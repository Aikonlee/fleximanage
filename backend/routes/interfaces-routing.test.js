/** @jest-environment node */
jest.mock('../logging/logging', () => () => ({ error: jest.fn(), info: jest.fn() }));
jest.mock('../models/devices', () => ({ devices: { findOne: jest.fn() } }));
jest.mock('../authenticate', () => ({ verifyPermission: () => (req, res, next) => next() }));
jest.mock('../utils/membershipUtils', () => ({ getAccessTokenOrgList: jest.fn() }));
jest.mock('../deviceLogic/routingHandler', () => ({ applyRoutingConfig: jest.fn(), removeRoutingConfig: jest.fn() }));
const router = require('./interfaces-routing');
const { devices } = require('../models/devices');
const { getAccessTokenOrgList } = require('../utils/membershipUtils');
const route = router.stack.filter(layer => layer.route && layer.route.path.endsWith('/routing'));
const handlers = Object.fromEntries(route.map(layer => [Object.keys(layer.route.methods)[0], layer.route.stack.at(-1).handle]));
const org = '507f1f77bcf86cd799439011';
const otherOrg = '507f1f77bcf86cd799439012';
const iface = { routing: { protocol: 'none', ospf: { enabled: false }, bgp: { enabled: false } } };
const device = { interfaces: { id: jest.fn(() => iface) }, save: jest.fn(), status: 'stopped' };
const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
const request = (method, user = { defaultOrg: { _id: org } }) => ({ params: { deviceId: 'device-id', interfaceId: 'iface-id' }, query: {}, user, body: method === 'put' ? { protocol: 'none' } : {} });
beforeEach(() => {
  jest.clearAllMocks();
  devices.findOne.mockResolvedValue(null);
  getAccessTokenOrgList.mockResolvedValue([org]);
});
for (const method of ['get', 'put']) {
  test(`${method.toUpperCase()} scopes device lookup to authorized organizations`, async () => {
    const res = response();
    await handlers[method](request(method), res);
    expect(devices.findOne).toHaveBeenCalledWith({ _id: 'device-id', org: { $in: [org] } });
    expect(res.status).toHaveBeenCalledWith(404);
    expect(device.save).not.toHaveBeenCalled();
  });
  test(`${method.toUpperCase()} allows an accessible device`, async () => {
    devices.findOne.mockResolvedValue(device);
    const res = response();
    await handlers[method](request(method), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
  test(`${method.toUpperCase()} rejects access when no organization is authorized`, async () => {
    getAccessTokenOrgList.mockResolvedValue([]);
    const res = response();
    await handlers[method](request(method), res);
    expect(devices.findOne).toHaveBeenCalledWith({ _id: 'device-id', org: { $in: [] } });
    expect(res.status).toHaveBeenCalledWith(404);
  });
}
test('PUT checks modify-level organization access for access tokens', async () => {
  const req = request('put', { accessToken: true });
  req.query.org = otherOrg;
  await handlers.put(req, response());
  expect(getAccessTokenOrgList).toHaveBeenCalledWith(req.user, otherOrg, true, null, '', true);
});
