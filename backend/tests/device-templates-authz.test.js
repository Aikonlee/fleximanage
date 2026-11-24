/** @jest-environment node */
const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const YAML = require('yaml');
const OpenApiValidator = require('express-openapi-validator');
const { Types: { ObjectId } } = require('mongoose');

const ownOrg = new ObjectId().toString();
const userId = new ObjectId().toString();
const templateId = new ObjectId().toString();

jest.mock('../mongoConns.js', () => {
  const mongooseLib = require('mongoose');
  const main = mongooseLib.createConnection();
  return () => ({ getMainDB: () => main });
});

jest.mock('../configs', () => () => ({
  get: (key) => {
    if (key === 'allowManagerToDel') return false;
    if (key === 'validateOpenAPIRequest') return true;
    if (key === 'userTokenSecretKey') return 'test-secret-key';
    if (key === 'restUiUrl') return ['https://localhost'];
    if (key === 'restServerUrl') return ['https://localhost'];
    return false;
  }
}));

jest.mock('passport', () => ({
  serializeUser: jest.fn(),
  deserializeUser: jest.fn(),
  authenticate: jest.fn(),
  use: jest.fn((name, strategy) => strategy || name)
}));

jest.mock('passport-local', () => ({ Strategy: class {} }));
jest.mock('passport-jwt', () => ({
  Strategy: class {},
  ExtractJwt: { fromAuthHeaderAsBearerToken: () => () => undefined }
}));

jest.mock('../models/users', () => ({
  serializeUser: () => () => {},
  deserializeUser: () => () => {},
  authenticate: () => () => {},
  findOne: jest.fn(),
  updateOne: jest.fn()
}));

jest.mock('../models/accounts', () => ({ findOne: jest.fn() }));
jest.mock('../models/accesstokens', () => ({
  findOne: jest.fn(),
  updateMany: jest.fn()
}));

jest.mock('../tokens', () => ({
  verifyToken: jest.fn(),
  getToken: jest.fn(),
  getRefreshToken: jest.fn()
}));

jest.mock('../utils/recaptcha', () => () => ({ verifyReCaptcha: jest.fn() }));
jest.mock('../logging/logging', () => () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn()
}));

jest.mock('../models/deviceTemplates', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  countDocuments: jest.fn(),
  create: jest.fn(),
  deleteOne: jest.fn()
}));

jest.mock('../utils/membershipUtils', () => ({
  getAccessTokenOrgList: jest.fn(),
  orgUpdateFromNull: jest.fn(),
  getUserOrgByID: jest.fn()
}));

jest.mock('../controllers', () => ({
  DeviceTemplatesController: require('../controllers/DeviceTemplatesController')
}));

jest.mock('../services', () => ({
  DeviceTemplatesService: require('../services/DeviceTemplatesService')
}));

const {
  membership,
  permissionsSchema,
  preDefinedPermissions
} = require('../models/membership');
const AccessTokens = require('../models/accesstokens');
const DeviceTemplates = require('../models/deviceTemplates');
const { getAccessTokenOrgList } = require('../utils/membershipUtils');
const openapiRouter = require('../utils/openapiRouter');
const devicetemplatesMigration = require(
  '../migrations/1795515372000-add_devicetemplates_permissions'
);

const openapiPath = path.join(__dirname, '..', 'api', 'openapi.yaml');
const openapiSpec = YAML.parse(fs.readFileSync(openapiPath, 'utf8'));

let currentUser = null;
let store = [];
let server;
let port;

function httpRequest ({ method, urlPath, body }) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const headers = {
      Authorization: 'Bearer test-token'
    };
    if (payload !== null) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      method,
      headers
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = raw ? JSON.parse(raw) : null;
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode, body: json, raw });
      });
    });

    req.on('error', reject);
    if (payload !== null) {
      req.write(payload);
    }
    req.end();
  });
}

function makeRouteUser (roleKey, extra = {}) {
  return {
    _id: userId,
    defaultOrg: { _id: ownOrg },
    perms: { ...preDefinedPermissions[roleKey] },
    ...extra
  };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = currentUser;
    next();
  });
  app.use(
    OpenApiValidator.middleware({
      apiSpec: openapiPath,
      validateRequests: true,
      validateResponses: false
    })
  );
  app.use(openapiRouter(openapiSpec.components.schemas));
  app.use((err, req, res, next) => {
    res.status(err.status || err.code || 500).json({
      message: err.message || 'Internal Server Error'
    });
  });

  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      resolve();
    });
  });
});

afterAll(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  const mongoose = require('mongoose');
  await Promise.all(mongoose.connections.map((conn) => conn.close(true)));
});

beforeEach(() => {
  jest.clearAllMocks();
  store = [
    {
      _id: templateId,
      org: ownOrg,
      name: 'branch-base',
      description: 'Base template',
      version: 1,
      config: { hostname: 'branch-1' },
      createdBy: userId
    }
  ];

  getAccessTokenOrgList.mockResolvedValue([ownOrg]);

  DeviceTemplates.find.mockImplementation(() => ({
    skip () {
      return {
        limit: async () => [...store]
      };
    }
  }));

  DeviceTemplates.findOne.mockImplementation((filter) => {
    const matched = store.filter((doc) => {
      if (filter._id && doc._id !== filter._id) return false;
      if (filter.name && doc.name !== filter.name) return false;
      return true;
    });
    const first = matched[0] || null;
    const promise = Promise.resolve(first);
    promise.sort = async () => {
      const sorted = [...matched].sort((a, b) => b.version - a.version);
      return sorted[0] || null;
    };
    return promise;
  });

  DeviceTemplates.countDocuments.mockImplementation(async (filter) => {
    return store.filter(
      (doc) => doc.org === filter.org && doc.name === filter.name && doc.version === filter.version
    ).length;
  });

  DeviceTemplates.create.mockImplementation(async (doc) => {
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
    const idx = store.findIndex((doc) => doc._id === filter._id);
    if (idx === -1) return { deletedCount: 0 };
    store.splice(idx, 1);
    return { deletedCount: 1 };
  });
});

describe('devicetemplates permission registration and migration', () => {
  test('membership schema and role defaults mirror linkmonitors', () => {
    const pathSpec = permissionsSchema.path('devicetemplates');
    expect(pathSpec).toBeDefined();
    expect(pathSpec.instance).toBe('Number');

    const roles = [
      'none',
      'account_owner',
      'account_manager',
      'account_viewer',
      'group_manager',
      'group_viewer',
      'organization_manager',
      'organization_viewer'
    ];
    for (const role of roles) {
      expect(preDefinedPermissions[role].devicetemplates)
        .toBe(preDefinedPermissions[role].linkmonitors);
    }
  });

  test('migration adds and removes devicetemplates permissions', async () => {
    const memSpy = jest.spyOn(membership, 'updateMany').mockResolvedValue({});
    AccessTokens.updateMany.mockResolvedValue({});

    const knownFilters = [
      { to: 'account', role: 'owner' },
      { to: 'account', role: 'manager' },
      { to: 'group', role: 'manager' },
      { to: 'organization', role: 'manager' },
      { to: 'account', role: 'viewer' },
      { to: 'group', role: 'viewer' },
      { to: 'organization', role: 'viewer' }
    ];

    await devicetemplatesMigration.up();
    expect(memSpy).toHaveBeenCalledWith(
      { to: 'account', role: 'owner' },
      { $set: { 'perms.devicetemplates': preDefinedPermissions.account_owner.devicetemplates } },
      { upsert: false }
    );
    expect(memSpy).toHaveBeenCalledWith(
      { to: 'account', role: 'manager' },
      { $set: { 'perms.devicetemplates': preDefinedPermissions.account_manager.devicetemplates } },
      { upsert: false }
    );
    expect(memSpy).toHaveBeenCalledWith(
      { to: 'group', role: 'manager' },
      { $set: { 'perms.devicetemplates': preDefinedPermissions.group_manager.devicetemplates } },
      { upsert: false }
    );
    expect(memSpy).toHaveBeenCalledWith(
      { to: 'organization', role: 'manager' },
      {
        $set: {
          'perms.devicetemplates': preDefinedPermissions.organization_manager.devicetemplates
        }
      },
      { upsert: false }
    );
    expect(memSpy).toHaveBeenCalledWith(
      { to: 'account', role: 'viewer' },
      { $set: { 'perms.devicetemplates': preDefinedPermissions.account_viewer.devicetemplates } },
      { upsert: false }
    );
    expect(memSpy).toHaveBeenCalledWith(
      { $nor: knownFilters },
      { $set: { 'perms.devicetemplates': 1 } },
      { upsert: false }
    );
    expect(AccessTokens.updateMany).toHaveBeenCalledWith(
      { permissions: { $exists: true, $ne: null }, to: 'account', role: 'owner' },
      {
        $set: {
          'permissions.devicetemplates': preDefinedPermissions.account_owner.devicetemplates
        }
      },
      { upsert: false }
    );
    expect(AccessTokens.updateMany).toHaveBeenCalledWith(
      { permissions: { $exists: true, $ne: null }, to: 'account', role: 'manager' },
      {
        $set: {
          'permissions.devicetemplates': preDefinedPermissions.account_manager.devicetemplates
        }
      },
      { upsert: false }
    );
    expect(AccessTokens.updateMany).toHaveBeenCalledWith(
      { permissions: { $exists: true, $ne: null }, $nor: knownFilters },
      { $set: { 'permissions.devicetemplates': 1 } },
      { upsert: false }
    );

    memSpy.mockClear();
    AccessTokens.updateMany.mockClear();

    await devicetemplatesMigration.down();
    expect(memSpy).toHaveBeenCalledWith(
      {},
      { $unset: { 'perms.devicetemplates': '' } },
      { upsert: false }
    );
    expect(AccessTokens.updateMany).toHaveBeenCalledWith(
      { permissions: { $exists: true } },
      { $unset: { 'permissions.devicetemplates': true } },
      { upsert: false }
    );

    memSpy.mockRestore();
  });
});

describe('Route-level authorization for /api/devicetemplates', () => {
  test('account_owner is allowed on GET, POST, GET/:id, PUT/:id, and DELETE/:id', async () => {
    currentUser = makeRouteUser('account_owner');

    const listRes = await httpRequest({ method: 'GET', urlPath: '/api/devicetemplates' });
    expect(listRes.status).toBe(200);

    const postRes = await httpRequest({
      method: 'POST',
      urlPath: '/api/devicetemplates',
      body: { name: 'wan-template', description: 'WAN', config: { mtu: 1500 } }
    });
    expect(postRes.status).toBe(201);

    const getRes = await httpRequest({
      method: 'GET',
      urlPath: `/api/devicetemplates/${templateId}`
    });
    expect(getRes.status).toBe(200);

    const putRes = await httpRequest({
      method: 'PUT',
      urlPath: `/api/devicetemplates/${templateId}`,
      body: { description: 'v2', config: { mtu: 1420 } }
    });
    expect(putRes.status).toBe(200);
    expect(putRes.body.version).toBe(2);

    const delRes = await httpRequest({
      method: 'DELETE',
      urlPath: `/api/devicetemplates/${templateId}`
    });
    expect(delRes.status).toBe(204);
  });

  test.each([
    'account_manager',
    'group_manager',
    'organization_manager'
  ])('%s can GET/POST/PUT and gets 403 on DELETE when allowManagerToDel is false', async (role) => {
    currentUser = makeRouteUser(role);

    const listRes = await httpRequest({ method: 'GET', urlPath: '/api/devicetemplates' });
    expect(listRes.status).toBe(200);

    const postRes = await httpRequest({
      method: 'POST',
      urlPath: '/api/devicetemplates',
      body: { name: `${role}-tpl`, config: { enabled: true } }
    });
    expect(postRes.status).toBe(201);

    const putRes = await httpRequest({
      method: 'PUT',
      urlPath: `/api/devicetemplates/${templateId}`,
      body: { config: { enabled: false } }
    });
    expect(putRes.status).toBe(200);

    const delRes = await httpRequest({
      method: 'DELETE',
      urlPath: `/api/devicetemplates/${templateId}`
    });
    expect(delRes.status).toBe(403);
    expect(DeviceTemplates.deleteOne).not.toHaveBeenCalled();
  });

  test.each([
    'account_viewer',
    'group_viewer',
    'organization_viewer'
  ])('%s can read templates but receives 403 on POST, PUT, and DELETE', async (role) => {
    currentUser = makeRouteUser(role);

    const listRes = await httpRequest({ method: 'GET', urlPath: '/api/devicetemplates' });
    expect(listRes.status).toBe(200);

    const getRes = await httpRequest({
      method: 'GET',
      urlPath: `/api/devicetemplates/${templateId}`
    });
    expect(getRes.status).toBe(200);

    const postRes = await httpRequest({
      method: 'POST',
      urlPath: '/api/devicetemplates',
      body: { name: 'denied', config: { a: 1 } }
    });
    expect(postRes.status).toBe(403);

    const putRes = await httpRequest({
      method: 'PUT',
      urlPath: `/api/devicetemplates/${templateId}`,
      body: { config: { a: 2 } }
    });
    expect(putRes.status).toBe(403);

    const delRes = await httpRequest({
      method: 'DELETE',
      urlPath: `/api/devicetemplates/${templateId}`
    });
    expect(delRes.status).toBe(403);

    expect(DeviceTemplates.create).not.toHaveBeenCalled();
    expect(DeviceTemplates.deleteOne).not.toHaveBeenCalled();
  });

  test('none role receives 403 for all /api/devicetemplates operations', async () => {
    currentUser = makeRouteUser('none');

    const resGet = await httpRequest({ method: 'GET', urlPath: '/api/devicetemplates' });
    const resPost = await httpRequest({
      method: 'POST',
      urlPath: '/api/devicetemplates',
      body: { name: 'denied', config: { a: 1 } }
    });
    const resIdGet = await httpRequest({
      method: 'GET',
      urlPath: `/api/devicetemplates/${templateId}`
    });
    const resPut = await httpRequest({
      method: 'PUT',
      urlPath: `/api/devicetemplates/${templateId}`,
      body: { config: { a: 2 } }
    });
    const resDel = await httpRequest({
      method: 'DELETE',
      urlPath: `/api/devicetemplates/${templateId}`
    });

    expect(resGet.status).toBe(403);
    expect(resPost.status).toBe(403);
    expect(resIdGet.status).toBe(403);
    expect(resPut.status).toBe(403);
    expect(resDel.status).toBe(403);
    expect(DeviceTemplates.find).not.toHaveBeenCalled();
    expect(DeviceTemplates.findOne).not.toHaveBeenCalled();
    expect(DeviceTemplates.create).not.toHaveBeenCalled();
    expect(DeviceTemplates.deleteOne).not.toHaveBeenCalled();
  });
});

describe('Route-level OpenAPI schema and 400 validation for /api/devicetemplates', () => {
  test('POST requires name and config; PUT accepts only description and config', async () => {
    currentUser = makeRouteUser('account_owner');

    const postNoName = await httpRequest({
      method: 'POST',
      urlPath: '/api/devicetemplates',
      body: { config: { a: 1 } }
    });
    expect(postNoName.status).toBe(400);

    const postNoConfig = await httpRequest({
      method: 'POST',
      urlPath: '/api/devicetemplates',
      body: { name: 'missing-config' }
    });
    expect(postNoConfig.status).toBe(400);

    const putWithName = await httpRequest({
      method: 'PUT',
      urlPath: `/api/devicetemplates/${templateId}`,
      body: { name: 'renamed', config: { a: 2 } }
    });
    expect(putWithName.status).toBe(400);

    const putNoConfig = await httpRequest({
      method: 'PUT',
      urlPath: `/api/devicetemplates/${templateId}`,
      body: { description: 'no config' }
    });
    expect(putNoConfig.status).toBe(400);
  });

  test('malformed path IDs and invalid write org rules return 400 at route level', async () => {
    currentUser = makeRouteUser('account_owner');

    const badGet = await httpRequest({
      method: 'GET',
      urlPath: '/api/devicetemplates/not-an-objectid'
    });
    const badPut = await httpRequest({
      method: 'PUT',
      urlPath: '/api/devicetemplates/not-an-objectid',
      body: { config: { a: 1 } }
    });
    const badDel = await httpRequest({
      method: 'DELETE',
      urlPath: '/api/devicetemplates/not-an-objectid'
    });
    const uiOrgPost = await httpRequest({
      method: 'POST',
      urlPath: `/api/devicetemplates?org=${ownOrg}`,
      body: { name: 'ui-with-org', config: { a: 1 } }
    });

    currentUser = makeRouteUser('account_owner', { accessToken: true });
    const accessNoOrgPost = await httpRequest({
      method: 'POST',
      urlPath: '/api/devicetemplates',
      body: { name: 'key-without-org', config: { a: 1 } }
    });

    expect(badGet.status).toBe(400);
    expect(badPut.status).toBe(400);
    expect(badDel.status).toBe(400);
    expect(uiOrgPost.status).toBe(400);
    expect(accessNoOrgPost.status).toBe(400);
  });
});
