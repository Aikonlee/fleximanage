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
jest.mock('../utils/recaptcha', () => () => ({}));
jest.mock('../utils/webhooks', () => () => ({ sendToWebHook: jest.fn(async () => true) }));
jest.mock('../utils/membershipUtils', () => ({ getUserOrganizations: jest.fn() }));
jest.mock('../otp', () => ({ verifyCode: jest.fn(), generateSecret: jest.fn() }));
jest.mock('express-rate-limit', () => () => (req, res, next) => next());
jest.mock('../utils/mfaRateLimitStore', () => class MfaRateLimitStore {});
jest.mock('../logging/logging', () => () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn()
}));
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
const router = require('../routes/users');
const MembersService = require('../services/MembersService');
const { RESET_PASSWORD_TTL_MS } = require('../utils/emailTokenExpiry');

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const handler = (path, method) => router.stack.find(layer => layer.route?.path === path)
  .route.stack.filter(layer => layer.method === method).at(-1).handle;
const response = () => ({
  statusCode: 0,
  json: jest.fn(),
  status (code) { this.statusCode = code; return this; }
});
const post = (body) => ({ body, get: () => undefined });
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

test('reverify-account returns 429 and does not overwrite a fresh verify token', async () => {
  User.findOne.mockResolvedValue(account(new Date()));
  const res = response();
  const next = jest.fn();
  await handler('/reverify-account', 'post')(post({ email: 'user@example.com' }), res, next);
  expect(next).toHaveBeenCalledTimes(1);
  expect(next.mock.calls[0][0].status).toBe(429);
  expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  expect(sendMailHTML).not.toHaveBeenCalled();
  expect(res.json).not.toHaveBeenCalled();
});

test('reverify-account still issues a token when verifyIssuedAt is past 60s', async () => {
  const user = account(new Date(Date.now() - 90 * 1000));
  User.findOne.mockResolvedValue(user);
  User.findOneAndUpdate.mockResolvedValue(user);
  const res = response();
  const next = jest.fn();
  await handler('/reverify-account', 'post')(post({ email: 'user@example.com' }), res, next);
  expect(next).not.toHaveBeenCalled();
  expect(User.findOneAndUpdate).toHaveBeenCalledWith(
    { email: 'user@example.com' },
    expect.objectContaining({
      'emailTokens.verify': expect.any(String),
      'emailTokens.verifyIssuedAt': expect.any(Date)
    }),
    { upsert: false, new: false }
  );
  expect(sendMailHTML).toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith({ status: 'account reverified' });
});

test('reverify-account still issues a token when verifyIssuedAt is missing', async () => {
  const user = account(null);
  User.findOne.mockResolvedValue(user);
  User.findOneAndUpdate.mockResolvedValue(user);
  const res = response();
  const next = jest.fn();
  await handler('/reverify-account', 'post')(post({ email: 'user@example.com' }), res, next);
  expect(next).not.toHaveBeenCalled();
  expect(User.findOneAndUpdate).toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith({ status: 'account reverified' });
});

test('reset-password returns 429 and does not overwrite a fresh reset token', async () => {
  const user = account(new Date());
  User.findOne.mockImplementation(async (query) => (
    query.email === user.email && query.state === 'verified' ? user : null
  ));
  const res = response();
  const next = jest.fn();
  await handler('/reset-password', 'post')(
    post({ type: 'reset', email: 'user@example.com' }), res, next
  );
  expect(next).toHaveBeenCalledTimes(1);
  expect(next.mock.calls[0][0].status).toBe(429);
  expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  expect(sendMailHTML).not.toHaveBeenCalled();
  expect(res.json).not.toHaveBeenCalled();
});

test('reset-password still issues a token when resetPasswordIssuedAt is past 60s', async () => {
  const user = account(new Date(Date.now() - 90 * 1000));
  User.findOne.mockResolvedValue(user);
  User.findOneAndUpdate.mockResolvedValue(user);
  const res = response();
  const next = jest.fn();
  await handler('/reset-password', 'post')(
    post({ type: 'reset', email: 'user@example.com' }), res, next
  );
  expect(next).not.toHaveBeenCalled();
  expect(User.findOneAndUpdate).toHaveBeenCalledWith(
    { email: 'user@example.com', state: 'verified' },
    expect.objectContaining({
      'emailTokens.resetPassword': expect.any(String),
      'emailTokens.resetPasswordIssuedAt': expect.any(Date)
    }),
    { upsert: false, new: false }
  );
  expect(sendMailHTML).toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith({ status: 'password reset initiated' });
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
});
