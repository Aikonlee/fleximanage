/** @jest-environment node */
// Write handlers must ask for modify scope. Heavy I/O modules are stubbed locally.
jest.mock('../utils/membershipUtils', () => ({
  getAccessTokenOrgList: jest.fn(),
  getUserOrganizations: jest.fn(),
  getUserOrgByID: jest.fn(),
  orgUpdateFromNull: jest.fn()
}));

const mockQueueApi = () => {
  const store = {};
  return new Proxy(store, {
    get (target, prop) {
      if (prop === 'then') return undefined;
      if (!Object.prototype.hasOwnProperty.call(target, prop)) {
        target[prop] = jest.fn();
      }
      return target[prop];
    }
  });
};

jest.mock('../utils/deviceQueue', () => () => mockQueueApi());
jest.mock('../periodic/deviceStatus', () => () => mockQueueApi());
jest.mock('../periodic/statusesInDb', () => () => ({}));
jest.mock('../websocket/Connections', () => () => ({
  isConnected: jest.fn(() => false)
}));
jest.mock('../logging/logging', () => () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn()
}));
jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    on: jest.fn(),
    auth: jest.fn(),
    quit: jest.fn(),
    connect: jest.fn()
  }))
}));
jest.mock('../deviceLogic/qosTrafficMap', () => ({
  apply: jest.fn(async () => ({ ids: [], status: 'completed', message: '' })),
  getFullTrafficMap: jest.fn(async () => ({ trafficMap: {}, updatedAt: new Date(0) })),
  complete: jest.fn(),
  completeSync: jest.fn(),
  error: jest.fn(),
  remove: jest.fn(),
  sync: jest.fn(),
  getDevicesTrafficMapJobInfo: jest.fn(async () => ({
    message: 'add-qos-traffic-map',
    params: {},
    deviceJobResp: {},
    installIds: {}
  }))
}));

const { getAccessTokenOrgList } = require('../utils/membershipUtils');
const { devices } = require('../models/devices');
const notificationsDb = require('../models/notifications');
const QOSTrafficMap = require('../models/qosTrafficMap');
const DevicesService = require('../services/DevicesService');
const QOSPoliciesService = require('../services/QOSPoliciesService');
const NotificationsService = require('../services/NotificationsService');
const TunnelsService = require('../services/TunnelsService');

const user = { _id: 'user-1', role: 'viewer' };
const org = 'org-1';
const deviceId = '507f1f77bcf86cd799439011';

const emptyQuery = (value) => {
  const query = Promise.resolve(value);
  query.lean = jest.fn(() => Promise.resolve(value));
  query.populate = jest.fn(() => query);
  return query;
};

const expectModifyCall = (orgId, orgIdRequired) => {
  expect(getAccessTokenOrgList).toHaveBeenCalledWith(
    user, orgId, orgIdRequired, null, '', true
  );
};

const expectRejected = (result) => {
  expect(result.error).toBeTruthy();
  expect(result.code).toBeGreaterThanOrEqual(400);
  expect(result.payload).toBeUndefined();
};

beforeEach(() => {
  getAccessTokenOrgList.mockReset();
  getAccessTokenOrgList.mockResolvedValue([]);
  jest.spyOn(devices, 'findOne').mockImplementation(() => emptyQuery(null));
  jest.spyOn(devices, 'find').mockImplementation(() => emptyQuery([]));
  jest.spyOn(notificationsDb, 'updateOne').mockResolvedValue({ n: 0 });
  jest.spyOn(QOSTrafficMap, 'findOneAndUpdate').mockResolvedValue({});
  jest.spyOn(QOSTrafficMap, 'findOne').mockImplementation(() => emptyQuery(null));
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('devicesIdSendPOST requests modify scope and rejects with no orgs', async () => {
  const result = await DevicesService.devicesIdSendPOST(
    { id: deviceId, org, api: 'shell', entity: 'system' },
    { user }
  );
  expectModifyCall(org, false);
  expectRejected(result);
});

test('devicesIdInterfacesIdActionPOST requests modify scope and rejects with no orgs', async () => {
  const result = await DevicesService.devicesIdInterfacesIdActionPOST(
    { org, id: deviceId, interfaceId: deviceId },
    { user }
  );
  expectModifyCall(org, false);
  expectRejected(result);
});

test('qosTrafficMapPUT requests modify scope', async () => {
  const result = await QOSPoliciesService.qosTrafficMapPUT({ org }, { user });
  expectModifyCall(org, false);
  expect(getAccessTokenOrgList.mock.calls[0][5]).toBe(true);
  expect(result.code).toBeDefined();
});

test('notificationsIdPUT requests modify scope and rejects with no orgs', async () => {
  const result = await NotificationsService.notificationsIdPUT(
    { id: deviceId, org, status: 'read' },
    { user }
  );
  expectModifyCall(org, false);
  expectRejected(result);
});

test('tunnelsNotificationsPUT requests modify scope and rejects with no orgs', async () => {
  const result = await TunnelsService.tunnelsNotificationsPUT(
    {
      org,
      tunnelsIdList: [deviceId],
      notifications: { 'Tunnel connection': { warningThreshold: 1, criticalThreshold: 2 } }
    },
    { user }
  );
  expectModifyCall(org, true);
  expect(result).toEqual(expect.objectContaining({
    error: 'You do not have permission to access this organization',
    code: 403
  }));
});
