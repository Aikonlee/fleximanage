/** @jest-environment node */
const jwt = require('jsonwebtoken');

jest.mock('passport', () => ({
  serializeUser: jest.fn(),
  deserializeUser: jest.fn(),
  authenticate: jest.fn(),
  use: jest.fn((name, strategy) => strategy || name)
}));
jest.mock('passport-local', () => ({ Strategy: class {} }));
jest.mock('passport-jwt', () => ({
  Strategy: class {
    constructor (opts, verify) {
      this._verify = verify;
    }
  },
  ExtractJwt: {
    fromAuthHeaderAsBearerToken: () => (req) => {
      const header = req?.headers?.authorization;
      return header ? header.split(' ')[1] : undefined;
    }
  }
}));
jest.mock('../models/users', () => ({
  serializeUser: () => () => {},
  deserializeUser: () => () => {},
  authenticate: () => () => {},
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn()
}));
jest.mock('../models/accounts', () => ({ findOne: jest.fn() }));
jest.mock('../models/accesstokens', () => ({ findOne: jest.fn() }));
jest.mock('../models/membership', () => ({
  membership: {},
  preDefinedPermissions: {},
  permissionMasks: {},
  getUserPermissions: jest.fn(async () => ({}))
}));
jest.mock('../utils/membershipUtils', () => ({
  orgUpdateFromNull: jest.fn(async () => {}),
  getUserOrgByID: jest.fn(async () => [{ _id: 'org-a' }]),
  getUserOrganizations: jest.fn()
}));
jest.mock('../utils/mailer', () => () => ({}));
jest.mock('../utils/recaptcha', () => () => ({ verifyReCaptcha: jest.fn() }));
jest.mock('../utils/webhooks', () => () => ({}));
jest.mock('../otp', () => ({ verifyCode: jest.fn(), generateSecret: jest.fn() }));
jest.mock('../utils/mfaRateLimitStore', () => class {});
jest.mock('express-rate-limit', () => () => (req, res, next) => next());
jest.mock('../flexibilling', () => ({}));
jest.mock('../logging/logging', () => () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));
jest.mock('../configs', () => () => ({
  get: (key) => {
    if (key === 'userTokenSecretKey') return 'synthetic-key';
    if (key === 'userTokenExpiration') return 300;
    if (key === 'userRefreshTokenExpiration') return 604800;
    return false;
  }
}));
jest.mock('../tokens', () => ({
  getLoginProcessToken: jest.fn(),
  verifyToken: jest.fn(token => require('jsonwebtoken').verify(token, 'synthetic-key')),
  getToken: jest.fn(),
  getRefreshToken: jest.fn()
}));
jest.mock('../sessionTokens', () => jest.fn());
jest.mock('../authSessions', () => ({
  validateAccess: jest.fn(),
  rotateRefresh: jest.fn(),
  revokeCurrent: jest.fn(),
  revokeAll: jest.fn()
}));

const passport = require('passport');
const tokens = require('../tokens');
const User = require('../models/users');
const sessions = require('../authSessions');
const issueSessionTokens = require('../sessionTokens');
const { setAuthCookies, clearAuthCookies } = require('../utils/authCookies');
const router = require('../routes/users');
const auth = require('../authenticate');

const ACCESS_MAX_AGE = 300 * 1000;
const REFRESH_MAX_AGE = 604800 * 1000;
let nextAccess;
const userId = '507f1f77bcf86cd799439011';
const accountId = '507f1f77bcf86cd799439012';
const baseFlags = { httpOnly: true, sameSite: 'lax', path: '/' };

const handler = (path, method) => router.stack.find(layer => layer.route?.path === path)
  .route.stack.filter(layer => layer.method === method).at(-1).handle;

const response = () => {
  const cookies = [];
  const cleared = [];
  return {
    headers: {},
    statusCode: 0,
    cookies,
    cleared,
    setHeader (key, value) { this.headers[key.toLowerCase()] = value; },
    getHeaders () { return this.headers; },
    cookie (name, value, options) { cookies.push({ name, value, options }); },
    clearCookie (name, options) { cleared.push({ name, options }); },
    json: jest.fn(),
    status (code) { this.statusCode = code; return this; },
    header () { return undefined; }
  };
};

const sign = (payload, expiresIn) => jwt.sign(payload, 'synthetic-key',
  expiresIn ? { expiresIn } : undefined);

const sessionClaims = {
  _id: userId,
  account: accountId,
  sid: 'sid-1',
  authVersion: 0,
  mfaVerified: true
};

const runRefresh = (req) => {
  passport.authenticate.mockImplementation((name, opts, callback) => () => {
    callback(null, false, { name: 'TokenExpiredError', message: 'expired' });
  });
  const res = response();
  let complete;
  const done = new Promise(resolve => { complete = resolve; });
  const next = jest.fn(error => complete({ error, res, req }));
  auth.verifyUserJWT(req, res, next);
  return done;
};

beforeEach(() => {
  jest.clearAllMocks();
  issueSessionTokens.mockResolvedValue({ token: 'access-jwt', refreshToken: 'refresh-jwt' });
  nextAccess = sign({ ...sessionClaims, org: null });
  tokens.getToken.mockResolvedValue(nextAccess);
  tokens.getRefreshToken.mockResolvedValue('next-refresh-jwt');
  sessions.rotateRefresh.mockResolvedValue({ sid: 'sid-1', jti: 'next-id' });
  User.findOne.mockReturnValue({
    populate () { return this; },
    then (resolve) {
      resolve({
        _id: userId,
        id: userId,
        username: 'alice',
        authVersion: 0,
        defaultAccount: { _id: accountId },
        defaultOrg: null,
        mfa: { enabled: false }
      });
    }
  });
});

describe('setAuthCookies', () => {
  test('sets httpOnly lax cookies and secure only for https', () => {
    const http = response();
    setAuthCookies({ secure: false, headers: {} }, http, 'access', 'refresh');
    expect(http.cookies).toEqual([
      {
        name: 'token',
        value: 'access',
        options: { ...baseFlags, secure: false, maxAge: ACCESS_MAX_AGE }
      },
      {
        name: 'refreshToken',
        value: 'refresh',
        options: { ...baseFlags, secure: false, maxAge: REFRESH_MAX_AGE }
      }
    ]);

    const forwarded = response();
    setAuthCookies(
      { secure: false, headers: { 'x-forwarded-proto': 'https' } },
      forwarded,
      'access',
      'refresh'
    );
    expect(forwarded.cookies.every(cookie => cookie.options.secure === true)).toBe(true);

    const direct = response();
    setAuthCookies({ secure: true, headers: { 'x-forwarded-proto': 'http' } }, direct, 'a', 'r');
    expect(direct.cookies.every(cookie => cookie.options.secure === true)).toBe(true);

    const plain = response();
    setAuthCookies({ secure: false, headers: { 'x-forwarded-proto': 'http' } }, plain, 'a', 'r');
    expect(plain.cookies.every(cookie => cookie.options.secure === false)).toBe(true);
  });

  test('clearAuthCookies expires both names for http and https', () => {
    const res = response();
    clearAuthCookies(res);
    expect(res.cleared).toEqual([
      { name: 'token', options: { ...baseFlags, secure: false } },
      { name: 'refreshToken', options: { ...baseFlags, secure: false } },
      { name: 'token', options: { ...baseFlags, secure: true } },
      { name: 'refreshToken', options: { ...baseFlags, secure: true } }
    ]);
  });
});

describe('login and logout', () => {
  test('login keeps bearer headers and sets both cookies', async () => {
    const user = { name: 'Synthetic' };
    const res = response();
    await handler('/login', 'post')({ user, secure: false, headers: {} }, res);
    expect(issueSessionTokens).toHaveBeenCalledWith(user, false);
    expect(res.headers['refresh-jwt']).toBe('access-jwt');
    expect(res.headers['refresh-token']).toBe('refresh-jwt');
    expect(res.cookies.map(cookie => [cookie.name, cookie.value])).toEqual([
      ['token', 'access-jwt'],
      ['refreshToken', 'refresh-jwt']
    ]);
    expect(res.cookies[0].options).toMatchObject({
      ...baseFlags, secure: false, maxAge: ACCESS_MAX_AGE
    });
    expect(res.cookies[1].options.maxAge).toBe(REFRESH_MAX_AGE);
  });

  test('logout revokes the session and clears auth cookies', async () => {
    const req = { user: { _id: 'user-id', authSessionId: 'session-id' } };
    const res = response();
    await handler('/logout', 'get')(req, res, jest.fn());
    expect(sessions.revokeCurrent).toHaveBeenCalledWith('user-id', 'session-id');
    expect(res.cleared.map(cookie => cookie.name)).toEqual([
      'token', 'refreshToken', 'token', 'refreshToken'
    ]);
    expect(res.json).toHaveBeenCalledWith({ status: 'logged out' });
  });
});

describe('expired access token refresh', () => {
  const expiredAccess = () => sign(sessionClaims, -10);
  const refreshFor = (extra) => sign({
    ...sessionClaims, type: 'refresh', jti: 'old-id', ...extra
  });

  test('falls back to the refreshToken cookie when the header is absent', async () => {
    const refresh = refreshFor();
    const { error, res } = await runRefresh({
      method: 'GET',
      originalUrl: '/api/users/me',
      secure: true,
      headers: { authorization: `Bearer ${expiredAccess()}` },
      cookies: { refreshToken: refresh },
      header () { return undefined; }
    });
    expect(error).toBeUndefined();
    expect(tokens.verifyToken).toHaveBeenCalledWith(refresh);
    expect(res.headers['refresh-jwt']).toBe(nextAccess);
    expect(res.headers['refresh-token']).toBe('next-refresh-jwt');
    expect(res.cookies.map(cookie => [cookie.name, cookie.value])).toEqual([
      ['token', nextAccess],
      ['refreshToken', 'next-refresh-jwt']
    ]);
    expect(res.cookies.every(cookie => cookie.options.secure === true)).toBe(true);
    expect(res.cookies.every(cookie => cookie.options.httpOnly === true)).toBe(true);
  });

  test('prefers the refresh-token header over the cookie', async () => {
    const headerToken = refreshFor();
    const cookieToken = refreshFor({ jti: 'cookie-id' });
    const { error } = await runRefresh({
      method: 'GET',
      originalUrl: '/api/users/me',
      secure: false,
      headers: {
        authorization: `Bearer ${expiredAccess()}`,
        'refresh-token': headerToken
      },
      cookies: { refreshToken: cookieToken },
      header () { return undefined; }
    });
    expect(error).toBeUndefined();
    expect(tokens.verifyToken).toHaveBeenCalledWith(headerToken);
    expect(tokens.verifyToken).not.toHaveBeenCalledWith(cookieToken);
  });

  test('rejects an expired access token with no refresh header or cookie', async () => {
    const { error } = await runRefresh({
      method: 'GET',
      originalUrl: '/api/users/me',
      headers: { authorization: `Bearer ${expiredAccess()}` },
      header () { return undefined; }
    });
    expect(error).toMatchObject({ status: 401 });
    expect(tokens.verifyToken).not.toHaveBeenCalled();
    expect(sessions.rotateRefresh).not.toHaveBeenCalled();
  });
});
