/** @jest-environment node */
jest.mock('../configs', () => () => ({
  get: (key, type) => {
    if (type === 'list') return ['https://ui.invalid'];
    if (type === 'boolean') return false;
    if (key === 'companyName') return 'TestCo';
    if (key === 'corsWhiteList') return [];
    return '';
  }
}));
jest.mock('../mongoConns.js', () => {
  const dbSession = {
    startTransaction: jest.fn(async () => {}),
    commitTransaction: jest.fn(async () => {}),
    abortTransaction: jest.fn(async () => {})
  };
  return () => ({ getMainDB: () => ({ startSession: async () => dbSession }) });
});
jest.mock('../flexibilling', () => ({}));
jest.mock('../models/accounts', () => ({}));
jest.mock('../models/organizations', () => ({}));
jest.mock('../models/notificationsConf', () => ({ updateMany: jest.fn() }));
jest.mock('../models/membership', () => ({
  membership: {
    findOne: jest.fn(),
    create: jest.fn(),
    findOneAndUpdate: jest.fn(),
    aggregate: jest.fn(),
    deleteOne: jest.fn()
  },
  permissionMasks: { get: 1 },
  preDefinedPermissions: new Proxy({}, { get: () => ({ preset: 'perm' }) }),
  validatePermissionCombination: () => ({ status: true, error: '' })
}));
jest.mock('../models/users', () => {
  const Users = jest.fn(function (data) {
    Object.assign(this, data, { _id: 'new-user-id' });
    this.validate = jest.fn();
    this.setPassword = jest.fn(async () => {});
    this.$session = jest.fn();
    this.save = jest.fn();
  });
  Object.assign(Users, {
    findOne: jest.fn(),
    findById: jest.fn(),
    updateOne: jest.fn(async () => ({})),
    findOneAndUpdate: jest.fn()
  });
  return Users;
});
jest.mock('../authenticate', () => ({
  verifyUserLocal: (req, res, next) => next(),
  verifyUserJWT: jest.fn((req, res, next) => next()),
  verifyUserOrLoginJWT: (req, res, next) => next(),
  validatePassword: jest.fn(() => true)
}));
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
jest.mock('../utils/webhooks', () => () => ({ sendToWebHook: jest.fn(async () => true) }));
jest.mock('../utils/membershipUtils', () => ({ getUserOrganizations: jest.fn() }));
jest.mock('../otp', () => ({ verifyCode: jest.fn(), generateSecret: jest.fn() }));
jest.mock('express-rate-limit', () => () => (req, res, next) => next());
jest.mock('../utils/mfaRateLimitStore', () => class MfaRateLimitStore {});
jest.mock('../logging/logging', () => {
  const warn = jest.fn();
  const error = jest.fn();
  const factory = () => ({ info: jest.fn(), warn, error });
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

const sessions = require('../authSessions');
const User = require('../models/users');
const { membership } = require('../models/membership');
const sendMailHTML = require('../utils/mailer').sendMailHTML;
const verifyReCaptcha = require('../utils/recaptcha').verifyReCaptcha;
const logWarn = require('../logging/logging').warn;
const logError = require('../logging/logging').error;
const router = require('../routes/users');
const MembersService = require('../services/MembersService');
const { RESET_PASSWORD_TTL_MS } = require('../utils/emailTokenExpiry');

const flushDetachedMail = async () => {
  await new Promise(setImmediate);
  await new Promise(setImmediate);
};

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const handler = (path, method) => router.stack.find(layer => layer.route?.path === path)
  .route.stack.filter(layer => layer.method === method).at(-1).handle;
const response = () => ({
  statusCode: 0,
  json: jest.fn(),
  status (code) { this.statusCode = code; return this; }
});
const post = (body, ip = '198.51.100.10') => ({ body, ip, get: () => undefined });
const account = (issuedAt) => ({
  _id: 'user-id',
  email: 'user@example.com',
  state: 'verified',
  emailTokens: {
    verify: 'old-verify',
    verifyIssuedAt: issuedAt,
    resetPassword: 'old-reset',
    resetPasswordIssuedAt: issuedAt
  }
});

beforeEach(() => {
  jest.clearAllMocks();
  User.updateOne.mockResolvedValue({});
  User.findOne.mockReset();
  User.findOneAndUpdate.mockReset();
  sendMailHTML.mockResolvedValue(true);
  verifyReCaptcha.mockResolvedValue(true);
  sessions.revokeAll.mockResolvedValue(undefined);
});

test('change-password clears reset token material after sessions are revoked', async () => {
  const order = [];
  sessions.revokeAll.mockImplementation(async () => { order.push('revoke'); });
  User.updateOne.mockImplementation(async () => { order.push('clear'); });
  const req = {
    body: { oldPassword: 'old', newPassword: 'new' },
    user: {
      _id: 'user-id',
      changePassword: (oldPassword, newPassword, callback) => callback(null)
    }
  };
  const res = response();
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  res.json = jest.fn(() => finish());
  handler('/change-password', 'post')(req, res, jest.fn());
  await done;
  expect(order).toEqual(['revoke', 'clear']);
  expect(User.updateOne).toHaveBeenCalledWith(
    { _id: 'user-id' },
    {
      $set: {
        'emailTokens.resetPassword': '',
        'emailTokens.resetPasswordIssuedAt': null
      }
    }
  );
  expect(res.json).toHaveBeenCalledWith({ status: 'password changed' });
});

test('reverify-account rejects failed captcha before DB lookup and logs redacted warn',
  async () => {
    verifyReCaptcha.mockResolvedValueOnce(false);
    const res = response();
    const next = jest.fn();
    await handler('/reverify-account', 'post')(
      post({ email: 'victim@example.com', captcha: 'bad-captcha-token' }, '203.0.113.5'),
      res,
      next
    );
    expect(verifyReCaptcha).toHaveBeenCalledWith('bad-captcha-token', '203.0.113.5');
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].status).toBe(401);
    expect(next.mock.calls[0][0].message).toBe('Wrong Captcha');
    expect(User.findOne).not.toHaveBeenCalled();
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
    expect(sendMailHTML).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(logWarn).toHaveBeenCalledTimes(1);
    const warnMeta = logWarn.mock.calls[0][1];
    const serializedWarn = JSON.stringify(logWarn.mock.calls[0]);
    expect(warnMeta.params).not.toHaveProperty('ip');
    expect(serializedWarn).not.toContain('victim@example.com');
    expect(serializedWarn).not.toContain('203.0.113.5');
    expect(serializedWarn).not.toContain('bad-captcha-token');
    expect(serializedWarn).not.toContain('old-verify');
  });

test('reverify-account enforces cooldown atomically in findOneAndUpdate with uniform 200',
  async () => {
    const freshUser = account(new Date());
    const pastUser = account(new Date(Date.now() - 90 * 1000));
    const missingIssuedAtUser = account(null);

    const runReverify = async (email, matchedUser) => {
      User.findOne.mockClear();
      User.findOneAndUpdate.mockReset();
      sendMailHTML.mockClear();
      User.findOneAndUpdate.mockImplementation(async (filter) => {
        if (!matchedUser) return null;
        if (filter.email !== matchedUser.email) return null;
        const issuedAt = matchedUser.emailTokens?.verifyIssuedAt;
        const lteClause = filter.$or?.find((clause) => clause['emailTokens.verifyIssuedAt']?.$lte);
        const cutoff = lteClause?.['emailTokens.verifyIssuedAt']?.$lte;
        const eligible = issuedAt == null || (cutoff instanceof Date && issuedAt <= cutoff);
        return eligible ? matchedUser : null;
      });
      const res = response();
      const next = jest.fn();
      await handler('/reverify-account', 'post')(
        post({ email, captcha: 'valid-token' }),
        res,
        next
      );
      return { res, next };
    };

    // Unknown address
    const unknown = await runReverify('nobody@example.com', null);
    await flushDetachedMail();
    expect(unknown.next).not.toHaveBeenCalled();
    expect(unknown.res.statusCode).toBe(200);
    expect(unknown.res.json).toHaveBeenCalledWith({ status: 'account reverified' });
    expect(sendMailHTML).not.toHaveBeenCalled();
    expect(User.findOne).not.toHaveBeenCalled();

    // Cooling-down address (issued within 60s cooldown): same 200 response, no mail sent
    const throttled = await runReverify('user@example.com', freshUser);
    await flushDetachedMail();
    expect(throttled.next).not.toHaveBeenCalled();
    expect(throttled.res.statusCode).toBe(200);
    expect(throttled.res.json).toHaveBeenCalledWith({ status: 'account reverified' });
    expect(sendMailHTML).not.toHaveBeenCalled();
    expect(User.findOne).not.toHaveBeenCalled();

    // Eligible address (past 60s cooldown): same 200 response, detached mail sent
    const eligible = await runReverify('user@example.com', pastUser);
    expect(eligible.next).not.toHaveBeenCalled();
    expect(eligible.res.statusCode).toBe(200);
    expect(eligible.res.json).toHaveBeenCalledWith({ status: 'account reverified' });
    expect(sendMailHTML).not.toHaveBeenCalled();
    await flushDetachedMail();
    expect(sendMailHTML).toHaveBeenCalledTimes(1);
    const reverifyHtml = sendMailHTML.mock.calls[0][4];
    expect(reverifyHtml).toMatch(/\/verify-account\?id=user-id#t=[^"&\s]+/);
    expect(reverifyHtml).not.toMatch(/[?&]t=/);
    expect(User.findOne).not.toHaveBeenCalled();
    expect(User.findOneAndUpdate).toHaveBeenCalledWith(
      {
        email: 'user@example.com',
        $or: [
          { 'emailTokens.verifyIssuedAt': null },
          { 'emailTokens.verifyIssuedAt': { $exists: false } },
          { 'emailTokens.verifyIssuedAt': { $lte: expect.any(Date) } }
        ]
      },
      expect.objectContaining({
        'emailTokens.verify': expect.any(String),
        'emailTokens.verifyIssuedAt': expect.any(Date)
      }),
      { upsert: false, new: false }
    );

    // Eligible address with missing verifyIssuedAt
    const missing = await runReverify('user@example.com', missingIssuedAtUser);
    expect(missing.next).not.toHaveBeenCalled();
    expect(missing.res.statusCode).toBe(200);
    expect(missing.res.json).toHaveBeenCalledWith({ status: 'account reverified' });
    expect(sendMailHTML).not.toHaveBeenCalled();
    await flushDetachedMail();
    expect(sendMailHTML).toHaveBeenCalledTimes(1);
    expect(User.findOne).not.toHaveBeenCalled();
  });

test('reverify-account detaches mail delivery and still yields 200 on rejected send',
  async () => {
    const pastUser = account(new Date(Date.now() - 90 * 1000));
    User.findOneAndUpdate.mockResolvedValue(pastUser);

    // 1) Slow/unsettled mail provider: response resolves strictly before mail starts or settles.
    const events = [];
    let resolveSlowMail;
    let mailSettled = false;
    sendMailHTML.mockImplementationOnce(() => {
      events.push('mail:start');
      return new Promise((resolve) => {
        resolveSlowMail = (val) => {
          mailSettled = true;
          events.push('mail:settled');
          resolve(val);
        };
      });
    });

    const slowRes = response();
    slowRes.json = jest.fn(() => {
      events.push('response');
      return slowRes;
    });
    const slowNext = jest.fn();
    await handler('/reverify-account', 'post')(
      post({ email: 'user@example.com', captcha: 'valid-token' }),
      slowRes,
      slowNext
    );
    expect(slowNext).not.toHaveBeenCalled();
    expect(slowRes.statusCode).toBe(200);
    expect(slowRes.json).toHaveBeenCalledWith({ status: 'account reverified' });
    expect(mailSettled).toBe(false);
    expect(sendMailHTML).not.toHaveBeenCalled();
    expect(events).toEqual(['response']);

    await flushDetachedMail();
    expect(sendMailHTML).toHaveBeenCalledTimes(1);
    expect(mailSettled).toBe(false);
    expect(events).toEqual(['response', 'mail:start']);

    resolveSlowMail(true);
    await flushDetachedMail();
    expect(mailSettled).toBe(true);
    expect(events).toEqual(['response', 'mail:start', 'mail:settled']);

    // 2) Rejected mail send still yields 200 and logs internally without calling next.
    logError.mockClear();
    sendMailHTML.mockRejectedValueOnce(new Error('SMTP connection refused'));

    const res = response();
    const next = jest.fn();
    await handler('/reverify-account', 'post')(
      post({ email: 'user@example.com', captcha: 'valid-token' }),
      res,
      next
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.json).toHaveBeenCalledWith({ status: 'account reverified' });
    expect(sendMailHTML).toHaveBeenCalledTimes(1);

    await flushDetachedMail();
    expect(next).not.toHaveBeenCalled();
    expect(sendMailHTML).toHaveBeenCalledTimes(2);
    expect(logError).toHaveBeenCalledWith(
      'Account Re-verification email delivery failed',
      { params: { reason: 'SMTP connection refused' } }
    );
  });

test('reset-password enforces cooldown in findOneAndUpdate and returns uniform 200 without 429', async () => {
  const freshUser = account(new Date());
  const pastUser = account(new Date(Date.now() - 90 * 1000));

  const runReset = async (email, matchedUser) => {
    User.findOne.mockClear();
    User.findOneAndUpdate.mockReset();
    sendMailHTML.mockClear();
    User.findOneAndUpdate.mockImplementation(async (filter) => {
      if (!matchedUser) return null;
      if (filter.email !== matchedUser.email || filter.state !== matchedUser.state) return null;
      const issuedAt = matchedUser.emailTokens?.resetPasswordIssuedAt;
      const lteClause = filter.$or?.find((clause) => clause['emailTokens.resetPasswordIssuedAt']?.$lte);
      const cutoff = lteClause?.['emailTokens.resetPasswordIssuedAt']?.$lte;
      const eligible = issuedAt == null || (cutoff instanceof Date && issuedAt <= cutoff);
      return eligible ? matchedUser : null;
    });
    const res = response();
    const next = jest.fn();
    await handler('/reset-password', 'post')(post({ type: 'reset', email }), res, next);
    return { res, next };
  };

  // Unknown address
  const unknown = await runReset('nobody@example.com', null);
  await flushDetachedMail();
  expect(unknown.next).not.toHaveBeenCalled();
  expect(unknown.res.statusCode).toBe(200);
  expect(unknown.res.json).toHaveBeenCalledWith({ status: 'password reset initiated' });
  expect(sendMailHTML).not.toHaveBeenCalled();
  expect(User.findOne).not.toHaveBeenCalled();

  // Throttled address (issued within 60s cooldown)
  const throttled = await runReset('user@example.com', freshUser);
  await flushDetachedMail();
  expect(throttled.next).not.toHaveBeenCalled();
  expect(throttled.res.statusCode).toBe(200);
  expect(throttled.res.json).toHaveBeenCalledWith({ status: 'password reset initiated' });
  expect(sendMailHTML).not.toHaveBeenCalled();
  expect(User.findOne).not.toHaveBeenCalled();

  // Accepted address (past 60s cooldown)
  const accepted = await runReset('user@example.com', pastUser);
  expect(accepted.next).not.toHaveBeenCalled();
  expect(accepted.res.statusCode).toBe(200);
  expect(accepted.res.json).toHaveBeenCalledWith({ status: 'password reset initiated' });
  // Mail delivery must be detached and not started synchronously before responding.
  expect(sendMailHTML).not.toHaveBeenCalled();
  await flushDetachedMail();
  expect(sendMailHTML).toHaveBeenCalledTimes(1);
  const resetHtml = sendMailHTML.mock.calls[0][4];
  expect(resetHtml).toMatch(/\/reset-password\?id=user-id#t=[^"&\s]+/);
  expect(resetHtml).not.toMatch(/[?&]t=/);
  expect(User.findOne).not.toHaveBeenCalled();
  expect(User.findOneAndUpdate).toHaveBeenCalledWith(
    {
      email: 'user@example.com',
      state: 'verified',
      $or: [
        { 'emailTokens.resetPasswordIssuedAt': null },
        { 'emailTokens.resetPasswordIssuedAt': { $exists: false } },
        { 'emailTokens.resetPasswordIssuedAt': { $lte: expect.any(Date) } }
      ]
    },
    expect.objectContaining({
      'emailTokens.resetPassword': expect.any(String),
      'emailTokens.resetPasswordIssuedAt': expect.any(Date)
    }),
    { upsert: false, new: false }
  );
});

test('reset-password detaches mail delivery so response resolves before mail settles and rejected send still yields 200', async () => {
  const pastUser = account(new Date(Date.now() - 90 * 1000));
  User.findOneAndUpdate.mockResolvedValue(pastUser);

  // 1) Slow/unsettled mail provider: response resolves strictly before mail starts or settles.
  const events = [];
  let resolveSlowMail;
  let mailSettled = false;
  sendMailHTML.mockImplementationOnce(() => {
    events.push('mail:start');
    return new Promise((resolve) => {
      resolveSlowMail = (val) => {
        mailSettled = true;
        events.push('mail:settled');
        resolve(val);
      };
    });
  });

  const slowRes = response();
  slowRes.json = jest.fn(() => {
    events.push('response');
    return slowRes;
  });
  const slowNext = jest.fn();
  await handler('/reset-password', 'post')(
    post({ type: 'reset', email: 'user@example.com' }), slowRes, slowNext
  );
  expect(slowNext).not.toHaveBeenCalled();
  expect(slowRes.statusCode).toBe(200);
  expect(slowRes.json).toHaveBeenCalledWith({ status: 'password reset initiated' });
  expect(mailSettled).toBe(false);
  expect(sendMailHTML).not.toHaveBeenCalled();
  expect(events).toEqual(['response']);

  await flushDetachedMail();
  expect(sendMailHTML).toHaveBeenCalledTimes(1);
  expect(mailSettled).toBe(false);
  expect(events).toEqual(['response', 'mail:start']);

  resolveSlowMail(true);
  await flushDetachedMail();
  expect(mailSettled).toBe(true);
  expect(events).toEqual(['response', 'mail:start', 'mail:settled']);

  // 2) Rejected mail send still yields 200 and logs internally without calling next.
  logError.mockClear();
  sendMailHTML.mockRejectedValueOnce(new Error('SMTP connection refused'));

  const res = response();
  const next = jest.fn();
  await handler('/reset-password', 'post')(
    post({ type: 'reset', email: 'user@example.com' }), res, next
  );
  expect(next).not.toHaveBeenCalled();
  expect(res.statusCode).toBe(200);
  expect(res.json).toHaveBeenCalledWith({ status: 'password reset initiated' });
  expect(sendMailHTML).toHaveBeenCalledTimes(1);

  await flushDetachedMail();
  expect(next).not.toHaveBeenCalled();
  expect(sendMailHTML).toHaveBeenCalledTimes(2);
  expect(logError).toHaveBeenCalledWith(
    'Account Password Reset email delivery failed',
    { params: { reason: 'SMTP connection refused' } }
  );
});

test('reset-password update rejects object-valued token, id, password, invalid ObjectId, and unknown type', async () => {
  const validId = '507f1f77bcf86cd799439011';
  const badPayloads = [
    { type: 'update', id: validId, token: { $ne: '' }, password: 'valid-password-123' },
    { type: 'update', id: { $gt: '' }, token: 'valid-token', password: 'valid-password-123' },
    { type: 'update', id: 'not-an-object-id', token: 'valid-token', password: 'valid-password-123' },
    { type: 'update', id: validId, token: ['arr-token'], password: 'valid-password-123' },
    { type: 'update', id: validId, token: 'valid-token', password: { $ne: '' } },
    { type: 'other', id: validId, token: 'valid-token', password: 'valid-password-123' },
    { type: { $ne: 'reset' }, id: validId, token: 'valid-token', password: 'valid-password-123' },
    { type: 'reset', email: { $ne: '' } }
  ];

  for (const body of badPayloads) {
    User.findOneAndUpdate.mockClear();
    const res = response();
    const next = jest.fn();
    await handler('/reset-password', 'post')(post(body), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].status).toBe(400);
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  }
});

test('invitation issuedAt stays inside the 1h reset window beyond one hour', async () => {
  membership.findOne.mockResolvedValue({ _id: 'caller-membership', role: 'owner' });
  User.findOne.mockImplementation(() => ({ session: () => Promise.resolve(null) }));
  membership.create.mockResolvedValue([{
    _id: 'membership-id',
    account: { _id: 'account-id', name: 'Acct' },
    organization: null,
    group: '',
    to: 'account',
    role: 'viewer',
    populate () { return this; }
  }]);
  const result = await MembersService.membersPOST({
    email: 'new@example.invalid',
    userFirstName: 'F',
    userLastName: 'L',
    userJobTitle: 'J',
    userPermissionTo: 'account',
    userRole: 'viewer',
    userEntity: 'account-id'
  }, {
    user: {
      _id: 'caller-id',
      email: 'owner@example.invalid',
      username: 'owner@example.invalid',
      defaultAccount: { _id: 'account-id', name: 'Acct' },
      defaultOrg: { _id: 'org-id' }
    },
    restUiUrl: 'https://ui.invalid'
  });
  expect(result.code).toBe(201);
  const created = User.mock.calls[0][0];
  const issuedAt = created.emailTokens.resetPasswordIssuedAt;
  const stillAccepted = (elapsedMs) => {
    return issuedAt.getTime() >= (Date.now() + elapsedMs) - RESET_PASSWORD_TTL_MS;
  };
  expect(created.state).toBe('unverified');
  expect(typeof created.emailTokens.resetPassword).toBe('string');
  expect(created.emailTokens.resetPassword.length).toBeGreaterThan(0);
  expect(stillAccepted(RESET_PASSWORD_TTL_MS + 60 * 1000)).toBe(true);
  expect(stillAccepted(INVITE_TTL_MS - 60 * 1000)).toBe(true);
  expect(stillAccepted(INVITE_TTL_MS + 60 * 1000)).toBe(false);
  const inviteHtml = sendMailHTML.mock.calls[0][4];
  expect(inviteHtml).toMatch(/\/reset-password\?id=new-user-id#t=[^"&\s]+/);
  expect(inviteHtml).not.toMatch(/[?&]t=/);
});
