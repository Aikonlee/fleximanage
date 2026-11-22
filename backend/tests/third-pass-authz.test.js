/** @jest-environment node */
// Third-pass authz: app-key admin, select denial, cookie refresh, member scope, cookies.
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
      const header = req && req.headers && req.headers.authorization;
      return header ? header.split(' ')[1] : undefined;
    }
  }
}));
jest.mock('../models/users', () => ({
  serializeUser: () => () => {},
  deserializeUser: () => () => {},
  authenticate: () => () => {},
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn(async () => ({}))
}));
jest.mock('../models/accounts', () => ({
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn()
}));
jest.mock('../models/accesstokens', () => ({ findOne: jest.fn() }));
jest.mock('../models/membership', () => ({
  membership: { find: jest.fn() },
  preDefinedPermissions: {},
  permissionMasks: { get: 1, post: 2, put: 4, del: 8 },
  getUserPermissions: jest.fn(async () => ({})),
  validatePermissionCombination: jest.fn()
}));
jest.mock('../utils/membershipUtils', () => ({
  orgUpdateFromNull: jest.fn(async () => {}),
  getUserOrgByID: jest.fn(async () => [{ _id: 'org-a' }]),
  getUserOrganizations: jest.fn(async () => ({})),
  getUserAccounts: jest.fn(async () => []),
  getAccessTokenOrgList: jest.fn(async () => ['org-scoped'])
}));
jest.mock('../utils/mailer', () => () => ({ sendMailHTML: jest.fn() }));
jest.mock('../utils/recaptcha', () => () => ({ verifyReCaptcha: jest.fn() }));
jest.mock('../utils/webhooks', () => () => ({ sendToWebHook: jest.fn() }));
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
  verifyToken: jest.fn(),
  getToken: jest.fn(),
  getRefreshToken: jest.fn()
}));
jest.mock('../sessionTokens', () => jest.fn());
jest.mock('../authSessions', () => ({
  validateAccess: jest.fn(),
  rotateRefresh: jest.fn(),
  revokeCurrent: jest.fn(),
  revokeAll: jest.fn(async () => 1)
}));
jest.mock('../utils/authCookies', () => ({
  setAuthCookies: jest.fn(),
  clearAuthCookies: jest.fn()
}));
jest.mock('../websocket/Connections', () => () => ({ deviceDisconnect: jest.fn() }));
jest.mock('../notifications/notifications', () => () => ({}));
jest.mock('../deviceLogic/events', () => jest.fn());
jest.mock('../deviceLogic/modifyDevice', () => ({ processModifyJob: jest.fn() }));
jest.mock('../deviceLogic/sync', () => ({ forceDevicesSync: jest.fn() }));
jest.mock('../deviceLogic/events/eventReasons', () => ({
  pendingTypes: {},
  getReason: jest.fn()
}));
jest.mock('../deviceLogic/tunnels', () => ({
  prepareTunnelAddJob: jest.fn(),
  prepareTunnelRemoveJob: jest.fn()
}));
jest.mock('../deviceLogic/jobParameters', () => ({ transformVxlanConfig: jest.fn() }));
jest.mock('../deviceLogic/validators', () => ({ validateOverlappingSubnets: jest.fn() }));
jest.mock('../utils/deviceUtils', () => ({ validateFirewallRules: jest.fn() }));
jest.mock('../utils/networks', () => ({ checkOverlapping: jest.fn() }));
jest.mock('../versioning', () => ({
  getMajorVersion: jest.fn(),
  getMinorVersion: jest.fn()
}));

const passport = require('passport');
const Accounts = require('../models/accounts');
const Users = require('../models/users');
const { membership } = require('../models/membership');
const { getAccessTokenOrgList, getUserOrgByID, getUserAccounts } =
  require('../utils/membershipUtils');
const tokens = require('../tokens');
const authSessions = require('../authSessions');
const issueSessionTokens = require('../sessionTokens');
const { setAuthCookies, clearAuthCookies } = require('../utils/authCookies');
const auth = require('../authenticate');
const router = require('../routes/users');
const OrganizationsService = require('../services/OrganizationsService');
const AccountsService = require('../services/AccountsService');
const MembersService = require('../services/MembersService');

const thenable = (value) => {
  const promise = Promise.resolve(value);
  const query = {
    populate () { return query; },
    then (ok, fail) { return promise.then(ok, fail); }
  };
  return query;
};

const postHandler = (path) => router.stack.find(layer => layer.route && layer.route.path === path)
  .route.stack.filter(layer => layer.method === 'post').at(-1).handle;

const refreshRequest = (cookies, headerToken) => ({
  method: 'GET',
  originalUrl: '/api/users/me',
  cookies,
  headers: {
    authorization: 'Bearer expired-access',
    'refresh-token': headerToken
  },
  header () { return undefined; }
});

const runExpiredRefresh = (req) => {
  passport.authenticate.mockImplementation((name, opts, callback) => () => {
    callback(null, false, { name: 'TokenExpiredError', message: 'expired' });
  });
  const res = {
    headers: {},
    setHeader (key, value) { this.headers[key.toLowerCase()] = value; },
    getHeaders () { return this.headers; },
    header () { return undefined; }
  };
  let complete;
  const done = new Promise(resolve => { complete = resolve; });
  auth.verifyUserJWT(req, res, error => complete(error));
  return done;
};

beforeEach(() => {
  jest.clearAllMocks();
  Accounts.findOne.mockResolvedValue({ _id: 'acct-1', name: 'Acct' });
  membership.find.mockReturnValue(thenable([]));
  getAccessTokenOrgList.mockResolvedValue(['org-scoped']);
  tokens.verifyToken.mockRejectedValue(Object.assign(new Error('stop'), {
    name: 'JsonWebTokenError'
  }));
});

test('app access key does not keep its creator global admin flag', async () => {
  const user = {
    _id: 'creator',
    admin: true,
    defaultAccount: { _id: { toString: () => 'acct-1' } },
    defaultOrg: { _id: 'org-creator' },
    mfa: { enabled: false }
  };
  const ok = await auth.setUserPerms(user, {
    type: 'app_access_key',
    account: 'acct-1',
    org: 'org-token',
    perms: { organizations: 1 },
    id: 'token-id'
  }, {
    permissions: { organizations: 1 },
    to: 'organization',
    organization: 'org-allowed',
    group: '',
    role: 'manager'
  });
  expect(ok).toBe(true);
  expect(user.admin).toBe(false);
  expect(user.accessToken).toBe(true);
  expect(user.perms).toEqual({ organizations: 1 });
  expect(user.role).toBe('manager');
});

test('access key cannot select an organization or an account', async () => {
  const user = {
    _id: 'creator',
    accessToken: true,
    defaultAccount: { _id: { toString: () => 'acct-1' } }
  };
  const orgResult = await OrganizationsService.organizationsSelectPOST(
    { org: 'org-other' }, { user }, { setHeader: jest.fn() });
  const accountResult = await AccountsService.accountsSelectPOST(
    { account: 'acct-other' }, { user }, {});
  expect(orgResult.code).toBe(403);
  expect(accountResult.code).toBe(403);
  expect(getUserOrgByID).not.toHaveBeenCalled();
  expect(getUserAccounts).not.toHaveBeenCalled();
});

test('expired access refresh prefers the cookie over the refresh header', async () => {
  const req = refreshRequest(
    { refreshToken: 'cookie-refresh' },
    'header-refresh'
  );
  await runExpiredRefresh(req);
  expect(tokens.verifyToken).toHaveBeenCalledTimes(1);
  expect(tokens.verifyToken).toHaveBeenCalledWith('cookie-refresh');
});

test('expired access refresh falls back to the header when no cookie is set', async () => {
  const req = refreshRequest(undefined, 'header-refresh');
  await runExpiredRefresh(req);
  expect(tokens.verifyToken).toHaveBeenCalledTimes(1);
  expect(tokens.verifyToken).toHaveBeenCalledWith('header-refresh');
});

test('members list and member get use the access-token org list', async () => {
  const user = {
    _id: 'creator',
    admin: true,
    accessToken: true,
    defaultAccount: { _id: 'acct-1' },
    defaultOrg: { _id: 'org-creator', group: 'creator-group' },
    perms: { accounts: 1, organizations: 1 }
  };
  const list = await MembersService.membersGET({ offset: 0, limit: 10 }, { user });
  const one = await MembersService.membersIdGET({ id: 'mem-1' }, { user });
  const orgClause = {
    to: 'organization',
    organization: { $in: ['org-scoped'] }
  };
  expect(list.code).toBe(200);
  expect(one.code).toBe(200);
  expect(getAccessTokenOrgList).toHaveBeenCalledWith(user, undefined, false);
  expect(membership.find).toHaveBeenCalledWith({
    account: 'acct-1',
    $or: [orgClause]
  });
  expect(membership.find).toHaveBeenCalledWith({
    _id: 'mem-1',
    account: 'acct-1',
    $or: [orgClause]
  });
  const queries = membership.find.mock.calls.map(call => JSON.stringify(call[0]));
  expect(queries.some(query => query.includes('org-creator'))).toBe(false);
  expect(queries.some(query => query.includes('creator-group'))).toBe(false);
});

test('forceMfa rotation calls setAuthCookies with the new session pair', async () => {
  issueSessionTokens.mockResolvedValue({
    token: 'access-jwt',
    refreshToken: 'refresh-jwt'
  });
  Accounts.findOne.mockResolvedValue({ _id: 'acct-1', forceMfa: false });
  Accounts.findOneAndUpdate.mockResolvedValue({
    _id: 'acct-1',
    name: 'Renamed',
    companyType: 'msp',
    companyDesc: 'desc',
    country: 'US',
    forceMfa: true
  });
  Users.findOne.mockReturnValue(thenable({
    _id: 'caller',
    defaultAccount: { _id: 'acct-1', name: 'Acct' },
    defaultOrg: { _id: 'org-1', name: 'Org' }
  }));
  const req = {
    headers: {},
    user: {
      _id: 'caller',
      isLoggedInWithMfa: true,
      defaultAccount: { _id: 'acct-1', name: 'Acct' },
      defaultOrg: { _id: 'org-1', name: 'Org' }
    }
  };
  const response = { setHeader: jest.fn() };
  const result = await AccountsService.accountsIdPUT({
    id: 'acct-1',
    name: 'Renamed',
    companyType: 'msp',
    companyDesc: 'desc',
    country: 'US',
    forceMfa: true
  }, req, response);
  expect(result.code).toBe(200);
  expect(setAuthCookies).toHaveBeenCalledTimes(1);
  expect(setAuthCookies).toHaveBeenCalledWith(
    req, response, 'access-jwt', 'refresh-jwt'
  );
});

test('change-password clears auth cookies after sessions are revoked', async () => {
  const order = [];
  authSessions.revokeAll.mockImplementation(async () => {
    order.push('revoke');
    return 1;
  });
  clearAuthCookies.mockImplementation(() => { order.push('clear'); });
  const res = {
    status (code) { this.statusCode = code; return this; },
    json: jest.fn()
  };
  let complete;
  const done = new Promise(resolve => { complete = resolve; });
  res.json.mockImplementation(() => complete());
  const handle = postHandler('/change-password');
  handle({
    body: { oldPassword: 'old-password', newPassword: 'new-password-1' },
    user: {
      _id: 'caller',
      changePassword: (oldPassword, newPassword, callback) => callback(null)
    }
  }, res, error => complete(error));
  await done;
  expect(order).toEqual(['revoke', 'clear']);
  expect(authSessions.revokeAll).toHaveBeenCalledWith('caller');
  expect(clearAuthCookies).toHaveBeenCalledWith(res);
});
