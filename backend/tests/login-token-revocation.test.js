/** @jest-environment node */
// Regression: a short-lived login token embeds authVersion and jwt-login rejects it
// once authSessions.revokeAll increments that version. Access tokens never pass jwt-login.
const mockStrategies = {};
jest.mock('passport', () => ({
  serializeUser: jest.fn(),
  deserializeUser: jest.fn(),
  authenticate: jest.fn(),
  use: jest.fn((name, strategy) => {
    if (typeof name === 'string') mockStrategies[name] = strategy;
    return strategy;
  })
}));
jest.mock('passport-local', () => ({ Strategy: class {} }));
jest.mock('passport-jwt', () => ({
  Strategy: class { constructor (opts, verify) { this._verify = verify; } },
  ExtractJwt: { fromAuthHeaderAsBearerToken: () => () => {} }
}));
jest.mock('../configs', () => () => ({
  get: key => key === 'userTokenSecretKey' ? 'synthetic-signing-key' : 3600
}));
jest.mock('../logging/logging', () => () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn()
}));
jest.mock('../utils/recaptcha', () => () => ({ verifyReCaptcha: jest.fn() }));
jest.mock('../utils/membershipUtils', () => ({
  orgUpdateFromNull: jest.fn(), getUserOrgByID: jest.fn()
}));
jest.mock('../models/membership', () => ({
  permissionMasks: {},
  preDefinedPermissions: { none: {} },
  getUserPermissions: jest.fn(async () => ({}))
}));
jest.mock('../models/accounts', () => ({ findOne: jest.fn() }));
jest.mock('../models/accesstokens', () => ({ findOne: jest.fn() }));
jest.mock('../models/users', () => ({
  serializeUser: () => () => {},
  deserializeUser: () => () => {},
  authenticate: () => () => {},
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn()
}));
jest.mock('../models/authSessions', () => ({ updateMany: jest.fn() }), { virtual: true });
const jwt = require('jsonwebtoken');
const User = require('../models/users');
const Sessions = require('../models/authSessions');
const { getLoginProcessToken, getToken } = require('../tokens');
const authSessions = require('../authSessions');
require('../authenticate');

const userId = '507f1f77bcf86cd799439011';
const secret = 'synthetic-signing-key';
let authVersion;
const storedUser = () => ({
  _id: userId,
  authVersion,
  username: 'synthetic',
  mfa: { enabled: false },
  defaultAccount: { _id: '507f1f77bcf86cd799439012' }
});
const loginVerify = payload => new Promise((resolve, reject) => {
  mockStrategies['jwt-login']._verify(payload, (error, found, info) => (
    error ? reject(error) : resolve({ found, info })
  ));
});

beforeEach(() => {
  jest.clearAllMocks();
  authVersion = 0;
  User.findOne.mockImplementation(() => ({ populate: async () => storedUser() }));
  User.findOneAndUpdate.mockImplementation(async (_filter, update) => {
    authVersion += update.$inc.authVersion;
    return storedUser();
  });
  Sessions.updateMany.mockResolvedValue({});
});

test('a login token with the current authVersion authenticates through jwt-login', async () => {
  const token = await getLoginProcessToken(storedUser());
  const payload = jwt.verify(token, secret);
  expect(payload).toMatchObject({ type: 'login', userId, authVersion: 0 });
  expect(payload.exp - payload.iat).toBe(180);
  const { found } = await loginVerify(payload);
  expect(found).toMatchObject({ _id: userId, authVersion: 0 });
});

test('revokeAll bumps authVersion and the same login token is rejected', async () => {
  const token = await getLoginProcessToken(storedUser());
  const payload = jwt.verify(token, secret);
  expect((await loginVerify(payload)).found).toMatchObject({ _id: userId });

  const nextVersion = await authSessions.revokeAll(userId);
  expect(nextVersion).toBe(1);
  expect(User.findOneAndUpdate).toHaveBeenCalledTimes(1);
  expect(User.findOneAndUpdate).toHaveBeenCalledWith(
    { _id: userId }, { $inc: { authVersion: 1 } }, { new: true }
  );

  const rejected = await loginVerify(payload);
  expect(rejected.found).toBe(false);
  expect(rejected.info).toEqual({ message: 'Login token revoked' });
});

test('an access token is rejected by jwt-login', async () => {
  const token = await getToken({ user: storedUser() });
  const payload = jwt.verify(token, secret);
  expect(payload.type).toBeUndefined();
  const { found, info } = await loginVerify(payload);
  expect(found).toBe(false);
  expect(info).toEqual({
    message: 'The JWT token is unauthorized to access this resource'
  });
  expect(User.findOne).not.toHaveBeenCalled();
});
