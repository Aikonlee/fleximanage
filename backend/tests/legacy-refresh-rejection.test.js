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

const runRefresh = (access, refresh) => {
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
  return done.then(() => ({ req, res, next }));
};

beforeEach(() => {
  jest.clearAllMocks();
  User.findOne.mockReturnValue({
    populate () { return this; }, then (resolve) { resolve({ ...user }); }
  });
  authSessions.rotateRefresh.mockResolvedValue({ sid: payload.sid, jti: 'next-id' });
  tokens.getToken.mockResolvedValue(jwt.sign({ ...payload, mfaVerified: true }, 'synthetic-key'));
  tokens.getRefreshToken.mockResolvedValue('next-refresh-jwt');
});

test('a refresh token without sid or jti is rejected before any token is issued', async () => {
  const legacy = {
    _id: user._id, account: user.defaultAccount._id, authVersion: 0, mfaVerified: true
  };
  const access = jwt.sign(legacy, 'synthetic-key', { expiresIn: -10 });
  const refresh = jwt.sign({ ...legacy, type: 'refresh' }, 'synthetic-key');
  const { res, next } = await runRefresh(access, refresh);
  expect(next.mock.calls[0][0]).toMatchObject({
    status: 401, message: 'Invalid refresh session'
  });
  expect(tokens.getToken).not.toHaveBeenCalled();
  expect(tokens.getRefreshToken).not.toHaveBeenCalled();
  expect(authSessions.rotateRefresh).not.toHaveBeenCalled();
  expect(res.headers['refresh-jwt']).toBeUndefined();
  expect(res.headers['refresh-token']).toBeUndefined();
});

test('a session-bound refresh token still rotates and sets both headers', async () => {
  const access = jwt.sign({ ...payload, mfaVerified: true }, 'synthetic-key', { expiresIn: -10 });
  const refresh = jwt.sign({ ...payload, type: 'refresh', jti: 'old-id', mfaVerified: true },
    'synthetic-key');
  const { res, next } = await runRefresh(access, refresh);
  expect(authSessions.rotateRefresh).toHaveBeenCalledWith(
    expect.objectContaining({ sid: payload.sid, jti: 'old-id' }),
    expect.objectContaining({ _id: user._id })
  );
  expect(tokens.getToken).toHaveBeenCalled();
  expect(tokens.getRefreshToken).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ sid: payload.sid, jti: 'next-id', mfaVerified: true })
  );
  expect(res.headers['refresh-jwt']).toEqual(expect.any(String));
  expect(res.headers['refresh-token']).toBe('next-refresh-jwt');
  expect(next).toHaveBeenCalledWith();
});
