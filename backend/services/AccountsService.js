// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2020  flexiWAN Ltd.

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

const crypto = require('crypto');
const Service = require('./Service');
const logger = require('../logging/logging')({ module: module.filename, type: 'req' });

const Accounts = require('../models/accounts');
const Users = require('../models/users');
const { membership } = require('../models/membership');
const authSessions = require('../authSessions');
const pick = require('lodash/pick');
const { getToken } = require('../tokens');
const issueSessionTokens = require('../sessionTokens');
const { setAuthCookies } = require('../utils/authCookies');
const {
  getUserAccounts,
  getUserOrganizations
} = require('../utils/membershipUtils');

// revokeAll owns the single authVersion increment per user.
const revokeAccountMembers = async (accountId) => {
  const rows = await membership.find({ account: accountId });
  const seen = new Set();
  for (const row of rows || []) {
    if (row?.user == null) continue;
    const key = String(row.user);
    if (seen.has(key)) continue;
    seen.add(key);
    await authSessions.revokeAll(row.user);
  }
};

const runConditionalMarkerUpdate = async (operation, filter, update, context) => {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await Users.findOneAndUpdate(
        filter,
        update,
        { upsert: false, new: false }
      );
      return;
    } catch (err) {
      lastError = err;
      if (attempt === 1) {
        logger.warn(`Retrying accountSwitchMarker ${operation} after write failure`, {
          params: { ...context, attempt, reason: err.message }
        });
      }
    }
  }
  logger.error(`Failed accountSwitchMarker ${operation} after retry`, {
    params: { ...context, reason: lastError.message }
  });
  throw lastError;
};

class AccountsService {
  /**
   * Select the API fields from mongo Account Object
   *
   * @param {mongo Account Object} item
   */
  static selectAccountParams (item, onlySubscriptionStatus = false) {
    const items = [
      '_id',
      'isSubscriptionValid',
      'trial_end',
      'forceMfa'
    ];
    if (!onlySubscriptionStatus) {
      items.push(...[
        'companyType',
        'companyDesc',
        'name',
        'country'
      ]);
    }
    const ret = pick(item, items);
    ret._id = ret._id.toString();
    return ret;
  }

  /**
   * Get all AccessTokens
   *
   * offset Integer The number of items to skip before starting to collect the result set (optional)
   * limit Integer The numbers of items to return (optional)
   * returns List
   *
   * Important Note: this API bypass account permission check, return only necessary info
   **/
  static async accountsGET ({ offset, limit }, { user }) {
    try {
      // This API bypass account permission check, make sure to return only necessary info
      const accounts = await getUserAccounts(user, offset, limit);
      return Service.successResponse(accounts);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * Retrieve account information
   *
   * id String Numeric ID of the Account to retrieve information
   * returns Account
   **/
  static async accountsIdGET ({ id }, { user }) {
    try {
      if (user.defaultAccount._id.toString() !== id) {
        return Service.rejectResponse(
          'No permission to access this account', 403
        );
      }
      const account = await Accounts.findOne({ _id: id });
      const result = AccountsService.selectAccountParams(account);
      return Service.successResponse(result);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * Retrieve account subscription status information
   *
   * id String Numeric ID of the Account to retrieve information
   * returns Account with only subscription status
   *
   * Important NOTE: This API bypass the account permission check, must return only necessary data
   **/
  static async accountsIdSubscriptionStatusGET ({ id }, { user }) {
    try {
      // Validate that user is accessing this API while he has access to this account
      if (user?.defaultAccount?._id.toString() !== id) {
        return Service.rejectResponse(
          'No permission to access this account', 403
        );
      }
      const account = await Accounts.findOne({ _id: id });
      // This API bypass permissions, return only needed info
      const result = AccountsService.selectAccountParams(account, true);
      return Service.successResponse(result);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * Modify account information
   *
   * id String Numeric ID of the Account to modify
   * accountRequest AccountRequest  (optional)
   * returns Account
   **/
  static async accountsIdPUT ({ id, ...accountRequest }, req, response) {
    const user = req.user;
    try {
      if (user.defaultAccount._id.toString() !== id) {
        return Service.rejectResponse(
          'No permission to access this account', 403
        );
      }
      const {
        name, companyType, companyDesc, country, forceMfa
      } = accountRequest;

      const existing = await Accounts.findOne({ _id: id });
      const previousForceMfa = existing ? existing.forceMfa : undefined;

      const account = await Accounts.findOneAndUpdate(
        { _id: id },
        { $set: { name, companyType, companyDesc, country, forceMfa } },
        { upsert: false, new: true, runValidators: true });

      // A forceMfa change (especially turning it on) invalidates member sessions.
      // Do not increment authVersion here; revokeAll does that once per user.
      // Revocation bumps the caller's authVersion in the database, so the in-memory
      // user is stale. Re-read it and issue a new session; otherwise the response
      // JWT is already revoked.
      if (account && previousForceMfa !== forceMfa) {
        await revokeAccountMembers(id);
        const fresh = await Users.findOne({ _id: user._id })
          .populate('defaultAccount')
          .populate('defaultOrg');
        if (!fresh) {
          return Service.rejectResponse('User not found', 401);
        }
        if (!fresh.defaultAccount || fresh.defaultAccount._id == null) {
          fresh.defaultAccount = { ...user.defaultAccount };
        }
        if (String(fresh.defaultAccount._id) === String(id)) {
          fresh.defaultAccount.name = account.name;
        }
        if (!fresh.defaultOrg || fresh.defaultOrg._id == null) {
          fresh.defaultOrg = user.defaultOrg;
        }
        const { token, refreshToken } = await issueSessionTokens(
          fresh, user.isLoggedInWithMfa === true);
        response.setHeader('Refresh-JWT', token);
        response.setHeader('Refresh-Token', refreshToken);
        setAuthCookies(req, response, token, refreshToken);
      } else {
        // Update token. Unchanged forceMfa keeps the caller's current session.
        const token = await getToken({ user }, { accountName: account.name });
        response.setHeader('Refresh-JWT', token);
      }

      const result = AccountsService.selectAccountParams(account);
      return Service.successResponse(result);
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * Select account
   *
   * selectAccountRequest SelectAccountRequest
   * returns Account
   *
   * Important Note: This API bypass account permission check, return only necessary info
   **/
  static async accountsSelectPOST ({ ...accountSelectRequest }, req, res) {
    const user = req.user;
    const { account } = accountSelectRequest;

    try {
      // A scoped app access key or token cannot switch the caller's account.
      if (user.accessToken) {
        return Service.rejectResponse('No permission to access this account', 403);
      }
      if (!user.defaultAccount || !user.defaultAccount._id || !user._id) {
        return Service.rejectResponse('Error in selecting account', 500);
      }

      // If current account not changed, return OK
      if (user.defaultAccount._id.toString() === account) {
        // This API bypass permissions, return only needed info
        const result = AccountsService.selectAccountParams(user.defaultAccount, true);
        return Service.successResponse(result, 201);
      }

      const accounts = await getUserAccounts(user);
      const requestedAccount = accounts.find(acc => acc._id === account);
      if (!requestedAccount) {
        return Service.rejectResponse(
          'No permission to access this account', 403
        );
      }

      // if user logged in to account that doesn't force MFA on user,
      // but now wants to switch to account that does force it,
      // we don't allow it, The user should configure MFA for himself.
      if (!req.user.isLoggedInWithMfa && requestedAccount.forceMfa) {
        return Service.rejectResponse(
          'No permission to access this account. Two-Factor-authenticator is required', 403
        );
      }

      const previousAccount = user.defaultAccount;
      const previousAccountId = previousAccount._id;
      const previousOrg = user.defaultOrg || null;
      const previousOrgId = previousOrg ? (previousOrg._id || previousOrg) : null;
      const previousSessionId = user.authSessionId;

      // Load destination account and resolve its default organization before mutating
      // persisted user state so a failed session issuance never orphans the caller.
      const targetAccount = await Accounts.findOne({ _id: account });
      if (!targetAccount) {
        return Service.rejectResponse('No permission to access this account', 403);
      }

      const candidateOrgs = await getUserOrganizations(user, 0, 0, targetAccount._id);
      const nextOrg = candidateOrgs && typeof candidateOrgs === 'object'
        ? (candidateOrgs[Object.keys(candidateOrgs)[0]] || null)
        : null;

      const targetUser = {
        ...(typeof user.toObject === 'function' ? user.toObject() : user),
        _id: user._id,
        username: user.username,
        admin: user.admin,
        authVersion: user.authVersion,
        authTime: user.authTime,
        isLoggedInWithMfa: user.isLoggedInWithMfa,
        defaultAccount: targetAccount,
        defaultOrg: nextOrg
      };

      // Explicit session transition: issue the new destination-bound session BEFORE
      // committing defaultAccount so issuance failures leave DB and source session intact.
      const { token, refreshToken } = await issueSessionTokens(
        targetUser, user.isLoggedInWithMfa === true
      );
      const newSessionId = targetUser.authSessionId;
      const switchMarker = crypto.randomUUID();

      let accountCommitted = false;
      let markerHandled = false;
      let populatedUser;
      const markerContext = { userId: String(user._id), accountId: String(account) };
      try {
        try {
          const updUser = await Users.findOneAndUpdate(
            { _id: user._id },
            {
              $set: {
                defaultAccount: account,
                defaultOrg: nextOrg ? nextOrg._id : null,
                accountSwitchMarker: switchMarker
              }
            },
            { upsert: false, new: true }
          );
          if (!updUser) {
            throw new Error('Error in selecting account');
          }
          accountCommitted = true;

          populatedUser = typeof updUser.populate === 'function'
            ? (await updUser.populate('defaultAccount')) || updUser
            : updUser;
          if (!populatedUser || !populatedUser.defaultAccount) {
            throw new Error('Error in selecting account');
          }

          if (previousSessionId && previousSessionId !== newSessionId) {
            await authSessions.revokeCurrent(user._id, previousSessionId);
          }
        } catch (commitError) {
          let rollbackError = null;
          if (accountCommitted) {
            try {
              await runConditionalMarkerUpdate(
                'rollback',
                {
                  _id: user._id,
                  defaultAccount: account,
                  accountSwitchMarker: switchMarker
                },
                {
                  $set: {
                    defaultAccount: previousAccountId,
                    defaultOrg: previousOrgId
                  },
                  $unset: { accountSwitchMarker: 1 }
                },
                markerContext
              );
            } catch (err) {
              rollbackError = err;
            }
            markerHandled = true;
          }
          if (newSessionId && newSessionId !== previousSessionId) {
            try {
              await authSessions.revokeCurrent(user._id, newSessionId);
            } catch (revokeError) {
              logger.error('Failed to revoke uncommitted destination session', {
                params: { ...markerContext, reason: revokeError.message }
              });
            }
          }
          user.defaultAccount = previousAccount;
          user.defaultOrg = previousOrg;
          user.authSessionId = previousSessionId;
          if (rollbackError) {
            throw new Error(
              `${commitError.message}; account switch rollback failed: ${rollbackError.message}`
            );
          }
          throw commitError;
        }

        user.defaultAccount = populatedUser.defaultAccount;
        user.defaultOrg = nextOrg;
        user.authSessionId = newSessionId;

        res.setHeader('Refresh-JWT', token);
        res.setHeader('Refresh-Token', refreshToken);
        setAuthCookies(req, res, token, refreshToken);

        // This API bypass account permissions check, return only needed info
        // Still it's returned only if user has any permission to access this account
        const result = AccountsService.selectAccountParams(populatedUser.defaultAccount, true);
        return Service.successResponse(result, 201);
      } finally {
        if (accountCommitted && !markerHandled) {
          await runConditionalMarkerUpdate(
            'cleanup',
            { _id: user._id, accountSwitchMarker: switchMarker },
            { $unset: { accountSwitchMarker: 1 } },
            markerContext
          );
          markerHandled = true;
        }
      }
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }

  /**
   * Create new account
   *
   * registerAccountRequest RegisterAccountRequest  (optional)
   * returns Account
   **/
  static async accountsPOST ({ registerAccountRequest }, { user }) {
    try {
      return Service.successResponse('');
    } catch (e) {
      return Service.rejectResponse(
        e.message || 'Internal Server Error',
        e.status || 500
      );
    }
  }
}

module.exports = AccountsService;
