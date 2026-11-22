/** @jest-environment node */
// Legacy /api/organizations handlers are mounted ahead of the OpenAPI router.
// Models and sessions are mocked; no MongoDB is required.
jest.mock('../logging/logging', () => () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));
jest.mock('../routes/cors', () => ({
  cors: (req, res, next) => next(),
  corsWithOptions: (req, res, next) => next()
}));
jest.mock('../authenticate', () => ({
  verifyPermission: () => (req, res, next) => next()
}));
jest.mock('../tokens', () => ({ getToken: jest.fn(async () => 'jwt') }));
jest.mock('../websocket/Connections', () => () => ({ deviceDisconnect: jest.fn() }));
jest.mock('../flexibilling', () => ({ registerDevice: jest.fn(async () => ({})) }));
jest.mock('../authSessions', () => ({ revokeAll: jest.fn(async () => 1) }));
jest.mock('../utils/membershipUtils', () => ({
  getUserOrganizations: jest.fn(),
  getUserOrgByID: jest.fn(),
  orgUpdateFromNull: jest.fn(),
  getAccessTokenOrgList: jest.fn()
}));
jest.mock('../mongoConns.js', () => {
  const session = {
    startTransaction: jest.fn(async () => {}),
    commitTransaction: jest.fn(async () => {}),
    abortTransaction: jest.fn(async () => {})
  };
  const api = {
    session,
    getMainDB: jest.fn(() => ({
      startSession: jest.fn(async () => session)
    }))
  };
  return () => api;
});
jest.mock('../models/users', () => ({ findOneAndUpdate: jest.fn() }));
jest.mock('../models/accounts', () => ({ findOneAndUpdate: jest.fn() }));
jest.mock('../models/organizations', () => ({
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  findOneAndRemove: jest.fn()
}));
jest.mock('../models/membership', () => ({
  membership: { find: jest.fn(), deleteMany: jest.fn() }
}));
jest.mock('../models/devices', () => ({
  devices: { find: jest.fn(), countDocuments: jest.fn(), deleteMany: jest.fn() }
}));
jest.mock('../models/tunnels', () => ({ deleteMany: jest.fn(async () => ({})) }));
jest.mock('../models/tunnelids', () => ({ deleteMany: jest.fn(async () => ({})) }));
jest.mock('../models/tokens', () => ({ deleteMany: jest.fn(async () => ({})) }));
jest.mock('../models/accesstokens', () => ({ deleteMany: jest.fn(async () => ({})) }));
jest.mock('../models/analytics/deviceStats', () => ({ deviceStats: {} }));

const users = require('../models/users');
const accounts = require('../models/accounts');
const organizations = require('../models/organizations');
const { membership } = require('../models/membership');
const { devices } = require('../models/devices');
const flexibilling = require('../flexibilling');
const authSessions = require('../authSessions');
const { getToken } = require('../tokens');
const {
  getUserOrgByID,
  orgUpdateFromNull,
  getAccessTokenOrgList
} = require('../utils/membershipUtils');
const mongo = require('../mongoConns.js')();
const { organizationsRouter } = require('../routes/organizations');

const handler = (path, method) => {
  const layer = organizationsRouter.stack.find(entry => entry.route &&
    entry.route.path === path);
  const stack = layer.route.stack.filter(entry => entry.method === method);
  return stack[stack.length - 1].handle;
};

const invoke = (handle, req) => new Promise((resolve, reject) => {
  let settled = false;
  const finish = (err, value) => {
    if (settled) return;
    settled = true;
    if (err) reject(err);
    else resolve(value);
  };
  const res = {
    headers: {},
    statusCode: 200,
    setHeader (key, value) { this.headers[key.toLowerCase()] = value; },
    status (code) { this.statusCode = code; return this; },
    json (body) { finish(null, { res, body }); return this; }
  };
  const next = (err) => finish(err || new Error('next called without error'));
  let result;
  try {
    result = handle(req, res, next);
  } catch (err) {
    finish(err);
    return;
  }
  if (result && typeof result.then === 'function') {
    result.then(() => {
      if (!settled) finish(new Error('handler finished without a response'));
    }).catch(err => finish(err));
  }
});

const currentOrg = () => ({
  _id: 'org-id',
  name: 'Org',
  description: 'desc',
  group: 'alpha',
  account: 'acct-id',
  encryptionMethod: 'psk',
  vxlanPort: '4789',
  tunnelRange: '10.100.0.0'
});

const orgUser = (extra) => Object.assign({
  _id: 'caller',
  defaultAccount: { _id: 'acct-id' },
  defaultOrg: { _id: 'org-id' }
}, extra || {});

let events;

beforeEach(() => {
  jest.clearAllMocks();
  events = [];
  getUserOrgByID.mockResolvedValue([{ _id: 'org-id' }]);
  orgUpdateFromNull.mockResolvedValue(undefined);
  getToken.mockResolvedValue('jwt');
  getAccessTokenOrgList.mockImplementation(async (user, orgId, required, accountId, group) => {
    if (user && user.accountModify && accountId) return ['org-id'];
    if (group && user && Array.isArray(user.groups) && user.groups.includes(group)) {
      return ['org-id'];
    }
    return [];
  });
  accounts.findOneAndUpdate.mockResolvedValue({ _id: 'acct-id' });
  organizations.findOne.mockImplementation(async () => currentOrg());
  organizations.findOneAndRemove.mockResolvedValue({ _id: 'org-id' });
  organizations.findOneAndUpdate.mockImplementation(async (query, update) => {
    const set = update.$set;
    return {
      _id: 'org-id',
      name: set.name !== undefined ? set.name : 'Org',
      description: set.description !== undefined ? set.description : 'desc',
      group: set.group !== undefined ? set.group : 'alpha',
      account: set.account !== undefined ? set.account : 'acct-id',
      encryptionMethod: set.encryptionMethod !== undefined ? set.encryptionMethod : 'psk',
      vxlanPort: set.vxlanPort !== undefined ? set.vxlanPort : '4789',
      tunnelRange: set.tunnelRange !== undefined ? set.tunnelRange : '10.100.0.0'
    };
  });
  membership.find.mockImplementation(async (query) => {
    if (query && query.organization) {
      events.push('find');
      return [
        { user: 'user-1' },
        { user: 'user-1' },
        { user: 'user-2' },
        { user: null }
      ];
    }
    if (query && query.to === 'group') {
      return [{ user: 'old-user' }, { user: 'new-user' }, { user: 'old-user' }];
    }
    return [];
  });
  membership.deleteMany.mockImplementation(async () => {
    events.push('delete');
    return {};
  });
  devices.find.mockResolvedValue([{ machineId: 'machine-1' }]);
  devices.countDocuments.mockImplementation(() => ({
    session: () => Promise.resolve(1)
  }));
  devices.deleteMany.mockResolvedValue({});
  flexibilling.registerDevice.mockResolvedValue({});
  mongo.session.commitTransaction.mockImplementation(async () => {
    events.push('committed');
  });
  authSessions.revokeAll.mockImplementation(async (id) => {
    events.push('revoke:' + id);
    return 1;
  });
  users.findOneAndUpdate.mockImplementation(() => {
    const promise = Promise.resolve({
      defaultOrg: { _id: 'org-2', name: 'Other' }
    });
    const chain = {
      populate () { return chain; },
      then (ok, bad) { return promise.then(ok, bad); }
    };
    return chain;
  });
});

const putBody = (extra) => Object.assign({
  name: 'renamed',
  description: 'newer',
  encryptionMethod: 'ikev2',
  account: 'other-account',
  group: 'beta',
  tunnelRange: '10.200.0.0',
  vxlanPort: '4790',
  role: 'owner'
}, extra || {});

test('POST /select rejects an app access key before changing defaultOrg', async () => {
  const req = {
    user: {
      _id: 'creator',
      accessToken: true,
      defaultAccount: { _id: 'acct-id' }
    },
    body: { org: 'org-2' }
  };
  await expect(invoke(handler('/select', 'post'), req)).rejects.toMatchObject({
    status: 403,
    message: 'Organization selection is not permitted for access keys'
  });
  expect(users.findOneAndUpdate).not.toHaveBeenCalled();
  expect(getUserOrgByID).not.toHaveBeenCalled();
});

test('PUT /:orgId keeps metadata and drops fields without account or group rights', async () => {
  const req = {
    user: orgUser(),
    params: { orgId: 'org-id' },
    body: putBody()
  };
  const { body } = await invoke(handler('/:orgId', 'put'), req);
  expect(organizations.findOneAndUpdate).toHaveBeenCalledWith(
    { _id: 'org-id' },
    {
      $set: {
        name: 'renamed',
        description: 'newer',
        encryptionMethod: 'ikev2'
      }
    },
    expect.objectContaining({ new: true, runValidators: true })
  );
  expect(body.account).toBe('acct-id');
  expect(body.group).toBe('alpha');
  expect(body.role).toBeUndefined();
  expect(authSessions.revokeAll).not.toHaveBeenCalled();
});

test('PUT /:orgId applies restricted fields when account modify rights exist', async () => {
  const req = {
    user: orgUser({ accountModify: true }),
    params: { orgId: 'org-id' },
    body: putBody()
  };
  await invoke(handler('/:orgId', 'put'), req);
  expect(organizations.findOneAndUpdate).toHaveBeenCalledWith(
    { _id: 'org-id' },
    {
      $set: {
        name: 'renamed',
        description: 'newer',
        encryptionMethod: 'ikev2',
        account: 'other-account',
        group: 'beta',
        tunnelRange: '10.200.0.0',
        vxlanPort: '4790'
      }
    },
    expect.any(Object)
  );
  expect(getAccessTokenOrgList).toHaveBeenCalledWith(
    req.user, null, false, 'acct-id', '', true
  );
  expect(membership.find).toHaveBeenCalledWith({
    account: 'acct-id',
    to: 'group',
    group: { $in: ['alpha', 'beta'] }
  });
  expect(authSessions.revokeAll).toHaveBeenCalledTimes(2);
  expect(authSessions.revokeAll).toHaveBeenCalledWith('old-user');
  expect(authSessions.revokeAll).toHaveBeenCalledWith('new-user');
});

test('PUT /:orgId allows group and tunnel edits for group modify rights only', async () => {
  const req = {
    user: orgUser({ groups: ['alpha', 'beta'] }),
    params: { orgId: 'org-id' },
    body: putBody()
  };
  await invoke(handler('/:orgId', 'put'), req);
  const update = organizations.findOneAndUpdate.mock.calls[0][1].$set;
  expect(update.group).toBe('beta');
  expect(update.tunnelRange).toBe('10.200.0.0');
  expect(update.vxlanPort).toBe('4790');
  expect(update.account).toBeUndefined();
  expect(update.role).toBeUndefined();
  expect(update.name).toBe('renamed');
});

test('DELETE /:orgId revokes each distinct member once after commit', async () => {
  const req = {
    user: orgUser(),
    params: { orgId: 'org-id' }
  };
  const { body } = await invoke(handler('/:orgId', 'delete'), req);
  expect(body).toEqual({ ok: 1 });
  expect(membership.find).toHaveBeenCalledWith(
    { organization: 'org-id' },
    { user: 1 },
    { session: mongo.session }
  );
  expect(events.indexOf('find')).toBeLessThan(events.indexOf('delete'));
  expect(events.indexOf('delete')).toBeLessThan(events.indexOf('committed'));
  expect(events.indexOf('committed')).toBeLessThan(events.indexOf('revoke:user-1'));
  expect(authSessions.revokeAll).toHaveBeenCalledTimes(2);
  expect(authSessions.revokeAll).toHaveBeenCalledWith('user-1');
  expect(authSessions.revokeAll).toHaveBeenCalledWith('user-2');
  expect(authSessions.revokeAll).not.toHaveBeenCalledWith('caller');
});
