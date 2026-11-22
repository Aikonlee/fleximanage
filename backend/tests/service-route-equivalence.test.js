/** @jest-environment node */
// Service-layer stand-in for the removed organizations, accounts, and tunnels routers.
// Models and helpers are mocked; no MongoDB is required.
jest.mock('../services/Service', () => ({
  successResponse: (body, code = 200) => ({ body, code }),
  rejectResponse: (error, code = 500) => ({ error, code })
}));
jest.mock('../logging/logging', () => () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));
jest.mock('../configs', () => () => ({ get: () => '' }));
jest.mock('../tokens', () => ({ getToken: jest.fn(async () => 'jwt') }));
jest.mock('../flexibilling', () => ({ registerDevice: jest.fn(async () => ({})) }));
jest.mock('../websocket/Connections', () => () => ({ deviceDisconnect: jest.fn() }));
jest.mock('../notifications/notifications', () => () => ({}));
jest.mock('../sessionTokens', () => jest.fn());
jest.mock('../utils/authCookies', () => ({ setAuthCookies: jest.fn() }));
jest.mock('../utils/membershipUtils', () => ({
  getAccessTokenOrgList: jest.fn(),
  validateOrgAccess: jest.fn(),
  getUserOrganizations: jest.fn(),
  getUserOrgByID: jest.fn(),
  getUserAccounts: jest.fn(),
  orgUpdateFromNull: jest.fn()
}));
jest.mock('../mongoConns.js', () => {
  const dbSession = { id: 'session' };
  const api = {
    getMainDB: () => ({ startSession: async () => dbSession }),
    mainDBwithTransaction: jest.fn(async (fn) => { await fn(dbSession); }),
    dbSession
  };
  return () => api;
});
jest.mock('../models/membership', () => ({
  membership: { find: jest.fn(), deleteMany: jest.fn() }
}));
jest.mock('../models/accounts', () => ({ findOneAndUpdate: jest.fn() }));
jest.mock('../models/organizations', () => ({
  findOne: jest.fn(),
  findOneAndRemove: jest.fn()
}));
jest.mock('../models/users', () => ({ findOneAndUpdate: jest.fn() }));
jest.mock('../models/devices', () => ({
  devices: {
    find: jest.fn(),
    countDocuments: jest.fn(),
    deleteMany: jest.fn(),
    aggregate: jest.fn()
  }
}));
const deletable = () => ({ deleteMany: jest.fn(async () => ({})) });
jest.mock('../models/vrrp', () => deletable());
jest.mock('../models/peers', () => deletable());
jest.mock('../models/firewallPolicies', () => deletable());
jest.mock('../models/applications', () => deletable());
jest.mock('../models/notificationsConf', () => deletable());
jest.mock('../models/tunnels', () => ({
  deleteMany: jest.fn(async () => ({})),
  aggregate: jest.fn(),
  find: jest.fn(),
  findOneAndUpdate: jest.fn()
}));
jest.mock('../models/tunnelids', () => deletable());
jest.mock('../models/tokens', () => deletable());
jest.mock('../models/accesstokens', () => deletable());
jest.mock('../models/mlpolicies', () => deletable());
jest.mock('../models/pathlabels', () => deletable());
jest.mock('../models/qosPolicies', () => deletable());
jest.mock('../models/appIdentifications', () => ({
  appIdentifications: deletable(),
  importedAppIdentifications: deletable()
}));
jest.mock('../models/analytics/deviceStats', () => ({
  deviceStats: {},
  deviceAggregateStats: {}
}));
jest.mock('../deviceLogic/events', () => jest.fn());
jest.mock('../deviceLogic/modifyDevice', () => ({ processModifyJob: jest.fn() }));
jest.mock('../deviceLogic/sync', () => ({ forceDevicesSync: jest.fn() }));
jest.mock('../deviceLogic/events/eventReasons', () => ({
  pendingTypes: {}, getReason: jest.fn()
}));
jest.mock('../deviceLogic/tunnels', () => ({
  prepareTunnelAddJob: jest.fn(),
  prepareTunnelRemoveJob: jest.fn()
}));
jest.mock('../deviceLogic/jobParameters', () => ({ transformVxlanConfig: jest.fn() }));
jest.mock('../deviceLogic/validators', () => ({ validateOverlappingSubnets: jest.fn() }));
jest.mock('../utils/deviceUtils', () => ({ validateFirewallRules: jest.fn() }));
jest.mock('../utils/networks', () => ({ checkOverlapping: jest.fn() }));
jest.mock('../versioning', () => ({ getMajorVersion: jest.fn(), getMinorVersion: jest.fn() }));
jest.mock('../authSessions', () => ({ revokeAll: jest.fn(async () => 1) }));
jest.mock('../periodic/deviceStatus', () => () => ({
  getTunnelStatus: jest.fn(() => null),
  setTunnelsStatusByOrg: jest.fn()
}));
jest.mock('../periodic/statusesInDb', () => () => ({
  updateDevicesStatuses: jest.fn(),
  updateTunnelsStatuses: jest.fn()
}));
jest.mock('../utils/deviceQueue', () => () => ({}));
jest.mock('../models/validators', () => ({ validateNotificationsSettings: jest.fn() }));

const Users = require('../models/users');
const Accounts = require('../models/accounts');
const Organizations = require('../models/organizations');
const { membership } = require('../models/membership');
const Devices = require('../models/devices');
const Tunnels = require('../models/tunnels');
const Flexibilling = require('../flexibilling');
const authSessions = require('../authSessions');
const { getToken } = require('../tokens');
const {
  getUserOrgByID,
  getAccessTokenOrgList,
  validateOrgAccess,
  orgUpdateFromNull
} = require('../utils/membershipUtils');
const mongo = require('../mongoConns.js')();
const OrganizationsService = require('../services/OrganizationsService');
const AccountsService = require('../services/AccountsService');
const TunnelsService = require('../services/TunnelsService');

const tokenOrg = '507f1f77bcf86cd799439011';
const defaultOrg = '507f1f77bcf86cd799439012';
const tunnelId = '507f1f77bcf86cd799439015';

const query = (value) => {
  const promise = Promise.resolve(value);
  const chain = {
    populate () { return chain; },
    select () { return chain; },
    session () { return chain; },
    allowDiskUse () { return promise; },
    then (onFulfilled, onRejected) { return promise.then(onFulfilled, onRejected); }
  };
  return chain;
};

const response = () => ({ setHeader: jest.fn() });

const orgUser = (extra) => Object.assign({
  _id: 'caller',
  defaultAccount: { _id: 'acct-id' },
  defaultOrg: { _id: 'org-id' }
}, extra || {});

const makeOrg = () => ({
  _id: 'org-id',
  name: 'Org',
  description: 'desc',
  group: 'alpha',
  account: 'acct-id',
  encryptionMethod: 'psk',
  vxlanPort: '4789',
  tunnelRange: '10.100.0.0',
  save: jest.fn(async function () { return this; })
});

let events;

beforeEach(() => {
  jest.clearAllMocks();
  events = [];
  getUserOrgByID.mockResolvedValue([]);
  orgUpdateFromNull.mockResolvedValue(undefined);
  getToken.mockResolvedValue('jwt');
  getAccessTokenOrgList.mockImplementation(async (
    user, orgId, orgIdRequired, accountId, group, isModify
  ) => {
    if (isModify && (accountId || group)) return [];
    return ['org-id'];
  });
  validateOrgAccess.mockResolvedValue(['org-id']);
  Accounts.findOneAndUpdate.mockResolvedValue({ _id: 'acct-id' });
  Organizations.findOne.mockImplementation(async () => makeOrg());
  Organizations.findOneAndRemove.mockResolvedValue({ _id: 'org-id' });
  Devices.devices.find.mockImplementation(() => query([]));
  Devices.devices.countDocuments.mockImplementation(() => query(0));
  Devices.devices.deleteMany.mockResolvedValue({});
  Devices.devices.aggregate.mockImplementation(() => query([]));
  Flexibilling.registerDevice.mockResolvedValue({});
  membership.find.mockResolvedValue([]);
  membership.deleteMany.mockImplementation(async () => {
    events.push('delete');
    return {};
  });
  authSessions.revokeAll.mockImplementation(async (id) => {
    events.push('revoke:' + id);
    return 1;
  });
  mongo.mainDBwithTransaction.mockImplementation(async (fn) => {
    await fn(mongo.dbSession);
    events.push('committed');
  });
});

test('organizations select rejects an app access key before changing defaultOrg', async () => {
  const user = {
    _id: 'creator',
    accessToken: true,
    defaultAccount: { _id: 'acct-id' }
  };
  const result = await OrganizationsService.organizationsSelectPOST(
    { org: 'org-2' }, { user }, response()
  );
  expect(result).toMatchObject({
    code: 403,
    error: 'No permission to access this organization'
  });
  expect(Users.findOneAndUpdate).not.toHaveBeenCalled();
  expect(getUserOrgByID).not.toHaveBeenCalled();
});

test('accounts select rejects an app access key before changing defaultAccount', async () => {
  const user = {
    _id: 'creator',
    accessToken: true,
    defaultAccount: { _id: 'acct-id' }
  };
  const result = await AccountsService.accountsSelectPOST(
    { account: 'other-account' }, { user }, response()
  );
  expect(result).toMatchObject({
    code: 403,
    error: 'No permission to access this account'
  });
  expect(Users.findOneAndUpdate).not.toHaveBeenCalled();
});

test('organization PUT keeps name and ignores restricted fields without rights', async () => {
  const org = makeOrg();
  Organizations.findOne.mockResolvedValue(org);
  const result = await OrganizationsService.organizationsIdPUT({
    id: 'org-id',
    name: 'renamed',
    description: 'newer',
    encryptionMethod: 'ikev2',
    account: 'other-account',
    group: 'beta',
    tunnelRange: '10.200.0.0',
    vxlanPort: '4790',
    role: 'owner'
  }, { user: orgUser() }, response());

  expect(result.code).toBe(200);
  expect(org.name).toBe('renamed');
  expect(org.description).toBe('newer');
  expect(org.encryptionMethod).toBe('ikev2');
  expect(org.account).toBe('acct-id');
  expect(org.group).toBe('alpha');
  expect(org.tunnelRange).toBe('10.100.0.0');
  expect(org.vxlanPort).toBe('4789');
  expect(org.role).toBeUndefined();
  expect(result.body.name).toBe('renamed');
  expect(result.body.account).toBe('acct-id');
  expect(result.body.group).toBe('alpha');
  expect(result.body.tunnelRange).toBe('10.100.0.0');
  expect(result.body.vxlanPort).toBe('4789');
  expect(authSessions.revokeAll).not.toHaveBeenCalled();
  expect(getAccessTokenOrgList).toHaveBeenCalledWith(
    expect.any(Object), null, false, 'acct-id', '', true
  );
});

test('organization DELETE revokes each distinct member once after commit', async () => {
  membership.find.mockImplementation(async () => {
    events.push('find');
    return [
      { user: 'user-1' },
      { user: 'user-1' },
      { user: 'user-2' },
      { user: null }
    ];
  });
  const result = await OrganizationsService.organizationsIdDELETE(
    { id: 'org-id' }, { user: orgUser() }, response()
  );
  expect(result.code).toBe(204);
  expect(validateOrgAccess).toHaveBeenCalledWith(
    expect.objectContaining({ _id: 'caller' }), 'organization', 'org-id', true
  );
  expect(membership.find).toHaveBeenCalledWith(
    { organization: 'org-id' },
    { user: 1 },
    { session: mongo.dbSession }
  );
  expect(events.indexOf('find')).toBeLessThan(events.indexOf('delete'));
  expect(events.indexOf('delete')).toBeLessThan(events.indexOf('committed'));
  expect(events.indexOf('committed')).toBeLessThan(events.indexOf('revoke:user-1'));
  expect(authSessions.revokeAll).toHaveBeenCalledTimes(2);
  expect(authSessions.revokeAll).toHaveBeenCalledWith('user-1');
  expect(authSessions.revokeAll).toHaveBeenCalledWith('user-2');
  expect(authSessions.revokeAll).not.toHaveBeenCalledWith('caller');
});

function thenable (result) {
  const chain = {
    select: jest.fn(() => chain),
    populate: jest.fn(() => chain),
    then (onFulfilled, onRejected) {
      return Promise.resolve(result).then(onFulfilled, onRejected);
    }
  };
  return chain;
}

test('tunnels list is scoped by getAccessTokenOrgList and has no secrets', async () => {
  const user = {
    accessToken: true,
    tokenTo: 'organization',
    tokenOrganization: tokenOrg,
    defaultOrg: { _id: defaultOrg }
  };
  getAccessTokenOrgList.mockResolvedValue([tokenOrg]);
  Tunnels.aggregate.mockImplementation((pipeline) => {
    const project = pipeline.find(stage => stage.$project);
    const projected = JSON.stringify(project.$project);
    expect(project.$project).not.toHaveProperty('tunnelKeys');
    expect(projected).not.toContain('deviceToken');
    expect(projected).not.toContain('tunnelKeys');
    return {
      allowDiskUse: () => Promise.resolve([{
        _id: tunnelId,
        num: 7,
        isActive: true,
        deviceA: { machineId: 'machine-a', name: 'a' }
      }])
    };
  });

  const result = await TunnelsService.tunnelsGET({ org: tokenOrg }, { user }, response());

  // View list: orgIdRequired false. Modify checks pass isModify true as the sixth argument.
  expect(getAccessTokenOrgList).toHaveBeenCalledWith(user, tokenOrg, false);
  expect(getAccessTokenOrgList.mock.calls[0][5]).toBeUndefined();

  const match = Tunnels.aggregate.mock.calls[0][0][0].$match;
  expect(match.isActive).toBe(true);
  expect(match.org.$in.map(id => id.toString())).toEqual([tokenOrg]);
  expect(match.org.$in.map(id => id.toString())).not.toContain(defaultOrg);

  expect(result.body[0].num).toBe(7);
  expect(result.body[0]).not.toHaveProperty('tunnelKeys');
  expect(result.body[0]).not.toHaveProperty('deviceToken');
  expect(JSON.stringify(result.body)).not.toContain('secret');
  expect(JSON.stringify(result.body)).not.toContain(defaultOrg);
});

test('tunnel delete scopes with isModify true and strips secrets', async () => {
  const user = {
    accessToken: true,
    defaultOrg: { _id: defaultOrg }
  };
  getAccessTokenOrgList.mockResolvedValue([tokenOrg]);
  const stored = {
    _id: tunnelId,
    num: 7,
    tunnelKeys: { local: 'secret-a' },
    deviceA: { name: 'a', deviceToken: 'token-a' },
    toJSON () { return this; }
  };
  Tunnels.findOneAndUpdate.mockImplementation(() => thenable(stored));

  const result = await TunnelsService.tunnelsDELETE(
    { tunnelId, org: tokenOrg }, { user }, response()
  );

  expect(getAccessTokenOrgList).toHaveBeenCalledWith(user, tokenOrg, true, null, '', true);
  const filter = Tunnels.findOneAndUpdate.mock.calls[0][0];
  expect(filter.org).toEqual({ $in: [tokenOrg] });
  expect(filter.isActive).toBe(true);
  expect(JSON.stringify(filter)).not.toContain(defaultOrg);
  expect(Tunnels.findOneAndUpdate.mock.results[0].value.select).toHaveBeenCalledWith('-tunnelKeys');
  expect(result.body).not.toHaveProperty('tunnelKeys');
  expect(result.body.deviceA).not.toHaveProperty('deviceToken');
  expect(JSON.stringify(result.body)).not.toContain('secret-a');
  expect(JSON.stringify(result.body)).not.toContain('token-a');
  expect(result.body.num).toBe(7);
});
