/** @jest-environment node */
jest.mock('../configs', () => () => ({ get: () => false }));
jest.mock('../mongoConns.js', () => () => ({}));
jest.mock('../flexibilling', () => ({}));
jest.mock('../models/users', () => ({}));
jest.mock('../models/accounts', () => ({}));
jest.mock('../models/membership', () => ({ membership: {}, preDefinedPermissions: {} }));
jest.mock('../authenticate', () => ({
  verifyUserLocal: (req, res, next) => next(),
  verifyUserJWT: jest.fn((req, res, next) => next()),
  verifyUserOrLoginJWT: (req, res, next) => next()
}));
jest.mock('../utils/mailer', () => () => ({}));
jest.mock('../utils/recaptcha', () => () => ({}));
jest.mock('../utils/webhooks', () => () => ({}));
jest.mock('../utils/membershipUtils', () => ({ getUserOrganizations: jest.fn() }));
jest.mock('../otp', () => ({ verifyCode: jest.fn(), generateSecret: jest.fn() }));
jest.mock('../rateLimitStore', () => class {});
jest.mock('express-rate-limit', () => () => (req, res, next) => next());
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
jest.mock('../authSessions', () => ({ revokeCurrent: jest.fn(), revokeAll: jest.fn() }));
const sessions = require('../authSessions');
const auth = require('../authenticate');
const Users = require('../models/users');
const otp = require('../otp');
const issueSessionTokens = require('../sessionTokens');
const tokens = require('../tokens');
const router = require('../routes/users');
const handler = (path, method) => router.stack.find(layer => layer.route?.path === path)
  .route.stack.filter(layer => layer.method === method).at(-1).handle;
const response = () => ({
  headers: {},
  statusCode: 0,
  setHeader (key, value) { this.headers[key.toLowerCase()] = value; },
  json: jest.fn(),
  status (code) { this.statusCode = code; return this; }
});

beforeEach(() => {
  jest.clearAllMocks();
  issueSessionTokens.mockResolvedValue({ token: 'access-jwt', refreshToken: 'refresh-jwt' });
  tokens.getToken.mockResolvedValue('legacy-access');
  tokens.getRefreshToken.mockResolvedValue('legacy-refresh');
});

test('password login issues a persisted session before returning bearer tokens', async () => {
  const user = { name: 'Synthetic', mfa: { enabled: false }, defaultAccount: { forceMfa: false } };
  const res = response();
  await handler('/login', 'post')({ user }, res);
  expect(issueSessionTokens).toHaveBeenCalledWith(user, false);
  expect(res.headers['refresh-jwt']).toBe('access-jwt');
  expect(res.headers['refresh-token']).toBe('refresh-jwt');
});

test('logout revokes the authenticated current session', async () => {
  const req = { user: { _id: 'user-id', authSessionId: 'session-id' }, logout: jest.fn() };
  const res = response();
  await handler('/logout', 'get')(req, res, jest.fn());
  expect(sessions.revokeCurrent).toHaveBeenCalledWith('user-id', 'session-id');
  expect(res.json).toHaveBeenCalledWith({ status: 'logged out' });
});

test('admin mutation delegates authentication to revocable JWT middleware', async () => {
  const rejection = new Error('Session revoked');
  auth.verifyUserJWT.mockImplementationOnce((req, res, next) => next(rejection));
  const route = router.stack.find(layer => layer.route?.path === '/:userId/admin').route;
  const guard = route.stack.filter(layer => layer.method === 'put')[1].handle;
  const next = jest.fn();
  await guard({ headers: {} }, response(), next);
  expect(auth.verifyUserJWT).toHaveBeenCalledTimes(1);
  expect(next).toHaveBeenCalledWith(rejection);
});

test('password change invalidates all old sessions after the password is saved', async () => {
  const req = {
    body: { oldPassword: 'old', newPassword: 'new' },
    user: {
      _id: 'user-id', changePassword: (oldPassword, newPassword, callback) => callback(null)
    }
  };
  const res = response();
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  res.json = jest.fn(() => finish());
  handler('/change-password', 'post')(req, res, jest.fn());
  await done;
  expect(sessions.revokeAll).toHaveBeenCalledWith('user-id');
  expect(res.json).toHaveBeenCalledWith({ status: 'password changed' });
});

test('completed password reset invalidates all previous sessions', async () => {
  const validId = '507f1f77bcf86cd799439011';
  auth.validatePassword = jest.fn(() => true);
  Users.findOneAndUpdate = jest.fn(async () => ({
    _id: validId
  }));
  const res = response();
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  res.json = jest.fn(() => finish());
  handler('/reset-password', 'post')({
    body: {
      type: 'update', id: validId, token: 'reset-key', password: 'new-value'
    }
  }, res, jest.fn());
  await done;
  expect(Users.findOneAndUpdate).toHaveBeenCalledWith(
    expect.objectContaining({
      _id: validId,
      'emailTokens.resetPassword': 'reset-key',
      'emailTokens.resetPasswordIssuedAt': { $gte: expect.any(Date) }
    }),
    expect.objectContaining({
      $set: expect.objectContaining({
        state: 'verified',
        hash: expect.any(String),
        salt: expect.any(String),
        'emailTokens.resetPassword': '',
        'emailTokens.resetPasswordIssuedAt': null
      }),
      $inc: { authVersion: 1 }
    }),
    { upsert: false, new: true }
  );
  expect(sessions.revokeAll).toHaveBeenCalledWith(validId, { incrementAuthVersion: false });
  expect(res.json).toHaveBeenCalledWith({ status: 'password reset' });
});

test('admin demotion invalidates the target user sessions', async () => {
  Users.findOneAndUpdate = jest.fn(async () => ({ _id: 'target-user' }));
  const res = response();
  await handler('/:userId/admin', 'delete')({
    params: { userId: 'target-user' }, user: { _id: 'admin-user' }
  }, res, jest.fn());
  expect(Users.findOneAndUpdate).toHaveBeenCalledWith(
    { _id: 'target-user' },
    { admin: false },
    { new: true }
  );
  expect(sessions.revokeAll).toHaveBeenCalledWith('target-user');
  expect(res.json).toHaveBeenCalledWith({ status: 'user demoted', userId: 'target-user' });
});

test('admin promotion invalidates previous target-user sessions', async () => {
  Users.findOneAndUpdate = jest.fn(async () => ({ _id: 'target-user' }));
  const res = response();
  await handler('/:userId/admin', 'put')({
    params: { userId: 'target-user' }, user: { _id: 'admin-user' }
  }, res, jest.fn());
  expect(Users.findOneAndUpdate).toHaveBeenCalledWith(
    { _id: 'target-user' },
    { admin: true },
    { new: true }
  );
  expect(sessions.revokeAll).toHaveBeenCalledWith('target-user');
});

test('batch admin demotion invalidates each affected user', async () => {
  Users.findOneAndUpdate = jest.fn(async ({ _id }) => ({ _id }));
  const res = response();
  await handler('/admin/batch', 'post')({
    body: { demote: ['first', 'second'] }, user: { _id: 'admin-user' }
  }, res, jest.fn());
  for (const id of ['first', 'second']) {
    expect(Users.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: id, admin: true }, { admin: false }, { new: true });
    expect(sessions.revokeAll).toHaveBeenCalledWith(id);
  }
  expect(res.json).toHaveBeenCalledWith({ status: 'batch demotion completed', demotedCount: 2 });
});

test('batch admin promotion invalidates each affected user', async () => {
  Users.findOneAndUpdate = jest.fn(async ({ _id }) => ({ _id }));
  await handler('/admin/batch', 'post')({
    body: { promote: ['first', 'second'] }, user: { _id: 'admin-user' }
  }, response(), jest.fn());
  for (const id of ['first', 'second']) {
    expect(Users.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: id, admin: { $ne: true } }, { admin: true }, { new: true });
    expect(sessions.revokeAll).toHaveBeenCalledWith(id);
  }
});

test('enabling MFA invalidates previous sessions before issuing a verified one', async () => {
  otp.verifyCode.mockReturnValue(true);
  Users.findOneAndUpdate = jest.fn(async () => ({}));
  sessions.revokeAll.mockResolvedValue(1);
  const user = {
    _id: 'user-id',
    name: 'Synthetic',
    authVersion: 0,
    mfa: { secret: 'synthetic-secret', enabled: false, unverifiedSecrets: [] }
  };
  const res = response();
  await handler('/mfa/verify', 'post')({ body: { token: 'synthetic-code' }, user }, res, jest.fn());
  expect(sessions.revokeAll).toHaveBeenCalledWith('user-id');
  expect(user.authVersion).toBe(1);
  expect(issueSessionTokens).toHaveBeenCalledWith(user, true);
});
