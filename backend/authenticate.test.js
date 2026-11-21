const mockJwt = require('jsonwebtoken');
const mockSecret = 'test-only-secret';
let mockAuthenticateResult;
let mockUser;
let mockAccessRecord;
let mockStrategies = {};

jest.mock('passport', () => ({
  use: jest.fn((name, strategy) => { mockStrategies[name] = strategy; return strategy; }),
  serializeUser: jest.fn(), deserializeUser: jest.fn(),
  authenticate: jest.fn((strategy, options, callback) => (req, res, next) => mockAuthenticateResult(callback, req, res, next))
}));
jest.mock('passport-jwt', () => ({
  Strategy: class { constructor (opts, callback) { this.callback = callback; } },
  ExtractJwt: { fromAuthHeaderAsBearerToken: () => (req) => req.headers.authorization?.split(' ')[1] }
}));
jest.mock('./models/users', () => ({
  serializeUser: () => () => {}, deserializeUser: () => () => {}, authenticate: () => () => {},
  findOne: jest.fn(() => ({ populate: jest.fn(() => ({ populate: async () => mockUser, then: (resolve, reject) => Promise.resolve(mockUser).then(resolve, reject) })) }))
}));
jest.mock('./models/accounts', () => ({ findOne: jest.fn(async () => ({ _id: 'account-a' })) }));
jest.mock('./models/accesstokens', () => ({ findOne: jest.fn(async () => mockAccessRecord) }));
jest.mock('./models/membership', () => ({ permissionMasks: {} }));
jest.mock('./utils/membershipUtils', () => ({ orgUpdateFromNull: jest.fn(async () => {}), getUserOrgByID: jest.fn(async () => []) }));
jest.mock('./configs', () => () => ({ get: (key) => key === 'userTokenSecretKey' ? mockSecret : false }));
jest.mock('./utils/recaptcha', () => () => ({}));
jest.mock('./logging/logging', () => () => ({ warn: jest.fn(), info: jest.fn(), debug: jest.fn() }));
jest.mock('./tokens', () => ({
  verifyToken: jest.fn((token) => mockJwt.verify(token, mockSecret)),
  getToken: jest.fn(async () => mockJwt.sign(
    { _id: 'user-a', account: 'account-a', perms: {} },
    mockSecret
  )),
  getRefreshToken: jest.fn(async () => 'next-refresh-jwt')
}));
jest.mock('./authSessions', () => ({
  rotateRefresh: jest.fn(async (payload) => ({ sid: payload.sid, jti: 'new-jti' })),
  validateAccess: jest.fn(async () => true)
}));

const auth = require('./authenticate');
const Access = require('./models/accesstokens');

beforeEach(() => {

  // Strategy registrations occur at module load, so reuse registered callbacks below.
  mockUser = { _id: 'user-a', username: 'alice', defaultAccount: { _id: 'account-a' } };
  mockAccessRecord = { account: 'account-a', isValid: true, permissions: {} };
  jest.clearAllMocks();
});
const jwtStrategy = mockStrategies.jwt;
const checkJwt = async (payload, storedToken) => {
  const presented = mockJwt.sign(payload, mockSecret);
  mockAccessRecord.token = storedToken === undefined ? presented : storedToken;
  return new Promise((resolve, reject) => jwtStrategy.callback({ headers: { authorization: `Bearer ${presented}` } }, payload, (err, result, info) => err ? reject(err) : resolve({ result, info })));
};
const request = (refreshPayload, expiredPayload = { _id: 'user-a', account: 'account-a' }) => {
  const expiredToken = mockJwt.sign(expiredPayload, mockSecret, { expiresIn: -1 });
  const req = { method: 'GET', originalUrl: '/api/devices', headers: { authorization: `Bearer ${expiredToken}`, 'refresh-token': mockJwt.sign(refreshPayload, mockSecret) }, header: () => undefined };
  const headers = {};
  const res = { setHeader: (name, value) => { headers[name.toLowerCase()] = value; }, getHeaders: () => headers };
  mockAuthenticateResult = (callback) => callback(null, false, { name: 'TokenExpiredError' });
  return { req, res, headers };
};

test('rejects revoked access key', async () => {
  mockAccessRecord.isValid = false;
  expect((await checkJwt({ type: 'app_access_key', id: 'key-a', account: 'account-a', _id: 'user-a' })).result).toBe(false);
});

test('rejects access key used for a different account', async () => {
  mockAccessRecord.account = 'account-b';
  expect((await checkJwt({ type: 'app_access_key', id: 'key-a', account: 'account-a', _id: 'user-a' })).result).toBe(false);
});

test('rejects access key JWT lacking a token ID', async () => {
  expect((await checkJwt({ type: 'app_access_key', account: 'account-a', _id: 'user-a' })).result).toBe(false);
});

test('rejects access token JWT with revoked record', async () => {
  mockAccessRecord.isValid = false;
  expect((await checkJwt({ type: 'app_access_token', id: 'key-a', account: 'account-a', _id: 'user-a' })).result).toBe(false);
});

test('rejects access key whose presented JWT differs from stored credential', async () => {
  expect((await checkJwt({ type: 'app_access_key', id: 'key-a', account: 'account-a', _id: 'user-a' }, 'other-token')).result).toBe(false);
});

test('accepts valid bound access key', async () => {
  expect((await checkJwt({ type: 'app_access_key', id: 'key-a', account: 'account-a', _id: 'user-a' })).result._id).toBe('user-a');
});

test('rejects refresh token from another user', async () => {
  const { req, res } = request({ type: 'refresh', _id: 'user-b' });

  const next = jest.fn();
  await auth.verifyUserJWT(req, res, next);
  await new Promise(setImmediate);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }));
  expect(res.getHeaders()['refresh-jwt']).toBeUndefined();
});

test('rejects an access JWT presented as a refresh token', async () => {
  const { req, res } = request({ _id: 'user-a', account: 'account-a' });
  const next = jest.fn();
  auth.verifyUserJWT(req, res, next);
  await new Promise(setImmediate);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }));
  expect(res.getHeaders()['refresh-jwt']).toBeUndefined();
});

test('accepts a matching typed refresh token after access expiry', async () => {
  const session = {
    _id: 'user-a',
    account: 'account-a',
    sid: 'session-a',
    authVersion: 0,
    mfaVerified: false
  };
  const { req, res } = request(
    { ...session, jti: 'old-jti', type: 'refresh' },
    session
  );
  const next = jest.fn();
  auth.verifyUserJWT(req, res, next);
  await new Promise(setImmediate);
  expect(next).toHaveBeenCalledWith();
  expect(res.getHeaders()['refresh-jwt']).toBeTruthy();
  expect(res.getHeaders()['refresh-token']).toBeTruthy();
});
