/** @jest-environment node */
const { Types: { ObjectId } } = require('mongoose');
const ownOrg = new ObjectId().toString();
const otherOrg = new ObjectId().toString();
const ownId = new ObjectId().toString();
const otherId = new ObjectId().toString();
const fixture = [
  {
    _id: ownId,
    org: { _id: ownOrg, account: 'own-account' },
    appStoreApp: { identifier: 'own-app', latestVersion: '2' },
    installedVersion: '1'
  },
  {
    _id: otherId,
    org: { _id: otherOrg, account: 'other-account' },
    appStoreApp: { identifier: 'other-app', latestVersion: '2' },
    installedVersion: '1'
  }
];

jest.mock('../../models/applicationStore', () => ({}));
jest.mock('../../models/applications', () => ({ findOne: jest.fn() }));
jest.mock('../../models/devices', () => ({ devices: { aggregate: jest.fn(), find: jest.fn() } }));
jest.mock('../../utils/membershipUtils', () => ({ getAccessTokenOrgList: jest.fn() }));
jest.mock('../../deviceLogic/dispatcher', () => ({ apply: jest.fn() }));
jest.mock('../../logging/logging', () => () => ({}));
jest.mock('../../utils/filterUtils', () => ({}));
jest.mock('../../applicationLogic/applications', () => {
  const getApplicationStats = jest.fn();
  return () => ({ getApplicationStats });
});
jest.mock('../../periodic/deviceStatus', () => () => ({ getDeviceStatus: jest.fn() }));

const applications = require('../../models/applications');
const { devices } = require('../../models/devices');
const { getAccessTokenOrgList } = require('../../utils/membershipUtils');
const stats = require('../../applicationLogic/applications')().getApplicationStats;
const dispatcher = require('../../deviceLogic/dispatcher');
const ApplicationsService = require('../ApplicationsService');

beforeEach(() => {
  jest.clearAllMocks();
  getAccessTokenOrgList.mockResolvedValue([ownOrg]);
  applications.findOne.mockImplementation(filter => ({
    populate: () => ({
      lean: async () => fixture.find(app =>
        app._id === filter._id &&
      (!filter.org || filter.org.$in.some(org => org.toString() === app.org._id))
      ) || null
    })
  }));
  devices.aggregate.mockReturnValue({ allowDiskUse: async () => [] });
  devices.find.mockResolvedValue([]);
  stats.mockResolvedValue({ installed: 1 });
});

test('foreign application status never reads foreign statistics', async () => {
  const result = await ApplicationsService.appstorePurchasedIdStatusGet(
    { id: otherId }, { user: { defaultOrg: { _id: ownOrg } } }
  );
  expect(result).toEqual({ error: 'Invalid application id', code: 500, data: {} });
  expect(stats).not.toHaveBeenCalled();
  expect(devices.aggregate).not.toHaveBeenCalled();
});

test('own application status remains available', async () => {
  const result = await ApplicationsService.appstorePurchasedIdStatusGet(
    { id: ownId }, { user: { defaultOrg: { _id: ownOrg } } }
  );
  expect(result).toEqual({ payload: { devices: [], installed: 1 }, code: 200 });
  expect(stats).toHaveBeenCalledWith('own-app', 'own-account', ownOrg);
});

test('foreign application upgrade cannot dispatch a job', async () => {
  const user = { defaultOrg: { _id: ownOrg } };
  const result = await ApplicationsService.appstorePurchasedIdUpgradePost(
    { id: otherId }, { user }
  );
  expect(result).toEqual({ error: 'Invalid application id', code: 500, data: {} });
  expect(devices.find).not.toHaveBeenCalled();
  expect(dispatcher.apply).not.toHaveBeenCalled();
});

test('own application upgrade dispatches a job', async () => {
  const user = { defaultOrg: { _id: ownOrg } };
  const result = await ApplicationsService.appstorePurchasedIdUpgradePost(
    { id: ownId }, { user }
  );
  expect(result).toEqual({ payload: { data: 'ok' }, code: 200 });
  expect(dispatcher.apply).toHaveBeenCalledWith(
    [], 'application', user, { org: ownOrg, meta: { op: 'upgrade', id: ownId, newVersion: '2' } }
  );
});
