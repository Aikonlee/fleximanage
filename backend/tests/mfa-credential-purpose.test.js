/** @jest-environment node */
// A2, A11 & NEW-L1: Enforce credential purpose on MFA routes through real Passport
// JWT strategies (jwt & jwt-login), real signed tokens, and real refresh authTime preservation.
jest.mock('../configs', () => () => ({
  get: (key, type) => {
    if (key === 'userTokenSecretKey') return 'synthetic-key';
    if (key === 'userTokenExpiration') return 3600;
    if (key === 'userRefreshTokenExpiration') return 86400;
    if (key === 'companyName') return 'TestCo';
    if (key === 'corsWhiteList') return [];
    if (type === 'number') return 3600;
    return false;
  }
}));
jest.mock('../mongoConns.js', () => () => ({}));
jest.mock('../flexibilling', () => ({}));
jest.mock('../models/accounts', () => ({ findOne: jest.fn() }));
jest.mock('../models/accesstokens', () => ({ findOne: jest.fn() }));
jest.mock('../models/membership', () => ({
  membership: {},
  preDefinedPermissions: { none: {} },
  permissionMasks: {},
  getUserPermissions: jest.fn(async () => ({}))
}));
jest.mock('../models/users', () => ({
  serializeUser: () => () => {},
  deserializeUser: () => () => {},
  authenticate: () => () => {},
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn()
}));
jest.mock('../utils/mailer', () => () => ({ sendMailHTML: jest.fn() }));
jest.mock('../utils/recaptcha', () => () => ({ verifyReCaptcha: jest.fn() }));
jest.mock('../utils/webhooks', () => () => ({ sendToWebHook: jest.fn() }));
jest.mock('../utils/membershipUtils', () => ({
  orgUpdateFromNull: jest.fn(async () => {}),
  getUserOrgByID: jest.fn(async () => [{ _id: '507f1f77bcf86cd799439013', name: 'Org' }]),
  getUserOrganizations: jest.fn(async () => ({ '507f1f77bcf86cd799439013': { _id: '507f1f77bcf86cd799439013', name: 'Org' } }))
}));
jest.mock('../otp', () => ({
  verifyCode: jest.fn(() => true),
  generateSecret: jest.fn(async () => ({ secret: 'NEWSECRET', uri: 'otpauth://totp/Test?secret=NEWSECRET' }))
}));
jest.mock('express-rate-limit', () => () => (req, res, next) => next());
jest.mock('../utils/mfaRateLimitStore', () => class {});
jest.mock('../logging/logging', () => () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));
jest.mock('../sessionTokens', () => jest.fn(async () => ({
  token: 'new-access-jwt',
  refreshToken: 'new-refresh-jwt'
})));
jest.mock('../authSessions', () => ({
  validateAccess: jest.fn(async () => true),
  rotateRefresh: jest.fn(async (payload) => ({ sid: payload.sid, jti: 'rotated-jti' })),
  revokeCurrent: jest.fn(),
  revokeAll: jest.fn(async () => 1)
}));
jest.mock('../utils/authCookies', () => ({
  setAuthCookies: jest.fn(),
  clearAuthCookies: jest.fn()
}));

const express = require('express');
const http = require('http');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const { createHash } = require('crypto');
const Users = require('../models/users');
const Accounts = require('../models/accounts');
const Accesstoken = require('../models/accesstokens');
const authSessions = require('../authSessions');
const otp = require('../otp');
const issueSessionTokens = require('../sessionTokens');
const tokens = require('../tokens');
const auth = require('../authenticate');
const usersRouter = require('../routes/users');

function buildApp () {
  const app = express();
  app.use(passport.initialize());
  app.use('/api/users', usersRouter);
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({
      error: err.message,
      ...(err.errorCode ? { code: err.errorCode } : {})
    });
  });
  return app;
}

function send (app, method, urlPath, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const payload = body !== undefined ? JSON.stringify(body) : null;
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers: {
          ...extraHeaders,
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {})
        }
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          server.close(() => {
            const raw = Buffer.concat(chunks).toString('utf8');
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: raw ? JSON.parse(raw) : null
            });
          });
        });
      });
      req.on('error', (err) => server.close(() => reject(err)));
      if (payload) req.write(payload);
      req.end();
    });
  });
}

const nowSec = () => Math.floor(Date.now() / 1000);
const USER_ID = '507f1f77bcf86cd799439011';
const ACCOUNT_ID = '507f1f77bcf86cd799439012';
const ORG_ID = '507f1f77bcf86cd799439013';
const ACCESS_TOKEN_DOC_ID = '507f1f77bcf86cd799439014';

const makeDbUser = (overrides = {}) => ({
  _id: USER_ID,
  id: USER_ID,
  username: 'alice@example.com',
  name: 'Alice',
  lastName: 'User',
  email: 'alice@example.com',
  state: 'verified',
  admin: false,
  authVersion: 0,
  defaultAccount: { _id: ACCOUNT_ID, name: 'TestAccount', forceMfa: false },
  defaultOrg: { _id: ORG_ID, name: 'TestOrg' },
  mfa: {
    enabled: true,
    secret: 'VERIFIEDSECRET',
    unverifiedSecrets: ['UNVERIFIEDSECRET'],
    recoveryCodes: [{
      code: createHash('sha256').update('valid-recovery').digest('hex'),
      usedTime: null
    }]
  },
  ...overrides
});

function mockUserLookup (factory) {
  Users.findOne.mockImplementation(() => {
    const doc = factory();
    const chain = {
      populate () { return chain; },
      then (resolve, reject) { return Promise.resolve(doc).then(resolve, reject); }
    };
    return chain;
  });
}

describe('MFA credential purpose enforcement via real JWT strategies (A2 & NEW-L1)', () => {
  const app = buildApp();
  let currentDbUser;

  beforeEach(() => {
    jest.clearAllMocks();
    currentDbUser = makeDbUser();
    mockUserLookup(() => ({
      ...currentDbUser,
      defaultAccount: { ...currentDbUser.defaultAccount },
      defaultOrg: currentDbUser.defaultOrg ? { ...currentDbUser.defaultOrg } : null,
      mfa: {
        ...currentDbUser.mfa,
        unverifiedSecrets: [...(currentDbUser.mfa.unverifiedSecrets || [])],
        recoveryCodes: [...(currentDbUser.mfa.recoveryCodes || [])]
      }
    }));
    Accounts.findOne.mockResolvedValue({ _id: ACCOUNT_ID, name: 'TestAccount', forceMfa: false });
    Users.findOneAndUpdate.mockResolvedValue({ _id: USER_ID });
    authSessions.validateAccess.mockResolvedValue(true);
    authSessions.rotateRefresh.mockImplementation(async (payload) => ({
      sid: payload.sid,
      jti: 'rotated-jti'
    }));
    otp.verifyCode.mockReturnValue(true);
  });

  test.each([
    ['app_access_key'],
    ['app_access_token']
  ])('rejects signed %s JWT through real jwt strategy with 403 on every MFA route without mutating state',
    async (tokenType) => {
      currentDbUser = makeDbUser({
        mfa: {
          enabled: false,
          secret: null,
          unverifiedSecrets: ['UNVERIFIEDSECRET'],
          recoveryCodes: [{
            code: createHash('sha256').update('valid-recovery').digest('hex'),
            usedTime: null
          }]
        }
      });

      const signedToken = tokenType === 'app_access_key'
        ? await tokens.getAccessKey({ user: currentDbUser }, { id: ACCESS_TOKEN_DOC_ID })
        : jwt.sign({
          _id: USER_ID,
          type: 'app_access_token',
          account: ACCOUNT_ID,
          id: ACCESS_TOKEN_DOC_ID,
          perms: {}
        }, 'synthetic-key', { expiresIn: 3600 });

      Accesstoken.findOne.mockResolvedValue({
        _id: ACCESS_TOKEN_DOC_ID,
        isValid: true,
        account: ACCOUNT_ID,
        token: signedToken,
        permissions: {},
        to: 'account',
        role: 'owner'
      });

      const headers = { Authorization: `Bearer ${signedToken}` };
      const routes = [
        ['GET', '/api/users/login/methods'],
        ['GET', '/api/users/mfa/isEnabled'],
        ['GET', '/api/users/mfa/getMfaConfigUri'],
        ['POST', '/api/users/mfa/verify', { token: '123456' }],
        ['GET', '/api/users/mfa/generateRecoveryCodes?regenerate=true'],
        ['POST', '/api/users/mfa/verifyRecoveryCode', { recoveryCode: 'valid-recovery' }]
      ];

      for (const [method, urlPath, body] of routes) {
        const res = await send(app, method, urlPath, body, headers);
        expect(res.status).toBe(403);
      }

      expect(Users.findOneAndUpdate).not.toHaveBeenCalled();
      expect(otp.generateSecret).not.toHaveBeenCalled();
      expect(issueSessionTokens).not.toHaveBeenCalled();
    });

  test('rejects signed stale interactive session JWT for recovery codes and MFA enrollment', async () => {
    const staleAuthTime = nowSec() - (auth.REAUTH_MAX_AGE_SECONDS + 60);
    const staleSessionJwt = await tokens.getToken({
      user: {
        ...currentDbUser,
        authSessionId: 'sid-stale',
        isLoggedInWithMfa: true,
        authTime: staleAuthTime
      }
    });

    const genRes = await send(
      app, 'GET', '/api/users/mfa/generateRecoveryCodes?regenerate=true', undefined,
      { Authorization: `Bearer ${staleSessionJwt}` }
    );
    expect(genRes.status).toBe(403);
    expect(genRes.body.code).toBe('REAUTH_REQUIRED');

    // Switch to unenrolled user with stale interactive session.
    currentDbUser = makeDbUser({
      mfa: { enabled: false, secret: null, unverifiedSecrets: ['UNVERIFIED'], recoveryCodes: [] }
    });
    const staleUnenrolledJwt = await tokens.getToken({
      user: {
        ...currentDbUser,
        authSessionId: 'sid-stale-unenrolled',
        isLoggedInWithMfa: false,
        authTime: staleAuthTime
      }
    });

    const uriRes = await send(
      app, 'GET', '/api/users/mfa/getMfaConfigUri', undefined,
      { Authorization: `Bearer ${staleUnenrolledJwt}` }
    );
    expect(uriRes.status).toBe(403);
    expect(uriRes.body.code).toBe('REAUTH_REQUIRED');

    const verifyRes = await send(
      app, 'POST', '/api/users/mfa/verify', { token: '123456' },
      { Authorization: `Bearer ${staleUnenrolledJwt}` }
    );
    expect(verifyRes.status).toBe(403);
    expect(verifyRes.body.code).toBe('REAUTH_REQUIRED');
    expect(Users.findOneAndUpdate).not.toHaveBeenCalled();
    expect(issueSessionTokens).not.toHaveBeenCalled();
  });

  test('refreshed stale session preserves original authTime and still fails recent-reauth check', async () => {
    const staleAuthTime = nowSec() - (auth.REAUTH_MAX_AGE_SECONDS + 120);
    const expiredStaleAccess = jwt.sign({
      _id: USER_ID,
      username: currentDbUser.username,
      admin: false,
      org: ORG_ID,
      orgName: 'TestOrg',
      account: ACCOUNT_ID,
      accountName: 'TestAccount',
      perms: {},
      mfaVerified: true,
      sid: 'sid-refresh-stale',
      authVersion: 0,
      authTime: staleAuthTime
    }, 'synthetic-key', { expiresIn: -10 });

    const staleRefresh = await tokens.getRefreshToken({
      user: { ...currentDbUser, authTime: staleAuthTime }
    }, {
      sid: 'sid-refresh-stale',
      jti: 'initial-jti',
      mfaVerified: true
    });

    // Trigger real refresh rotation inside verifyUserJWT on the protected MFA endpoint.
    const refreshGenRes = await send(
      app,
      'GET',
      '/api/users/mfa/generateRecoveryCodes?regenerate=true',
      undefined,
      {
        Authorization: `Bearer ${expiredStaleAccess}`,
        'Refresh-Token': staleRefresh
      }
    );

    expect(authSessions.rotateRefresh).toHaveBeenCalledTimes(1);
    expect(refreshGenRes.status).toBe(403);
    expect(refreshGenRes.body.code).toBe('REAUTH_REQUIRED');
    expect(Users.findOneAndUpdate).not.toHaveBeenCalled();

    // Verify the rotated access JWT returned by refresh preserved the stale authTime.
    const rotatedAccess = refreshGenRes.headers['refresh-jwt'];
    const rotatedRefresh = refreshGenRes.headers['refresh-token'];
    expect(rotatedAccess).toBeTruthy();
    expect(rotatedRefresh).toBeTruthy();
    expect(jwt.verify(rotatedAccess, 'synthetic-key').authTime).toBe(staleAuthTime);
    expect(jwt.verify(rotatedRefresh, 'synthetic-key').authTime).toBe(staleAuthTime);

    // Presenting the newly minted rotated access JWT STILL fails recent-reauth on MFA route...
    const followUpGenRes = await send(
      app,
      'GET',
      '/api/users/mfa/generateRecoveryCodes?regenerate=true',
      undefined,
      { Authorization: `Bearer ${rotatedAccess}` }
    );
    expect(followUpGenRes.status).toBe(403);
    expect(followUpGenRes.body.code).toBe('REAUTH_REQUIRED');

    // ...while normal authenticated routes still accept the rotated session.
    const meRes = await send(
      app,
      'GET',
      '/api/users/me',
      undefined,
      { Authorization: `Bearer ${rotatedAccess}` }
    );
    expect(meRes.status).toBe(200);
    expect(meRes.body.email).toBe('alice@example.com');
  });

  test('requires signed jwt-login challenge for recovery-code verification and already-enabled MFA verify', async () => {
    const recentSessionJwt = await tokens.getToken({
      user: {
        ...currentDbUser,
        authSessionId: 'sid-fresh',
        isLoggedInWithMfa: true,
        authTime: nowSec()
      }
    });
    const headers = { Authorization: `Bearer ${recentSessionJwt}` };

    const recoveryRes = await send(
      app, 'POST', '/api/users/mfa/verifyRecoveryCode', { recoveryCode: 'valid-recovery' }, headers
    );
    expect(recoveryRes.status).toBe(403);

    const verifyEnabledRes = await send(
      app, 'POST', '/api/users/mfa/verify', { token: '123456' }, headers
    );
    expect(verifyEnabledRes.status).toBe(403);
    expect(issueSessionTokens).not.toHaveBeenCalled();

    // Recovery code generation IS allowed for a recently-reauthenticated interactive session.
    const genRes = await send(
      app, 'GET', '/api/users/mfa/generateRecoveryCodes?regenerate=true', undefined, headers
    );
    expect(genRes.status).toBe(200);
    expect(genRes.body.codes).toHaveLength(10);
  });

  test('allows signed jwt-login challenge through real jwt-login strategy to complete MFA and recovery verification',
    async () => {
      const loginJwt = await tokens.getLoginProcessToken(currentDbUser);
      const headers = { Authorization: `Bearer ${loginJwt}` };

      const verifyRes = await send(app, 'POST', '/api/users/mfa/verify', { token: '123456' }, headers);
      expect(verifyRes.status).toBe(200);

      const recoveryRes = await send(
        app, 'POST', '/api/users/mfa/verifyRecoveryCode', { recoveryCode: 'valid-recovery' }, headers
      );
      expect(recoveryRes.status).toBe(200);
      expect(issueSessionTokens).toHaveBeenCalledTimes(2);
    });

  test('allows signed recent session JWT for interactive enrollment when MFA is not yet enabled', async () => {
    currentDbUser = makeDbUser({
      mfa: { enabled: false, secret: null, unverifiedSecrets: ['UNVERIFIEDSECRET'], recoveryCodes: [] }
    });
    const recentUnenrolledJwt = await tokens.getToken({
      user: {
        ...currentDbUser,
        authSessionId: 'sid-enroll',
        isLoggedInWithMfa: false,
        authTime: nowSec()
      }
    });
    const headers = { Authorization: `Bearer ${recentUnenrolledJwt}` };

    const uriRes = await send(app, 'GET', '/api/users/mfa/getMfaConfigUri', undefined, headers);
    expect(uriRes.status).toBe(200);
    expect(uriRes.body.configUri).toContain('otpauth://');

    const verifyRes = await send(app, 'POST', '/api/users/mfa/verify', { token: '123456' }, headers);
    expect(verifyRes.status).toBe(200);
    expect(issueSessionTokens).toHaveBeenCalledTimes(1);
  });
});

describe('MFA guard path normalization (A11)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('allows mixed-case /API/Users paths to reach passport auth instead of returning 403', async () => {
    for (const originalUrl of [
      '/api/users/mfa/verify',
      '/API/Users/mfa/verify',
      '/API/USERS/MFA/VERIFY?foo=1',
      '//api//users/mfa/verify'
    ]) {
      const next = jest.fn();
      auth.verifyUserOrLoginJWT({ originalUrl, headers: {} }, {}, next);
      await new Promise(setImmediate);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }));
    }
  });

  test('rejects sibling prefixes and dot-segment traversal outside /api/users with 403', async () => {
    const loginJwt = await tokens.getLoginProcessToken(makeDbUser());

    for (const originalUrl of [
      '/api/users2/mfa/verify',
      '/api/users-extra/mfa/verify',
      '/api/users/../devices',
      '/api/devices'
    ]) {
      const next = jest.fn();
      auth.verifyUserOrLoginJWT({
        originalUrl,
        headers: { authorization: `Bearer ${loginJwt}` }
      }, {}, next);
      await new Promise(setImmediate);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
    }
    expect(Users.findOne).not.toHaveBeenCalled();
  });
});
