const escapeRegExp = require('lodash/escapeRegExp');

jest.mock('../logging/logging', () => () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));
jest.mock('../authenticate', () => ({
  verifyAdmin: (req, res, next) => next(),
  verifyPermission: () => (req, res, next) => next()
}));
jest.mock('../routes/cors', () => ({
  corsWithOptions: (req, res, next) => next()
}));
jest.mock('../websocket/Connections', () => () => ({
  getAllDevices: jest.fn(() => []),
  getDeviceInfo: jest.fn()
}));
jest.mock('../periodic/deviceStatus', () => () => ({
  getDeviceStatus: jest.fn()
}));
jest.mock('../models/users', () => ({
  aggregate: jest.fn(() => ({ allowDiskUse: () => Promise.resolve([{ num_registered_users: 1 }]) }))
}));
jest.mock('../models/organizations', () => ({ find: jest.fn() }));
jest.mock('../models/devices', () => ({ devices: { find: jest.fn() } }));
jest.mock('../models/tunnels', () => ({ aggregate: jest.fn() }));
jest.mock('../models/analytics/deviceStats', () => ({
  deviceAggregateStats: {
    aggregate: jest.fn(() => ({ allowDiskUse: () => Promise.resolve([]) }))
  }
}));

jest.mock('../models/accounts', () => ({
  aggregate: jest.fn()
}));

jest.mock('../flexibilling', () => ({
  getMaxDevicesRegisteredSummmaryByAccounts: jest.fn(),
  getFeaturesSummaryByAccounts: jest.fn(),
  createPortalSession: jest.fn()
}));

const accountsAggregate = require('../models/accounts').aggregate;
const flexibilling = require('../flexibilling');
const {
  getMaxDevicesRegisteredSummmaryByAccounts,
  getFeaturesSummaryByAccounts,
  createPortalSession
} = flexibilling;

const adminRouter = require('../routes/admin');
const portalsRouter = require('../routes/portals');

const routeHandler = (router, path, method) => {
  const layer = router.stack.find(l => l.route && l.route.path === path && l.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
};

const flush = () => new Promise(resolve => setImmediate(resolve));

describe('admin and portal error handling', () => {
  beforeEach(() => {
    accountsAggregate.mockReset();
    getMaxDevicesRegisteredSummmaryByAccounts.mockReset();
    getFeaturesSummaryByAccounts.mockReset();
    createPortalSession.mockReset();
  });

  test('admin handler forwards a rejection to next', async () => {
    accountsAggregate.mockReturnValue({
      allowDiskUse: () => Promise.resolve([{
        all: [{ account_id: 1 }],
        data: [{ account_id: 9, organizations: [] }]
      }])
    });
    const boom = new Error('billing down');
    getMaxDevicesRegisteredSummmaryByAccounts.mockRejectedValue(boom);
    getFeaturesSummaryByAccounts.mockResolvedValue([]);

    const handler = routeHandler(adminRouter, '/', 'get');
    const next = jest.fn();
    const res = { statusCode: 0, setHeader: jest.fn(), json: jest.fn(), status: jest.fn() };
    handler({ query: {} }, res, next);
    await flush();
    await flush();

    expect(next).toHaveBeenCalledWith(boom);
  });

  test('escaped regex receives metacharacters', async () => {
    const raw = 'acme.+*?^$()[]{}|\\';
    accountsAggregate.mockReturnValue({
      allowDiskUse: () => Promise.resolve([{ all: [{ account_id: 0 }], data: [] }])
    });
    getMaxDevicesRegisteredSummmaryByAccounts.mockResolvedValue([]);
    getFeaturesSummaryByAccounts.mockResolvedValue([]);

    const handler = routeHandler(adminRouter, '/', 'get');
    const next = jest.fn();
    const res = {
      statusCode: 0,
      setHeader: jest.fn(),
      json: jest.fn(),
      status: jest.fn()
    };
    handler({ query: { filters: JSON.stringify({ account_name: raw }) } }, res, next);
    await flush();
    await flush();

    const pipeline = accountsAggregate.mock.calls[0][0];
    expect(pipeline[0].$match.name).toEqual({
      $regex: escapeRegExp(String(raw)),
      $options: 'i'
    });
    expect(pipeline[0].$match.name.$regex).not.toBe(raw);
    expect(next).not.toHaveBeenCalled();
  });

  test('portals catch calls next', async () => {
    createPortalSession.mockRejectedValue(new Error('chargebee down'));
    const handler = routeHandler(portalsRouter, '/', 'get');
    const next = jest.fn();
    const res = { status: jest.fn(() => res), json: jest.fn() };
    handler({ user: { defaultAccount: { billingCustomerId: 'cust_1' } } }, res, next);
    await flush();

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err.status).toBe(500);
    expect(err.message).toBe('Failed to create portal session');
  });
});
