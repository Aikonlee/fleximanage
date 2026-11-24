/** @jest-environment node */
const fs = require('fs');
const path = require('path');

jest.mock('../configs', () => () => ({
  get: (key, type) => {
    if (key === 'allowUsersRegistration') return true;
    if (type === 'list') return ['https://ui.invalid'];
    if (type === 'boolean') return false;
    if (key === 'companyName') return 'TestCo';
    if (key === 'corsWhiteList') return [];
    return '';
  }
}));

const mockDbSession = {
  startTransaction: jest.fn(async () => {}),
  commitTransaction: jest.fn(async () => {}),
  abortTransaction: jest.fn(async () => {})
};
const mockStartSession = jest.fn(async () => mockDbSession);
jest.mock('../mongoConns.js', () => () => ({
  getMainDB: () => ({ startSession: mockStartSession })
}));

const mockFlexibilling = {
  createCustomer: jest.fn(async () => 'cust-123'),
  getAllSubscriptionsForQuery: jest.fn(async () => []),
  removeCustomer: jest.fn(async () => true)
};
jest.mock('../flexibilling', () => mockFlexibilling);

jest.mock('../models/accounts', () => ({
  create: jest.fn(async () => [{ _id: 'acct-123' }])
}));

jest.mock('../models/membership', () => ({
  membership: { create: jest.fn(async () => [{ _id: 'mem-123' }]) },
  preDefinedPermissions: { account_owner: { owner: true } }
}));

let mockSaveImplementation = async () => {};
jest.mock('../models/users', () => {
  const Users = jest.fn(function (data) {
    Object.assign(this, data, { _id: 'user-123' });
    this.validate = jest.fn(async () => {});
    this.setPassword = jest.fn(async () => {});
    this.$session = jest.fn();
    this.save = jest.fn((...args) => mockSaveImplementation(...args));
  });
  Object.assign(Users, {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    findById: jest.fn(),
    updateOne: jest.fn(async () => ({}))
  });
  return Users;
});

jest.mock('../authenticate', () => {
  const validatePassword = (password) =>
    password !== null && password !== undefined && password.length >= 8;
  const validateRegistrationPassword = (password) => {
    if (typeof password !== 'string' || password.length < 12) return false;
    const classes = [
      /[a-z]/.test(password),
      /[A-Z]/.test(password),
      /[0-9]/.test(password),
      /[^a-zA-Z0-9\s]/.test(password)
    ].filter(Boolean).length;
    return classes >= 3;
  };
  return {
    verifyUserLocal: (req, res, next) => next(),
    verifyUserJWT: jest.fn((req, res, next) => next()),
    verifyUserOrLoginJWT: (req, res, next) => next(),
    validatePassword,
    validateRegistrationPassword
  };
});

jest.mock('../utils/mailer', () => {
  const sendMailHTML = jest.fn(async () => true);
  const factory = () => ({ sendMailHTML });
  factory.sendMailHTML = sendMailHTML;
  return factory;
});

jest.mock('../utils/recaptcha', () => {
  const verifyReCaptcha = jest.fn(async () => true);
  const factory = () => ({ verifyReCaptcha });
  factory.verifyReCaptcha = verifyReCaptcha;
  return factory;
});

jest.mock('../utils/webhooks', () => {
  const sendToWebHook = jest.fn(async () => true);
  const factory = () => ({ sendToWebHook });
  factory.sendToWebHook = sendToWebHook;
  return factory;
});

jest.mock('../utils/membershipUtils', () => ({ getUserOrganizations: jest.fn() }));
jest.mock('../otp', () => ({ verifyCode: jest.fn(), generateSecret: jest.fn() }));
jest.mock('express-rate-limit', () => () => (req, res, next) => next());
jest.mock('../utils/mfaRateLimitStore', () => class MfaRateLimitStore {});
jest.mock('../logging/logging', () => {
  const info = jest.fn();
  const warn = jest.fn();
  const error = jest.fn();
  const factory = () => ({ info, warn, error });
  factory.info = info;
  factory.warn = warn;
  factory.error = error;
  return factory;
});
jest.mock('../tokens', () => ({
  getLoginProcessToken: jest.fn(),
  getToken: jest.fn(),
  getRefreshToken: jest.fn(),
  verifyToken: jest.fn()
}));
jest.mock('../sessionTokens', () => jest.fn());
jest.mock('../authSessions', () => ({
  revokeCurrent: jest.fn(),
  revokeAll: jest.fn(async () => {})
}));

const Account = require('../models/accounts');
const User = require('../models/users');
const { membership } = require('../models/membership');
const sendMailHTML = require('../utils/mailer').sendMailHTML;
const verifyReCaptcha = require('../utils/recaptcha').verifyReCaptcha;
const sendToWebHook = require('../utils/webhooks').sendToWebHook;
const loggerMock = require('../logging/logging');
const router = require('../routes/users');

const handler = (routePath, method) => router.stack
  .find(layer => layer.route?.path === routePath)
  .route.stack.filter(layer => layer.method === method).at(-1).handle;

const makeRes = () => {
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const res = {
    statusCode: 0,
    body: undefined,
    done,
    status (code) {
      this.statusCode = code;
      return this;
    },
    json: jest.fn(function (payload) {
      res.body = payload;
      resolveDone(payload);
      return res;
    })
  };
  return res;
};

const makeNext = () => {
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const next = jest.fn((err) => {
    resolveDone(err);
  });
  next.done = done;
  return next;
};

const validRegistrationBody = (overrides = {}) => ({
  accountName: 'Acme Corp',
  userFirstName: 'Alice',
  userLastName: 'Tester',
  email: 'alice@example.com',
  userJobTitle: 'Engineer',
  userPhoneNumber: '+15551234567',
  country: 'US',
  companySize: '1-10',
  serviceType: 'general',
  numberSites: 1,
  password: 'StrongPassword12!',
  captcha: 'valid-captcha-token',
  ...overrides
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSaveImplementation = async () => {};
  verifyReCaptcha.mockResolvedValue(true);
  mockFlexibilling.createCustomer.mockResolvedValue('cust-123');
  mockFlexibilling.getAllSubscriptionsForQuery.mockResolvedValue([]);
  mockFlexibilling.removeCustomer.mockResolvedValue(true);
  Account.create.mockResolvedValue([{ _id: 'acct-123' }]);
  membership.create.mockResolvedValue([{ _id: 'mem-123' }]);
  sendMailHTML.mockResolvedValue(true);
  sendToWebHook.mockResolvedValue(true);
});

describe('open-registration hardening', () => {
  test('duplicate email registration returns identical 200 response, aborts tx, and logs warn',
    async () => {
      // 1) Baseline successful registration
      const okRes = makeRes();
      const okNext = makeNext();
      await handler('/register', 'post')(
        { body: validRegistrationBody(), ip: '198.51.100.1', get: () => undefined },
        okRes,
        okNext
      );
      await okRes.done;

      expect(okNext).not.toHaveBeenCalled();
      expect(okRes.statusCode).toBe(200);
      expect(okRes.body).toEqual({ status: 'user registered' });
      expect(mockDbSession.commitTransaction).toHaveBeenCalledTimes(1);

      jest.clearAllMocks();

      // 2) Duplicate registration (Mongo code 11000 on user email or username index)
      for (const keyPattern of [{ email: 1 }, { username: 1 }]) {
        jest.clearAllMocks();
        const dupErr = Object.assign(
          new Error('E11000 duplicate key error dup key: { email: "alice@example.com" }'),
          { code: 11000, name: 'MongoServerError', keyPattern }
        );
        mockSaveImplementation = async () => { throw dupErr; };

        const dupRes = makeRes();
        const dupNext = makeNext();
        await handler('/register', 'post')(
          { body: validRegistrationBody(), ip: '198.51.100.2', get: () => undefined },
          dupRes,
          dupNext
        );
        await dupRes.done;

        // Exact same public response as success, no error body
        expect(dupNext).not.toHaveBeenCalled();
        expect(dupRes.statusCode).toBe(okRes.statusCode);
        expect(dupRes.body).toEqual(okRes.body);
        expect(dupRes.body).toEqual({ status: 'user registered' });

        // Transaction aborted, billing customer removed, no membership/email/webhook
        expect(mockDbSession.abortTransaction).toHaveBeenCalledTimes(1);
        expect(mockDbSession.commitTransaction).not.toHaveBeenCalled();
        expect(mockFlexibilling.removeCustomer).toHaveBeenCalledWith({ id: 'cust-123' });
        expect(membership.create).not.toHaveBeenCalled();
        expect(sendMailHTML).not.toHaveBeenCalled();
        expect(sendToWebHook).not.toHaveBeenCalled();

        // Structured warn emitted without leaking PII or tokens
        expect(loggerMock.warn).toHaveBeenCalledTimes(1);
        expect(loggerMock.warn.mock.calls[0][0]).toMatch(/duplicate/i);
        const warnParams = loggerMock.warn.mock.calls[0][1].params;
        const serializedWarn = JSON.stringify(loggerMock.warn.mock.calls[0]);
        expect(warnParams).not.toHaveProperty('ip');
        expect(serializedWarn).not.toContain('alice@example.com');
        expect(serializedWarn).not.toContain('198.51.100.2');
        expect(serializedWarn).not.toContain('valid-captcha-token');
        const createdUser = User.mock.instances.at(-1);
        expect(serializedWarn).not.toContain(createdUser.emailTokens.verify);
        expect(loggerMock.error).not.toHaveBeenCalledWith(
          'Error in create account process',
          expect.anything()
        );
      }
    });

  test('unrelated 11000 errors (account, membership, non-email user index) reach next(err)',
    async () => {
      const cases = [
        {
          name: 'Account.create 11000',
          setup: () => {
            Account.create.mockRejectedValueOnce(Object.assign(
              new Error('E11000 duplicate key error on accounts'),
              { code: 11000, name: 'MongoServerError', keyPattern: { billingCustomerId: 1 } }
            ));
          },
          expectedMessage: 'E11000 duplicate key error on accounts'
        },
        {
          name: 'Account.create 11000 even with email keyPattern outside user save phase',
          setup: () => {
            Account.create.mockRejectedValueOnce(Object.assign(
              new Error('E11000 duplicate key error on account email'),
              { code: 11000, name: 'MongoServerError', keyPattern: { email: 1 } }
            ));
          },
          expectedMessage: 'E11000 duplicate key error on account email'
        },
        {
          name: 'membership.create 11000',
          setup: () => {
            membership.create.mockRejectedValueOnce(Object.assign(
              new Error('E11000 duplicate key error on membership'),
              { code: 11000, name: 'MongoServerError', keyPattern: { user: 1, account: 1 } }
            ));
          },
          expectedMessage: 'E11000 duplicate key error on membership'
        },
        {
          name: 'User.save 11000 on unrelated keyPattern',
          setup: () => {
            mockSaveImplementation = async () => {
              throw Object.assign(
                new Error('E11000 duplicate key error on phoneNumber'),
                { code: 11000, name: 'MongoServerError', keyPattern: { phoneNumber: 1 } }
              );
            };
          },
          expectedMessage: 'E11000 duplicate key error on phoneNumber'
        },
        {
          name: 'User.save 11000 missing keyPattern',
          setup: () => {
            mockSaveImplementation = async () => {
              throw Object.assign(
                new Error('E11000 duplicate key error without keyPattern'),
                { code: 11000, name: 'MongoServerError' }
              );
            };
          },
          expectedMessage: 'E11000 duplicate key error without keyPattern'
        }
      ];

      for (const testCase of cases) {
        jest.clearAllMocks();
        mockSaveImplementation = async () => {};
        Account.create.mockResolvedValue([{ _id: 'acct-123' }]);
        membership.create.mockResolvedValue([{ _id: 'mem-123' }]);
        testCase.setup();

        const res = makeRes();
        const next = makeNext();
        await handler('/register', 'post')(
          { body: validRegistrationBody(), ip: '198.51.100.3', get: () => undefined },
          res,
          next
        );
        await next.done;

        expect(res.json).not.toHaveBeenCalled();
        expect(loggerMock.warn).not.toHaveBeenCalled();
        expect(mockDbSession.abortTransaction).toHaveBeenCalledTimes(1);
        expect(mockFlexibilling.removeCustomer).toHaveBeenCalledWith({ id: 'cust-123' });
        expect(next).toHaveBeenCalledWith(expect.objectContaining({
          status: 500,
          message: testCase.expectedMessage
        }));
      }
    });

  test('non-duplicate registration errors still propagate through next', async () => {
    mockSaveImplementation = async () => { throw new Error('Transient DB failure'); };
    const res = makeRes();
    const next = makeNext();
    await handler('/register', 'post')(
      { body: validRegistrationBody(), ip: '198.51.100.3', get: () => undefined },
      res,
      next
    );
    await next.done;

    expect(res.json).not.toHaveBeenCalled();
    expect(mockDbSession.abortTransaction).toHaveBeenCalledTimes(1);
    expect(mockFlexibilling.removeCustomer).toHaveBeenCalledWith({ id: 'cust-123' });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      status: 500,
      message: 'Transient DB failure'
    }));
  });

  test('registration enforces >=12 chars and >=3 classes while reset keeps legacy length',
    async () => {
      const weakPasswords = ['abcdefgh', 'Abc123!@', 'abcdefghijkl', 'Abcdefghijkl'];
      for (const password of weakPasswords) {
        const res = makeRes();
        const next = makeNext();
        await handler('/register', 'post')(
          { body: validRegistrationBody({ password }), ip: '198.51.100.4', get: () => undefined },
          res,
          next
        );
        expect(next).toHaveBeenCalledWith(expect.objectContaining({
          status: 500,
          message: 'Bad Password'
        }));
        expect(mockStartSession).not.toHaveBeenCalled();
        expect(verifyReCaptcha).not.toHaveBeenCalled();
      }

      // Password reset update still accepts legacy 8-char password
      const validId = '507f1f77bcf86cd799439011';
      User.findOneAndUpdate.mockResolvedValue({ _id: validId });
      const resetRes = makeRes();
      const resetNext = makeNext();
      await handler('/reset-password', 'post')(
        {
          body: { type: 'update', id: validId, token: 'reset-tok', password: 'abcdefgh' },
          ip: '198.51.100.4',
          get: () => undefined
        },
        resetRes,
        resetNext
      );
      expect(resetNext).not.toHaveBeenCalled();
      expect(resetRes.statusCode).toBe(200);
      expect(resetRes.body).toEqual({ status: 'password reset' });
    });

  test('reverify-account verifies captcha, redacts PII, and gives parity with detached mail',
    async () => {
      verifyReCaptcha.mockResolvedValueOnce(false);
      const failRes = makeRes();
      const failNext = makeNext();
      await handler('/reverify-account', 'post')(
        {
          body: { email: 'probe@example.com', captcha: 'bad-token' },
          ip: '198.51.100.9',
          get: () => undefined
        },
        failRes,
        failNext
      );
      expect(verifyReCaptcha).toHaveBeenCalledWith('bad-token', '198.51.100.9');
      expect(User.findOne).not.toHaveBeenCalled();
      expect(User.findOneAndUpdate).not.toHaveBeenCalled();
      expect(failNext).toHaveBeenCalledWith(expect.objectContaining({
        status: 401,
        message: 'Wrong Captcha'
      }));
      expect(loggerMock.warn).toHaveBeenCalledTimes(1);
      const warnParams = loggerMock.warn.mock.calls[0][1].params;
      const serializedWarn = JSON.stringify(loggerMock.warn.mock.calls[0]);
      expect(warnParams).not.toHaveProperty('ip');
      expect(serializedWarn).not.toContain('probe@example.com');
      expect(serializedWarn).not.toContain('198.51.100.9');
      expect(serializedWarn).not.toContain('bad-token');

      const flushDetached = async () => {
        await new Promise(setImmediate);
        await new Promise(setImmediate);
      };

      const runReverify = async (email, matchedUser) => {
        jest.clearAllMocks();
        verifyReCaptcha.mockResolvedValueOnce(true);
        User.findOneAndUpdate.mockImplementationOnce(async (filter) => {
          if (!matchedUser || filter.email !== matchedUser.email) return null;
          const issuedAt = matchedUser.emailTokens?.verifyIssuedAt;
          const lteClause = filter.$or?.find(c => c['emailTokens.verifyIssuedAt']?.$lte);
          const cutoff = lteClause?.['emailTokens.verifyIssuedAt']?.$lte;
          const eligible = issuedAt == null || (cutoff instanceof Date && issuedAt <= cutoff);
          return eligible ? matchedUser : null;
        });
        const res = makeRes();
        const next = makeNext();
        await handler('/reverify-account', 'post')(
          {
            body: { email, captcha: 'good-token' },
            ip: '198.51.100.9',
            get: () => undefined
          },
          res,
          next
        );
        return { res, next };
      };

      // Unknown address
      const unknown = await runReverify('unknown@example.com', null);
      await flushDetached();
      expect(unknown.next).not.toHaveBeenCalled();
      expect(unknown.res.statusCode).toBe(200);
      expect(unknown.res.body).toEqual({ status: 'account reverified' });
      expect(User.findOne).not.toHaveBeenCalled();
      expect(sendMailHTML).not.toHaveBeenCalled();

      // Cooling-down address
      const cooling = await runReverify('fresh@example.com', {
        _id: 'fresh-id',
        email: 'fresh@example.com',
        emailTokens: { verifyIssuedAt: new Date() }
      });
      await flushDetached();
      expect(cooling.next).not.toHaveBeenCalled();
      expect(cooling.res.statusCode).toBe(unknown.res.statusCode);
      expect(cooling.res.body).toEqual(unknown.res.body);
      expect(User.findOne).not.toHaveBeenCalled();
      expect(sendMailHTML).not.toHaveBeenCalled();

      // Eligible address: same 200 immediately, mail detached to next turn
      const eligible = await runReverify('eligible@example.com', {
        _id: 'eligible-id',
        email: 'eligible@example.com',
        emailTokens: { verifyIssuedAt: new Date(Date.now() - 90 * 1000) }
      });
      expect(eligible.next).not.toHaveBeenCalled();
      expect(eligible.res.statusCode).toBe(unknown.res.statusCode);
      expect(eligible.res.body).toEqual(unknown.res.body);
      expect(User.findOne).not.toHaveBeenCalled();
      expect(sendMailHTML).not.toHaveBeenCalled();
      await flushDetached();
      expect(sendMailHTML).toHaveBeenCalledTimes(1);
    });

  test('nginx config defines signup and verify rate-limit zones without breaking existing ones',
    () => {
      const confPath = path.resolve(__dirname, '../../deploy/fleximanage-nginx.conf');
      const conf = fs.readFileSync(confPath, 'utf8');
      expect(conf).toMatch(/map "\$request_method:\$uri" \$flexi_signup_key \{/);
      expect(conf).toMatch(/~\*\^POST:\/api\/users\/\(register\|reverify-account\)\/\?\$/);
      expect(conf).toMatch(/map "\$request_method:\$uri" \$flexi_verify_key \{/);
      expect(conf).toMatch(/~\*\^POST:\/api\/users\/verify-account\/\?\$/);
      expect(conf).toContain('limit_req_zone $flexi_signup_key zone=flexi_signup:10m rate=5r/m;');
      expect(conf).toContain('limit_req_zone $flexi_verify_key zone=flexi_verify:10m rate=10r/m;');
      expect(conf).toContain('limit_req zone=flexi_signup burst=5 nodelay;');
      expect(conf).toContain('limit_req zone=flexi_verify burst=10 nodelay;');
      // Existing zones and query-free log format preserved
      expect(conf).toContain('limit_req_zone $flexi_login_key zone=flexi_login:10m rate=10r/m;');
      expect(conf).toContain('limit_req_zone $flexi_reset_key zone=flexi_reset:10m rate=6r/m;');
      expect(conf).toContain('limit_req_zone $flexi_mfa_key zone=flexi_mfa:10m rate=12r/m;');
      expect(conf).toContain('log_format fleximanage_no_query');
    });
});
