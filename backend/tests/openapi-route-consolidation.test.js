/** @jest-environment node */
// Legacy /api/organizations and /api/tunnels mounts are retired.
// OpenAPI services own those routes. Heavy I/O is stubbed so the service can load.
const fs = require('fs');
const path = require('path');

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

const { getAccessTokenOrgList } = require('../utils/membershipUtils');
const Tunnels = require('../models/tunnels');
const TunnelsService = require('../services/TunnelsService');
const TunnelsController = require('../controllers/TunnelsController');

const expressServerSource = fs.readFileSync(
  path.join(__dirname, '..', 'expressserver.js'),
  'utf8'
);
const user = { _id: 'user-1' };
const org = '507f1f77bcf86cd799439012';
const tunnelId = '507f1f77bcf86cd799439011';

const selectQuery = (value) => ({
  select: jest.fn(() => Promise.resolve(value))
});

beforeEach(() => {
  getAccessTokenOrgList.mockReset();
  jest.spyOn(Tunnels, 'findOneAndUpdate').mockReturnValue(selectQuery(null));
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('legacy organization and tunnel mounts are removed', () => {
  expect(expressServerSource).not.toMatch(
    /this\.app\.use\(\s*['"]\/api\/organizations['"]/
  );
  expect(expressServerSource).not.toMatch(
    /this\.app\.use\(\s*['"]\/api\/tunnels['"]/
  );
  expect(expressServerSource).not.toMatch(/organizationsRouter/);
  expect(expressServerSource).not.toMatch(/require\(\s*['"]\.\/routes\/tunnels['"]\s*\)/);
  expect(expressServerSource).toMatch(/this\.app\.use\(\s*['"]\/api\/users['"]/);
  expect(expressServerSource).toMatch(/this\.app\.use\(\s*['"]\/api\/public['"]/);
  expect(expressServerSource).toMatch(/this\.app\.use\(\s*['"]\/api\/devicestats['"]/);
  expect(expressServerSource).toMatch(/this\.app\.use\(\s*['"]\/api\/portals['"]/);
  expect(expressServerSource).toMatch(/this\.app\.use\(\s*['"]\/api\/admin['"]/);
  expect(expressServerSource).toMatch(/this\.app\.use\(\s*['"]\/api\/tickets['"]/);
  expect(expressServerSource).toMatch(/this\.app\.use\(\s*['"]\/api\/connect['"]/);
});

test('TunnelsService.tunnelsDELETE exists', async () => {
  expect(typeof TunnelsService.tunnelsDELETE).toBe('function');

  const tunnelsDELETE = jest.fn().mockResolvedValue({ code: 200, payload: { ok: true } });
  const controller = new TunnelsController({ tunnelsDELETE });
  const request = {
    openapi: { schema: {} },
    protocol: 'https',
    get: jest.fn(() => 'localhost'),
    url: `/api/tunnels/${tunnelId}`,
    method: 'DELETE',
    body: {}
  };
  const response = {
    status: jest.fn(),
    json: jest.fn(),
    end: jest.fn()
  };

  await controller.tunnelsDELETE(request, response);

  expect(tunnelsDELETE).toHaveBeenCalledWith({}, request, response);
  expect(response.status).toHaveBeenCalledWith(200);
  expect(response.json).toHaveBeenCalledWith({ ok: true });
});

test('tunnelsDELETE rejects when the org list is empty', async () => {
  getAccessTokenOrgList.mockResolvedValue([]);
  const result = await TunnelsService.tunnelsDELETE(
    { tunnelId, org },
    { user },
    {}
  );
  expect(getAccessTokenOrgList).toHaveBeenCalledWith(user, org, true, null, '', true);
  expect(result.error).toBeTruthy();
  expect(result.code).toBe(404);
  expect(result.payload).toBeUndefined();
  expect(Tunnels.findOneAndUpdate).not.toHaveBeenCalled();
});

test('tunnelsDELETE rejects when the tunnel is missing', async () => {
  getAccessTokenOrgList.mockResolvedValue([org]);
  Tunnels.findOneAndUpdate.mockReturnValue(selectQuery(null));
  const result = await TunnelsService.tunnelsDELETE(
    { tunnelId, org },
    { user },
    {}
  );
  expect(result).toEqual(expect.objectContaining({
    error: 'Tunnel not found or already inactive',
    code: 404
  }));
  expect(result.payload).toBeUndefined();
  expect(Tunnels.findOneAndUpdate).toHaveBeenCalledWith(
    {
      _id: expect.any(Object),
      org: { $in: [org] },
      isActive: true
    },
    { isActive: false },
    { new: true }
  );
});

test('tunnelsDELETE omits tunnelKeys and deviceToken', async () => {
  getAccessTokenOrgList.mockResolvedValue([org]);
  const deleted = {
    _id: tunnelId,
    num: 7,
    isActive: false,
    tunnelKeys: { key1: 'secret' },
    deviceA: { name: 'a', deviceToken: 'tok' }
  };
  const query = selectQuery(deleted);
  Tunnels.findOneAndUpdate.mockReturnValue(query);
  const result = await TunnelsService.tunnelsDELETE(
    { tunnelId, org },
    { user },
    {}
  );
  expect(result.code).toBe(200);
  expect(result.payload.num).toBe(7);
  expect(result.payload.tunnelKeys).toBeUndefined();
  expect(result.payload.deviceA).toEqual({ name: 'a' });
  expect(JSON.stringify(result.payload)).not.toMatch(/deviceToken|tunnelKeys/);
  expect(query.select).toHaveBeenCalledWith('-tunnelKeys');
});
