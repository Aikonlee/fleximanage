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

jest.mock('../utils/membershipUtils', () => ({
  getAccessTokenOrgList: jest.fn()
}));

jest.mock('../models/appIdentifications', () => ({
  appIdentifications: {
    findOne: jest.fn(),
    updateOne: jest.fn()
  },
  importedAppIdentifications: {},
  getAllAppIdentifications: jest.fn(),
  getAppIdentificationById: jest.fn(),
  getAppIdentificationUpdateAt: jest.fn()
}));

jest.mock('../models/devices', () => ({
  devices: {
    find: jest.fn(),
    countDocuments: jest.fn()
  }
}));

jest.mock('../models/firewallPolicies', () => ({
  find: jest.fn(),
  countDocuments: jest.fn()
}));

jest.mock('../models/mlpolicies', () => ({
  find: jest.fn(),
  countDocuments: jest.fn()
}));

jest.mock('../models/tunnels', () => ({
  countDocuments: jest.fn()
}));

jest.mock('../models/pathlabels', () => ({
  countDocuments: jest.fn(),
  deleteOne: jest.fn(),
  findOneAndUpdate: jest.fn(() => ({ session: jest.fn() })),
  findOne: jest.fn(() => ({ session: jest.fn() }))
}));

const { getAccessTokenOrgList } = require('../utils/membershipUtils');
const { appIdentifications } = require('../models/appIdentifications');
const { devices } = require('../models/devices');
const firewallPoliciesModel = require('../models/firewallPolicies');
const multiLinkPoliciesModel = require('../models/mlpolicies');
const tunnels = require('../models/tunnels');
const PathLabels = require('../models/pathlabels');
const AppIdentificationsService = require('../services/AppIdentificationsService');
const PathLabelsService = require('../services/PathLabelsService');

const callerOrg = new mongoose.Types.ObjectId();
const user = { _id: 'user-1' };

function hasCallerOrg (query) {
  return query && query.org && Array.isArray(query.org.$in) &&
    query.org.$in.some(org => String(org) === String(callerOrg));
}

describe('tenant usage scope', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getAccessTokenOrgList.mockResolvedValue([callerOrg]);
  });

  test('app identification delete ignores cross-tenant references', async () => {
    const id = 'custom-app-1';
    const stored = {
      appIdentifications: [{ id, name: 'custom:keep' }]
    };
    appIdentifications.findOne.mockResolvedValue(stored);
    appIdentifications.updateOne.mockResolvedValue({ nModified: 1 });

    firewallPoliciesModel.find.mockImplementation(async (query) => {
      return hasCallerOrg(query) ? [] : [{ name: 'foreign-fw' }];
    });
    multiLinkPoliciesModel.find.mockImplementation(async (query) => {
      return hasCallerOrg(query) ? [] : [{ name: 'foreign-ml' }];
    });
    devices.find.mockImplementation(async (query) => {
      return hasCallerOrg(query) ? [] : [{ name: 'foreign-device' }];
    });

    const result = await AppIdentificationsService.appIdentificationsIdDELETE(
      { id, org: String(callerOrg) },
      { user }
    );

    expect(result).toEqual({ payload: null, code: 204 });
    expect(firewallPoliciesModel.find).toHaveBeenCalledWith(
      expect.objectContaining({ org: { $in: [callerOrg] } }),
      { name: 1 }
    );
    expect(multiLinkPoliciesModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        org: { $in: [callerOrg] },
        'rules.classification.application.appId': id
      }),
      { name: 1 }
    );
    expect(devices.find).toHaveBeenCalledWith(
      expect.objectContaining({ org: { $in: [callerOrg] } }),
      { name: 1 }
    );
    expect(stored.appIdentifications).toEqual([]);
    expect(appIdentifications.updateOne).toHaveBeenCalled();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/foreign-fw|foreign-ml|foreign-device/);
  });

  test('custom app identification PUT of an unknown id returns 404', async () => {
    const stored = {
      appIdentifications: [{ id: 'existing', name: 'custom:existing' }]
    };
    appIdentifications.findOne.mockResolvedValue(stored);

    const result = await AppIdentificationsService.appIdentificationsCustomIdPUT(
      {
        id: 'missing-id',
        org: String(callerOrg),
        name: 'custom:new',
        category: 'web',
        serviceClass: 'class',
        importance: 'low',
        rules: []
      },
      { user }
    );

    expect(result).toEqual({
      error: 'Requested object was not found',
      code: 404,
      data: {}
    });
    expect(stored.appIdentifications).toHaveLength(1);
    expect(appIdentifications.updateOne).not.toHaveBeenCalled();
  });

  test('path label delete and type change ignore cross-tenant usage', async () => {
    const id = 'label-1';
    const countIfScoped = async (query) => (hasCallerOrg(query) ? 0 : 3);
    devices.countDocuments.mockImplementation(countIfScoped);
    tunnels.countDocuments.mockImplementation(countIfScoped);
    multiLinkPoliciesModel.countDocuments.mockImplementation(countIfScoped);
    PathLabels.deleteOne.mockResolvedValue({ deletedCount: 1 });
    PathLabels.countDocuments.mockResolvedValue(0);

    const deleted = await PathLabelsService.pathlabelsIdDELETE(
      { id, org: String(callerOrg) },
      { user }
    );
    expect(deleted).toEqual({ payload: null, code: 204 });
    expect(devices.countDocuments).toHaveBeenCalledWith(expect.objectContaining({
      org: { $in: [callerOrg] },
      'interfaces.pathlabels': id
    }));
    expect(tunnels.countDocuments).toHaveBeenCalledWith(expect.objectContaining({
      org: { $in: [callerOrg] },
      isActive: true,
      pathlabel: id
    }));
    expect(multiLinkPoliciesModel.countDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        org: { $in: [callerOrg] },
        'rules.action.links.pathlabels': id
      })
    );

    const orig = { type: 'dia', name: 'wan' };
    PathLabels.findOneAndUpdate.mockReturnValue({
      session: () => Promise.resolve(orig)
    });
    PathLabels.findOne.mockReturnValue({
      session: () => Promise.resolve({ name: 'wan', type: 'tunnel' })
    });

    const updated = await PathLabelsService.pathlabelsIdPUT(
      {
        id,
        org: String(callerOrg),
        name: 'wan',
        description: 'd',
        color: '#112233',
        type: 'tunnel'
      },
      { user }
    );

    expect(updated.code).toBe(200);
    expect(devices.countDocuments.mock.calls.length).toBeGreaterThan(1);
    for (const [query] of devices.countDocuments.mock.calls) {
      expect(hasCallerOrg(query)).toBe(true);
    }
  });
});
