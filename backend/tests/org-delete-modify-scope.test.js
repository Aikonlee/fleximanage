const mongoose = require('mongoose');

jest.mock('../mongoConns', () => {
  const mongooseLib = require('mongoose');
  const main = mongooseLib.createConnection();
  const analytics = mongooseLib.createConnection();
  const vpn = mongooseLib.createConnection();
  return () => ({
    getMainDB: () => main,
    getAnalyticsDB: () => analytics,
    getVpnDB: () => vpn,
    mainDBwithTransaction: async (fn) => fn({})
  });
});

jest.mock('../utils/membershipUtils', () => {
  const actual = jest.requireActual('../utils/membershipUtils');
  return {
    ...actual,
    orgUpdateFromNull: jest.fn(async () => true)
  };
});

jest.mock('../authSessions', () => ({ revokeAll: jest.fn(async () => true) }));
jest.mock('../flexibilling', () => ({ registerDevice: jest.fn(async () => true) }));
jest.mock('../websocket/Connections', () => () => ({
  deviceDisconnect: jest.fn(),
  registerStatusCallback: jest.fn()
}));
jest.mock('../logging/logging', () => () => ({
  error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));
jest.mock('../tokens', () => ({ getToken: jest.fn() }));
jest.mock('../notifications/notifications', () => () => ({}));
jest.mock('../deviceLogic/sync', () => ({ forceDevicesSync: jest.fn() }));
jest.mock('../deviceLogic/events', () => ({}));
jest.mock('../deviceLogic/modifyDevice', () => ({ processModifyJob: jest.fn() }));
jest.mock('../deviceLogic/events/eventReasons', () => ({ pendingTypes: {}, getReason: jest.fn() }));
jest.mock('../deviceLogic/tunnels', () => ({
  prepareTunnelAddJob: jest.fn(),
  prepareTunnelRemoveJob: jest.fn()
}));
jest.mock('../deviceLogic/jobParameters', () => ({ transformVxlanConfig: jest.fn() }));
jest.mock('../utils/deviceUtils', () => ({ validateFirewallRules: jest.fn() }));
jest.mock('../versioning', () => ({ getMajorVersion: jest.fn(), getMinorVersion: jest.fn() }));
jest.mock('../deviceLogic/validators', () => ({ validateOverlappingSubnets: jest.fn() }));
jest.mock('../utils/networks', () => ({ checkOverlapping: jest.fn() }));

const resolved = (value) => {
  const promise = Promise.resolve(value);
  promise.session = () => Promise.resolve(value);
  promise.lean = () => Promise.resolve(value);
  promise.populate = () => promise;
  return promise;
};

const modelStub = () => ({
  find: jest.fn(() => resolved([])),
  findOne: jest.fn(() => resolved(null)),
  findOneAndUpdate: jest.fn(() => resolved({ _id: 'account' })),
  findOneAndRemove: jest.fn(() => resolved({})),
  deleteMany: jest.fn(() => resolved({ deletedCount: 0 })),
  countDocuments: jest.fn(() => resolved(0)),
  updateOne: jest.fn(() => resolved({}))
});

jest.mock('../models/accounts', () => modelStub());
jest.mock('../models/organizations', () => modelStub());
jest.mock('../models/users', () => modelStub());
jest.mock('../models/devices', () => ({ devices: modelStub() }));
jest.mock('../models/vrrp', () => modelStub());
jest.mock('../models/peers', () => modelStub());
jest.mock('../models/firewallPolicies', () => modelStub());
jest.mock('../models/appIdentifications', () => ({
  appIdentifications: modelStub(),
  importedAppIdentifications: modelStub()
}));
jest.mock('../models/applications', () => modelStub());
jest.mock('../models/notificationsConf', () => modelStub());
jest.mock('../models/tunnels', () => modelStub());
jest.mock('../models/tunnelids', () => modelStub());
jest.mock('../models/tokens', () => modelStub());
jest.mock('../models/accesstokens', () => modelStub());
jest.mock('../models/mlpolicies', () => modelStub());
jest.mock('../models/pathlabels', () => modelStub());
jest.mock('../models/qosPolicies', () => modelStub());
jest.mock('../models/membership', () => ({ membership: modelStub() }));

const { membership } = require('../models/membership');
const Accounts = require('../models/accounts');
const OrganizationsService = require('../services/OrganizationsService');

const ORG = new mongoose.Types.ObjectId().toString();
const OTHER = new mongoose.Types.ObjectId().toString();
const ACCOUNT = new mongoose.Types.ObjectId().toString();

const baseUser = (extra) => ({
  _id: new mongoose.Types.ObjectId().toString(),
  defaultAccount: { _id: ACCOUNT, organizations: [ORG, OTHER] },
  defaultOrg: { _id: ORG },
  ...extra
});

const allowMembership = (rows) => {
  membership.find.mockImplementation((query, projection, options) => {
    if (options && options.session) return Promise.resolve([]);
    return resolved(rows);
  });
};

describe('organization delete modify scope', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Accounts.findOneAndUpdate.mockImplementation(() => resolved({ _id: ACCOUNT }));
  });

  test('viewer on the organization cannot delete it', async () => {
    allowMembership([{
      to: 'organization',
      organization: ORG,
      role: 'viewer'
    }]);
    const result = await OrganizationsService.organizationsIdDELETE(
      { id: ORG },
      { user: baseUser() },
      {}
    );
    expect(result.code).toBe(500);
    expect(String(result.error)).toMatch(/select an organization/i);
    expect(Accounts.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('manager on the organization can delete it', async () => {
    allowMembership([{
      to: 'organization',
      organization: ORG,
      role: 'manager'
    }]);
    const result = await OrganizationsService.organizationsIdDELETE(
      { id: ORG },
      { user: baseUser() },
      {}
    );
    expect(result.code).toBe(204);
    expect(Accounts.findOneAndUpdate).toHaveBeenCalled();
  });

  test('app access key scoped to another organization cannot delete it', async () => {
    allowMembership([]);
    const user = baseUser({
      accessToken: true,
      tokenTo: 'organization',
      tokenOrganization: OTHER,
      tokenGroup: '',
      role: 'manager'
    });
    const result = await OrganizationsService.organizationsIdDELETE(
      { id: ORG },
      { user },
      {}
    );
    expect(result.code).toBe(500);
    expect(String(result.error)).toMatch(/select an organization/i);
    expect(Accounts.findOneAndUpdate).not.toHaveBeenCalled();
    expect(membership.find).not.toHaveBeenCalled();
  });
});
