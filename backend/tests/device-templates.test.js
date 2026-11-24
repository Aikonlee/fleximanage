/** @jest-environment node */
const { Types: { ObjectId } } = require('mongoose');

const ownOrg = new ObjectId().toString();
const otherOrg = new ObjectId().toString();
const userId = new ObjectId().toString();
const ownId = new ObjectId().toString();
const ownV2Id = new ObjectId().toString();
const otherId = new ObjectId().toString();

let store = [];

jest.mock('../models/deviceTemplates', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  countDocuments: jest.fn(),
  create: jest.fn(),
  deleteOne: jest.fn(),
  updateOne: jest.fn(),
  findOneAndUpdate: jest.fn()
}));

jest.mock('../utils/membershipUtils', () => ({
  getAccessTokenOrgList: jest.fn()
}));

jest.mock('../logging/logging', () => () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn()
}));

const DeviceTemplates = require('../models/deviceTemplates');
const { getAccessTokenOrgList } = require('../utils/membershipUtils');
const DeviceTemplatesService = require('../services/DeviceTemplatesService');
const DeviceTemplatesController = require('../controllers/DeviceTemplatesController');

const matchesFilter = (doc, filter) => {
  if (filter._id && doc._id !== filter._id) {
    return false;
  }
  if (filter.org) {
    if (typeof filter.org === 'string') {
      if (doc.org !== filter.org) return false;
    } else if (filter.org.$in) {
      if (!filter.org.$in.some(o => o.toString() === doc.org)) return false;
    }
  }
  if (filter.name !== undefined && doc.name !== filter.name) {
    return false;
  }
  if (filter.version !== undefined && doc.version !== filter.version) {
    return false;
  }
  return true;
};

const makeUser = (extra = {}) => ({
  _id: userId,
  defaultOrg: { _id: ownOrg },
  ...extra
});

beforeEach(() => {
  jest.clearAllMocks();
  store = [
    {
      _id: ownId,
      org: ownOrg,
      name: 'branch-base',
      description: 'Initial branch template',
      version: 1,
      config: { hostname: 'branch-v1', mtu: 1500 },
      createdBy: userId
    },
    {
      _id: ownV2Id,
      org: ownOrg,
      name: 'branch-base',
      description: 'Second branch template',
      version: 2,
      config: { hostname: 'branch-v2', mtu: 1420 },
      createdBy: userId
    },
    {
      _id: otherId,
      org: otherOrg,
      name: 'foreign-template',
      description: 'Other org template',
      version: 1,
      config: { hostname: 'other-org-router' },
      createdBy: new ObjectId().toString()
    }
  ];

  getAccessTokenOrgList.mockResolvedValue([ownOrg]);

  DeviceTemplates.find.mockImplementation((filter) => {
    const matched = store.filter(doc => matchesFilter(doc, filter));
    return {
      skip (offset) {
        const sliced = typeof offset === 'number' ? matched.slice(offset) : matched;
        return {
          limit: async (limit) => (typeof limit === 'number' ? sliced.slice(0, limit) : sliced)
        };
      }
    };
  });

  DeviceTemplates.findOne.mockImplementation((filter) => {
    const matched = store.filter(doc => matchesFilter(doc, filter));
    const result = matched[0] || null;
    const promise = Promise.resolve(result);
    promise.sort = async (sortSpec) => {
      if (sortSpec && sortSpec.version === -1) {
        const sorted = [...matched].sort((a, b) => b.version - a.version);
        return sorted[0] || null;
      }
      return result;
    };
    return promise;
  });

  DeviceTemplates.countDocuments.mockImplementation(async (filter) => {
    return store.filter(doc => matchesFilter(doc, filter)).length;
  });

  DeviceTemplates.create.mockImplementation(async (doc) => {
    const duplicate = store.some(
      item => item.org === doc.org && item.name === doc.name && item.version === doc.version
    );
    if (duplicate) {
      const err = new Error('E11000 duplicate key error');
      err.code = 11000;
      throw err;
    }
    const created = {
      _id: new ObjectId().toString(),
      ...doc,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    store.push(created);
    return created;
  });

  DeviceTemplates.deleteOne.mockImplementation(async (filter) => {
    const idx = store.findIndex(doc => matchesFilter(doc, filter));
    if (idx === -1) {
      return { deletedCount: 0 };
    }
    store.splice(idx, 1);
    return { deletedCount: 1 };
  });
});

describe('DeviceTemplatesService tenant isolation', () => {
  test('list returns only templates belonging to the caller org', async () => {
    const result = await DeviceTemplatesService.devicetemplatesGET(
      { offset: 0, limit: 50 },
      { user: makeUser() }
    );

    expect(getAccessTokenOrgList).toHaveBeenCalledWith(expect.any(Object), undefined, false);
    expect(result.code).toBe(200);
    expect(result.payload).toHaveLength(2);
    expect(result.payload.every(t => t.org === ownOrg)).toBe(true);
    expect(result.payload.some(t => t._id === otherId)).toBe(false);
  });

  test('foreign-org list request is rejected with 403 when org access is denied', async () => {
    getAccessTokenOrgList.mockResolvedValue([]);

    const result = await DeviceTemplatesService.devicetemplatesGET(
      { org: otherOrg },
      { user: makeUser() }
    );

    expect(result.code).toBe(403);
    expect(result.error).toBeTruthy();
    expect(DeviceTemplates.find).not.toHaveBeenCalled();
  });

  test('foreign-org get returns 404 and cannot read another org template', async () => {
    const result = await DeviceTemplatesService.devicetemplatesIdGET(
      { id: otherId },
      { user: makeUser() }
    );

    expect(result.code).toBe(404);
    expect(result.payload).toBeUndefined();
  });

  test('own-org get returns the requested template', async () => {
    const result = await DeviceTemplatesService.devicetemplatesIdGET(
      { id: ownId },
      { user: makeUser() }
    );

    expect(result.code).toBe(200);
    expect(result.payload._id).toBe(ownId);
    expect(result.payload.org).toBe(ownOrg);
  });

  test('foreign-org delete returns 404 and leaves the foreign template intact', async () => {
    const result = await DeviceTemplatesService.devicetemplatesIdDELETE(
      { id: otherId },
      { user: makeUser() }
    );

    expect(result.code).toBe(404);
    expect(store.some(doc => doc._id === otherId)).toBe(true);
  });

  test('own-org delete removes the template and returns 204', async () => {
    const result = await DeviceTemplatesService.devicetemplatesIdDELETE(
      { id: ownId },
      { user: makeUser() }
    );

    expect(result.code).toBe(204);
    expect(store.some(doc => doc._id === ownId)).toBe(false);
    expect(store.some(doc => doc._id === otherId)).toBe(true);
  });
});

describe('DeviceTemplatesService creation and duplicate rejection', () => {
  test('POST creates version 1 in orgList[0] with trimmed name', async () => {
    const result = await DeviceTemplatesService.devicetemplatesPOST(
      {
        name: '  wan-profile  ',
        description: 'WAN profile',
        config: { wan: { dhcp: true } }
      },
      { user: makeUser() }
    );

    expect(result.code).toBe(201);
    expect(result.payload.org).toBe(ownOrg);
    expect(result.payload.name).toBe('wan-profile');
    expect(result.payload.version).toBe(1);
    expect(result.payload.config).toEqual({ wan: { dhcp: true } });
    expect(result.payload.createdBy).toBe(userId);
  });

  test('POST rejects duplicate (org, name, version)', async () => {
    const result = await DeviceTemplatesService.devicetemplatesPOST(
      {
        name: 'branch-base',
        description: 'Duplicate attempt',
        config: { hostname: 'dup' }
      },
      { user: makeUser() }
    );

    expect(result.code).toBe(400);
    expect(result.error).toMatch(/already exists/i);
    expect(DeviceTemplates.create).not.toHaveBeenCalled();
  });

  test('POST handles duplicate key race condition (E11000)', async () => {
    DeviceTemplates.countDocuments.mockResolvedValueOnce(0);

    const result = await DeviceTemplatesService.devicetemplatesPOST(
      {
        name: 'branch-base',
        description: 'Race duplicate',
        config: { hostname: 'dup' }
      },
      { user: makeUser() }
    );

    expect(result.code).toBe(400);
    expect(result.error).toMatch(/already exists/i);
  });
});

describe('DeviceTemplatesService immutable PUT versioning', () => {
  test('PUT creates version max+1 and leaves existing documents unchanged', async () => {
    const originalV1 = { ...store.find(d => d._id === ownId) };
    const originalV2 = { ...store.find(d => d._id === ownV2Id) };

    const result = await DeviceTemplatesService.devicetemplatesIdPUT(
      {
        id: ownId,
        config: { hostname: 'branch-v3', mtu: 1400 },
        description: 'Third branch template'
      },
      { user: makeUser() }
    );

    expect(result.code).toBe(200);
    expect(result.payload._id).not.toBe(ownId);
    expect(result.payload._id).not.toBe(ownV2Id);
    expect(result.payload.org).toBe(ownOrg);
    expect(result.payload.name).toBe('branch-base');
    expect(result.payload.version).toBe(3);
    expect(result.payload.description).toBe('Third branch template');
    expect(result.payload.config).toEqual({ hostname: 'branch-v3', mtu: 1400 });

    expect(DeviceTemplates.updateOne).not.toHaveBeenCalled();
    expect(DeviceTemplates.findOneAndUpdate).not.toHaveBeenCalled();
    expect(store.find(d => d._id === ownId)).toEqual(originalV1);
    expect(store.find(d => d._id === ownV2Id)).toEqual(originalV2);
    expect(store.filter(d => d.org === ownOrg && d.name === 'branch-base')).toHaveLength(3);
  });

  test('PUT on a foreign-org template returns 404 and does not create a version', async () => {
    const result = await DeviceTemplatesService.devicetemplatesIdPUT(
      {
        id: otherId,
        config: { hostname: 'hijack' },
        description: 'Should fail'
      },
      { user: makeUser() }
    );

    expect(result.code).toBe(404);
    expect(DeviceTemplates.create).not.toHaveBeenCalled();
  });
});

describe('DeviceTemplatesService config validation', () => {
  const invalidConfigs = [
    ['top-level $where operator', { $where: 'this.version > 0' }],
    ['nested $gt operator', { firewall: { $gt: 1 } }],
    ['array element with $ne operator', { rules: [{ $ne: null }] }],
    ['own __proto__ key', JSON.parse('{"__proto__": {"polluted": true}}')],
    ['nested own __proto__ key', { nested: JSON.parse('{"__proto__": {"polluted": true}}') }],
    ['mutated prototype via __proto__', Object.create({ polluted: true })],
    ['array config', ['a', 'b']],
    ['string config', 'not-an-object'],
    ['number config', 42],
    ['boolean config', true],
    ['null config', null],
    ['undefined config', undefined]
  ];

  test.each(invalidConfigs)('POST rejects %s', async (_label, badConfig) => {
    const result = await DeviceTemplatesService.devicetemplatesPOST(
      { name: 'bad-template', description: 'invalid', config: badConfig },
      { user: makeUser() }
    );

    expect(result.code).toBe(400);
    expect(result.error).toMatch(/invalid template config/i);
    expect(DeviceTemplates.create).not.toHaveBeenCalled();
  });

  test.each(invalidConfigs)('PUT rejects %s', async (_label, badConfig) => {
    const result = await DeviceTemplatesService.devicetemplatesIdPUT(
      { id: ownId, config: badConfig, description: 'invalid' },
      { user: makeUser() }
    );

    expect(result.code).toBe(400);
    expect(result.error).toMatch(/invalid template config/i);
    expect(DeviceTemplates.create).not.toHaveBeenCalled();
  });
});

describe('DeviceTemplatesService bad request validation (400)', () => {
  test('access-key writes without org return 400 before org lookup', async () => {
    const accessUser = makeUser({ accessToken: true });

    const resPost = await DeviceTemplatesService.devicetemplatesPOST(
      { name: 'no-org', config: { a: 1 } },
      { user: accessUser }
    );
    const resPostBlank = await DeviceTemplatesService.devicetemplatesPOST(
      { org: '   ', name: 'blank-org', config: { a: 1 } },
      { user: accessUser }
    );
    const resPut = await DeviceTemplatesService.devicetemplatesIdPUT(
      { id: ownId, config: { a: 2 } },
      { user: accessUser }
    );
    const resDel = await DeviceTemplatesService.devicetemplatesIdDELETE(
      { id: ownId },
      { user: accessUser }
    );

    expect(resPost.code).toBe(400);
    expect(resPostBlank.code).toBe(400);
    expect(resPut.code).toBe(400);
    expect(resDel.code).toBe(400);
    expect(getAccessTokenOrgList).not.toHaveBeenCalled();
  });

  test('UI-session writes with org return 400 before calling getAccessTokenOrgList', async () => {
    const uiUser = makeUser({ accessToken: false });

    const resPost = await DeviceTemplatesService.devicetemplatesPOST(
      { org: ownOrg, name: 'ui-org', config: { a: 1 } },
      { user: uiUser }
    );
    const resPut = await DeviceTemplatesService.devicetemplatesIdPUT(
      { id: ownId, org: ownOrg, config: { a: 2 } },
      { user: uiUser }
    );
    const resDel = await DeviceTemplatesService.devicetemplatesIdDELETE(
      { id: ownId, org: ownOrg },
      { user: uiUser }
    );

    expect(resPost.code).toBe(400);
    expect(resPut.code).toBe(400);
    expect(resDel.code).toBe(400);
    expect(getAccessTokenOrgList).not.toHaveBeenCalled();
  });

  test.each(['not-an-id', '123456789012', ''])('malformed id %j returns 400 in GET/PUT/DELETE',
    async (badId) => {
      const uiUser = makeUser();

      const resGet = await DeviceTemplatesService.devicetemplatesIdGET(
        { id: badId },
        { user: uiUser }
      );
      const resPut = await DeviceTemplatesService.devicetemplatesIdPUT(
        { id: badId, config: { a: 1 } },
        { user: uiUser }
      );
      const resDel = await DeviceTemplatesService.devicetemplatesIdDELETE(
        { id: badId },
        { user: uiUser }
      );

      expect(resGet.code).toBe(400);
      expect(resPut.code).toBe(400);
      expect(resDel.code).toBe(400);
      expect(DeviceTemplates.findOne).not.toHaveBeenCalled();
      expect(DeviceTemplates.create).not.toHaveBeenCalled();
      expect(DeviceTemplates.deleteOne).not.toHaveBeenCalled();
    });

  test('Mongoose CastError is mapped to 400 and never leaks as 500', async () => {
    const castErr = new Error('Cast to ObjectId failed');
    castErr.name = 'CastError';
    DeviceTemplates.findOne.mockRejectedValueOnce(castErr);

    const result = await DeviceTemplatesService.devicetemplatesIdGET(
      { id: ownId },
      { user: makeUser() }
    );

    expect(result.code).toBe(400);
    expect(result.error).toMatch(/Cast to ObjectId failed/i);
  });
});

describe('DeviceTemplatesService authorization and permission failures', () => {
  test('POST returns 403 when user has no modify org access', async () => {
    getAccessTokenOrgList.mockResolvedValue([]);

    const result = await DeviceTemplatesService.devicetemplatesPOST(
      { org: otherOrg, name: 'unauth', config: { a: 1 } },
      { user: makeUser({ role: 'viewer', accessToken: true }) }
    );

    expect(getAccessTokenOrgList).toHaveBeenCalledWith(
      expect.any(Object), otherOrg, true, null, '', true
    );
    expect(result.code).toBe(403);
    expect(DeviceTemplates.create).not.toHaveBeenCalled();
  });

  test('PUT returns 403 when user has no modify org access', async () => {
    getAccessTokenOrgList.mockResolvedValue([]);

    const result = await DeviceTemplatesService.devicetemplatesIdPUT(
      { id: ownId, org: otherOrg, config: { a: 1 } },
      { user: makeUser({ role: 'viewer', accessToken: true }) }
    );

    expect(result.code).toBe(403);
    expect(DeviceTemplates.create).not.toHaveBeenCalled();
  });

  test('DELETE returns 403 when user has no modify org access', async () => {
    getAccessTokenOrgList.mockResolvedValue([]);

    const result = await DeviceTemplatesService.devicetemplatesIdDELETE(
      { id: ownId, org: otherOrg },
      { user: makeUser({ role: 'viewer', accessToken: true }) }
    );

    expect(result.code).toBe(403);
    expect(DeviceTemplates.deleteOne).not.toHaveBeenCalled();
  });

  test('GET by id returns 403 when requesting unauthorized org', async () => {
    getAccessTokenOrgList.mockResolvedValue([]);

    const result = await DeviceTemplatesService.devicetemplatesIdGET(
      { id: otherId, org: otherOrg },
      { user: makeUser() }
    );

    expect(result.code).toBe(403);
    expect(DeviceTemplates.findOne).not.toHaveBeenCalled();
  });

  test('GET by id returns 404 when template does not exist', async () => {
    const result = await DeviceTemplatesService.devicetemplatesIdGET(
      { id: new ObjectId().toString() },
      { user: makeUser() }
    );

    expect(result.code).toBe(404);
  });

  test('propagates 403 error thrown by membership check', async () => {
    const forbiddenErr = new Error('Forbidden');
    forbiddenErr.status = 403;
    getAccessTokenOrgList.mockRejectedValue(forbiddenErr);

    const result = await DeviceTemplatesService.devicetemplatesGET(
      { org: otherOrg },
      { user: makeUser() }
    );

    expect(result.code).toBe(403);
    expect(result.error).toBe('Forbidden');
  });

  test('missing user returns 403 across operations', async () => {
    const resGet = await DeviceTemplatesService.devicetemplatesGET({}, { user: null });
    const resPost = await DeviceTemplatesService.devicetemplatesPOST(
      { name: 't', config: {} },
      { user: null }
    );
    const resIdGet = await DeviceTemplatesService.devicetemplatesIdGET(
      { id: ownId },
      { user: null }
    );
    const resPut = await DeviceTemplatesService.devicetemplatesIdPUT(
      { id: ownId, config: {} },
      { user: null }
    );
    const resDel = await DeviceTemplatesService.devicetemplatesIdDELETE(
      { id: ownId },
      { user: null }
    );

    expect(resGet.code).toBe(403);
    expect(resPost.code).toBe(403);
    expect(resIdGet.code).toBe(403);
    expect(resPut.code).toBe(403);
    expect(resDel.code).toBe(403);
  });

  test('controller delegates all five OpenAPI operations', () => {
    const controller = new DeviceTemplatesController(DeviceTemplatesService);
    expect(typeof controller.devicetemplatesGET).toBe('function');
    expect(typeof controller.devicetemplatesPOST).toBe('function');
    expect(typeof controller.devicetemplatesIdGET).toBe('function');
    expect(typeof controller.devicetemplatesIdPUT).toBe('function');
    expect(typeof controller.devicetemplatesIdDELETE).toBe('function');
  });
});

describe('deviceTemplates model schema', () => {
  let DeviceTemplateModel;

  beforeAll(() => {
    jest.isolateModules(() => {
      jest.doMock('../mongoConns.js', () => {
        const mongooseLib = require('mongoose');
        const main = mongooseLib.createConnection();
        return () => ({ getMainDB: () => main });
      });
      DeviceTemplateModel = jest.requireActual('../models/deviceTemplates');
    });
  });

  test('defines required fields, immutable org, timestamps, and unique index', () => {
    const { schema } = DeviceTemplateModel;

    expect(schema.path('org').options.required).toBe(true);
    expect(schema.path('org').options.immutable).toBe(true);
    expect(schema.path('org').options.ref).toBe('organizations');
    expect(schema.path('name').options.required).toBe(true);
    expect(schema.path('name').options.trim).toBe(true);
    expect(schema.path('version').options.required).toBe(true);
    expect(schema.path('config').options.required).toBe(true);
    expect(schema.path('createdBy').options.ref).toBe('users');
    expect(schema.options.timestamps).toBe(true);

    const uniqueIdx = schema.indexes().find(([fields, opts]) =>
      fields.org === 1 && fields.name === 1 && fields.version === 1 && opts.unique === true
    );
    expect(uniqueIdx).toBeDefined();
  });

  test('schema validator accepts plain object config and rejects unsafe values', () => {
    const validDoc = new DeviceTemplateModel({
      org: ownOrg,
      name: '  edge-profile  ',
      description: 'desc',
      version: 1,
      config: { hostname: 'edge-1', interfaces: [{ name: 'eth0' }] },
      createdBy: userId
    });
    expect(validDoc.validateSync()).toBeUndefined();
    expect(validDoc.name).toBe('edge-profile');

    const badConfigs = [
      { $where: '1 == 1' },
      JSON.parse('{"__proto__": {"polluted": true}}'),
      ['not', 'object'],
      'string-config',
      123
    ];
    for (const badConfig of badConfigs) {
      const invalidDoc = new DeviceTemplateModel({
        org: ownOrg,
        name: 'bad',
        version: 1,
        config: badConfig
      });
      const err = invalidDoc.validateSync();
      expect(err).toBeDefined();
      expect(err.errors.config).toBeDefined();
    }
  });
});
