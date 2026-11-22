const mockSession = {
  startTransaction: jest.fn(async () => {}),
  commitTransaction: jest.fn(async () => {}),
  abortTransaction: jest.fn(async () => {}),
  endSession: jest.fn(async () => {})
};

jest.mock('../configs', () => () => ({ get: () => '' }));
jest.mock('../websocket/Connections', () => () => ({}));
jest.mock('../flexibilling', () => ({}));
jest.mock('../authSessions', () => ({ revokeAll: jest.fn() }));
jest.mock('../deviceLogic/events', () => ({}));
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

jest.mock('../logging/logging', () => () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

jest.mock('../utils/membershipUtils', () => ({
  getAccessTokenOrgList: jest.fn(),
  getUserOrganizations: jest.fn(),
  getUserOrgByID: jest.fn(),
  orgUpdateFromNull: jest.fn()
}));

jest.mock('../models/organizations', () => ({
  create: jest.fn(async () => [{ _id: 'org1', name: 'Acme' }])
}));

jest.mock('../models/users', () => ({
  findOneAndUpdate: jest.fn(async () => ({ _id: 'user1', defaultAccount: 'acct1' }))
}));

jest.mock('../models/accounts', () => ({
  findOneAndUpdate: jest.fn(async () => ({ _id: 'acct1' }))
}));

jest.mock('../models/qosPolicies', () => ({
  create: jest.fn(async () => [{ _id: 'qos1' }])
}));

jest.mock('../models/notificationsConf', () => ({
  create: jest.fn()
}));

jest.mock('../notifications/notifications', () => () => ({
  getDefaultNotificationsSettings: jest.fn(async () => [])
}));

jest.mock('../tokens', () => ({
  getToken: jest.fn()
}));

const { membership } = require('../models/membership');
const { getAccessTokenOrgList } = require('../utils/membershipUtils');
const NotificationsConf = require('../models/notificationsConf');
const mongoConns = require('../mongoConns.js')();
const OrganizationsService = require('../services/OrganizationsService');

const TUNNEL_FIELDS = [
  'total', 'active', 'connected', 'notConnected', 'pending', 'warning', 'unknown'
];
const TRAFFIC_FIELDS = ['total', 'unit', 'totalBytes', 'lastUpdate', 'monthly'];

afterAll(async () => {
  const mongoose = require('mongoose');
  await Promise.all(mongoose.connections.map((conn) => conn.close(true)));
});

describe('organizations contract robustness', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(mongoConns.getMainDB(), 'startSession').mockResolvedValue(mockSession);
    jest.spyOn(membership, 'find').mockResolvedValue([]);
  });

  test('organizationsSummaryGET returns zeroed counters when org list is empty', async () => {
    getAccessTokenOrgList.mockResolvedValue([]);

    const result = await OrganizationsService.organizationsSummaryGET(
      { org: 'missing' },
      { user: { _id: 'user1' } }
    );

    expect(result.code).toBe(200);
    expect(result.payload.devices).toEqual({
      connected: 0, approved: 0, running: 0, warning: 0, total: 0
    });
    for (const field of TUNNEL_FIELDS) {
      expect(result.payload.tunnels[field]).toBe(0);
    }
    for (const field of TRAFFIC_FIELDS) {
      expect(Object.prototype.hasOwnProperty.call(result.payload.traffic, field)).toBe(true);
    }
    expect(result.payload.traffic.total).toBe(0);
    expect(result.payload.traffic.totalBytes).toBe(0);
    expect(result.payload.traffic.unit).toBe('bytes');
    expect(result.payload.traffic.lastUpdate).toBeNull();
    expect(result.payload.traffic.monthly).toEqual([]);
  });

  test('organizationsPOST rejects an account with no owner and closes the session', async () => {
    const response = { setHeader: jest.fn() };

    const result = await OrganizationsService.organizationsPOST(
      { name: 'Acme' },
      { user: { _id: 'user1', defaultAccount: 'acct1' } },
      response
    );

    expect(result.code).toBe(500);
    expect(result.error).toMatch(/owner membership/i);
    expect(NotificationsConf.create).not.toHaveBeenCalled();
    expect(mockSession.commitTransaction).not.toHaveBeenCalled();
    expect(mockSession.abortTransaction).toHaveBeenCalled();
    expect(mockSession.endSession).toHaveBeenCalled();
    expect(response.setHeader).not.toHaveBeenCalled();
  });
});
