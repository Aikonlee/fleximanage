/** @jest-environment node */
// A5: Ensure interface ospf.key is never exposed in device GET/PUT responses
// and that omitting ospf.key on update preserves the stored secret.
jest.mock('cidr-tools', () => ({
  overlapCidr: jest.fn(() => false),
  normalizeCidr: jest.fn((v) => v)
}));
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
jest.mock('../periodic/deviceStatus', () => () => ({
  getDeviceStatus: jest.fn(() => ({ state: 'running' }))
}));
jest.mock('../periodic/statusesInDb', () => () => ({
  isStatusesInDbEnabled: jest.fn(() => false)
}));
jest.mock('../websocket/Connections', () => () => ({
  isConnected: jest.fn(() => true),
  deviceDisconnect: jest.fn(),
  devices: { updateDeviceInfo: jest.fn() }
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
jest.mock('../deviceLogic/publicAddressLimiter', () => ({
  isBlocked: jest.fn(async () => false)
}));
jest.mock('../deviceLogic/dispatcher', () => ({
  apply: jest.fn(async () => ({ ids: [] }))
}));
jest.mock('../deviceLogic/validators', () => ({
  validateDevice: jest.fn(async () => ({ valid: true })),
  validateDhcpConfig: jest.fn(() => ({ valid: true })),
  validateStaticRoute: jest.fn(() => ({ valid: true })),
  validateQOSPolicy: jest.fn(() => ({ valid: true })),
  isLocalOrBroadcastAddress: jest.fn(() => false)
}));
jest.mock('../deviceLogic/events', () => ({
  activatePendingTunnelsOfDevice: jest.fn(async () => {}),
  releasePublicAddrLimiterBlockage: jest.fn(async () => false)
}));
jest.mock('../mongoConns.js', () => {
  const mongoose = require('mongoose');
  const main = mongoose.createConnection();
  const analytics = mongoose.createConnection();
  const vpn = mongoose.createConnection();
  const safeConn = (conn) => ({
    model: (name, schema) => conn.models[name] || conn.model(name, schema)
  });
  const session = { endSession: jest.fn() };
  return () => ({
    getMainDB: () => safeConn(main),
    getAnalyticsDB: () => safeConn(analytics),
    getVpnDB: () => safeConn(vpn),
    mainDBwithTransaction: jest.fn(async (fn) => {
      await fn(session);
      return session;
    })
  });
});

const { getAccessTokenOrgList } = require('../utils/membershipUtils');
const { devices } = require('../models/devices');
const tunnelsModel = require('../models/tunnels');
const pathLabelsModel = require('../models/pathlabels');
const Vrrp = require('../models/vrrp');
const DevicesService = require('../services/DevicesService');

const orgId = '507f1f77bcf86cd799439011';
const deviceId = '507f1f77bcf86cd799439022';
const ifaceId = '507f1f77bcf86cd799439033';
const user = { _id: 'user-1', role: 'owner' };
const OSPF_SECRET = 'ospf-md5-secret1';

function chainQuery (value) {
  const q = {
    session () { return q; },
    populate () { return q; },
    lean () { return Promise.resolve(value); },
    allowDiskUse () { return Promise.resolve(value); },
    then (resolve, reject) { return Promise.resolve(value).then(resolve, reject); }
  };
  return q;
}

function makeStoredDevice (ospf = { area: '0.0.0.1', keyId: '7', key: OSPF_SECRET, cost: 20 }) {
  return {
    _id: deviceId,
    name: 'edge-1',
    machineId: 'machine-1',
    org: { _id: orgId, vxlanPort: 4789 },
    isApproved: true,
    versions: { agent: '6.5.0' },
    policies: {
      firewall: { toObject: () => ({}) }
    },
    firewall: { rules: [] },
    interfaces: [
      {
        _id: ifaceId,
        devId: 'eth0',
        name: 'eth0',
        type: 'LAN',
        isAssigned: true,
        dhcp: 'no',
        IPv4: '10.0.1.1',
        IPv4Mask: '24',
        gateway: '',
        routing: 'OSPF',
        dnsServers: [],
        dnsDomains: [],
        pathlabels: [],
        ospf
      }
    ],
    staticroutes: [],
    dhcp: [],
    bgp: { enable: false },
    ospf: { routerId: '1.1.1.1', helloInterval: 10, deadInterval: 40, redistributeBgp: true },
    toObject () { return { ...this }; }
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  getAccessTokenOrgList.mockResolvedValue([orgId]);
  jest.spyOn(tunnelsModel, 'find').mockImplementation(() => chainQuery([]));
  jest.spyOn(pathLabelsModel, 'find').mockImplementation(() => chainQuery([]));
  jest.spyOn(Vrrp, 'aggregate').mockImplementation(() => chainQuery([]));
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('devicesIdGET and devicesGET omit interface ospf.key and return keyConfigured', async () => {
  const stored = makeStoredDevice();
  jest.spyOn(devices, 'findOne').mockImplementation(() => chainQuery(stored));
  jest.spyOn(devices, 'aggregate').mockImplementation(() => chainQuery([{
    records: [stored],
    meta: [{ total: 1 }]
  }]));

  const singleRes = await DevicesService.devicesIdGET({ id: deviceId }, { user });
  expect(singleRes.code).toBe(200);
  const singleIface = singleRes.payload[0].interfaces[0];
  expect(singleIface.ospf).toEqual({
    area: '0.0.0.1',
    keyId: '7',
    cost: 20,
    keyConfigured: true
  });
  expect('key' in singleIface.ospf).toBe(false);
  expect(JSON.stringify(singleRes.payload)).not.toContain(OSPF_SECRET);

  const listRes = await DevicesService.devicesGET({}, { user }, { setHeader: jest.fn() });
  expect(listRes.code).toBe(200);
  const listIface = listRes.payload[0].interfaces[0];
  expect(listIface.ospf).toEqual({
    area: '0.0.0.1',
    keyId: '7',
    cost: 20,
    keyConfigured: true
  });
  expect('key' in listIface.ospf).toBe(false);
  expect(JSON.stringify(listRes.payload)).not.toContain(OSPF_SECRET);

  // When no key is stored, keyConfigured is false and key is still absent.
  const emptyKeyDev = makeStoredDevice({ area: '0', keyId: '', key: '', cost: 10 });
  const projected = await DevicesService.selectDeviceParams(emptyKeyDev);
  expect(projected.interfaces[0].ospf).toEqual({
    area: '0',
    keyId: '',
    cost: 10,
    keyConfigured: false
  });
  expect('key' in projected.interfaces[0].ospf).toBe(false);
});

test('devicesIdPUT preserves stored ospf.key when omitted and never exposes key in response', async () => {
  const orig = makeStoredDevice();
  jest.spyOn(devices, 'findOne').mockImplementation(() => chainQuery(orig));

  let persistedUpdate = null;
  jest.spyOn(devices, 'findOneAndUpdate').mockImplementation((filter, update) => {
    persistedUpdate = update.$set;
    const updatedDoc = {
      ...orig,
      ...update.$set,
      interfaces: update.$set.interfaces
    };
    return chainQuery(updatedDoc);
  });

  // Simulate a read-edit-write cycle (e.g. Batch OSPF or DeviceInfo edit) where
  // key is omitted and read-only keyConfigured is echoed back from GET.
  const res = { setHeader: jest.fn() };
  const result = await DevicesService.devicesIdPUT(
    {
      id: deviceId,
      name: 'edge-1',
      interfaces: [
        {
          _id: ifaceId,
          devId: 'eth0',
          name: 'eth0',
          type: 'LAN',
          isAssigned: true,
          dhcp: 'no',
          IPv4: '10.0.1.1',
          IPv4Mask: '24',
          gateway: '',
          routing: 'OSPF',
          dnsServers: [],
          dnsDomains: [],
          pathlabels: [],
          ospf: {
            area: '0.0.0.2',
            keyId: '7',
            cost: 15,
            keyConfigured: true
          }
        }
      ],
      bgp: { enable: false }
    },
    { user, server: 'https://localhost:3443' },
    res
  );

  expect(result.code).toBe(200);
  // Stored key must be preserved in the persisted DB update and keyConfigured stripped.
  expect(persistedUpdate.interfaces[0].ospf).toEqual({
    area: '0.0.0.2',
    keyId: '7',
    key: OSPF_SECRET,
    cost: 15
  });
  expect('keyConfigured' in persistedUpdate.interfaces[0].ospf).toBe(false);

  // Response must omit key and report keyConfigured: true.
  expect(result.payload.interfaces[0].ospf).toEqual({
    area: '0.0.0.2',
    keyId: '7',
    cost: 15,
    keyConfigured: true
  });
  expect('key' in result.payload.interfaces[0].ospf).toBe(false);
  expect(JSON.stringify(result.payload)).not.toContain(OSPF_SECRET);
});

test('devicesIdPUT allows explicitly rotating or clearing ospf.key without returning it', async () => {
  const orig = makeStoredDevice();
  jest.spyOn(devices, 'findOne').mockImplementation(() => chainQuery(orig));

  let persistedUpdate = null;
  jest.spyOn(devices, 'findOneAndUpdate').mockImplementation((filter, update) => {
    persistedUpdate = update.$set;
    return chainQuery({
      ...orig,
      ...update.$set,
      interfaces: update.$set.interfaces
    });
  });

  const rotated = await DevicesService.devicesIdPUT(
    {
      id: deviceId,
      name: 'edge-1',
      interfaces: [
        {
          ...orig.interfaces[0],
          ospf: { area: '0.0.0.1', keyId: '8', key: 'brand-new-key', cost: 20 }
        }
      ],
      bgp: { enable: false }
    },
    { user, server: 'https://localhost:3443' },
    { setHeader: jest.fn() }
  );

  expect(rotated.code).toBe(200);
  expect(persistedUpdate.interfaces[0].ospf.key).toBe('brand-new-key');
  expect(rotated.payload.interfaces[0].ospf).toEqual({
    area: '0.0.0.1',
    keyId: '8',
    cost: 20,
    keyConfigured: true
  });
  expect('key' in rotated.payload.interfaces[0].ospf).toBe(false);
  expect(JSON.stringify(rotated.payload)).not.toContain('brand-new-key');

  // Explicit clear of both keyId and key succeeds and sets keyConfigured: false.
  const cleared = await DevicesService.devicesIdPUT(
    {
      id: deviceId,
      name: 'edge-1',
      interfaces: [
        {
          ...orig.interfaces[0],
          ospf: { area: '0.0.0.1', keyId: '', key: '', cost: 20 }
        }
      ],
      bgp: { enable: false }
    },
    { user, server: 'https://localhost:3443' },
    { setHeader: jest.fn() }
  );

  expect(cleared.code).toBe(200);
  expect(persistedUpdate.interfaces[0].ospf.key).toBe('');
  expect(cleared.payload.interfaces[0].ospf).toEqual({
    area: '0.0.0.1',
    keyId: '',
    cost: 20,
    keyConfigured: false
  });
});

test('devicesIdRoutingOSPFPUT never echoes ospf.key, preserves stored key when omitted, and matches GET projection', async () => {
  const storedDevice = makeStoredDevice();
  storedDevice.ospf = {
    routerId: '1.1.1.1',
    helloInterval: 10,
    deadInterval: 40,
    redistributeBgp: true,
    key: OSPF_SECRET
  };
  jest.spyOn(devices, 'findOne').mockImplementation(() => chainQuery(storedDevice));

  let persistedOspf = null;
  jest.spyOn(devices, 'findOneAndUpdate').mockImplementation((filter, update) => {
    persistedOspf = update.$set.ospf;
    storedDevice.ospf = persistedOspf;
    return chainQuery({ ...storedDevice, ospf: persistedOspf });
  });

  // 1) Submitting a new key on device-level OSPF PUT must not echo key in response.
  const putWithKey = await DevicesService.devicesIdRoutingOSPFPUT(
    {
      id: deviceId,
      org: orgId,
      routerId: '2.2.2.2',
      helloInterval: 15,
      deadInterval: 45,
      redistributeBgp: false,
      key: 'rotated-device-key'
    },
    { user, server: 'https://localhost:3443' },
    { setHeader: jest.fn() }
  );

  expect(putWithKey.code).toBe(202);
  expect(persistedOspf.key).toBe('rotated-device-key');
  expect('key' in putWithKey.payload).toBe(false);
  expect(JSON.stringify(putWithKey.payload)).not.toContain('rotated-device-key');
  expect(putWithKey.payload).toEqual({
    routerId: '2.2.2.2',
    helloInterval: 15,
    deadInterval: 45,
    redistributeBgp: false,
    keyConfigured: true
  });

  // 2) Omitting key on subsequent PUT preserves the stored key and matches GET projection.
  const putOmittedKey = await DevicesService.devicesIdRoutingOSPFPUT(
    {
      id: deviceId,
      org: orgId,
      routerId: '3.3.3.3',
      helloInterval: 20,
      keyConfigured: false
    },
    { user, server: 'https://localhost:3443' },
    { setHeader: jest.fn() }
  );

  expect(putOmittedKey.code).toBe(202);
  expect(persistedOspf.key).toBe('rotated-device-key');
  expect('keyConfigured' in persistedOspf).toBe(false);
  expect('key' in putOmittedKey.payload).toBe(false);
  expect(JSON.stringify(putOmittedKey.payload)).not.toContain('rotated-device-key');

  const getRes = await DevicesService.devicesIdRoutingOSPFGET(
    { id: deviceId, org: orgId },
    { user }
  );
  expect(getRes.code).toBe(200);
  expect('key' in getRes.payload).toBe(false);
  expect(putOmittedKey.payload).toEqual(getRes.payload);
  expect(putOmittedKey.payload).toEqual({
    routerId: '3.3.3.3',
    helloInterval: 20,
    deadInterval: 45,
    redistributeBgp: false,
    keyConfigured: true
  });
});
