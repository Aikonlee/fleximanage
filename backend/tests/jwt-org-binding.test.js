// NEW-02: normal-user JWT perms stay trusted only while account and org match.
const mockJwt = require('jsonwebtoken');
const mockSecret = 'test-only-secret';
let mockUser;
const mockStrategies = {};

jest.mock('passport', () => ({
  use: jest.fn((name, strategy) => {
    mockStrategies[name] = strategy;
    return strategy;
  }),
  serializeUser: jest.fn(),
  deserializeUser: jest.fn(),
  authenticate: jest.fn()
}));
jest.mock('passport-jwt', () => ({
  Strategy: class {
    constructor (opts, callback) {
      this.callback = callback;
    }
  },
  ExtractJwt: {
    fromAuthHeaderAsBearerToken: () => (req) => {
      const header = req.headers.authorization;
      return header ? header.split(' ')[1] : undefined;
    }
  }
}));
jest.mock('../models/users', () => ({
  serializeUser: () => () => {},
  deserializeUser: () => () => {},
  authenticate: () => () => {},
  findOne: jest.fn(() => ({
    populate: jest.fn(() => ({
      populate: async () => mockUser,
      then: (resolve, reject) => Promise.resolve(mockUser).then(resolve, reject)
    }))
  }))
}));
jest.mock('../models/accounts', () => ({
  findOne: jest.fn(async () => ({ _id: 'account-a' }))
}));
jest.mock('../models/accesstokens', () => ({
  findOne: jest.fn(async () => null)
}));
jest.mock('../models/membership', () => ({
  permissionMasks: {},
  getUserPermissions: jest.fn()
}));
jest.mock('../utils/membershipUtils', () => ({
  orgUpdateFromNull: jest.fn(async () => {}),
  getUserOrgByID: jest.fn(async () => [])
}));
jest.mock('../configs', () => () => ({
  get: (key) => key === 'userTokenSecretKey' ? mockSecret : false
}));
jest.mock('../utils/recaptcha', () => () => ({}));
jest.mock('../logging/logging', () => () => ({
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn()
}));
jest.mock('../tokens', () => ({
  verifyToken: jest.fn(),
  getToken: jest.fn(),
  getRefreshToken: jest.fn()
}));
jest.mock('../authSessions', () => ({
  rotateRefresh: jest.fn(),
  validateAccess: jest.fn(async () => true)
}));

const { getUserPermissions } = require('../models/membership');
require('../authenticate');

const tokenPerms = { devices: 15, organizations: 7 };
const activeOrgPerms = { devices: 1, organizations: 1 };

beforeEach(() => {
  mockUser = {
    _id: 'user-a',
    username: 'alice',
    defaultAccount: { _id: 'account-a' },
    // Non-string id: trust requires String(defaultOrg._id) === String(token org).
    defaultOrg: { _id: { toString: () => 'org-a' } }
  };
  getUserPermissions.mockReset();
  getUserPermissions.mockResolvedValue(activeOrgPerms);
});

const jwtStrategy = mockStrategies.jwt;

const checkJwt = async (payload) => {
  const presented = mockJwt.sign(payload, mockSecret);
  const req = { headers: { authorization: `Bearer ${presented}` } };
  return new Promise((resolve, reject) => {
    jwtStrategy.callback(req, payload, (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve({ result });
      }
    });
  });
};

test('keeps token perms when account and organization match', async () => {
  const payload = {
    _id: 'user-a',
    account: 'account-a',
    org: 'org-a',
    perms: tokenPerms
  };

  const { result } = await checkJwt(payload);

  expect(result).toBe(mockUser);
  expect(result.perms).toBe(tokenPerms);
  expect(getUserPermissions).not.toHaveBeenCalled();
});

test('recomputes perms when defaultOrg no longer matches the token', async () => {
  mockUser.defaultOrg = { _id: { toString: () => 'org-b' } };
  const payload = {
    _id: 'user-a',
    account: 'account-a',
    org: 'org-a',
    perms: tokenPerms
  };

  const { result } = await checkJwt(payload);

  expect(result).toBe(mockUser);
  expect(getUserPermissions).toHaveBeenCalledTimes(1);
  expect(getUserPermissions).toHaveBeenCalledWith(mockUser);
  expect(result.perms).toBe(activeOrgPerms);
  expect(result.perms).not.toBe(tokenPerms);
});
