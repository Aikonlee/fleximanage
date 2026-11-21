/** @jest-environment node */
// Regression: admin promotion/demotion must bump authVersion exactly once per changed user.
// The real authSessions module runs against an in-memory user store so a reintroduced
// `$inc: { authVersion }` in the route (on top of revokeAll's own increment) is caught.
jest.mock('../configs', () => () => ({ get: () => false }));
jest.mock('../mongoConns.js', () => () => ({}));
jest.mock('../flexibilling', () => ({}));
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
// Same mock flavour (virtual) as tests/auth-sessions.test.js: mixing virtual and non-virtual
// mocks of one path across suites in a single --runInBand process confuses Jest's resolver.
jest.mock('../models/authSessions', () => ({ updateMany: jest.fn(async () => ({})) }),
  { virtual: true });
jest.mock('../models/users', () => {
  const store = new Map();
  const matches = (doc, filter) => Object.entries(filter).every(([key, cond]) => {
    if (cond && typeof cond === 'object' && '$ne' in cond) return doc[key] !== cond.$ne;
    if (cond && typeof cond === 'object' && '$in' in cond) return cond.$in.includes(doc[key]);
    return doc[key] === cond;
  });
  const apply = (doc, update) => {
    for (const [key, value] of Object.entries(update)) {
      if (key === '$inc') for (const [f, n] of Object.entries(value)) doc[f] = (doc[f] ?? 0) + n;
      else if (key === '$set') Object.assign(doc, value);
      else doc[key] = value;
    }
  };
  const castCheck = filter => {
    if (String(filter._id).startsWith('malformed')) {
      throw Object.assign(new Error('Cast to ObjectId failed'), { name: 'CastError' });
    }
  };
  return {
    store,
    findOneAndUpdate: jest.fn(async (filter, update) => {
      castCheck(filter);
      const doc = [...store.values()].find(d => matches(d, filter));
      if (!doc) return null;
      apply(doc, update);
      return { ...doc };
    }),
    updateMany: jest.fn(async (filter, update) => {
      const docs = [...store.values()].filter(d => matches(d, filter));
      docs.forEach(d => apply(d, update));
      return { modifiedCount: docs.length };
    })
  };
});
const Users = require('../models/users');
const Sessions = require('../models/authSessions');
const authSessions = require('../authSessions');
const router = require('../routes/users');
const handler = (path, method) => router.stack.find(layer => layer.route?.path === path)
  .route.stack.filter(layer => layer.method === method).at(-1).handle;
const response = () => ({
  statusCode: 0, json: jest.fn(), status (code) { this.statusCode = code; return this; }
});
const seed = (...docs) => docs.forEach(d => Users.store.set(d._id, { authVersion: 0, ...d }));
const version = id => Users.store.get(id).authVersion;
const admin = { _id: 'acting-admin' };

beforeEach(() => {
  jest.clearAllMocks();
  Users.store.clear();
});

test('single-user promotion increments authVersion exactly once', async () => {
  seed({ _id: 'u1', admin: false, authVersion: 4 });
  const res = response();
  await handler('/:userId/admin', 'put')({ params: { userId: 'u1' }, user: admin }, res, jest.fn());
  expect(res.statusCode).toBe(200);
  expect(Users.store.get('u1').admin).toBe(true);
  expect(version('u1')).toBe(5);
  expect(Sessions.updateMany).toHaveBeenCalledTimes(1);
});

test('single-user demotion increments authVersion exactly once', async () => {
  seed({ _id: 'u1', admin: true, authVersion: 2 });
  const res = response();
  await handler('/:userId/admin', 'delete')({ params: { userId: 'u1' }, user: admin },
    res, jest.fn());
  expect(res.statusCode).toBe(200);
  expect(Users.store.get('u1').admin).toBe(false);
  expect(version('u1')).toBe(3);
});

test('single-user admin change for a missing user returns 404 without revoking', async () => {
  const next = jest.fn();
  const spy = jest.spyOn(authSessions, 'revokeAll');
  await handler('/:userId/admin', 'put')({ params: { userId: 'ghost' }, user: admin },
    response(), next);
  expect(next.mock.calls[0][0].status).toBe(404);
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
});

test('batch promotion increments authVersion exactly once per changed user only', async () => {
  seed({ _id: 'a', admin: false }, { _id: 'b', admin: false },
    { _id: 'already', admin: true, authVersion: 7 }, { _id: 'bystander', admin: false });
  const res = response();
  const next = jest.fn();
  await handler('/admin/batch', 'post')({
    body: { promote: ['a', 'b', 'a', 'already', 'ghost', 'malformed-id'] }, user: admin
  }, res, next);
  expect(next).not.toHaveBeenCalled();
  expect(res.statusCode).toBe(200);
  expect(res.json).toHaveBeenCalledWith({ status: 'batch promotion completed', promotedCount: 2 });
  expect(version('a')).toBe(1); // duplicated id still only one increment
  expect(version('b')).toBe(1);
  expect(version('already')).toBe(7); // unchanged user is not revoked
  expect(version('bystander')).toBe(0);
  expect(Sessions.updateMany).toHaveBeenCalledTimes(2);
  expect(Sessions.updateMany.mock.calls.map(c => c[0].user).sort()).toEqual(['a', 'b']);
});

test('batch demotion increments authVersion exactly once per changed user only', async () => {
  seed({ _id: 'a', admin: true, authVersion: 3 }, { _id: 'b', admin: true },
    { _id: 'plain', admin: false, authVersion: 9 });
  const res = response();
  await handler('/admin/batch', 'post')({
    body: { demote: ['a', 'b', 'plain', 'ghost'] }, user: admin
  }, res, jest.fn());
  expect(res.json).toHaveBeenCalledWith({ status: 'batch demotion completed', demotedCount: 2 });
  expect(Users.store.get('a').admin).toBe(false);
  expect(version('a')).toBe(4);
  expect(version('b')).toBe(1);
  expect(version('plain')).toBe(9);
});

test('batch tolerates a user deleted between update and revocation', async () => {
  seed({ _id: 'a', admin: false }, { _id: 'gone', admin: false });
  const real = authSessions.revokeAll;
  const spy = jest.spyOn(authSessions, 'revokeAll').mockImplementation(async id => {
    if (id === 'gone') { Users.store.delete('gone'); }
    return real(id);
  });
  const res = response();
  const next = jest.fn();
  await handler('/admin/batch', 'post')({ body: { promote: ['a', 'gone'] }, user: admin },
    res, next);
  expect(next).not.toHaveBeenCalled();
  expect(res.statusCode).toBe(200);
  expect(version('a')).toBe(1);
  spy.mockRestore();
});

test('batch surfaces unexpected revocation failures instead of reporting success', async () => {
  seed({ _id: 'a', admin: false });
  const spy = jest.spyOn(authSessions, 'revokeAll').mockRejectedValue(new Error('db down'));
  const res = response();
  const next = jest.fn();
  await handler('/admin/batch', 'post')({ body: { promote: ['a'] }, user: admin }, res, next);
  expect(next.mock.calls[0][0].status).toBe(500);
  expect(res.json).not.toHaveBeenCalled();
  spy.mockRestore();
});
