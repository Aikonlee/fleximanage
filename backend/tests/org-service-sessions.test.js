/** @jest-environment node */
// Organization deletion and group changes must revoke affected users via authSessions.revokeAll.
// Models and the transaction runner are mocked; no MongoDB is required.
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
jest.mock('../utils/membershipUtils', () => ({
  getAccessTokenOrgList: jest.fn(),
  validateOrgAccess: jest.fn(),
  getUserOrganizations: jest.fn(),
  getUserOrgByID: jest.fn(),
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
jest.mock('../models/users', () => ({}));
jest.mock('../models/devices', () => ({
  devices: { find: jest.fn(), countDocuments: jest.fn(), deleteMany: jest.fn() }
}));
const deletable = () => ({ deleteMany: jest.fn(async () => ({})) });
jest.mock('../models/vrrp', () => deletable());
jest.mock('../models/peers', () => deletable());
jest.mock('../models/firewallPolicies', () => deletable());
jest.mock('../models/applications', () => deletable());
jest.mock('../models/notificationsConf', () => deletable());
jest.mock('../models/tunnels', () => deletable());
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

const { membership } = require('../models/membership');
const Accounts = require('../models/accounts');
const Organizations = require('../models/organizations');
const Devices = require('../models/devices');
const Flexibilling = require('../flexibilling');
const {
  getAccessTokenOrgList,
  validateOrgAccess,
  orgUpdateFromNull
} = require('../utils/membershipUtils');
const { getToken } = require('../tokens');
const authSessions = require('../authSessions');
const mongo = require('../mongoConns.js')();
const OrganizationsService = require('../services/OrganizationsService');

const query = (value) => {
  const promise = Promise.resolve(value);
  const chain = {
    populate () { return chain; },
    select () { return chain; },
    session () { return chain; },
    allowDiskUse () { return chain; },
    then (onFulfilled, onRejected) { return promise.then(onFulfilled, onRejected); }
  };
  return chain;
};

const user = {
  _id: 'caller',
  defaultAccount: { _id: 'acct-id' },
  defaultOrg: { _id: 'org-id' }
};
const response = () => ({ setHeader: jest.fn() });
const makeOrg = (group = 'alpha') => ({
  _id: 'org-id',
  name: 'Org',
  description: 'desc',
  group,
  account: 'acct-id',
  encryptionMethod: 'psk',
  vxlanPort: '4789',
  tunnelRange: '10.100.0.0',
  save: jest.fn(async function () { return this; })
});
const putRequest = (group) => ({
  id: 'org-id',
  name: 'Org',
  description: 'desc',
  group,
  encryptionMethod: 'psk',
  vxlanPort: '4789',
  tunnelRange: '10.100.0.0'
});

let events;

beforeEach(() => {
  jest.clearAllMocks();
  events = [];
  getAccessTokenOrgList.mockResolvedValue(['org-id']);
  validateOrgAccess.mockResolvedValue(['org-id']);
  orgUpdateFromNull.mockResolvedValue(undefined);
  getToken.mockResolvedValue('jwt');
  Accounts.findOneAndUpdate.mockResolvedValue({ _id: 'acct-id' });
  Organizations.findOneAndRemove.mockResolvedValue({ _id: 'org-id' });
  Organizations.findOne.mockResolvedValue(makeOrg());
  Devices.devices.find.mockImplementation(() => query([{ machineId: 'machine-1' }]));
  Devices.devices.countDocuments.mockImplementation(() => query(1));
  Devices.devices.deleteMany.mockResolvedValue({});
  Flexibilling.registerDevice.mockResolvedValue({});
  membership.deleteMany.mockImplementation(async () => {
    events.push('delete');
    return {};
  });
  membership.find.mockResolvedValue([]);
  authSessions.revokeAll.mockImplementation(async (id) => {
    events.push(`revoke:${id}`);
    return 1;
  });
  mongo.mainDBwithTransaction.mockImplementation(async (fn) => {
    await fn(mongo.dbSession);
    events.push('committed');
  });
});

describe('organizationsIdDELETE', () => {
  test('revokes each distinct member once, only after the transaction commits', async () => {
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
      { id: 'org-id' }, { user }, response());

    expect(result.code).toBe(204);
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

  test('does not revoke when the caller cannot delete the organization', async () => {
    getAccessTokenOrgList.mockResolvedValue(['other-org']);
    validateOrgAccess.mockResolvedValue(['other-org']);
    const result = await OrganizationsService.organizationsIdDELETE(
      { id: 'org-id' }, { user }, response());
    expect(result.code).toBe(500);
    expect(membership.deleteMany).not.toHaveBeenCalled();
    expect(authSessions.revokeAll).not.toHaveBeenCalled();
    expect(events).not.toContain('committed');
  });

  test('does not revoke when the transaction fails before commit', async () => {
    membership.find.mockResolvedValue([{ user: 'user-1' }]);
    Flexibilling.registerDevice.mockRejectedValue(new Error('billing down'));
    const result = await OrganizationsService.organizationsIdDELETE(
      { id: 'org-id' }, { user }, response());
    expect(result.code).toBe(500);
    expect(events).toContain('delete');
    expect(events).not.toContain('committed');
    expect(authSessions.revokeAll).not.toHaveBeenCalled();
  });
});

describe('organizationsIdPUT', () => {
  test('revokes members of the old and new groups after a successful group change', async () => {
    const org = makeOrg('alpha');
    org.save.mockImplementation(async function () {
      events.push('save');
      return this;
    });
    Organizations.findOne.mockResolvedValue(org);
    membership.find.mockImplementation(async () => {
      events.push('find');
      return [{ user: 'old-user' }, { user: 'new-user' }, { user: 'old-user' }];
    });

    const result = await OrganizationsService.organizationsIdPUT(
      putRequest('beta'), { user }, response());

    expect(result.code).toBe(200);
    expect(membership.find).toHaveBeenCalledWith({
      account: 'acct-id',
      to: 'group',
      group: { $in: ['alpha', 'beta'] }
    });
    expect(events.indexOf('save')).toBeLessThan(events.indexOf('find'));
    expect(events.indexOf('find')).toBeLessThan(events.indexOf('revoke:old-user'));
    expect(authSessions.revokeAll).toHaveBeenCalledTimes(2);
    expect(authSessions.revokeAll).toHaveBeenCalledWith('old-user');
    expect(authSessions.revokeAll).toHaveBeenCalledWith('new-user');
  });

  test('does not revoke when the group is unchanged', async () => {
    const org = makeOrg('alpha');
    Organizations.findOne.mockResolvedValue(org);
    const result = await OrganizationsService.organizationsIdPUT(
      putRequest('alpha'), { user }, response());
    expect(result.code).toBe(200);
    expect(org.save).toHaveBeenCalled();
    expect(membership.find).not.toHaveBeenCalled();
    expect(authSessions.revokeAll).not.toHaveBeenCalled();
  });

  test('does not revoke when the save fails', async () => {
    const org = makeOrg('alpha');
    org.save.mockRejectedValue(new Error('save failed'));
    Organizations.findOne.mockResolvedValue(org);
    const result = await OrganizationsService.organizationsIdPUT(
      putRequest('beta'), { user }, response());
    expect(result.code).toBe(500);
    expect(membership.find).not.toHaveBeenCalled();
    expect(authSessions.revokeAll).not.toHaveBeenCalled();
  });

  test('does not revoke when the caller cannot update the organization', async () => {
    getAccessTokenOrgList.mockResolvedValue([]);
    validateOrgAccess.mockResolvedValue([]);
    const result = await OrganizationsService.organizationsIdPUT(
      putRequest('beta'), { user }, response());
    expect(result.code).toBe(500);
    expect(Organizations.findOne).not.toHaveBeenCalled();
    expect(authSessions.revokeAll).not.toHaveBeenCalled();
  });
});
