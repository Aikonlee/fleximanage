/** @jest-environment node */
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
  ExtractJwt: {
    fromAuthHeaderAsBearerToken: () => (req) => req?.headers?.authorization?.split(' ')[1]
  }
}));
jest.mock('../models/users', () => ({
  serializeUser: () => () => {},
  deserializeUser: () => () => {},
  authenticate: () => () => {},
  findOne: jest.fn()
}));
jest.mock('../models/accounts', () => ({ findOne: jest.fn() }));
jest.mock('../models/accesstokens', () => ({ findOne: jest.fn() }));
jest.mock('../models/membership', () => ({ permissionMasks: {} }));
jest.mock('../utils/membershipUtils', () => ({
  orgUpdateFromNull: jest.fn(), getUserOrgByID: jest.fn()
}));
jest.mock('../utils/recaptcha', () => () => ({ verifyReCaptcha: jest.fn() }));
jest.mock('../logging/logging', () => () => ({ warn: jest.fn(), info: jest.fn() }));
jest.mock('../configs', () => () => ({ get: () => 'synthetic-key' }));
jest.mock('../authSessions', () => ({
  validateAccess: jest.fn(), rotateRefresh: jest.fn()
}));
jest.mock('../tokens', () => ({
  verifyToken: jest.fn(token => require('jsonwebtoken').verify(token, 'synthetic-key')),
  getToken: jest.fn(),
  getRefreshToken: jest.fn()
}));
const passport = require('passport');
const jwt = require('jsonwebtoken');
const tokens = require('../tokens');
const User = require('../models/users');
const authSessions = require('../authSessions');
require('../authenticate');
const user = {
  _id: '507f1f77bcf86cd799439011',
  authVersion: 0,
  defaultAccount: { _id: '507f1f77bcf86cd799439012' },
  mfa: { enabled: false }
};
const payload = {
  _id: user._id, account: user.defaultAccount._id, sid: 'current-session', authVersion: 0
};
const verify = jwtPayload => new Promise((resolve, reject) => {
  mockStrategies.jwt._verify({ headers: {} }, jwtPayload, (error, result) =>
    error ? reject(error) : resolve(result));
});

beforeEach(() => {
  jest.clearAllMocks();
  User.findOne.mockReturnValue({ populate: async () => ({ ...user }) });
  authSessions.validateAccess.mockResolvedValue(true);
});

test('refresh JWT cannot authenticate as an API access token', async () => {
  expect(await verify({ ...payload, type: 'refresh' })).toBe(false);
});

test('revoked user sessions cannot authenticate even with a signed access JWT', async () => {
  authSessions.validateAccess.mockResolvedValue(false);
  expect(await verify(payload)).toBe(false);
  expect(authSessions.validateAccess).toHaveBeenCalledWith(
    payload, expect.objectContaining({ _id: user._id })
  );
});

test('stale MFA login tokens cannot complete authentication', async () => {
  const result = await new Promise((resolve, reject) => {
    mockStrategies['jwt-login']._verify({ type: 'login', userId: user._id, authVersion: -1 },
      (error, found) => error ? reject(error) : resolve(found));
  });
  expect(result).toBe(false);
});

test('expired access JWT refresh rotates the credential and returns a new pair', async () => {
  const access = jwt.sign({ ...payload, mfaVerified: true }, 'synthetic-key', { expiresIn: -10 });
  const refresh = jwt.sign({ ...payload, type: 'refresh', jti: 'old-id', mfaVerified: true },
    'synthetic-key');
  const nextAccess = jwt.sign({ ...payload, mfaVerified: true }, 'synthetic-key');
  User.findOne.mockReturnValue({
    populate () { return this; }, then (resolve) { resolve({ ...user }); }
  });
  authSessions.rotateRefresh.mockResolvedValue({ sid: payload.sid, jti: 'next-id' });
  tokens.getToken.mockResolvedValue(nextAccess);
  tokens.getRefreshToken.mockResolvedValue('next-refresh-jwt');
  passport.authenticate.mockImplementation((name, opts, callback) =>
    () => callback(null, false, { name: 'TokenExpiredError', message: 'expired' }));
  const req = {
    method: 'GET',
    originalUrl: '/api/users/me',
    headers: { authorization: `Bearer ${access}`, 'refresh-token': refresh },
    header: () => undefined
  };
  const res = {
    headers: {},
    setHeader (key, value) { this.headers[key.toLowerCase()] = value; },
    getHeaders () { return this.headers; }
  };
  let complete;
  const done = new Promise(resolve => { complete = resolve; });
  const next = jest.fn(error => complete(error));
  require('../authenticate').verifyUserJWT(req, res, next);
  await done;
  expect(authSessions.rotateRefresh).toHaveBeenCalledWith(
    expect.objectContaining({ sid: payload.sid, jti: 'old-id' }),
    expect.objectContaining({ _id: user._id })
  );
  expect(res.headers['refresh-jwt']).toBe(nextAccess);
  expect(res.headers['refresh-token']).toBe('next-refresh-jwt');
  expect(next).toHaveBeenCalledWith();
});

test('a refresh JWT cannot masquerade as the expired access JWT', async () => {
  const refresh = jwt.sign({ ...payload, type: 'refresh', jti: 'old-id', mfaVerified: true },
    'synthetic-key', { expiresIn: 3600 });
  const expiredRefreshBearer = jwt.sign(
    { ...payload, type: 'refresh', jti: 'old-id', mfaVerified: true },
    'synthetic-key', { expiresIn: -10 });
  passport.authenticate.mockImplementation((name, opts, callback) =>
    () => callback(null, false, { name: 'TokenExpiredError', message: 'expired' }));
  User.findOne.mockReturnValue({
    populate () { return this; }, then (resolve) { resolve({ ...user }); }
  });
  authSessions.rotateRefresh.mockResolvedValue({ sid: payload.sid, jti: 'next-id' });
  const req = {
    method: 'GET',
    originalUrl: '/api/users/me',
    headers: { authorization: `Bearer ${expiredRefreshBearer}`, 'refresh-token': refresh },
    header: () => undefined
  };
  const res = {
    headers: {},
    setHeader (key, value) { this.headers[key.toLowerCase()] = value; },
    getHeaders () { return this.headers; }
  };
  let complete;
  const done = new Promise(resolve => { complete = resolve; });
  const next = jest.fn(error => complete(error));
  require('../authenticate').verifyUserJWT(req, res, next);
  await done;
  expect(authSessions.rotateRefresh).not.toHaveBeenCalled();
  expect(next.mock.calls[0][0]).toMatchObject({ status: 401 });
});
