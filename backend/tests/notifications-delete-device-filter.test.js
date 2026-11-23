/** @jest-environment node */
jest.mock('cidr-tools', () => ({
  overlapCidr: jest.fn(() => false),
  normalizeCidr: jest.fn((v) => v)
}));
jest.mock('../utils/membershipUtils', () => ({
  getAccessTokenOrgList: jest.fn(),
  getUserOrganizations: jest.fn()
}));
jest.mock('../logging/logging', () => () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn()
}));
jest.mock('../deviceLogic/deviceNotifications', () => ({
  apply: jest.fn()
}));
jest.mock('../notifications/notifications', () => () => ({}));
jest.mock('../mongoConns.js', () => {
  const mongoose = require('mongoose');
  const main = mongoose.createConnection();
  const analytics = mongoose.createConnection();
  const vpn = mongoose.createConnection();
  const safeConn = (conn) => ({
    model: (name, schema) => conn.models[name] || conn.model(name, schema)
  });
  return () => ({
    getMainDB: () => safeConn(main),
    getAnalyticsDB: () => safeConn(analytics),
    getVpnDB: () => safeConn(vpn)
  });
});

const mongoose = require('mongoose');
const { getAccessTokenOrgList } = require('../utils/membershipUtils');
const notificationsDb = require('../models/notifications');
const { devices } = require('../models/devices');
const NotificationsService = require('../services/NotificationsService');

const orgId = '507f1f77bcf86cd799439011';
const matchedDeviceId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439022');
const user = { _id: 'user-1' };

beforeEach(() => {
  jest.clearAllMocks();
  getAccessTokenOrgList.mockResolvedValue([orgId]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('notificationsDELETE deletes nothing when a device filter matches zero devices', async () => {
  jest.spyOn(devices, 'find').mockResolvedValue([]);
  const deleteSpy = jest.spyOn(notificationsDb, 'deleteMany').mockImplementation(async (query) => {
    const deviceConstraint = query.$and?.find((clause) => 'targets.deviceId' in clause);
    if (!deviceConstraint) {
      // Simulate wiping the whole org if the constraint was dropped.
      return { deletedCount: 42 };
    }
    expect(deviceConstraint).toEqual({ 'targets.deviceId': { $in: [] } });
    return { deletedCount: 0 };
  });

  const result = await NotificationsService.notificationsDELETE(
    {
      org: orgId,
      filters: [{ key: 'targets.deviceId.name', op: '==', val: 'nonexistent-device' }]
    },
    { user }
  );

  expect(deleteSpy).toHaveBeenCalledTimes(1);
  expect(deleteSpy.mock.calls[0][0].$and).toEqual([
    { 'targets.deviceId': { $in: [] } }
  ]);
  expect(result.code).toBe(404);
});

test('notificationsDELETE constrains deleteMany to matched device IDs', async () => {
  jest.spyOn(devices, 'find').mockResolvedValue([{ _id: matchedDeviceId }]);
  const deleteSpy = jest.spyOn(notificationsDb, 'deleteMany')
    .mockResolvedValue({ deletedCount: 2 });

  const result = await NotificationsService.notificationsDELETE(
    {
      org: orgId,
      filters: [{ key: 'targets.deviceId.name', op: '==', val: 'edge-1' }]
    },
    { user }
  );

  expect(deleteSpy).toHaveBeenCalledTimes(1);
  expect(deleteSpy.mock.calls[0][0].$and).toEqual([
    { 'targets.deviceId': { $in: [matchedDeviceId] } }
  ]);
  expect(result.code).toBe(204);
});
