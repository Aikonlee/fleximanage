// flexiWAN SD-WAN software - flexiEdge,flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2019  flexiWAN Ltd.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

var configs = require('../configs')();
const express = require('express');
const router = express.Router();
const createError = require('http-errors');
const bodyParser = require('body-parser');
const User = require('../models/users');
const Account = require('../models/accounts');
const { membership, preDefinedPermissions } = require('../models/membership');
const auth = require('../authenticate');
const { getLoginProcessToken } = require('../tokens');
const issueSessionTokens = require('../sessionTokens');
const authSessions = require('../authSessions');
const { setAuthCookies, clearAuthCookies } = require('../utils/authCookies');
const cors = require('./cors');
const mongoConns = require('../mongoConns.js')();
const randomKey = require('../utils/random-key');
const {
  verifyIssuedAtQuery,
  resetPasswordIssuedAtQuery
} = require('../utils/emailTokenExpiry');
const mailer = require('../utils/mailer')(
  configs.get('mailerHost'),
  configs.get('mailerPort'),
  configs.get('mailerBypassCert', 'boolean')
);
const reCaptcha = require('../utils/recaptcha')(configs.get('captchaKey'), {
  enforced: process.env.NODE_ENV === 'production' || configs.get('environment') === 'production' ||
    configs.get('captchaEnforced', 'boolean')
});
const webHooks = require('../utils/webhooks')();
const logger = require('../logging/logging')({ module: module.filename, type: 'req' });
const { getUiServerUrl } = require('../utils/httpUtils');
const flexibilling = require('../flexibilling');
const { getUserOrganizations } = require('../utils/membershipUtils');
const { generateSecret, verifyCode } = require('../otp');
const { createHash } = require('crypto');
const SHA256 = value => createHash('sha256').update(value).digest('hex');
const rateLimit = require('express-rate-limit');
const MfaRateLimitStore = require('../utils/mfaRateLimitStore');
const jwt = require('jsonwebtoken');

router.use(bodyParser.json());

// Admin routes share the revocable session check with other user APIs.
const verifyAdminJWT = (req, res, next) => {
  auth.verifyUserJWT(req, res, err => {
    if (err) return next(err);
    if (req.user?.admin !== true) return next(createError(403, 'Admin access required'));
    next();
  });
};

// Error formatter
const formatErr = (err, msg) => {
  // Check for unique error. err.name is 'MongoServerError' since mongodb driver v4
  // (was 'MongoError' before) - match on the version-independent code instead
  if (err.code === 11000) {
    return ({ status: 500, error: 'User ' + msg.email + ' already exists' });
  } else if (err.name === 'ValidationError') {
    return ({ status: 500, error: err.message.split(':')[2] });
  } else {
    return ({ status: 500, error: err.message });
  }
};

// Per-account cooldown so a caller cannot rotate an email token indefinitely.
const EMAIL_TOKEN_COOLDOWN_MS = 60 * 1000;

const issuedWithinCooldown = (issuedAt) => {
  if (!issuedAt) return false;
  const issuedMs = new Date(issuedAt).getTime();
  return !Number.isNaN(issuedMs) && (Date.now() - issuedMs) < EMAIL_TOKEN_COOLDOWN_MS;
};

// register user
router.route('/register')
  .options(cors.corsWithOptions, (req, res) => { res.sendStatus(200); })
  .post(cors.corsWithOptions, async (req, res, next) => {
    let session = null;
    let registerUser = null;
    let registerAccount = null;

    // log info
    logger.info('Create account request', {
      params: {
        account: req.body.accountName,
        // PII masked
        email: req.body.email ? '***' : '',
        phoneNumber: req.body.userPhoneNumber ? '***' : '',
        country: req.body.country,
        companySize: req.body.companySize,
        usageType: req.body.serviceType,
        numSites: req.body.numberSites
      }
    });

    // check if registration is allowed
    if (!configs.get('allowUsersRegistration', 'boolean')) {
      return next(createError(500, 'Users registration is not allowed'));
    }

    // Validate password
    if (!auth.validatePassword(req.body.password)) return next(createError(500, 'Bad Password'));

    // Verify captcha
    if (!await reCaptcha.verifyReCaptcha(req.body.captcha, req.ip)) {
      return next(createError(401, 'Wrong Captcha'));
    }

    // Continue with registration
    let registerCustomerId;

    mongoConns.getMainDB().startSession()
      .then((_session) => {
        session = _session;
        return session.startTransaction();
      })
      .then(() => {
        return flexibilling.createCustomer({
          first_name: req.body.userFirstName,
          last_name: req.body.userLastName,
          email: req.body.email,
          company: req.body.accountName,
          billing_address: {
            first_name: req.body.userFirstName,
            last_name: req.body.userLastName,
            country: req.body.country || ''
          }
        });
      })
      .then(async customerId => {
        registerCustomerId = customerId;
        const subscription = await flexibilling.getAllSubscriptionsForQuery({
          'customer_id[is]': customerId
        });
        return Account.create([{
          name: req.body.accountName,
          country: req.body.country,
          companySize: req.body.companySize,
          serviceType: req.body.serviceType,
          numSites: req.body.numberSites,
          logoFile: '',
          billingCustomerId: customerId,
          isSubscriptionValid: true,
          trial_end: subscription?.[0]?.subscription?.trial_end ?? null
        }], { session: session });
      })
      .then((account) => {
        registerAccount = account[0];
        const validateKey = randomKey(30);
        registerUser = new User({
          username: req.body.email,
          name: req.body.userFirstName,
          lastName: req.body.userLastName,
          email: req.body.email,
          jobTitle: req.body.userJobTitle,
          phoneNumber: req.body.userPhoneNumber,
          admin: false,
          state: 'unverified',
          emailTokens: {
            verify: validateKey,
            invite: '',
            resetPassword: '',
            verifyIssuedAt: new Date()
          },
          defaultAccount: registerAccount._id,
          defaultOrg: null
        });
        return registerUser.validate();
      })
      .then(() => {
        return registerUser.setPassword(req.body.password);
      })
      .then(() => {
        registerUser.$session(session);
        return registerUser.save();
      })
      .then(() => {
        const mem = {
          user: registerUser._id,
          account: registerAccount._id,
          group: '',
          organization: null,
          to: 'account',
          role: 'owner',
          perms: preDefinedPermissions.account_owner
        };
        return membership.create([mem], { session: session });
      })
      .then(() => {
        const uiServerUrl = getUiServerUrl(req);
        const p = mailer.sendMailHTML(
          configs.get('mailerEnvelopeFromAddress'),
          configs.get('mailerFromAddress'),
          req.body.email,
          `Verify Your ${configs.get('companyName')} Account`,
          `<h2>Thank you for joining ${configs.get('companyName')}</h2>
            <b>Click below to verify your account:</b>
            <p><a href="${uiServerUrl}/verify-account?id=${
              registerUser._id
          }&t=${
            registerUser.emailTokens.verify
          }"><button style="color:#fff;background-color:#F99E5B;
            border-color:#F99E5B;font-weight:400;text-align:center;
            vertical-align:middle;border:1px solid transparent;
            padding:.375rem .75rem;font-size:1rem;line-height:1.5;
            border-radius:.25rem;
            cursor:pointer">Verify Account</button></a></p>
            <p>Your friends @ ${configs.get('companyName')}</p>`
        );
        return p;
      })
      .then(() => {
        return session.commitTransaction();
      })
      .then(async () => {
        // Session committed, set to null
        session = null;

        // Trigger web hook
        const webHookMessage = {
          account: req.body.accountName,
          firstName: req.body.userFirstName,
          lastName: req.body.userLastName,
          email: req.body.email,
          jobTitle: req.body.userJobTitle,
          phoneNumber: req.body.userPhoneNumber,
          country: req.body.country,
          companySize: req.body.companySize,
          usageType: req.body.serviceType,
          numSites: req.body.numberSites,
          companyType: '',
          companyDesc: '',
          state: 'unverified'
        };
        if (!await webHooks.sendToWebHook(configs.get('webHookAddUserUrl'),
          webHookMessage,
          configs.get('webHookAddUserSecret'))) {
          logger.error('Web hook call failed', { params: { message: webHookMessage } });
        }
        // Always resolve
        return Promise.resolve(true);
      })
      .then(() => {
        return res.status(200).json({ status: 'user registered' });
      })
      .catch(async (err) => {
        if (session) session.abortTransaction();

        // need to remove billing account
        if (registerCustomerId) {
          if (await flexibilling.removeCustomer({ id: registerCustomerId })) {
            logger.error('Deleted billing account', {
              params: { registerCustomerId: registerCustomerId }
            });
          } else {
            logger.error('Deleted billing account failed', {
              params: { registerCustomerId: registerCustomerId }
            });
          }
        }

        logger.error('Error in create account process', { params: { reason: err.message } });

        const fErr = formatErr(err, req.body);
        return next(createError(fErr.status, fErr.error));
      });
  });

// verify account again if user did not received a verification email
router.route('/reverify-account')
  .options(cors.corsWithOptions, (req, res) => { res.sendStatus(200); })
  .post(cors.corsWithOptions, async (req, res, next) => {
    if (typeof req.body.email !== 'string') {
      return next(createError(400, 'Invalid email format'));
    }
    const validateKey = randomKey(30);
    let blocked = false;
    return User.findOne({ email: req.body.email })
      .then((current) => {
        const verifyIssuedAt = current && current.emailTokens
          ? current.emailTokens.verifyIssuedAt
          : null;
        if (issuedWithinCooldown(verifyIssuedAt)) {
          blocked = true;
          next(createError(429, 'Please wait before requesting another verification email'));
          return null;
        }
        return User.findOneAndUpdate(
          // Query, use the email
          { email: req.body.email },
          // Update
          {
            'emailTokens.verify': validateKey,
            'emailTokens.verifyIssuedAt': new Date()
          },
          // Options
          { upsert: false, new: false }
        );
      })
      .then((resp) => {
        if (blocked) return null;
        const uiServerUrl = getUiServerUrl(req);
        // Send email if user found
        if (resp) {
          const p = mailer.sendMailHTML(
            configs.get('mailerEnvelopeFromAddress'),
            configs.get('mailerFromAddress'),
            req.body.email,
            `Re-Verify Your ${configs.get('companyName')} Account`,
            `<h2>Re-Verify Your ${configs.get('companyName')} Account</h2>
                <b>It has been requested to re-verify your account. If it is asked by yourself,
                   click below to re-verify your account. If you do not know who this is,
                   ignore this message.</b>
                <p><a href="${uiServerUrl}/verify-account?id=${
              resp._id
            }&t=${validateKey}"><button style="color:#fff;background-color:#F99E5B;
                 border-color:#F99E5B;font-weight:400;text-align:center;
                 vertical-align:middle;border:1px solid transparent;
                 padding:.375rem .75rem;font-size:1rem;line-height:1.5;
                 border-radius:.25rem;
                cursor:pointer">Re-Verify Account</button></a></p>
                <p>Your friends @ ${configs.get('companyName')}</p>`
          );
          return p;
        }
      })
      .then(() => {
        if (blocked) return null;
        // In case of re-verification, always return OK to not expose email addresses
        return res.status(200).json({ status: 'account reverified' });
      })
      .catch((err) => {
        logger.error('Account Re-verification process failed', { params: { reason: err.message } });
        return next(createError(500, 'Account Re-verification process failed'));
      });
  });

// verify account
router.route('/verify-account')
  .options(cors.corsWithOptions, (req, res) => { res.sendStatus(200); })
  .post(cors.corsWithOptions, async (req, res, next) => {
    if (!req.body.id || !req.body.token || typeof req.body.id !== 'string' || typeof req.body.token !== 'string' || req.body.id === '' || req.body.token === '') {
      return next(createError(500, 'Verification Error'));
    }

    User.findOneAndUpdate(
      // Query, use the email and verification token. $gte rejects a missing
      // or expired verifyIssuedAt (older than 24 hours) without consuming it.
      {
        _id: req.body.id,
        'emailTokens.verify': req.body.token,
        'emailTokens.verifyIssuedAt': verifyIssuedAtQuery()
      },
      // Update
      {
        state: 'verified',
        'emailTokens.verify': '',
        'emailTokens.verifyIssuedAt': null
      },
      // Options
      { upsert: false, new: false }
    )
      .then(async (resp) => {
        if (resp) return res.status(200).json({ status: 'account verified' });
        // No match. A token that is still stored failed the issued-at check
        // (missing or older than 24 hours) and must be rejected. Only a cleared
        // token on an already-verified account is a repeat click.
        const existing = await User.findById(req.body.id);
        const tokenStillPresent = existing && existing.emailTokens &&
          existing.emailTokens.verify === req.body.token;
        if (tokenStillPresent) {
          return next(createError(500, 'Verification Error'));
        }
        if (existing && existing.state === 'verified') {
          return res.status(200).json({ status: 'account already verified' });
        }
        return next(createError(500, 'Verification Error'));
      })
      .catch((err) => {
        logger.error('Verification Error', { params: { reason: err.message } });
        return next(createError(500, 'Verification Error'));
      });
  });

// Change password (logged in user)
router.route('/change-password')
  .options(cors.corsWithOptions, (req, res) => { res.sendStatus(200); })
  .post(cors.corsWithOptions, auth.verifyUserJWT, async (req, res, next) => {
    try {
      if (!req.body.oldPassword || !req.body.newPassword) {
        return next(createError(400, 'Missing fields'));
      }

      // Use passport-local-mongoose's changePassword
      req.user.changePassword(req.body.oldPassword, req.body.newPassword, async (err) => {
        if (err) {
          if (err.name === 'IncorrectPasswordError') {
            return next(createError(403, 'Incorrect old password'));
          }
          return next(createError(500, err.message));
        }
        try {
          await authSessions.revokeAll(req.user._id);
          // Route unit tests stub this model as a plain object; production always has updateOne.
          if (typeof User.updateOne === 'function') {
            await User.updateOne(
              { _id: req.user._id },
              {
                $set: {
                  'emailTokens.resetPassword': '',
                  'emailTokens.resetPasswordIssuedAt': null
                }
              }
            );
          }
          res.status(200).json({ status: 'password changed' });
        } catch (error) {
          next(error);
        }
      });
    } catch (err) {
      return next(createError(500, err.message));
    }
  });

/**
 * Send reset password mail
 * @param {Object} req = request
 * @param {Object} res = response
 * @param {Function} next = next middleware
 */
const resetPassword = (req, res, next) => {
  if (!req.body.email) return next(createError(500, 'Password Reset Error'));

  const validateKey = randomKey(30);
  let blocked = false;
  return User.findOne({ email: req.body.email, state: 'verified' })
    .then((current) => {
      const issuedAt = current && current.emailTokens
        ? current.emailTokens.resetPasswordIssuedAt
        : null;
      if (issuedWithinCooldown(issuedAt)) {
        blocked = true;
        next(createError(429, 'Please wait before requesting another password reset email'));
        return null;
      }
      return User.findOneAndUpdate(
        // Query, use the email and make sure user is verified when reset password
        { email: req.body.email, state: 'verified' },
        // Update
        {
          'emailTokens.resetPassword': validateKey,
          'emailTokens.resetPasswordIssuedAt': new Date()
        },
        // Options
        { upsert: false, new: false }
      );
    })
    .then((resp) => {
      if (blocked) return null;
      // Send email if user found
      if (resp) {
        const uiServerUrl = getUiServerUrl(req);
        const p = mailer.sendMailHTML(
          configs.get('mailerEnvelopeFromAddress'),
          configs.get('mailerFromAddress'),
          req.body.email,
          `Reset Password for Your ${configs.get('companyName')} Account`,
          `<h2>Reset Password for your ${configs.get('companyName')} Account</h2>
                <b>It has been requested to reset your account password. If it is asked by yourself,
                   click below to reset your password. If you do not know who this is,
                   ignore this message.</b>
                <p><a href="${uiServerUrl}/reset-password?id=${
            resp._id
          }&t=${validateKey}"><button style="color:#fff;
          background-color:#F99E5B;border-color:#F99E5B;
          font-weight:400;text-align:center;
          vertical-align:middle;border:1px solid transparent;
          padding:.375rem .75rem;font-size:1rem;line-height:1.5;
          border-radius:.25rem;
                cursor:pointer">Reset Password</button></a></p>
                <p>Your friends @ ${configs.get('companyName')}</p>`
        );
        return p;
      }
    })
    .then(() => {
      if (blocked) return null;
      // In case of password reset, always return OK to not expose email addresses
      return res.status(200).json({ status: 'password reset initiated' });
    })
    .catch((err) => {
      logger.error('Account Password Reset process failed', { params: { reason: err.message } });
      return next(createError(500, 'Password Reset process failed'));
    });
};

/**
 * Update password using email and token
 * @param {Object} req = request
 * @param {Object} res = response
 * @param {Function} next = next middleware
 */
const updatePassword = (req, res, next) => {
  if (!req.body.id || !req.body.token || !req.body.password ||
    req.body.id === '' || req.body.token === '') {
    return next(createError(500, 'Password Reset Error'));
  }

  // Validate password
  if (!auth.validatePassword(req.body.password)) return next(createError(500, 'Bad Password'));

  let registerUser = null;
  User.findOneAndUpdate(
    // Query, use the id and password reset token. $gte rejects a missing
    // or expired resetPasswordIssuedAt (older than 1 hour).
    {
      _id: req.body.id,
      'emailTokens.resetPassword': req.body.token,
      'emailTokens.resetPasswordIssuedAt': resetPasswordIssuedAtQuery()
    },
    // Update
    {
      state: 'verified',
      'emailTokens.resetPassword': '',
      'emailTokens.resetPasswordIssuedAt': null
    },
    // Options
    { upsert: false, new: true }
  )
    .then((resp) => {
      if (!resp) throw new Error('Password Reset Error');
      else {
        registerUser = resp;
        return registerUser.setPassword(req.body.password);
      }
    })
    .then(() => {
      return registerUser.save();
    })
    .then(async () => {
      await authSessions.revokeAll(registerUser._id);
      return res.status(200).json({ status: 'password reset' });
    })
    .catch((err) => {
      logger.error('Password Reset Error', { params: { reason: err.message } });
      return next(createError(500, 'Password Reset Error'));
    });
};

/**
 * Reset password API
 * There are two modes:
 * 1) type = reset - send a mail to reset the password
 * 2) type = update - make the actual update of the password
 */
router.route('/reset-password')
  .options(cors.corsWithOptions, (req, res) => { res.sendStatus(200); })
  .post(cors.corsWithOptions, async (req, res, next) => {
    if (!req.body.type) return next(createError(500, 'Password Reset Error'));

    // Call function based on request type
    if (req.body.type === 'reset') return resetPassword(req, res, next);
    else return updatePassword(req, res, next);
  });

// This endpoint receives the username and password from the initial screen of the login process.
// Here, a check is made as to whether to allow the user to enter,
// or whether he needs to pass another identification factor (like 2FA)
router.route('/login')
  .options(cors.corsWithOptions, (req, res) => { res.sendStatus(200); })
  .post(cors.corsWithOptions, auth.verifyUserLocal, async (req, res) => {
    // if user enabled 2fa or account forces using it- send login process token
    // else, allow login without mfa
    const isUserEnabledMfa = req.user?.mfa?.enabled;
    const isAccountForcesIt = req.user?.defaultAccount?.forceMfa;
    if (isUserEnabledMfa || isAccountForcesIt) {
      const token = await getLoginProcessToken(req.user);
      res.status(200).json({ name: req.user.name, token });
    } else {
      return await sendJwtToken(req, res, false);
    }
  });

// This endpoint returns to the user his options,
// which he can use to identify himself and enter the system
router.route('/login/methods')
  .options(cors.corsWithOptions, (req, res) => { res.sendStatus(200); })
  .get(cors.corsWithOptions, auth.verifyUserOrLoginJWT, async (req, res) => {
    const methods = {
      recoveryCodes: 0,
      authenticatorApp: 0
    };

    const recoveryCodes = req.user?.mfa?.recoveryCodes ?? [];
    // Check if there is a recovery code,
    // and also if there is at least one that has not been used yet
    if (recoveryCodes.length > 0 && recoveryCodes.some(c => c.usedTime === null)) {
      methods.recoveryCodes = 1;
    }

    if (req.user?.mfa?.enabled) {
      methods.authenticatorApp = 1;
    }

    res.status(200).json({ methods });
  });

// Get current user info
router.route('/me')
  .options(cors.corsWithOptions, (req, res) => { res.sendStatus(200); })
  .get(cors.corsWithOptions, auth.verifyUserJWT, async (req, res) => {
    try {
      const orgs = await getUserOrganizations(req.user);
      res.status(200).json({
        _id: req.user._id,
        email: req.user.email,
        name: req.user.name,
        lastName: req.user.lastName,
        username: req.user.username,
        jobTitle: req.user.jobTitle,
        phoneNumber: req.user.phoneNumber,
        state: req.user.state,
        admin: req.user.admin,
        orgs: Object.keys(orgs)
      });
    } catch (err) {
      logger.error('Get user info failed', { params: { error: err.message } });
      res.status(500).json({ error: 'Failed to fetch user info' });
    }
  });

// Authentication check is done within passport, if passed, no login error exists
router.route('/auth')
  .options(cors.corsWithOptions, (req, res) => { res.sendStatus(200); })
  .post(cors.corsWithOptions, auth.verifyUserLocal, async (req, res) => {
    const orgs = await getUserOrganizations(req.user);
    res.status(200).json({
      email: req.user.email,
      name: `${req.user.name} ${req.user.lastName}`,
      orgs: Object.keys(orgs)
    });
  });

// Passport exposes a function logout() on the req object which removes the req.user
router.route('/logout')
  .options(cors.corsWithOptions, (req, res) => { res.sendStatus(200); })
  .get(cors.corsWithOptions, auth.verifyUserJWT, async (req, res, next) => {
    try {
      await authSessions.revokeCurrent(req.user._id, req.user.authSessionId);
      clearAuthCookies(res);
      res.status(200).json({ status: 'logged out' });
    } catch (err) {
      next(err);
    }
  });

// This endpoint checks if user enabled and verified 2FA for himself.
// Once user enabled it, he cannot login without it.
router.route('/mfa/isEnabled')
  .options(cors.corsWithOptions, (req, res) => { res.sendStatus(200); })
  .get(cors.corsWithOptions, auth.verifyUserOrLoginJWT, async (req, res) => {
    res.status(200).json({ isEnabled: req?.user?.mfa?.enabled });
  });

// This endpoint generates for the user the URI that will be displayed in the UI as a QR code
// that can be scanned by an authenticator application
router.route('/mfa/getMfaConfigUri')
  .options(cors.corsWithOptions, (req, res) => { res.sendStatus(200); })
  .get(cors.corsWithOptions, auth.verifyUserOrLoginJWT, async (req, res, next) => {
    // if verified - don't generate
    if (req.user.mfa.enabled) {
      return next(createError(500, 'Secret already verified'));
    }

    // generate unique secret for user
    // this secret will be used to check the verification code sent by user
    const userName = req.user.email;
    const secret = await generateSecret(configs.get('companyName'), userName);

    // save secret for the user
    await User.findOneAndUpdate(
      { _id: req.user._id },
      // keep the last 30
      { $push: { 'mfa.unverifiedSecrets': { $each: [secret.secret], $slice: -30 } } },
      { upsert: false });

    res.status(200).json({ configUri: secret.uri });
  });

// 2fa token is changed every 30 seconds.
// Hence allow 5 times in 30 seconds to verify,
const mfaRateLimitStore = new MfaRateLimitStore(1000 * 30); // 30 seconds
const verifyMfaRateLimit = rateLimit({
  store: mfaRateLimitStore,
  windowMs: 1000 * 30,
  max: 5, // Allow 5 times in token period. The 6th request will be blocked
  keyGenerator: (req) => {
    try {
      const bearer = req.headers.authorization?.split(' ')[1];
      const decoded = jwt.verify(bearer, configs.get('userTokenSecretKey'));
      return String(decoded._id || decoded.userId || req.ip);
    } catch (error) {
      return req.ip;
    }
  },
  message: { error: 'Too many attempts. Please wait and try again later' },
  onLimitReached: (req, res, options) => {
    logger.warn(
      'MFA versification rate limit exceeded. blocking request for one second', {
        params: { ip: req.ip },
        req: req
      });
  }
});

// This endpoint verifies user code with his unique secret.
router.route('/mfa/verify')
  .options(cors.corsWithOptions, (req, res) => { res.sendStatus(200); })
  .post(
    cors.corsWithOptions,
    auth.verifyUserOrLoginJWT,
    verifyMfaRateLimit,
    async (req, res, next) => {
      if (!req.body.token) {
        return next(createError(401, 'Token is required'));
      }

      let secrets = [];

      // Check with which secret we need to verify the code.
      if (req.user.mfa.secret) {
        // if user already enabled and verified 2fa, verify code with this verified secret.
        secrets.push(req.user.mfa.secret);
      } else if (req.user.mfa.unverifiedSecrets.length > 0) {
        // if user didn't enabled 2fa and wants to verify it on first time,
        // verify code with this unverifiedSecrets secrets code.
        secrets = req.user.mfa.unverifiedSecrets;
      } else {
        return next(createError(401, 'Multi-Factor is not configured'));
      }

      let validated = null;
      for (const secret of secrets) {
        const isValid = verifyCode(req.body.token, secret);
        if (isValid) {
          validated = secret;
          break;
        }
      }

      if (!validated) {
        return next(createError(403, 'Invalid Code'));
      }

      const updateQuery = { $set: {} };
      if (!req.user.mfa.secret) {
        updateQuery.$set['mfa.secret'] = validated;
      }

      if (!req.user.mfa.enabled) {
        updateQuery.$set['mfa.enabled'] = true;
      }

      if (req.user.mfa.unverifiedSecrets.length > 0) {
        updateQuery.$set['mfa.unverifiedSecrets'] = [];
      }

      if (Object.keys(updateQuery.$set).length > 0) {
        // save secret for the user
        await User.findOneAndUpdate(
          { _id: req.user._id },
          updateQuery,
          { upsert: false }
        );
        if (updateQuery.$set['mfa.enabled']) {
          req.user.authVersion = await authSessions.revokeAll(req.user._id);
        }
      }

      return await sendJwtToken(req, res, validated !== null);
    });

// This function generates the JWT after the authentication process is complete.
// With this token, the user can access and receive the organization's information.
const sendJwtToken = async (req, res, mfaVerified) => {
  const { token, refreshToken } = await issueSessionTokens(req.user, mfaVerified);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Refresh-JWT', token);
  res.setHeader('refresh-token', refreshToken);
  setAuthCookies(req, res, token, refreshToken);
  res.json({ name: req.user.name, status: 'logged in' });
};

router.route('/mfa/generateRecoveryCodes')
  .options(cors.corsWithOptions, (req, res) => { res.sendStatus(200); })
  .get(cors.corsWithOptions, auth.verifyUserJWT, async (req, res, next) => {
    if (!req?.user?.mfa?.enabled) {
      return next(createError(403, 'Two-Factor authentication is not configured'));
    }

    const codes = []; // send to user as clear text
    const hashed = []; // store hashed in DB

    if (req?.user?.mfa?.recoveryCodes?.length > 0 && req.query.regenerate !== 'true') {
      return res.json({ codes });
    }

    for (let i = 0; i < 10; i++) {
      const code = randomKey(40);
      codes.push(code);
      hashed.push({ code: SHA256(code).toString(), usedTime: null });
    };

    await User.findOneAndUpdate(
      { _id: req.user._id },
      { $set: { 'mfa.recoveryCodes': hashed } },
      { upsert: false }
    );

    res.json({ codes });
  });

router.route('/mfa/verifyRecoveryCode')
  .options(cors.corsWithOptions, (req, res) => { res.sendStatus(200); })
  .post(cors.corsWithOptions, auth.verifyUserOrLoginJWT, verifyMfaRateLimit,
    async (req, res, next) => {
      const requestedCode = req.body?.recoveryCode;
      if (typeof requestedCode !== 'string' || !requestedCode.trim()) {
        return next(createError(403, 'Recovery code is required'));
      }
      const hashedCode = SHA256(requestedCode.trim()).toString();
      // Match and consume atomically so concurrent requests cannot reuse a code.
      // A previously consumed, different code must not prevent the next valid code.
      const updatedUser = await User.findOneAndUpdate({
        _id: req.user._id,
        'mfa.enabled': true,
        'mfa.recoveryCodes': { $elemMatch: { code: hashedCode, usedTime: null } }
      }, {
        $set: { 'mfa.recoveryCodes.$.usedTime': new Date() }
      }, { new: true });
      if (!updatedUser) return next(createError(403, 'Recovery code is invalid or already used'));
      return await sendJwtToken(req, res, true);
    });

// Batch verify users by admin (must come before /:userId/verify to avoid route conflict)
router.route('/verify/batch')
  .options(cors.corsWithOptions, (req, res) => { res.sendStatus(200); })
  .post(cors.corsWithOptions, verifyAdminJWT, async (req, res, next) => {
    try {
      if (!req.body.ids || !Array.isArray(req.body.ids) || req.body.ids.length === 0) {
        return next(createError(400, 'Invalid user IDs'));
      }

      const result = await User.updateMany(
        { _id: { $in: req.body.ids }, state: 'unverified' },
        { state: 'verified' }
      );

      logger.info('Batch user verification', {
        params: { count: result.modifiedCount, adminId: req.user._id }
      });

      return res.status(200).json({
        status: 'batch verification completed',
        verifiedCount: result.modifiedCount
      });
    } catch (err) {
      logger.error('Batch verification failed', {
        params: { reason: err.message }
      });
      return next(createError(500, 'Batch verification failed'));
    }
  });

// Verify user by admin (single user)
router.route('/:userId/verify')
  .options(cors.corsWithOptions, (req, res) => { res.sendStatus(200); })
  .post(cors.corsWithOptions, verifyAdminJWT, async (req, res, next) => {
    try {
      const user = await User.findOneAndUpdate(
        { _id: req.params.userId, state: 'unverified' },
        { state: 'verified' },
        { new: true }
      );

      if (!user) {
        return next(createError(404, 'User not found or already verified'));
      }

      logger.info('User verified by admin', {
        params: { userId: req.params.userId, adminId: req.user._id }
      });

      return res.status(200).json({ status: 'user verified', userId: user._id });
    } catch (err) {
      logger.error('User verification failed', {
        params: { userId: req.params.userId, reason: err.message }
      });
      return next(createError(500, 'Verification failed'));
    }
  });

// Flip the admin flag only where it differs, then revoke just those users.
// authSessions.revokeAll owns the single authVersion increment per changed user.
const setAdminFlag = async (ids, admin) => {
  const updated = await Promise.all([...new Set(ids.map(String))].map(async id => {
    try {
      return await User.findOneAndUpdate(
        { _id: id, admin: admin ? { $ne: true } : true },
        { admin },
        { new: true }
      );
    } catch (err) {
      if (err.name === 'CastError') return null; // malformed id: nothing to change
      throw err;
    }
  }));
  const changed = updated.filter(Boolean).map(user => user._id);
  const results = await Promise.allSettled(changed.map(id => authSessions.revokeAll(id)));
  const failure = results.find(result => result.status === 'rejected' &&
    result.reason?.message !== 'User not found'); // user deleted concurrently: nothing to revoke
  if (failure) throw failure.reason;
  return changed;
};

// Batch promote/demote admin (must come before /:userId/admin to avoid route conflict)
router.route('/admin/batch')
  .options(cors.corsWithOptions, (req, res) => { res.sendStatus(200); })
  .post(cors.corsWithOptions, verifyAdminJWT, async (req, res, next) => {
    try {
      const { promote, demote } = req.body;

      if (promote && Array.isArray(promote) && promote.length > 0) {
        const changed = await setAdminFlag(promote, true);
        logger.info('Batch user promotion', {
          params: { count: changed.length, adminId: req.user._id }
        });
        return res.status(200).json({
          status: 'batch promotion completed',
          promotedCount: changed.length
        });
      } else if (demote && Array.isArray(demote) && demote.length > 0) {
        const changed = await setAdminFlag(demote, false);
        logger.info('Batch user demotion', {
          params: { count: changed.length, adminId: req.user._id }
        });
        return res.status(200).json({
          status: 'batch demotion completed',
          demotedCount: changed.length
        });
      } else {
        return next(createError(400, 'Invalid request: provide promote or demote array'));
      }
    } catch (err) {
      logger.error('Batch admin operation failed', {
        params: { reason: err.message }
      });
      return next(createError(500, 'Batch admin operation failed'));
    }
  });

// Promote/Demote admin (single user)
router.route('/:userId/admin')
  .options(cors.corsWithOptions, (req, res) => { res.sendStatus(200); })
  .put(cors.corsWithOptions, verifyAdminJWT, async (req, res, next) => {
    try {
      const user = await User.findOneAndUpdate(
        { _id: req.params.userId },
        { admin: true },
        { new: true }
      );

      if (!user) {
        return next(createError(404, 'User not found'));
      }

      await authSessions.revokeAll(user._id);
      logger.info('User promoted to admin', {
        params: { userId: req.params.userId, adminId: req.user._id }
      });

      return res.status(200).json({ status: 'user promoted', userId: user._id });
    } catch (err) {
      logger.error('User promotion failed', {
        params: { userId: req.params.userId, reason: err.message }
      });
      return next(createError(500, 'Promotion failed'));
    }
  })
  .delete(cors.corsWithOptions, verifyAdminJWT, async (req, res, next) => {
    try {
      const user = await User.findOneAndUpdate(
        { _id: req.params.userId },
        { admin: false },
        { new: true }
      );

      if (!user) {
        return next(createError(404, 'User not found'));
      }

      await authSessions.revokeAll(user._id);
      logger.info('User demoted from admin', {
        params: { userId: req.params.userId, adminId: req.user._id }
      });

      return res.status(200).json({ status: 'user demoted', userId: user._id });
    } catch (err) {
      logger.error('User demotion failed', {
        params: { userId: req.params.userId, reason: err.message }
      });
      return next(createError(500, 'Demotion failed'));
    }
  });

// Default exports
module.exports = router;
