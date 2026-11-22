/** @jest-environment node */
jest.mock('../logging/logging', () => () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));
jest.mock('../authenticate', () => ({
  verifyPermission: () => (req, res, next) => next()
}));
jest.mock('../routes/cors', () => ({
  corsWithOptions: (req, res, next) => next()
}));
jest.mock('../utils/membershipUtils', () => ({
  getAccessTokenOrgList: jest.fn()
}));
jest.mock('../models/tunnels', () => ({
  find: jest.fn(),
  findOneAndUpdate: jest.fn()
}));
jest.mock('../periodic/deviceStatus', () => () => ({
  getTunnelStatus: jest.fn(() => null)
}));
jest.mock('../models/analytics/deviceStats', () => ({
  deviceStats: { aggregate: jest.fn() }
}));

const tunnelsModel = require('../models/tunnels');
const { deviceStats } = require('../models/analytics/deviceStats');
const { getAccessTokenOrgList } = require('../utils/membershipUtils');
const tunnelsRouter = require('../routes/tunnels');
const deviceStatsRouter = require('../routes/deviceStats');

const tokenOrg = '507f1f77bcf86cd799439011';
const otherTokenOrg = '507f1f77bcf86cd799439013';
const defaultOrg = '507f1f77bcf86cd799439012';
const tunnelId = '507f1f77bcf86cd799439015';
const deviceId = '507f1f77bcf86cd799439014';
const tokenOrgs = [tokenOrg, otherTokenOrg];

const user = {
  accessToken: true,
  tokenTo: 'organization',
  tokenOrganization: tokenOrg,
  tokenGroup: 'group-1',
  defaultOrg: { _id: defaultOrg }
};

function assertNoSecrets (value) {
  const seen = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    expect(Object.prototype.hasOwnProperty.call(node, 'tunnelKeys')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(node, 'deviceToken')).toBe(false);
    Object.keys(node).forEach(key => walk(node[key]));
  };
  walk(value);
}

function device (machineId, ifcId, token) {
  return {
    machineId,
    deviceToken: token,
    interfaces: [{ _id: { toString: () => ifcId }, name: 'wan' }]
  };
}

function tunnelDoc () {
  return {
    num: 7,
    interfaceA: 'ifc-a',
    interfaceB: 'ifc-b',
    tunnelKeys: { local: 'secret-a', remote: 'secret-b' },
    deviceA: device('machine-a', 'ifc-a', 'token-a'),
    deviceB: device('machine-b', 'ifc-b', 'token-b'),
    set (key, value) { this[key] = value; }
  };
}

function thenable (result) {
  const query = {
    select: jest.fn(() => query),
    populate: jest.fn(() => query),
    then (onFulfilled, onRejected) {
      return Promise.resolve(result).then(onFulfilled, onRejected);
    },
    catch (onRejected) {
      return Promise.resolve(result).catch(onRejected);
    }
  };
  return query;
}

function response () {
  return {
    statusCode: 0,
    headers: {},
    setHeader (key, value) { this.headers[key] = value; },
    json: jest.fn(),
    status (code) { this.statusCode = code; return this; }
  };
}

function request (extra = {}) {
  return {
    user,
    query: { org: tokenOrg },
    params: {},
    ...extra
  };
}

function routeHandler (router, path, method) {
  const layer = router.stack.find(entry => entry.route && entry.route.path === path);
  return layer.route.stack.filter(entry => entry.method === method).at(-1).handle;
}

beforeEach(() => {
  jest.clearAllMocks();
  getAccessTokenOrgList.mockResolvedValue(tokenOrgs);
  tunnelsModel.find.mockImplementation(() => thenable([tunnelDoc()]));
  tunnelsModel.findOneAndUpdate.mockImplementation(() => thenable(tunnelDoc()));
  deviceStats.aggregate.mockImplementation(() => ({
    allowDiskUse: () => Promise.resolve([])
  }));
});

test('resolveScopedOrgList returns the access-token org list, not defaultOrg', async () => {
  getAccessTokenOrgList.mockResolvedValue(tokenOrgs);
  const list = await tunnelsRouter.resolveScopedOrgList(user, tokenOrg);
  expect(getAccessTokenOrgList).toHaveBeenCalledWith(user, tokenOrg, true);
  expect(list).toEqual(tokenOrgs);
  expect(list).not.toContain(defaultOrg);
});

test('stripTunnelSecrets removes tunnelKeys and deviceToken', () => {
  const clean = tunnelsRouter.stripTunnelSecrets({
    num: 1,
    tunnelKeys: { local: 'secret' },
    deviceA: { name: 'a', deviceToken: 'tok-a' },
    deviceB: { name: 'b', deviceToken: 'tok-b' },
    nested: [{ deviceToken: 'tok-n', ok: true }]
  });
  assertNoSecrets(clean);
  expect(clean.num).toBe(1);
  expect(clean.deviceA.name).toBe('a');
  expect(clean.deviceB.name).toBe('b');
  expect(clean.nested[0].ok).toBe(true);
  expect(JSON.stringify(clean)).not.toContain('secret');
  expect(JSON.stringify(clean)).not.toContain('tok-a');
  expect(JSON.stringify(clean)).not.toContain('tok-n');
});

test('GET /tunnels scopes to the access-token org list and omits secrets', async () => {
  const res = response();
  const req = request();
  await routeHandler(tunnelsRouter, '/', 'get')(req, res, jest.fn());

  expect(getAccessTokenOrgList).toHaveBeenCalledWith(req.user, tokenOrg, true);
  expect(tunnelsModel.find).toHaveBeenCalledWith({
    org: { $in: tokenOrgs },
    isActive: true
  });
  expect(JSON.stringify(tunnelsModel.find.mock.calls[0][0])).not.toContain(defaultOrg);

  const query = tunnelsModel.find.mock.results[0].value;
  expect(query.select).toHaveBeenCalledWith('-tunnelKeys');
  expect(query.populate).toHaveBeenCalledWith({
    path: 'deviceA',
    select: '-deviceToken'
  });
  expect(query.populate).toHaveBeenCalledWith({
    path: 'deviceB',
    select: '-deviceToken'
  });

  const body = res.json.mock.calls[0][0];
  assertNoSecrets(body);
  expect(body[0].num).toBe(7);
  expect(body[0].interfaceADetails.name).toBe('wan');
  expect(body[0].tunnelStatusA).toBe(null);
  expect(JSON.stringify(body)).not.toContain('secret-a');
  expect(JSON.stringify(body)).not.toContain('token-a');
  expect(JSON.stringify(body)).not.toContain(defaultOrg);
});

test('DELETE /tunnels/:tunnelId scopes to the access-token list and omits secrets', async () => {
  const res = response();
  const req = request({ params: { tunnelId } });
  await routeHandler(tunnelsRouter, '/:tunnelId', 'delete')(req, res, jest.fn());

  expect(getAccessTokenOrgList).toHaveBeenCalledWith(req.user, tokenOrg, true);
  const filter = tunnelsModel.findOneAndUpdate.mock.calls[0][0];
  expect(filter._id.toString()).toBe(tunnelId);
  expect(filter.org).toEqual({ $in: tokenOrgs });
  expect(filter.isActive).toBe(true);
  expect(JSON.stringify(filter)).not.toContain(defaultOrg);
  expect(tunnelsModel.findOneAndUpdate.mock.calls[0][1]).toEqual({ isActive: false });

  const query = tunnelsModel.findOneAndUpdate.mock.results[0].value;
  expect(query.select).toHaveBeenCalledWith('-tunnelKeys');

  const body = res.json.mock.calls[0][0];
  assertNoSecrets(body);
  expect(body.num).toBe(7);
  expect(JSON.stringify(body)).not.toContain('secret-a');
  expect(JSON.stringify(body)).not.toContain('token-a');
});

test('DELETE missing tunnel still returns 404', async () => {
  tunnelsModel.findOneAndUpdate.mockImplementation(() => thenable(null));
  const next = jest.fn();
  const req = request({ params: { tunnelId } });
  await routeHandler(tunnelsRouter, '/:tunnelId', 'delete')(req, response(), next);
  expect(next.mock.calls[0][0].status).toBe(404);
});

test('rejected access-token org check does not query defaultOrg', async () => {
  getAccessTokenOrgList.mockRejectedValue(
    new Error('Organization query parameter must be specified for this operation')
  );
  const next = jest.fn();
  const req = request({ query: {} });
  await routeHandler(tunnelsRouter, '/', 'get')(req, response(), next);
  expect(tunnelsModel.find).not.toHaveBeenCalled();
  expect(next.mock.calls[0][0].status).toBe(400);
  expect(getAccessTokenOrgList).toHaveBeenCalledWith(req.user, undefined, true);
});

test('empty access-token org list does not fall back to defaultOrg', async () => {
  getAccessTokenOrgList.mockResolvedValue([]);
  const res = response();
  await routeHandler(tunnelsRouter, '/', 'get')(request(), res, jest.fn());
  expect(tunnelsModel.find).toHaveBeenCalledWith({
    org: { $in: [] },
    isActive: true
  });
  expect(JSON.stringify(tunnelsModel.find.mock.calls[0][0])).not.toContain(defaultOrg);
});

test('GET /devicestats scopes aggregation to the access-token org list', async () => {
  const res = response();
  const req = request();
  await routeHandler(deviceStatsRouter, '/', 'get')(req, res, jest.fn());

  expect(getAccessTokenOrgList).toHaveBeenCalledWith(req.user, tokenOrg, true);
  const match = deviceStats.aggregate.mock.calls[0][0][0].$match;
  expect(match.org.$in.map(id => id.toString())).toEqual(tokenOrgs);
  expect(match.org.$in.map(id => id.toString())).not.toContain(defaultOrg);
  const body = res.json.mock.calls[0][0];
  assertNoSecrets(body);
});

test('GET /devicestats/:deviceId does not fall back to defaultOrg', async () => {
  const res = response();
  const req = request({ params: { deviceId } });
  await routeHandler(deviceStatsRouter, '/:deviceId', 'get')(req, res, jest.fn());

  expect(getAccessTokenOrgList).toHaveBeenCalledWith(req.user, tokenOrg, true);
  const match = deviceStats.aggregate.mock.calls[0][0][0].$match;
  expect(match.org.$in.map(id => id.toString())).toEqual(tokenOrgs);
  expect(match.device.toString()).toBe(deviceId);
  expect(match.org.$in.map(id => id.toString())).not.toContain(defaultOrg);
  assertNoSecrets(res.json.mock.calls[0][0]);
});

test('UI with no authorized org gets 400 and does not read defaultOrg', async () => {
  getAccessTokenOrgList.mockResolvedValue([]);
  const next = jest.fn();
  const req = {
    user: { defaultOrg: { _id: defaultOrg } },
    query: {},
    params: {}
  };
  await routeHandler(deviceStatsRouter, '/', 'get')(req, response(), next);
  expect(deviceStats.aggregate).not.toHaveBeenCalled();
  expect(next.mock.calls[0][0].status).toBe(400);
  expect(next.mock.calls[0][0].message).toBe('User has no default organization selected');
});
