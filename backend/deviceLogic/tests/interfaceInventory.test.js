jest.mock('../../mongoConns', () => {
  const m = require('mongoose');
  const defaultMain = m.createConnection();
  const defaultAnalytics = m.createConnection();
  const defaultVpn = m.createConnection();
  const api = {
    _main: defaultMain,
    _analytics: defaultAnalytics,
    _vpn: defaultVpn,
    _mainDBwithTransaction: async (cb) => {
      const fakeSession = { endSession: jest.fn() };
      await cb(fakeSession);
      return fakeSession;
    },
    getMainDB: () => api._main,
    getAnalyticsDB: () => api._analytics,
    getVpnDB: () => api._vpn,
    mainDBwithTransaction: (...args) => api._mainDBwithTransaction(...args)
  };
  return () => api;
});

const mongoose = require('mongoose');
const mongoConnsApi = require('../../mongoConns')();
const {
  normalizeRegistrationInterfaces,
  mergeInterfaceInventory,
  applyInterfaceInventory,
  isLinuxManagementWifi
} = require('../interfaceInventory');
const { buildInterfaces } = require('../interfaces');
const { devices: DeviceModel } = require('../../models/devices');

const makeStoredInterface = (overrides = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  name: 'eth0',
  devId: 'pci:0000:00:03.00',
  parentDevId: '',
  vlanTag: '',
  driver: 'igb',
  MAC: '52:54:00:aa:bb:01',
  dhcp: 'no',
  IPv4: '192.0.2.10',
  IPv4Mask: '24',
  IPv6: '',
  IPv6Mask: '',
  PublicIP: '198.51.100.10',
  PublicPort: '4789',
  NatType: 'Full Cone',
  useStun: true,
  useFixedPublicPort: false,
  gateway: '192.0.2.1',
  metric: '0',
  mtu: 1500,
  isAssigned: true,
  locked: true,
  routing: 'NONE',
  type: 'WAN',
  pathlabels: [],
  monitorInternet: true,
  internetAccess: 'yes',
  linkStatus: 'up',
  deviceType: 'dpdk',
  configuration: {},
  deviceParams: {},
  qosPolicy: null,
  hasIpOnDevice: true,
  assignable: true,
  vppManaged: true,
  ...overrides
});

const makeMockDeviceModel = (initialDoc) => {
  let doc = {
    ...initialDoc,
    interfaces: initialDoc.interfaces.map((i) => ({ ...i }))
  };
  const findOneCalls = [];
  const findOneAndUpdateCalls = [];

  const matchesFilter = (filter, current) => {
    for (const [key, val] of Object.entries(filter)) {
      if (key === '__v' && val && typeof val === 'object' && '$exists' in val) {
        if (val.$exists === false && current.__v !== undefined) return false;
        continue;
      }
      if (String(current[key]) !== String(val)) return false;
    }
    return true;
  };

  return {
    getDoc: () => doc,
    setDoc: (next) => { doc = next; },
    findOneCalls,
    findOneAndUpdateCalls,
    findOne: jest.fn(async (filter) => {
      findOneCalls.push({ ...filter });
      if (!matchesFilter(filter, doc)) return null;
      return {
        ...doc,
        interfaces: doc.interfaces.map((i) => ({ ...i }))
      };
    }),
    findOneAndUpdate: jest.fn(async (filter, update, opts) => {
      findOneAndUpdateCalls.push({ filter: { ...filter }, update, opts });
      if (!matchesFilter(filter, doc)) return null;
      doc = {
        ...doc,
        interfaces: update.$set.interfaces.map((i) => ({ ...i })),
        __v: (typeof doc.__v === 'number' ? doc.__v : 0) + (update.$inc?.__v || 0)
      };
      return {
        ...doc,
        interfaces: doc.interfaces.map((i) => ({ ...i }))
      };
    })
  };
};

// Loads a real module inside jest.isolateModules using fresh mongoose connections
// (avoiding OverwriteModelError on shared connections) and cleans up every doMock
// afterward so stubs never leak into subsequent tests.
const loadIsolatedWithMocks = (mocks, loader, mongoOverrides = {}) => {
  const defaultMocks = {
    redis: () => ({
      createClient: () => ({
        auth: jest.fn(),
        duplicate: () => ({ subscribe: jest.fn(), on: jest.fn(), quit: jest.fn() }),
        on: jest.fn(),
        publish: jest.fn(),
        quit: jest.fn()
      })
    }),
    '../../utils/deviceQueue': () => () => ({ addJob: jest.fn() }),
    '../../notifications/notifications': () => () => ({
      sendNotifications: jest.fn(async () => {})
    }),
    '../../limiters/reconfigErrors': () => ({
      reconfigErrorsLimiter: { consume: jest.fn(async () => ({})), delete: jest.fn(async () => {}) }
    }),
    '../../deviceLogic/publicAddressLimiter': () => ({
      use: jest.fn(async () => ({ allowed: true, blockedNow: false, releasedNow: false })),
      isBlocked: jest.fn(async () => false),
      release: jest.fn(async () => false)
    })
  };
  const allMocks = { ...defaultMocks, ...mocks };
  const mockedPaths = Object.keys(allMocks);
  const prevMain = mongoConnsApi._main;
  const prevAnalytics = mongoConnsApi._analytics;
  const prevVpn = mongoConnsApi._vpn;
  const prevTx = mongoConnsApi._mainDBwithTransaction;

  const freshMain = mongoose.createConnection();
  if (mongoOverrides.mainOverrides) {
    Object.assign(freshMain, mongoOverrides.mainOverrides);
  }
  mongoConnsApi._main = freshMain;
  mongoConnsApi._analytics = mongoose.createConnection();
  mongoConnsApi._vpn = mongoose.createConnection();
  if (mongoOverrides.mainDBwithTransaction) {
    mongoConnsApi._mainDBwithTransaction = mongoOverrides.mainDBwithTransaction;
  }

  let loaded;
  try {
    jest.isolateModules(() => {
      for (const [modPath, factory] of Object.entries(allMocks)) {
        jest.doMock(modPath, factory);
      }
      loaded = loader();
    });
  } finally {
    for (const modPath of mockedPaths) {
      jest.dontMock(modPath);
    }
    if (!mongoOverrides.keepFreshMongo) {
      mongoConnsApi._main = prevMain;
      mongoConnsApi._analytics = prevAnalytics;
      mongoConnsApi._vpn = prevVpn;
      mongoConnsApi._mainDBwithTransaction = prevTx;
    }
  }
  return loaded;
};

describe('interfaceInventory', () => {
  test('appends a 4th down/no-IP PCI port while preserving _id, assignments, pathlabels, and tunnel refs on existing 3 ports', () => {
    const labelA = new mongoose.Types.ObjectId();
    const labelB = new mongoose.Types.ObjectId();
    const qosId = new mongoose.Types.ObjectId();
    const tunnelRefId = new mongoose.Types.ObjectId();

    const existing = [
      makeStoredInterface({
        name: 'eth0',
        devId: 'pci:0000:00:03.00',
        MAC: '52:54:00:11:22:01',
        type: 'WAN',
        isAssigned: true,
        pathlabels: [labelA],
        qosPolicy: qosId,
        tunnelRef: tunnelRefId
      }),
      makeStoredInterface({
        name: 'eth1',
        devId: 'pci:0000:00:04.00',
        MAC: '52:54:00:11:22:02',
        type: 'WAN',
        IPv4: '198.51.100.20',
        gateway: '198.51.100.1',
        metric: '100',
        isAssigned: true,
        pathlabels: [labelB],
        tunnels: [tunnelRefId]
      }),
      makeStoredInterface({
        name: 'eth2',
        devId: 'pci:0000:00:05.00',
        MAC: '52:54:00:11:22:03',
        type: 'LAN',
        IPv4: '10.10.0.1',
        gateway: '',
        metric: '',
        isAssigned: true,
        pathlabels: []
      })
    ];

    const reported = [
      {
        name: 'eth0',
        devId: 'pci:0000:00:03.00',
        driver: 'igb',
        MAC: '52:54:00:11:22:01',
        link: 'up',
        IPv4: '192.0.2.10',
        IPv4Mask: '24',
        IPv6: '',
        IPv6Mask: '',
        gateway: '192.0.2.1',
        metric: '0',
        mtu: 1500,
        dhcp: 'no',
        internetAccess: true,
        deviceType: 'dpdk'
      },
      {
        name: 'eth1',
        devId: 'pci:0000:00:04.00',
        driver: 'igb',
        MAC: '52:54:00:11:22:02',
        link: 'up',
        IPv4: '198.51.100.20',
        IPv4Mask: '24',
        IPv6: '',
        IPv6Mask: '',
        gateway: '198.51.100.1',
        metric: '100',
        mtu: 1500,
        dhcp: 'no',
        internetAccess: true,
        deviceType: 'dpdk'
      },
      {
        name: 'eth2',
        devId: 'pci:0000:00:05.00',
        driver: 'igb',
        MAC: '52:54:00:11:22:03',
        link: 'up',
        IPv4: '10.10.0.1',
        IPv4Mask: '24',
        IPv6: '',
        IPv6Mask: '',
        gateway: '',
        metric: '',
        mtu: 1500,
        dhcp: 'no',
        deviceType: 'dpdk'
      },
      {
        name: 'eth3',
        devId: 'pci:0000:00:06.00',
        driver: 'igb',
        MAC: '52:54:00:11:22:04',
        link: 'down',
        IPv4: '',
        IPv4Mask: '',
        IPv6: '',
        IPv6Mask: '',
        gateway: '',
        metric: '',
        mtu: 1500,
        dhcp: 'no',
        deviceType: 'dpdk'
      }
    ];

    const { interfaces } = mergeInterfaceInventory(existing, reported);

    expect(interfaces).toHaveLength(4);

    // Original 3 keep _id, isAssigned, pathlabels, qosPolicy, and tunnel references
    expect(interfaces[0]._id).toEqual(existing[0]._id);
    expect(interfaces[0].isAssigned).toBe(true);
    expect(interfaces[0].pathlabels).toEqual([labelA]);
    expect(interfaces[0].qosPolicy).toEqual(qosId);
    expect(interfaces[0].tunnelRef).toEqual(tunnelRefId);

    expect(interfaces[1]._id).toEqual(existing[1]._id);
    expect(interfaces[1].isAssigned).toBe(true);
    expect(interfaces[1].pathlabels).toEqual([labelB]);
    expect(interfaces[1].tunnels).toEqual([tunnelRefId]);

    expect(interfaces[2]._id).toEqual(existing[2]._id);
    expect(interfaces[2].isAssigned).toBe(true);

    // 4th down/no-IP PCI port is appended, locked, unassigned, with a fresh Mongoose ObjectId
    const fourth = interfaces[3];
    expect(fourth._id).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(fourth.devId).toBe('pci:0000:00:06.00');
    expect(fourth.locked).toBe(true);
    expect(fourth.isAssigned).toBe(false);
    expect(fourth.linkStatus).toBe('down');
    expect(fourth.IPv4).toBe('');
    expect(fourth.hasIpOnDevice).toBe(false);
    expect(fourth.assignable).toBe(true);
    expect(fourth.vppManaged).toBe(true);
  });

  test('stores Linux management Wi-Fi with assignable:false and vppManaged:false, persists via schema, and excludes it from buildInterfaces even if assigned', () => {
    const linuxMgmtWifiReport = {
      name: 'wlp2s0',
      devId: 'pci:0000:02:00.00',
      driver: 'iwlwifi',
      MAC: 'aa:bb:cc:dd:ee:10',
      link: 'up',
      IPv4: '192.168.50.10',
      IPv4Mask: '24',
      IPv6: '',
      IPv6Mask: '',
      gateway: '192.168.50.1',
      metric: '600',
      mtu: 1500,
      dhcp: 'yes',
      deviceType: 'dpdk'
    };

    const vppWifiApReport = {
      name: 'wlan1',
      devId: 'pci:0000:03:00.00',
      driver: 'ath10k_pci',
      MAC: 'aa:bb:cc:dd:ee:11',
      link: 'up',
      IPv4: '10.20.0.1',
      IPv4Mask: '24',
      IPv6: '',
      IPv6Mask: '',
      gateway: '',
      metric: '',
      mtu: 1500,
      dhcp: 'no',
      deviceType: 'wifi'
    };

    expect(isLinuxManagementWifi(linuxMgmtWifiReport)).toBe(true);
    expect(isLinuxManagementWifi(vppWifiApReport)).toBe(false);

    const { interfaces } = mergeInterfaceInventory([], [linuxMgmtWifiReport, vppWifiApReport]);
    expect(interfaces).toHaveLength(2);

    const storedMgmtWifi = interfaces.find((i) => i.devId === 'pci:0000:02:00.00');
    const storedVppWifi = interfaces.find((i) => i.devId === 'pci:0000:03:00.00');

    expect(storedMgmtWifi.assignable).toBe(false);
    expect(storedMgmtWifi.vppManaged).toBe(false);
    expect(storedMgmtWifi.isAssigned).toBe(false);
    expect(storedMgmtWifi.locked).toBe(true);

    // VPP-managed Wi-Fi AP must NOT be marked unassignable
    expect(storedVppWifi.assignable).toBe(true);
    expect(storedVppWifi.vppManaged).toBe(true);

    // Schema strict mode preserves assignable and vppManaged flags
    const doc = new DeviceModel({
      account: new mongoose.Types.ObjectId(),
      org: new mongoose.Types.ObjectId(),
      machineId: '11111111-2222-3333-4444-555555555555',
      hostname: 'edge-wifi-test',
      versions: { agent: '6.0.0', router: '6.0.0', device: '6.0.0' },
      interfaces
    });
    const docMgmtWifi = doc.interfaces.find((i) => i.devId === 'pci:0000:02:00.00');
    expect(docMgmtWifi.assignable).toBe(false);
    expect(docMgmtWifi.vppManaged).toBe(false);

    // Even if someone forcibly assigns the Linux management Wi-Fi, buildInterfaces omits its dev_id
    const built = buildInterfaces(
      [
        {
          ...storedMgmtWifi,
          isAssigned: true,
          type: 'LAN',
          routing: 'NONE',
          pathlabels: [],
          configuration: {}
        },
        {
          ...storedVppWifi,
          isAssigned: true,
          type: 'LAN',
          routing: 'NONE',
          pathlabels: [],
          configuration: {}
        }
      ],
      { helloInterval: 10, deadInterval: 40 },
      '6.2.0'
    );

    expect(built.map((b) => b.dev_id)).not.toContain('pci:0000:02:00.00');
    expect(built.map((b) => b.dev_id)).toContain('pci:0000:03:00.00');
  });

  test('repeated refresh with an identical report is idempotent and performs zero DB writes on the second call', async () => {
    const orgId = new mongoose.Types.ObjectId();
    const accountId = new mongoose.Types.ObjectId();
    const deviceId = new mongoose.Types.ObjectId();
    const existing = [
      makeStoredInterface({
        name: 'eth0',
        devId: 'pci:0000:00:03.00',
        MAC: '52:54:00:aa:bb:01',
        isAssigned: true,
        type: 'WAN'
      })
    ];

    const model = makeMockDeviceModel({
      _id: deviceId,
      org: orgId,
      account: accountId,
      __v: 0,
      interfaces: existing
    });

    const report = [
      {
        name: 'eth0',
        devId: 'pci:0000:00:03.00',
        driver: 'igb',
        MAC: '52:54:00:aa:bb:01',
        link: 'up',
        IPv4: '192.0.2.10',
        IPv4Mask: '24',
        IPv6: '',
        IPv6Mask: '',
        gateway: '192.0.2.1',
        metric: '0',
        mtu: 1500,
        dhcp: 'no',
        internetAccess: true,
        deviceType: 'dpdk'
      },
      {
        name: 'eth1',
        devId: 'pci:0000:00:04.00',
        driver: 'igb',
        MAC: '52:54:00:aa:bb:02',
        link: 'down',
        IPv4: '',
        IPv4Mask: '',
        IPv6: '',
        IPv6Mask: '',
        gateway: '',
        metric: '',
        mtu: 1500,
        dhcp: 'no',
        deviceType: 'dpdk'
      }
    ];

    const first = await applyInterfaceInventory({
      deviceModel: model,
      deviceId,
      org: orgId,
      account: accountId,
      reportedInterfaces: report
    });

    expect(first.wrote).toBe(true);
    expect(first.interfaces).toHaveLength(2);
    expect(model.findOneAndUpdate).toHaveBeenCalledTimes(1);

    const second = await applyInterfaceInventory({
      deviceModel: model,
      deviceId,
      org: orgId,
      account: accountId,
      reportedInterfaces: report
    });

    expect(second.wrote).toBe(false);
    expect(second.interfaces).toHaveLength(2);
    expect(second.interfaces[0].isAssigned).toBe(true);
    expect(second.interfaces[1].isAssigned).toBe(false);
    // Zero DB writes on the second call
    expect(model.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  test('dedupes repeated devIds/MACs, drops invalid devIds, preserves existing valid devId when report omits it, and keeps VLANs sharing parent MAC', () => {
    const existing = [
      makeStoredInterface({
        name: 'eth0',
        devId: 'pci:0000:00:03.00',
        MAC: '52:54:00:10:20:30',
        isAssigned: false,
        linkStatus: 'down',
        IPv4: ''
      }),
      makeStoredInterface({
        name: 'eth1',
        devId: '',
        MAC: '52:54:00:10:20:31',
        isAssigned: true,
        type: 'LAN'
      })
    ];

    const reported = [
      // Report omits devId for eth0, matched via case-insensitive MAC -> existing valid devId must survive
      {
        name: 'eth0',
        devId: '',
        driver: 'igb',
        MAC: '52:54:00:10:20:30',
        link: 'up',
        IPv4: '10.0.0.10',
        IPv4Mask: '24',
        gateway: '',
        metric: '',
        mtu: 1500,
        dhcp: 'no',
        deviceType: 'dpdk'
      },
      // Report recovers lost devId on eth1 via MAC match
      {
        name: 'eth1',
        devId: 'pci:0000:00:04.00',
        driver: 'igb',
        MAC: '52:54:00:10:20:31',
        link: 'up',
        IPv4: '10.0.1.1',
        IPv4Mask: '24',
        gateway: '',
        metric: '',
        mtu: 1500,
        dhcp: 'no',
        deviceType: 'dpdk'
      },
      // Invalid devId with unknown MAC -> dropped
      {
        name: 'bogus0',
        devId: 'not-a-valid-devid',
        driver: 'igb',
        MAC: '52:54:00:99:99:99',
        link: 'up',
        IPv4: '10.9.9.9',
        IPv4Mask: '24',
        deviceType: 'dpdk'
      },
      // Duplicate devId entries (first less informative, second latest/more informative)
      {
        name: 'eth2',
        devId: 'pci:0000:00:05.00',
        driver: 'igb',
        MAC: '52:54:00:10:20:32',
        link: 'down',
        IPv4: '',
        deviceType: 'dpdk'
      },
      {
        name: 'eth2',
        devId: 'pci:0000:00:05.00',
        driver: 'igb',
        MAC: '52:54:00:10:20:32',
        link: 'up',
        IPv4: '10.0.2.5',
        IPv4Mask: '24',
        deviceType: 'dpdk'
      },
      // VLAN sub-interface sharing eth0's MAC must NOT be collapsed with eth0
      {
        name: 'eth0.10',
        devId: 'vlan.10.pci:0000:00:03.00',
        driver: 'igb',
        MAC: '52:54:00:10:20:30',
        link: 'up',
        IPv4: '10.10.10.1',
        IPv4Mask: '24',
        deviceType: 'dpdk'
      }
    ];

    const result = mergeInterfaceInventory(existing, reported);
    const { interfaces, recoveredDevIds, droppedReported } = result;

    // 2 existing + eth2 (deduped) + eth0.10 VLAN = 4 total; bogus0 dropped
    expect(interfaces).toHaveLength(4);
    expect(droppedReported.map((d) => d.name)).toEqual(['bogus0']);

    const eth0 = interfaces.find((i) => i.name === 'eth0');
    expect(eth0.devId).toBe('pci:0000:00:03.00');
    expect(eth0.linkStatus).toBe('up');
    expect(eth0.IPv4).toBe('10.0.0.10');

    const eth1 = interfaces.find((i) => i.name === 'eth1');
    expect(eth1.devId).toBe('pci:0000:00:04.00');
    expect(recoveredDevIds).toHaveLength(1);
    expect(recoveredDevIds[0].devId).toBe('pci:0000:00:04.00');

    const eth2 = interfaces.find((i) => i.devId === 'pci:0000:00:05.00');
    expect(eth2.linkStatus).toBe('up');
    expect(eth2.IPv4).toBe('10.0.2.5');

    const vlan10 = interfaces.find((i) => i.devId === 'vlan.10.pci:0000:00:03.00');
    expect(vlan10.vlanTag).toBe('10');
    expect(vlan10.parentDevId).toBe('pci:0000:00:03.00');

    // No duplicate devIds in stored result
    const devIds = interfaces.map((i) => i.devId);
    expect(new Set(devIds).size).toBe(devIds.length);
  });

  test('enforces org/account tenant scoping on reads and writes and rejects cross-org updates', async () => {
    const orgA = new mongoose.Types.ObjectId();
    const orgB = new mongoose.Types.ObjectId();
    const accountA = new mongoose.Types.ObjectId();
    const deviceId = new mongoose.Types.ObjectId();

    const model = makeMockDeviceModel({
      _id: deviceId,
      org: orgA,
      account: accountA,
      __v: 1,
      interfaces: [makeStoredInterface({ devId: 'pci:0000:00:03.00', MAC: '52:54:00:aa:bb:01' })]
    });

    // Wrong org must fail with DEVICE_NOT_FOUND and perform zero writes
    await expect(applyInterfaceInventory({
      deviceModel: model,
      deviceId,
      org: orgB,
      account: accountA,
      reportedInterfaces: [{ name: 'eth1', devId: 'pci:0000:00:04.00', driver: 'igb', link: 'down', IPv4: '' }]
    })).rejects.toMatchObject({ code: 'DEVICE_NOT_FOUND' });
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();

    // Missing org must throw immediately
    await expect(applyInterfaceInventory({
      deviceModel: model,
      deviceId,
      org: null,
      reportedInterfaces: []
    })).rejects.toThrow(/org is required/i);

    // Matching org+account writes with org, account, and __v in filter
    await applyInterfaceInventory({
      deviceModel: model,
      deviceId,
      org: orgA,
      account: accountA,
      reportedInterfaces: [
        { name: 'eth0', devId: 'pci:0000:00:03.00', driver: 'igb', MAC: '52:54:00:aa:bb:01', link: 'up', IPv4: '192.0.2.10', IPv4Mask: '24', gateway: '192.0.2.1', metric: '0', mtu: 1500, dhcp: 'no', internetAccess: true, deviceType: 'dpdk' },
        { name: 'eth1', devId: 'pci:0000:00:04.00', driver: 'igb', MAC: '52:54:00:aa:bb:02', link: 'down', IPv4: '', IPv4Mask: '', gateway: '', metric: '', mtu: 1500, dhcp: 'no', deviceType: 'dpdk' }
      ]
    });

    expect(model.findOneCalls[1]).toEqual({ _id: deviceId, org: orgA, account: accountA });
    expect(model.findOneAndUpdateCalls[0].filter).toEqual({
      _id: deviceId,
      org: orgA,
      account: accountA,
      __v: 1
    });
    expect(model.findOneAndUpdateCalls[0].update.$inc).toEqual({ __v: 1 });
  });

  test('retries on optimistic concurrency conflict and preserves concurrent assignment edits', async () => {
    const orgId = new mongoose.Types.ObjectId();
    const accountId = new mongoose.Types.ObjectId();
    const deviceId = new mongoose.Types.ObjectId();
    const concurrentLabel = new mongoose.Types.ObjectId();

    const eth0 = makeStoredInterface({
      name: 'eth0',
      devId: 'pci:0000:00:03.00',
      MAC: '52:54:00:aa:bb:01',
      isAssigned: false,
      type: 'LAN',
      pathlabels: []
    });

    const model = makeMockDeviceModel({
      _id: deviceId,
      org: orgId,
      account: accountId,
      __v: 2,
      interfaces: [eth0]
    });

    // Inject a concurrent user edit right after the first findOne, bumping __v to 3
    const origFindOne = model.findOne;
    let simulatedConflict = false;
    model.findOne = jest.fn(async (filter) => {
      const snapshot = await origFindOne(filter);
      if (!simulatedConflict) {
        simulatedConflict = true;
        const current = model.getDoc();
        model.setDoc({
          ...current,
          __v: 3,
          interfaces: current.interfaces.map((i) => ({
            ...i,
            isAssigned: true,
            type: 'WAN',
            pathlabels: [concurrentLabel]
          }))
        });
      }
      return snapshot;
    });

    const result = await applyInterfaceInventory({
      deviceModel: model,
      deviceId,
      org: orgId,
      account: accountId,
      reportedInterfaces: [
        {
          name: 'eth0',
          devId: 'pci:0000:00:03.00',
          driver: 'igb',
          MAC: '52:54:00:aa:bb:01',
          link: 'up',
          IPv4: '192.0.2.10',
          IPv4Mask: '24',
          gateway: '192.0.2.1',
          metric: '0',
          mtu: 1500,
          dhcp: 'no',
          internetAccess: true,
          deviceType: 'dpdk'
        },
        {
          name: 'eth1',
          devId: 'pci:0000:00:04.00',
          driver: 'igb',
          MAC: '52:54:00:aa:bb:02',
          link: 'down',
          IPv4: '',
          IPv4Mask: '',
          gateway: '',
          metric: '',
          mtu: 1500,
          dhcp: 'no',
          deviceType: 'dpdk'
        }
      ]
    });

    expect(result.wrote).toBe(true);
    expect(result.attempts).toBe(2);
    expect(model.findOneAndUpdateCalls).toHaveLength(2);
    // Attempt 1 tried stale __v: 2 and conflicted; attempt 2 succeeded on __v: 3
    expect(model.findOneAndUpdateCalls[0].filter.__v).toBe(2);
    expect(model.findOneAndUpdateCalls[1].filter.__v).toBe(3);

    // Final stored state preserves the concurrent assignment edit AND includes new eth1
    const finalDoc = model.getDoc();
    expect(finalDoc.__v).toBe(4);
    expect(finalDoc.interfaces).toHaveLength(2);
    expect(finalDoc.interfaces[0].isAssigned).toBe(true);
    expect(finalDoc.interfaces[0].type).toBe('WAN');
    expect(finalDoc.interfaces[0].pathlabels).toEqual([concurrentLabel]);
    expect(finalDoc.interfaces[1].devId).toBe('pci:0000:00:04.00');
    expect(finalDoc.interfaces[1].isAssigned).toBe(false);
    expect(finalDoc.interfaces[1].locked).toBe(true);
  });

  test('stops after bounded retries when version conflicts persist', async () => {
    const orgId = new mongoose.Types.ObjectId();
    const deviceId = new mongoose.Types.ObjectId();
    const model = makeMockDeviceModel({
      _id: deviceId,
      org: orgId,
      __v: 5,
      interfaces: [makeStoredInterface({ devId: 'pci:0000:00:03.00', MAC: '52:54:00:aa:bb:01' })]
    });
    model.findOneAndUpdate = jest.fn(async () => null);

    await expect(applyInterfaceInventory({
      deviceModel: model,
      deviceId,
      org: orgId,
      reportedInterfaces: [
        { name: 'eth1', devId: 'pci:0000:00:04.00', driver: 'igb', link: 'down', IPv4: '' }
      ],
      maxRetries: 2
    })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });

    expect(model.findOneAndUpdate).toHaveBeenCalledTimes(3);
  });

  test('normalizeRegistrationInterfaces preserves VLAN, WAN/LAN/auto-metric derivation, down PCI ports, and Linux management Wi-Fi flags', () => {
    const { interfaces, dropped } = normalizeRegistrationInterfaces([
      {
        name: 'eth0',
        devId: 'pci:0000:00:03.00',
        driver: 'igb',
        MAC: '52:54:00:aa:bb:01',
        link: 'up',
        IPv4: '192.0.2.10',
        IPv4Mask: '24',
        gateway: '192.0.2.1',
        metric: '',
        mtu: '1500',
        dhcp: 'no',
        internetAccess: true,
        deviceType: 'dpdk'
      },
      {
        name: 'eth0.20',
        devId: 'vlan.20.pci:0000:00:03.00',
        driver: 'igb',
        MAC: '52:54:00:aa:bb:01',
        link: 'up',
        IPv4: '10.20.0.1',
        IPv4Mask: '24',
        gateway: '',
        metric: '',
        mtu: 1500,
        dhcp: 'no',
        deviceType: 'dpdk'
      },
      {
        name: 'eth1',
        devId: 'pci:0000:00:04.00',
        driver: 'igb',
        MAC: '52:54:00:aa:bb:02',
        link: 'down',
        IPv4: '',
        IPv4Mask: '',
        gateway: '',
        metric: '',
        dhcp: 'no',
        deviceType: 'dpdk'
      },
      {
        name: 'wlp1s0',
        devId: 'pci:0000:01:00.00',
        driver: 'iwlwifi',
        MAC: '52:54:00:aa:bb:03',
        link: 'up',
        IPv4: '192.168.1.50',
        IPv4Mask: '24',
        gateway: '',
        metric: '',
        dhcp: 'yes',
        deviceType: 'dpdk'
      },
      {
        name: 'bad0',
        devId: 'invalid-bus',
        driver: 'igb',
        link: 'up',
        IPv4: '10.0.0.1'
      }
    ], {
      sourceIP: '203.0.113.5',
      defaultRoute: '192.0.2.1'
    });

    expect(dropped).toHaveLength(1);
    expect(interfaces).toHaveLength(4);

    const wan = interfaces.find((i) => i.devId === 'pci:0000:00:03.00');
    expect(wan.type).toBe('WAN');
    expect(wan.metric).toBe('0');
    expect(wan.PublicIP).toBe('203.0.113.5');
    expect(wan.locked).toBe(true);
    expect(wan.isAssigned).toBe(false);

    const vlan = interfaces.find((i) => i.devId === 'vlan.20.pci:0000:00:03.00');
    expect(vlan.vlanTag).toBe('20');
    expect(vlan.parentDevId).toBe('pci:0000:00:03.00');
    expect(vlan.type).toBe('LAN');

    const downPort = interfaces.find((i) => i.devId === 'pci:0000:00:04.00');
    expect(downPort.linkStatus).toBe('down');
    expect(downPort.IPv4).toBe('');
    expect(downPort.assignable).toBe(true);
    expect(downPort.vppManaged).toBe(true);

    const wifi = interfaces.find((i) => i.devId === 'pci:0000:01:00.00');
    expect(wifi.assignable).toBe(false);
    expect(wifi.vppManaged).toBe(false);
  });

  // --- Follow-up regression tests ---

  test('devId identity wins over cloned MAC: two distinct valid devIds sharing one MAC both survive registration and refresh', () => {
    const sharedMac = '52:54:00:de:ad:01';
    const regReport = [
      {
        name: 'eth0',
        devId: 'pci:0000:00:03.00',
        driver: 'igb',
        MAC: sharedMac,
        link: 'up',
        IPv4: '192.0.2.10',
        IPv4Mask: '24',
        gateway: '192.0.2.1',
        metric: '0',
        mtu: 1500,
        dhcp: 'no',
        deviceType: 'dpdk'
      },
      {
        name: 'eth1',
        devId: 'pci:0000:00:04.00',
        driver: 'igb',
        MAC: sharedMac,
        link: 'up',
        IPv4: '10.0.1.10',
        IPv4Mask: '24',
        gateway: '',
        metric: '',
        mtu: 1500,
        dhcp: 'no',
        deviceType: 'dpdk'
      }
    ];

    const regResult = normalizeRegistrationInterfaces(regReport, {
      sourceIP: '198.51.100.1',
      defaultRoute: '192.0.2.1'
    });
    expect(regResult.interfaces).toHaveLength(2);
    expect(regResult.interfaces.map((i) => i.devId)).toEqual([
      'pci:0000:00:03.00',
      'pci:0000:00:04.00'
    ]);

    // On refresh: existing has port 03.00 only; report arrives with port 04.00 having the same cloned MAC.
    // Pass 2 must NOT merge port 04.00 into stored port 03.00; both must survive with their own volatile data.
    const existingSingle = [
      makeStoredInterface({
        name: 'eth0',
        devId: 'pci:0000:00:03.00',
        MAC: sharedMac,
        IPv4: '192.0.2.10',
        linkStatus: 'up',
        isAssigned: true
      })
    ];
    const refreshResult = mergeInterfaceInventory(existingSingle, [
      {
        name: 'eth1',
        devId: 'pci:0000:00:04.00',
        driver: 'igb',
        MAC: sharedMac,
        link: 'down',
        IPv4: '',
        IPv4Mask: '',
        gateway: '',
        metric: '',
        mtu: 1500,
        dhcp: 'no',
        deviceType: 'dpdk'
      }
    ]);

    expect(refreshResult.interfaces).toHaveLength(2);
    const port03 = refreshResult.interfaces.find((i) => i.devId === 'pci:0000:00:03.00');
    const port04 = refreshResult.interfaces.find((i) => i.devId === 'pci:0000:00:04.00');
    expect(port03.IPv4).toBe('192.0.2.10');
    expect(port03.linkStatus).toBe('up');
    expect(port04.IPv4).toBe('');
    expect(port04.linkStatus).toBe('down');
    expect(port04.isAssigned).toBe(false);
  });

  test('missing VLAN sub-interfaces from a non-empty report are unlocked when assigned and omitted when unassigned, while physical ports are preserved', () => {
    const existing = [
      makeStoredInterface({
        name: 'eth0',
        devId: 'pci:0000:00:03.00',
        MAC: '52:54:00:11:22:01',
        isAssigned: true,
        locked: true
      }),
      makeStoredInterface({
        name: 'eth1',
        devId: 'pci:0000:00:04.00',
        MAC: '52:54:00:11:22:02',
        isAssigned: false,
        locked: true
      }),
      makeStoredInterface({
        name: 'eth0.10',
        devId: 'vlan.10.pci:0000:00:03.00',
        parentDevId: 'pci:0000:00:03.00',
        vlanTag: '10',
        MAC: '52:54:00:11:22:01',
        isAssigned: true,
        locked: true
      }),
      makeStoredInterface({
        name: 'eth0.20',
        devId: 'vlan.20.pci:0000:00:03.00',
        parentDevId: 'pci:0000:00:03.00',
        vlanTag: '20',
        MAC: '52:54:00:11:22:01',
        isAssigned: false,
        locked: true
      })
    ];

    // Non-empty report contains only eth0 (omits eth1, eth0.10, eth0.20)
    const { interfaces, removedVlans } = mergeInterfaceInventory(existing, [
      {
        name: 'eth0',
        devId: 'pci:0000:00:03.00',
        driver: 'igb',
        MAC: '52:54:00:11:22:01',
        link: 'up',
        IPv4: '192.0.2.10',
        IPv4Mask: '24',
        gateway: '192.0.2.1',
        metric: '0',
        mtu: 1500,
        dhcp: 'no',
        internetAccess: true,
        deviceType: 'dpdk'
      }
    ]);

    // eth0 + eth1 (physical preserved) + eth0.10 (assigned VLAN unlocked); eth0.20 omitted
    expect(interfaces).toHaveLength(3);
    expect(removedVlans.map((v) => v.devId)).toEqual(['vlan.20.pci:0000:00:03.00']);
    const assignedVlan = interfaces.find((i) => i.devId === 'vlan.10.pci:0000:00:03.00');
    expect(assignedVlan).toBeDefined();
    expect(assignedVlan.locked).toBe(false);
    expect(assignedVlan.isAssigned).toBe(true);
    expect(interfaces.find((i) => i.devId === 'vlan.20.pci:0000:00:03.00')).toBeUndefined();
    const missingPhysical = interfaces.find((i) => i.devId === 'pci:0000:00:04.00');
    expect(missingPhysical).toBeDefined();
    expect(missingPhysical.locked).toBe(true);

    // Empty report must NOT drop or unlock VLANs
    const emptyRes = mergeInterfaceInventory(existing, []);
    expect(emptyRes.interfaces).toHaveLength(4);
    expect(emptyRes.interfaces.find((i) => i.devId === 'vlan.10.pci:0000:00:03.00').locked).toBe(true);
  });

  test('idempotent refresh preserves generated WAN metric when omitted and normalizes numeric STUN PublicPort/metric with zero DB writes', async () => {
    const orgId = new mongoose.Types.ObjectId();
    const deviceId = new mongoose.Types.ObjectId();

    const model = makeMockDeviceModel({
      _id: deviceId,
      org: orgId,
      __v: 0,
      interfaces: [
        makeStoredInterface({
          name: 'eth0',
          devId: 'pci:0000:00:03.00',
          MAC: '52:54:00:aa:bb:01',
          isAssigned: false,
          type: 'WAN',
          gateway: '192.0.2.1',
          metric: '100',
          PublicPort: '4789',
          useStun: true,
          internetAccess: 'yes',
          linkStatus: 'up'
        })
      ]
    });

    // Agent sends numeric public_port (4789) and omits metric (''), matching stored '4789' and generated '100'
    const identicalReport = [
      {
        name: 'eth0',
        devId: 'pci:0000:00:03.00',
        driver: 'igb',
        MAC: '52:54:00:aa:bb:01',
        link: 'up',
        IPv4: '192.0.2.10',
        IPv4Mask: '24',
        IPv6: '',
        IPv6Mask: '',
        gateway: '192.0.2.1',
        metric: '',
        mtu: '1500',
        dhcp: 'no',
        public_ip: '198.51.100.10',
        public_port: 4789,
        nat_type: 'Full Cone',
        internetAccess: true,
        deviceType: 'dpdk'
      }
    ];

    const res = await applyInterfaceInventory({
      deviceModel: model,
      deviceId,
      org: orgId,
      reportedInterfaces: identicalReport
    });

    expect(res.wrote).toBe(false);
    expect(res.interfaces[0].metric).toBe('100');
    expect(res.interfaces[0].PublicPort).toBe('4789');
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('partial refresh omitting deviceType does not disable a healthy flexiWAN Wi-Fi AP, while explicit host-managed evidence reclassifies it', () => {
    const existingAp = makeStoredInterface({
      name: 'wlan0',
      devId: 'pci:0000:03:00.00',
      driver: 'ath10k_pci',
      MAC: 'aa:bb:cc:dd:ee:20',
      deviceType: 'wifi',
      type: 'LAN',
      isAssigned: true,
      assignable: true,
      vppManaged: true
    });

    // Partial report carries wlan0/ath10k_pci but omits deviceType and ownership flags
    const partialRes = mergeInterfaceInventory([existingAp], [
      {
        name: 'wlan0',
        devId: 'pci:0000:03:00.00',
        driver: 'ath10k_pci',
        MAC: 'aa:bb:cc:dd:ee:20',
        link: 'up',
        IPv4: '10.20.0.1',
        IPv4Mask: '24'
      }
    ]);

    expect(partialRes.interfaces[0].assignable).toBe(true);
    expect(partialRes.interfaces[0].vppManaged).toBe(true);
    expect(isLinuxManagementWifi({ name: 'wlan0', driver: 'ath10k_pci' }, existingAp)).toBe(false);

    // Explicit host-management evidence DOES reclassify it
    const explicitRes = mergeInterfaceInventory([existingAp], [
      {
        name: 'wlan0',
        devId: 'pci:0000:03:00.00',
        driver: 'ath10k_pci',
        MAC: 'aa:bb:cc:dd:ee:20',
        link: 'up',
        managedBy: 'linux'
      }
    ]);
    expect(explicitRes.interfaces[0].assignable).toBe(false);
    expect(explicitRes.interfaces[0].vppManaged).toBe(false);
  });

  test('modifyDevice ignores newly appended unassigned inventory rows (no remove-interface) while still emitting remove-interface for real unassignments', async () => {
    const addJobMock = jest.fn(async () => ({ id: 'job-1' }));
    const setPendingMock = jest.fn(async () => ({}));
    const makeEmptyQuery = () => {
      const q = {
        populate: () => q,
        lean: async () => [],
        then: (resolve, reject) => Promise.resolve([]).then(resolve, reject)
      };
      return q;
    };
    const tunnelsFindMock = jest.fn(() => makeEmptyQuery());
    const vrrpFindMock = jest.fn(() => makeEmptyQuery());

    const modifyDevice = loadIsolatedWithMocks({
      '../../utils/deviceQueue': () => () => ({ addJob: addJobMock }),
      '../../models/devices': () => ({
        devices: { findOneAndUpdate: setPendingMock, updateOne: setPendingMock }
      }),
      '../../models/tunnels': () => ({ find: tunnelsFindMock }),
      '../../models/vrrp': () => ({ find: vrrpFindMock })
    }, () => require('../modifyDevice'));

    const orgId = new mongoose.Types.ObjectId();
    const deviceId = new mongoose.Types.ObjectId();
    const eth0Id = new mongoose.Types.ObjectId();
    const newPortId = new mongoose.Types.ObjectId();

    const makeDeviceDoc = (ifcs) => {
      const doc = {
        _id: deviceId,
        org: orgId,
        machineId: 'mach-mod-1',
        hostname: 'edge-mod-1',
        versions: { agent: '6.2.0', router: '6.2.0', device: '6.2.0' },
        ospf: { routerId: '', helloInterval: 10, deadInterval: 40, redistributeBgp: true, custom: '' },
        bgp: { enable: false, neighbors: [], redistributeOspf: true, custom: '' },
        advancedRouting: { custom: '' },
        routingFilters: [],
        staticroutes: [],
        dhcp: [],
        deviceSpecificRulesEnabled: true,
        firewall: {
          rules: Object.assign([], { toObject: () => [] })
        },
        policies: {
          firewall: { policy: null },
          qos: { policy: null }
        },
        interfaces: ifcs,
        populate: jest.fn(async () => doc),
        toObject: () => ({ ...doc, firewall: { rules: [] } })
      };
      return doc;
    };

    const eth0 = makeStoredInterface({
      _id: eth0Id,
      name: 'eth0',
      devId: 'pci:0000:00:03.00',
      isAssigned: true,
      type: 'WAN',
      ospf: { area: '0', keyId: '', key: '', cost: null },
      bandwidthMbps: { tx: 100, rx: 100 },
      dnsServers: ['8.8.8.8'],
      dnsDomains: [],
      useDhcpDnsServers: true
    });
    const newlyDiscovered = makeStoredInterface({
      _id: newPortId,
      name: 'eth1',
      devId: 'pci:0000:00:04.00',
      isAssigned: false,
      type: 'LAN',
      IPv4: '',
      IPv4Mask: '',
      gateway: '',
      metric: '',
      ospf: { area: '0', keyId: '', key: '', cost: null },
      bandwidthMbps: { tx: 100, rx: 100 },
      dnsServers: ['8.8.8.8'],
      dnsDomains: [],
      useDhcpDnsServers: true
    });

    // Case 1: New inventory-only port appended with isAssigned:false -> NO modify job / NO remove-interface
    const res1 = await modifyDevice.apply(
      [makeDeviceDoc([eth0])],
      { username: 'system' },
      { org: orgId.toString(), newDevice: makeDeviceDoc([eth0, newlyDiscovered]) }
    );
    expect(res1.ids).toEqual([]);
    expect(addJobMock).not.toHaveBeenCalled();

    // Case 2: Pre-existing assigned interface transitions true -> false -> MUST emit remove-interface
    const eth0Unassigned = { ...eth0, isAssigned: false };
    const res2 = await modifyDevice.apply(
      [makeDeviceDoc([eth0])],
      { username: 'admin' },
      { org: orgId.toString(), newDevice: makeDeviceDoc([eth0Unassigned]) }
    );
    expect(res2.ids).toEqual(['job-1']);
    expect(addJobMock).toHaveBeenCalledTimes(1);
    const queuedTasks = addJobMock.mock.calls[0][3].tasks;
    expect(queuedTasks.some((t) => t.message === 'remove-interface' && t.params.dev_id === 'pci:0000:00:03.00')).toBe(true);
  });

  test('Events.analyze pairs by stable _id when an assigned interface recovers its missing devId via MAC', async () => {
    const sendNotificationsMock = jest.fn(async () => {});
    const EventsClass = loadIsolatedWithMocks({
      '../../notifications/notifications': () => () => ({
        sendNotifications: sendNotificationsMock
      }),
      '../../models/tunnels': () => ({
        find: jest.fn(() => ({
          populate: () => ({ populate: () => ({ lean: async () => [] }) })
        }))
      }),
      '../modifyDevice': () => ({ apply: jest.fn() })
    }, () => require('../events'));

    const orgId = new mongoose.Types.ObjectId();
    const deviceId = new mongoose.Types.ObjectId();
    const ifcId = new mongoose.Types.ObjectId();

    const origIfc = makeStoredInterface({
      _id: ifcId,
      name: 'eth0',
      devId: '',
      MAC: '52:54:00:10:20:30',
      isAssigned: true,
      type: 'WAN',
      monitorInternet: true,
      internetAccess: 'no',
      IPv4: '192.0.2.10',
      IPv4Mask: '24',
      PublicPort: '4789',
      hasIpOnDevice: true
    });

    const { interfaces: merged } = mergeInterfaceInventory([origIfc], [
      {
        name: 'eth0',
        devId: 'pci:0000:00:04.00',
        driver: 'igb',
        MAC: '52:54:00:10:20:30',
        link: 'up',
        IPv4: '192.0.2.10',
        IPv4Mask: '24',
        gateway: '192.0.2.1',
        metric: '0',
        mtu: 1500,
        dhcp: 'no',
        internetAccess: true,
        deviceType: 'dpdk'
      }
    ]);

    expect(merged[0].devId).toBe('pci:0000:00:04.00');

    const events = new EventsClass();
    const origDevice = {
      _id: deviceId,
      org: orgId,
      name: 'edge-mac-recovery',
      versions: { agent: '6.2.0' },
      staticroutes: [],
      interfaces: [origIfc]
    };

    await expect(events.analyze(origDevice, merged)).resolves.toBeUndefined();
    // Connectivity transitioned from 'no' -> 'yes', confirming pairing succeeded across devId recovery
    expect(sendNotificationsMock).toHaveBeenCalledTimes(1);
    expect(sendNotificationsMock.mock.calls[0][0][0].eventType).toBe('Internet connection');
  });

  test('DevicesService.devicesIdPUT guards __v with retry (preserving concurrent inventory + assignment) and enforces assignable/vppManaged flags', async () => {
    const orgId = new mongoose.Types.ObjectId();
    const deviceId = new mongoose.Types.ObjectId();
    const eth0Id = new mongoose.Types.ObjectId();
    const wifiId = new mongoose.Types.ObjectId();
    const newlyDiscoveredId = new mongoose.Types.ObjectId();

    const makePutDoc = (base) => {
      const obj = {
        ...base,
        toObject: () => ({ ...base }),
        interfaces: base.interfaces.map((i) => ({ ...i, toObject: () => ({ ...i }) }))
      };
      return obj;
    };

    const makeChainable = (resolver) => {
      const chain = {
        session: () => chain,
        populate: () => chain,
        lean: () => Promise.resolve(resolver()),
        then: (resolve, reject) => Promise.resolve(resolver()).then(resolve, reject)
      };
      return chain;
    };

    let dbState = {
      _id: deviceId,
      org: { _id: orgId, tunnelRange: '10.100.0.0/16' },
      __v: 4,
      name: 'edge-put-test',
      machineId: 'mach-put-1',
      isApproved: true,
      versions: { agent: '6.2.0', router: '6.2.0', device: '6.2.0' },
      cpuInfo: { hwCores: 2, grubCores: 2, vppCores: 1, configuredVppCores: 1, powerSaving: false },
      distro: { version: '22.04', codename: 'jammy' },
      staticroutes: [],
      dhcp: [],
      bgp: { enable: false },
      firewall: { rules: [] },
      policies: { firewall: { toObject: () => ({}) } },
      interfaces: [
        makeStoredInterface({
          _id: eth0Id,
          name: 'eth0',
          devId: 'pci:0000:00:03.00',
          MAC: '52:54:00:aa:bb:01',
          isAssigned: false,
          type: 'WAN',
          dhcp: 'yes',
          ospf: { area: '0', keyId: '', key: '' },
          dnsServers: ['8.8.8.8'],
          dnsDomains: [],
          useDhcpDnsServers: true,
          assignable: true,
          vppManaged: true
        }),
        makeStoredInterface({
          _id: wifiId,
          name: 'wlp2s0',
          devId: 'pci:0000:02:00.00',
          driver: 'iwlwifi',
          MAC: '52:54:00:aa:bb:09',
          isAssigned: false,
          type: 'LAN',
          IPv4: '',
          IPv4Mask: '',
          gateway: '',
          metric: '',
          ospf: { area: '0', keyId: '', key: '' },
          dnsServers: ['8.8.8.8'],
          dnsDomains: [],
          useDhcpDnsServers: true,
          assignable: false,
          vppManaged: false
        })
      ]
    };

    const updateCalls = [];
    let injectConcurrentRefresh = false;

    const findOneMock = jest.fn(() => makeChainable(() => {
      const snapshot = makePutDoc(dbState);
      if (injectConcurrentRefresh) {
        injectConcurrentRefresh = false;
        // Simulate concurrent inventory refresh bumping __v from 4 -> 5 and appending eth1
        dbState = {
          ...dbState,
          __v: 5,
          interfaces: [
            ...dbState.interfaces,
            makeStoredInterface({
              _id: newlyDiscoveredId,
              name: 'eth1',
              devId: 'pci:0000:00:04.00',
              MAC: '52:54:00:aa:bb:02',
              isAssigned: false,
              locked: true,
              type: 'LAN',
              IPv4: '',
              IPv4Mask: '',
              gateway: '',
              metric: '',
              ospf: { area: '0', keyId: '', key: '' },
              dnsServers: ['8.8.8.8'],
              dnsDomains: [],
              useDhcpDnsServers: true,
              assignable: true,
              vppManaged: true
            })
          ]
        };
      }
      return snapshot;
    }));

    const findOneAndUpdateMock = jest.fn((filter, update) => makeChainable(() => {
      updateCalls.push({ filter: { ...filter }, update });
      if (filter.__v !== dbState.__v) {
        return null;
      }
      dbState = {
        ...dbState,
        ...update.$set,
        __v: dbState.__v + (update.$inc?.__v || 0)
      };
      return makePutDoc(dbState);
    }));

    const DevicesService = loadIsolatedWithMocks({
      '../../models/devices': () => ({
        devices: { findOne: findOneMock, findOneAndUpdate: findOneAndUpdateMock },
        staticroutes: {},
        dhcpModel: {}
      }),
      '../../models/tunnels': () => ({ find: () => makeChainable(() => []) }),
      '../../models/pathlabels': () => ({ find: () => makeChainable(() => []) }),
      '../../models/vrrp': () => ({
        aggregate: () => ({ allowDiskUse: async () => [] })
      }),
      '../../websocket/Connections': () => () => ({
        devices: { updateDeviceInfo: jest.fn() },
        deviceDisconnect: jest.fn()
      }),
      '../../periodic/deviceStatus': () => () => ({ getDeviceStatus: () => null }),
      '../../periodic/statusesInDb': () => () => ({}),
      '../../utils/deviceQueue': () => () => ({ addJob: jest.fn() }),
      '../../utils/membershipUtils': () => ({
        getAccessTokenOrgList: async () => [orgId]
      }),
      '../../deviceLogic/dispatcher': () => ({
        apply: jest.fn(async () => ({ ids: [] }))
      }),
      '../../deviceLogic/validators': () => ({
        validateDevice: async () => ({ valid: true }),
        validateDhcpConfig: () => ({ valid: true }),
        validateStaticRoute: () => ({ valid: true }),
        validateQOSPolicy: () => ({ valid: true }),
        isLocalOrBroadcastAddress: () => false
      })
    }, () => require('../../services/DevicesService'));

    DevicesService.setLocationHeader = jest.fn();
    DevicesService.selectDeviceParams = jest.fn(async (d) => d);

    // 5a-1: Reject assigning a stored interface with assignable:false (even if client passes assignable:true)
    const rejectRes = await DevicesService.devicesIdPUT(
      {
        id: deviceId.toString(),
        org: orgId.toString(),
        name: 'edge-put-test',
        interfaces: [
          { ...dbState.interfaces[0] },
          { ...dbState.interfaces[1], isAssigned: true, assignable: true }
        ]
      },
      { user: { username: 'admin' }, server: 'localhost' },
      {}
    ).catch((err) => err);
    expect(rejectRes.code).toBe(400);
    expect(rejectRes.error).toMatch(/not assignable/i);
    expect(findOneAndUpdateMock).not.toHaveBeenCalled();

    // 4a + 5a-2: Concurrent __v conflict triggers retry, preserves newly discovered eth1,
    // preserves the user's assignment on eth0, AND preserves assignable:false/vppManaged:false
    // on wlp2s0 even when those fields are omitted from the PUT payload.
    injectConcurrentRefresh = true;
    const wifiPayloadWithoutFlags = { ...dbState.interfaces[1] };
    delete wifiPayloadWithoutFlags.assignable;
    delete wifiPayloadWithoutFlags.vppManaged;

    const okRes = await DevicesService.devicesIdPUT(
      {
        id: deviceId.toString(),
        org: orgId.toString(),
        name: 'edge-put-test',
        interfaces: [
          { ...dbState.interfaces[0], isAssigned: true, type: 'WAN' },
          wifiPayloadWithoutFlags
        ]
      },
      { user: { username: 'admin' }, server: 'localhost' },
      {}
    );

    expect(okRes.code).toBe(200);
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[0].filter.__v).toBe(4);
    expect(updateCalls[1].filter.__v).toBe(5);
    expect(updateCalls[1].update.$inc).toEqual({ __v: 1 });
    expect(dbState.__v).toBe(6);

    // All 3 interfaces present: assigned eth0, preserved unassignable wlp2s0, and concurrently added eth1
    expect(dbState.interfaces).toHaveLength(3);
    const savedEth0 = dbState.interfaces.find((i) => i.devId === 'pci:0000:00:03.00');
    const savedWifi = dbState.interfaces.find((i) => i.devId === 'pci:0000:02:00.00');
    const savedEth1 = dbState.interfaces.find((i) => i.devId === 'pci:0000:00:04.00');
    expect(savedEth0.isAssigned).toBe(true);
    expect(savedWifi.assignable).toBe(false);
    expect(savedWifi.vppManaged).toBe(false);
    expect(savedEth1).toBeDefined();
    expect(savedEth1.isAssigned).toBe(false);
  });

  test('wired entry point: connect.js POST /register routes reported interfaces through normalizeRegistrationInterfaces', async () => {
    const jwt = require('jsonwebtoken');
    const configs = require('../../configs')();

    const orgId = new mongoose.Types.ObjectId().toString();
    const accountId = new mongoose.Types.ObjectId().toString();
    const createdDeviceId = new mongoose.Types.ObjectId();

    const devicesCreateMock = jest.fn(async (docs) => [{
      ...docs[0],
      _id: createdDeviceId
    }]);
    let normalizeSpy;
    const prevStartSession = mongoConnsApi._main.startSession;
    mongoConnsApi._main.startSession = jest.fn(async () => ({
      startTransaction: async () => {},
      commitTransaction: async () => {},
      abortTransaction: async () => {}
    }));

    const { connectRouter } = loadIsolatedWithMocks({
      '../../models/tokens': () => ({
        find: jest.fn(async () => [{ name: 'reg-token' }])
      }),
      '../../models/devices': () => ({
        devices: {
          countDocuments: () => ({ session: async () => 0 }),
          create: devicesCreateMock
        }
      }),
      '../../flexibilling': () => ({
        getMaxDevicesAllowed: async () => 10,
        registerDevice: async () => {}
      }),
      '../../utils/webhooks': () => () => ({
        sendToWebHook: async () => true
      }),
      '../../utils/httpUtils': () => ({
        getAgentBroker: (srv) => srv || 'manage.test:3443'
      }),
      'geoip-lite': () => ({
        lookup: () => null
      }),
      '../../deviceLogic/DevSwVersionUpdateManager': () => ({
        getSwVerUpdaterInstance: () => ({
          getLatestSwVersions: async () => ({ versions: { device: '6.2.0' } })
        })
      })
    }, () => {
      const realInventory = require('../interfaceInventory');
      normalizeSpy = jest.spyOn(realInventory, 'normalizeRegistrationInterfaces');
      return require('../../routes/connect');
    });

    const registerLayer = connectRouter.stack.find((l) => l.route && l.route.path === '/register');
    const registerHandler = registerLayer.route.stack[registerLayer.route.stack.length - 1].handle;

    const token = jwt.sign(
      { org: orgId, account: accountId, server: 'manage.test' },
      configs.get('deviceTokenSecretKey')
    );

    const rawInterfaces = [
      {
        name: 'eth0',
        devId: 'pci:0000:00:03.00',
        driver: 'igb',
        MAC: '52:54:00:aa:bb:01',
        link: 'down',
        IPv4: '',
        IPv4Mask: '',
        gateway: '',
        metric: '',
        mtu: 1500,
        dhcp: 'no',
        deviceType: 'dpdk'
      },
      {
        name: 'wlp2s0',
        devId: 'pci:0000:02:00.00',
        driver: 'iwlwifi',
        MAC: '52:54:00:aa:bb:09',
        link: 'up',
        IPv4: '192.168.1.50',
        IPv4Mask: '24',
        gateway: '',
        metric: '',
        mtu: 1500,
        dhcp: 'yes',
        deviceType: 'dpdk'
      }
    ];

    try {
      await new Promise((resolve, reject) => {
        const req = {
          ip: '203.0.113.10',
          body: {
            token,
            machine_id: '11111111-2222-3333-4444-555555555555',
            machine_name: 'edge-reg-wire',
            fwagent_version: '6.2.0',
            interfaces: JSON.stringify(rawInterfaces)
          }
        };
        const res = {
          statusCode: 0,
          setHeader: jest.fn(),
          json: jest.fn(() => resolve())
        };
        registerHandler(req, res, (err) => reject(err || new Error('Unexpected next()')));
      });
    } finally {
      mongoConnsApi._main.startSession = prevStartSession;
    }

    expect(normalizeSpy).toHaveBeenCalledTimes(1);
    expect(normalizeSpy).toHaveBeenCalledWith(rawInterfaces, expect.objectContaining({
      sourceIP: '203.0.113.10'
    }));
    expect(devicesCreateMock).toHaveBeenCalledTimes(1);
    const createdDoc = devicesCreateMock.mock.calls[0][0][0];
    expect(createdDoc.org).toBe(orgId);
    expect(createdDoc.account).toBe(accountId);
    expect(createdDoc.interfaces).toHaveLength(2);
    expect(createdDoc.interfaces.find((i) => i.devId === 'pci:0000:00:03.00').locked).toBe(true);
    expect(createdDoc.interfaces.find((i) => i.devId === 'pci:0000:02:00.00').vppManaged).toBe(false);
  });

  test('wired entry point: Connections.reconfigCheck uses applyInterfaceInventory with org scoping and dispatches no remove-interface task for a newly discovered port', async () => {
    const orgId = new mongoose.Types.ObjectId();
    const accountId = new mongoose.Types.ObjectId();
    const deviceId = new mongoose.Types.ObjectId();
    const eth0Id = new mongoose.Types.ObjectId();

    const eth0 = makeStoredInterface({
      _id: eth0Id,
      name: 'eth0',
      devId: 'pci:0000:00:03.00',
      MAC: '52:54:00:aa:bb:01',
      isAssigned: true,
      type: 'WAN',
      ospf: { area: '0', keyId: '', key: '', cost: null },
      bandwidthMbps: { tx: 100, rx: 100 },
      dnsServers: ['8.8.8.8'],
      dnsDomains: [],
      useDhcpDnsServers: true
    });

    const mockDeviceModel = makeMockDeviceModel({
      _id: deviceId,
      org: orgId,
      account: accountId,
      machineId: 'mach-reconfig-1',
      name: 'edge-reconfig',
      hostname: 'edge-reconfig',
      __v: 0,
      versions: { agent: '6.2.0', router: '6.2.0', device: '6.2.0' },
      ospf: { routerId: '', helloInterval: 10, deadInterval: 40, redistributeBgp: true, custom: '' },
      bgp: { enable: false, neighbors: [], redistributeOspf: true, custom: '' },
      advancedRouting: { custom: '' },
      routingFilters: [],
      staticroutes: [],
      dhcp: [],
      deviceSpecificRulesEnabled: true,
      firewall: { rules: Object.assign([], { toObject: () => [] }) },
      policies: { firewall: { policy: null }, qos: { policy: null } },
      interfaces: [eth0]
    });

    const addJobMock = jest.fn(async () => ({ id: 'job-reconfig' }));
    const wrapDocLike = (raw) => {
      if (!raw) return null;
      const doc = {
        ...raw,
        firewall: { rules: Object.assign([], { toObject: () => [] }) },
        populate: jest.fn(async () => doc),
        toObject: () => ({ ...raw, firewall: { rules: [] } })
      };
      return doc;
    };
    let applyInventorySpy;
    let modifyApplySpy;

    const connections = loadIsolatedWithMocks({
      '../../utils/deviceQueue': () => () => ({ addJob: addJobMock }),
      '../../notifications/notifications': () => () => ({
        sendNotifications: jest.fn(async () => {})
      }),
      '../../models/tunnels': () => ({
        find: jest.fn(() => ({
          populate: () => ({ populate: () => ({ lean: async () => [] }) })
        }))
      }),
      '../../models/vrrp': () => ({
        find: jest.fn(() => ({ populate: () => ({ lean: async () => [] }) }))
      }),
      '../../models/devices': () => ({
        devices: {
          findOne: jest.fn(async (filter) => wrapDocLike(await mockDeviceModel.findOne(filter))),
          findOneAndUpdate: jest.fn(async (filter, update, opts) =>
            wrapDocLike(await mockDeviceModel.findOneAndUpdate(filter, update, opts))),
          updateOne: jest.fn(async () => ({})),
          find: jest.fn(() => ({
            populate: async () => [wrapDocLike(mockDeviceModel.getDoc())]
          }))
        }
      })
    }, () => {
      const realInventory = require('../interfaceInventory');
      applyInventorySpy = jest.spyOn(realInventory, 'applyInterfaceInventory');
      const realModifyDevice = require('../modifyDevice');
      modifyApplySpy = jest.spyOn(realModifyDevice, 'apply');
      return require('../../websocket/Connections')();
    });

    const origDevice = {
      ...mockDeviceModel.getDoc(),
      firewall: { rules: Object.assign([], { toObject: () => [] }) },
      populate: jest.fn(async function () { return this; }),
      toObject: function () { return { ...mockDeviceModel.getDoc(), firewall: { rules: [] } }; }
    };

    const deviceInfo = {
      message: {
        reconfig: 'hash-v2',
        device: '6.2.0',
        network: {
          interfaces: [
            {
              name: 'eth0',
              devId: 'pci:0000:00:03.00',
              driver: 'igb',
              MAC: '52:54:00:aa:bb:01',
              link: 'up',
              IPv4: '192.0.2.10',
              IPv4Mask: '24',
              IPv6: '',
              IPv6Mask: '',
              gateway: '192.0.2.1',
              metric: '0',
              mtu: 1500,
              dhcp: 'no',
              internetAccess: true,
              deviceType: 'dpdk'
            },
            {
              name: 'eth1',
              devId: 'pci:0000:00:04.00',
              driver: 'igb',
              MAC: '52:54:00:aa:bb:02',
              link: 'down',
              IPv4: '',
              IPv4Mask: '',
              IPv6: '',
              IPv6Mask: '',
              gateway: '',
              metric: '',
              mtu: 1500,
              dhcp: 'no',
              deviceType: 'dpdk'
            }
          ]
        }
      }
    };

    try {
      await connections.reconfigCheck(origDevice, deviceInfo);

      expect(applyInventorySpy).toHaveBeenCalledTimes(1);
      expect(applyInventorySpy).toHaveBeenCalledWith(expect.objectContaining({
        deviceId,
        org: orgId,
        account: accountId
      }));
      expect(mockDeviceModel.getDoc().interfaces).toHaveLength(2);
      // modifyDevice.apply completed cleanly with zero tasks (no remove-interface for newly discovered port)
      expect(modifyApplySpy).toHaveBeenCalledTimes(1);
      await expect(modifyApplySpy.mock.results[0].value).resolves.toMatchObject({
        ids: [],
        tasks: {},
        status: 'completed'
      });
      expect(addJobMock).not.toHaveBeenCalled();
    } finally {
      clearInterval(connections.ping_interval);
      clearInterval(connections.alert_interval);
    }
  });

  // --- Second-round review regression tests (A, B, C, D) ---

  test('DevicesService.devicesIdPUT preserves newly discovered locked ports across transaction WriteConflict callback retries and successive __v conflicts', async () => {
    const orgId = new mongoose.Types.ObjectId();
    const deviceId = new mongoose.Types.ObjectId();
    const eth0Id = new mongoose.Types.ObjectId();
    const lockedPort1Id = new mongoose.Types.ObjectId();
    const lockedPort2Id = new mongoose.Types.ObjectId();

    const makePutDoc = (base) => ({
      ...base,
      toObject: () => ({ ...base }),
      interfaces: base.interfaces.map((i) => ({ ...i, toObject: () => ({ ...i }) }))
    });
    const makeChainable = (resolver) => {
      const chain = {
        session: () => chain,
        populate: () => chain,
        lean: () => Promise.resolve(resolver()),
        then: (resolve, reject) => Promise.resolve(resolver()).then(resolve, reject)
      };
      return chain;
    };

    const makeEth = (_id, name, devId, mac, assigned = false) => makeStoredInterface({
      _id,
      name,
      devId,
      MAC: mac,
      isAssigned: assigned,
      locked: true,
      type: assigned ? 'WAN' : 'LAN',
      dhcp: assigned ? 'yes' : 'no',
      IPv4: assigned ? '192.0.2.10' : '',
      IPv4Mask: assigned ? '24' : '',
      gateway: assigned ? '192.0.2.1' : '',
      metric: assigned ? '0' : '',
      ospf: { area: '0', keyId: '', key: '' },
      dnsServers: ['8.8.8.8'],
      dnsDomains: [],
      useDhcpDnsServers: true
    });

    let dbState = {
      _id: deviceId,
      org: { _id: orgId, tunnelRange: '10.100.0.0/16' },
      __v: 1,
      name: 'edge-tx-retry',
      machineId: 'mach-tx-retry',
      isApproved: true,
      versions: { agent: '6.2.0', router: '6.2.0', device: '6.2.0' },
      cpuInfo: { hwCores: 2, grubCores: 2, vppCores: 1, configuredVppCores: 1, powerSaving: false },
      distro: { version: '22.04', codename: 'jammy' },
      staticroutes: [],
      dhcp: [],
      bgp: { enable: false },
      firewall: { rules: [] },
      policies: { firewall: { toObject: () => ({}) } },
      interfaces: [makeEth(eth0Id, 'eth0', 'pci:0000:00:03.00', '52:54:00:aa:bb:01', false)]
    };

    let txInvocation = 0;
    let nullConflictsRemaining = 2;

    const findOneMock = jest.fn(() => makeChainable(() => makePutDoc(dbState)));
    const findOneAndUpdateMock = jest.fn((filter, update) => makeChainable(() => {
      if (txInvocation === 1) {
        // First transaction callback attempt: append lockedPort1 and abort with WriteConflict
        dbState = {
          ...dbState,
          __v: 2,
          interfaces: [
            ...dbState.interfaces,
            makeEth(lockedPort1Id, 'eth1', 'pci:0000:00:04.00', '52:54:00:aa:bb:02', false)
          ]
        };
        const err = new Error('WriteConflict');
        err.codeName = 'WriteConflict';
        throw err;
      }
      if (nullConflictsRemaining > 0) {
        nullConflictsRemaining -= 1;
        if (nullConflictsRemaining === 1) {
          // First null-version conflict inside retry: append lockedPort2 and bump __v
          dbState = {
            ...dbState,
            __v: dbState.__v + 1,
            interfaces: [
              ...dbState.interfaces,
              makeEth(lockedPort2Id, 'eth2', 'pci:0000:00:05.00', '52:54:00:aa:bb:03', false)
            ]
          };
        } else {
          // Second successive null-version conflict: bump __v again without adding new ports
          dbState = { ...dbState, __v: dbState.__v + 1 };
        }
        return null;
      }
      if (filter.__v !== dbState.__v) return null;
      dbState = {
        ...dbState,
        ...update.$set,
        __v: dbState.__v + (update.$inc?.__v || 0)
      };
      return makePutDoc(dbState);
    }));

    const prevTx = mongoConnsApi._mainDBwithTransaction;
    mongoConnsApi._mainDBwithTransaction = async (cb) => {
      const fakeSession = { endSession: jest.fn() };
      while (true) {
        txInvocation += 1;
        try {
          await cb(fakeSession);
          return fakeSession;
        } catch (err) {
          if (err.codeName === 'WriteConflict' && txInvocation < 3) {
            continue;
          }
          throw err;
        }
      }
    };

    try {
      const DevicesService = loadIsolatedWithMocks({
        '../../models/devices': () => ({
          devices: { findOne: findOneMock, findOneAndUpdate: findOneAndUpdateMock },
          staticroutes: {},
          dhcpModel: {}
        }),
        '../../models/tunnels': () => ({ find: () => makeChainable(() => []) }),
        '../../models/pathlabels': () => ({ find: () => makeChainable(() => []) }),
        '../../models/vrrp': () => ({ aggregate: () => ({ allowDiskUse: async () => [] }) }),
        '../../websocket/Connections': () => () => ({
          devices: { updateDeviceInfo: jest.fn() },
          deviceDisconnect: jest.fn()
        }),
        '../../periodic/deviceStatus': () => () => ({ getDeviceStatus: () => null }),
        '../../periodic/statusesInDb': () => () => ({}),
        '../../utils/membershipUtils': () => ({ getAccessTokenOrgList: async () => [orgId] }),
        '../../deviceLogic/dispatcher': () => ({ apply: jest.fn(async () => ({ ids: [] })) }),
        '../../deviceLogic/validators': () => ({
          validateDevice: async () => ({ valid: true }),
          validateDhcpConfig: () => ({ valid: true }),
          validateStaticRoute: () => ({ valid: true }),
          validateQOSPolicy: () => ({ valid: true }),
          isLocalOrBroadcastAddress: () => false
        })
      }, () => require('../../services/DevicesService'));

      DevicesService.setLocationHeader = jest.fn();
      DevicesService.selectDeviceParams = jest.fn(async (d) => d);

      const res = await DevicesService.devicesIdPUT(
        {
          id: deviceId.toString(),
          org: orgId.toString(),
          name: 'edge-tx-retry',
          interfaces: [
            { ...dbState.interfaces[0], isAssigned: true, type: 'WAN', dhcp: 'yes' }
          ]
        },
        { user: { username: 'admin' }, server: 'localhost' },
        {}
      );

      expect(res.code).toBe(200);
      expect(txInvocation).toBe(2);
      expect(dbState.interfaces).toHaveLength(3);
      expect(dbState.interfaces.find((i) => i.devId === 'pci:0000:00:03.00').isAssigned).toBe(true);
      expect(dbState.interfaces.find((i) => i.devId === 'pci:0000:00:04.00').locked).toBe(true);
      expect(dbState.interfaces.find((i) => i.devId === 'pci:0000:00:05.00').locked).toBe(true);
    } finally {
      mongoConnsApi._mainDBwithTransaction = prevTx;
    }
  });

  test('DevicesService.devicesIdPUT runs deviceDisconnect/reconfig reset only after commit, and preserves stored _id for PUT rows matched by devId', async () => {
    const orgId = new mongoose.Types.ObjectId();
    const deviceId = new mongoose.Types.ObjectId();
    const eth0Id = new mongoose.Types.ObjectId();

    const makePutDoc = (base) => ({
      ...base,
      toObject: () => ({ ...base }),
      interfaces: base.interfaces.map((i) => ({ ...i, toObject: () => ({ ...i }) }))
    });
    const makeChainable = (resolver) => {
      const chain = {
        session: () => chain,
        populate: () => chain,
        lean: () => Promise.resolve(resolver()),
        then: (resolve, reject) => Promise.resolve(resolver()).then(resolve, reject)
      };
      return chain;
    };

    let dbState = {
      _id: deviceId,
      org: { _id: orgId, tunnelRange: '10.100.0.0/16' },
      __v: 2,
      name: 'edge-post-commit',
      machineId: 'mach-post-commit',
      isApproved: true,
      versions: { agent: '6.2.0', router: '6.2.0', device: '6.2.0' },
      cpuInfo: { hwCores: 2, grubCores: 2, vppCores: 1, configuredVppCores: 1, powerSaving: false },
      distro: { version: '22.04', codename: 'jammy' },
      staticroutes: [],
      dhcp: [],
      bgp: { enable: false },
      firewall: { rules: [] },
      policies: { firewall: { toObject: () => ({}) } },
      interfaces: [
        makeStoredInterface({
          _id: eth0Id,
          name: 'eth0',
          devId: 'pci:0000:00:03.00',
          MAC: '52:54:00:aa:bb:01',
          isAssigned: true,
          type: 'WAN',
          dhcp: 'yes',
          ospf: { area: '0', keyId: '', key: '' },
          dnsServers: ['8.8.8.8'],
          dnsDomains: [],
          useDhcpDnsServers: true
        })
      ]
    };

    const updateDeviceInfoMock = jest.fn();
    const deviceDisconnectMock = jest.fn();
    let abortOnUpdate = true;

    const findOneMock = jest.fn(() => makeChainable(() => makePutDoc(dbState)));
    const findOneAndUpdateMock = jest.fn((filter, update) => makeChainable(() => {
      if (abortOnUpdate) {
        throw new Error('Simulated transaction abort');
      }
      dbState = {
        ...dbState,
        ...update.$set,
        __v: dbState.__v + (update.$inc?.__v || 0)
      };
      return makePutDoc(dbState);
    }));

    const DevicesService = loadIsolatedWithMocks({
      '../../models/devices': () => ({
        devices: { findOne: findOneMock, findOneAndUpdate: findOneAndUpdateMock },
        staticroutes: {},
        dhcpModel: {}
      }),
      '../../models/tunnels': () => ({ find: () => makeChainable(() => []) }),
      '../../models/pathlabels': () => ({ find: () => makeChainable(() => []) }),
      '../../models/vrrp': () => ({ aggregate: () => ({ allowDiskUse: async () => [] }) }),
      '../../websocket/Connections': () => () => ({
        devices: { updateDeviceInfo: updateDeviceInfoMock },
        deviceDisconnect: deviceDisconnectMock
      }),
      '../../periodic/deviceStatus': () => () => ({ getDeviceStatus: () => null }),
      '../../periodic/statusesInDb': () => () => ({}),
      '../../utils/membershipUtils': () => ({ getAccessTokenOrgList: async () => [orgId] }),
      '../../deviceLogic/dispatcher': () => ({ apply: jest.fn(async () => ({ ids: [] })) }),
      '../../deviceLogic/validators': () => ({
        validateDevice: async () => ({ valid: true }),
        validateDhcpConfig: () => ({ valid: true }),
        validateStaticRoute: () => ({ valid: true }),
        validateQOSPolicy: () => ({ valid: true }),
        isLocalOrBroadcastAddress: () => false
      })
    }, () => require('../../services/DevicesService'));

    DevicesService.setLocationHeader = jest.fn();
    DevicesService.selectDeviceParams = jest.fn(async (d) => d);

    // B: Aborted/rolled-back transaction must NOT call deviceDisconnect or updateDeviceInfo
    const abortRes = await DevicesService.devicesIdPUT(
      {
        id: deviceId.toString(),
        org: orgId.toString(),
        name: 'edge-post-commit',
        isApproved: false,
        interfaces: [{ ...dbState.interfaces[0] }]
      },
      { user: { username: 'admin' }, server: 'localhost' },
      {}
    ).catch((err) => err);
    expect(abortRes.code).toBe(500);
    expect(deviceDisconnectMock).not.toHaveBeenCalled();
    expect(updateDeviceInfoMock).not.toHaveBeenCalled();

    // C + B committed: PUT unassigns eth0 while replacing/omitting _id, and sets isApproved:false ->
    // stored _id is preserved on eth0 (keeping true->false transition intact) and post-commit disconnect runs once.
    abortOnUpdate = false;
    const spoofedId = new mongoose.Types.ObjectId();
    const okRes = await DevicesService.devicesIdPUT(
      {
        id: deviceId.toString(),
        org: orgId.toString(),
        name: 'edge-post-commit',
        isApproved: false,
        interfaces: [{ ...dbState.interfaces[0], _id: spoofedId, isAssigned: false }]
      },
      { user: { username: 'admin' }, server: 'localhost' },
      {}
    );
    expect(okRes.code).toBe(200);
    expect(dbState.interfaces[0]._id.toString()).toBe(eth0Id.toString());
    expect(dbState.interfaces[0].isAssigned).toBe(false);
    expect(updateDeviceInfoMock).toHaveBeenCalledTimes(1);
    expect(deviceDisconnectMock).toHaveBeenCalledTimes(1);
    expect(deviceDisconnectMock).toHaveBeenCalledWith('mach-post-commit');
  });

  test('ambiguous cloned MACs do not backfill a guessed devId onto a devId-less stored interface unless name disambiguates', () => {
    const sharedMac = '52:54:00:de:ad:99';
    const storedWithoutDevId = makeStoredInterface({
      name: 'eth0',
      devId: '',
      MAC: sharedMac,
      isAssigned: true,
      type: 'WAN'
    });

    // Two unmatched reports share the same MAC and neither matches stored name 'eth0' -> ambiguous
    const ambiguousResult = mergeInterfaceInventory([storedWithoutDevId], [
      {
        name: 'ens3',
        devId: 'pci:0000:00:04.00',
        driver: 'igb',
        MAC: sharedMac,
        link: 'up',
        IPv4: '192.0.2.10',
        IPv4Mask: '24',
        deviceType: 'dpdk'
      },
      {
        name: 'ens4',
        devId: 'pci:0000:00:05.00',
        driver: 'igb',
        MAC: sharedMac,
        link: 'up',
        IPv4: '192.0.2.20',
        IPv4Mask: '24',
        deviceType: 'dpdk'
      }
    ]);

    // Stored row must keep its untouched devId ('') and be reported via missing/dropped channels
    expect(ambiguousResult.interfaces).toHaveLength(1);
    expect(ambiguousResult.interfaces[0].devId).toBe('');
    expect(ambiguousResult.recoveredDevIds).toHaveLength(0);
    expect(ambiguousResult.missingInterfaces).toHaveLength(1);
    expect(ambiguousResult.droppedReported.map((r) => r.devId)).toEqual([
      'pci:0000:00:04.00',
      'pci:0000:00:05.00'
    ]);

    // When one report carries corroborating name 'eth0', backfill succeeds unambiguously and the 2nd port is appended
    const corroboratedResult = mergeInterfaceInventory([storedWithoutDevId], [
      {
        name: 'ens4',
        devId: 'pci:0000:00:05.00',
        driver: 'igb',
        MAC: sharedMac,
        link: 'up',
        IPv4: '192.0.2.20',
        IPv4Mask: '24',
        deviceType: 'dpdk'
      },
      {
        name: 'eth0',
        devId: 'pci:0000:00:04.00',
        driver: 'igb',
        MAC: sharedMac,
        link: 'up',
        IPv4: '192.0.2.10',
        IPv4Mask: '24',
        deviceType: 'dpdk'
      }
    ]);

    expect(corroboratedResult.interfaces).toHaveLength(2);
    expect(corroboratedResult.interfaces[0].devId).toBe('pci:0000:00:04.00');
    expect(corroboratedResult.recoveredDevIds).toHaveLength(1);
    expect(corroboratedResult.recoveredDevIds[0].devId).toBe('pci:0000:00:04.00');
    expect(corroboratedResult.interfaces[1].devId).toBe('pci:0000:00:05.00');
  });

  test('multi-row cloned-MAC recovery is order-independent across all stored and report permutations and retains new port without identity corruption', () => {
    const sharedMac = '52:54:00:de:ad:88';
    const legacyEth0 = makeStoredInterface({
      name: 'eth0',
      devId: '',
      MAC: sharedMac,
      isAssigned: true,
      type: 'WAN'
    });
    const legacyEth1 = makeStoredInterface({
      name: 'eth1',
      devId: '',
      MAC: sharedMac,
      isAssigned: true,
      type: 'LAN'
    });

    const repEth0 = {
      name: 'eth0',
      devId: 'pci:0000:00:04.00',
      driver: 'igb',
      MAC: sharedMac,
      link: 'up',
      IPv4: '192.0.2.10',
      IPv4Mask: '24',
      deviceType: 'dpdk'
    };
    const repNewPort = {
      name: 'ens9',
      devId: 'pci:0000:00:05.00',
      driver: 'igb',
      MAC: sharedMac,
      link: 'up',
      IPv4: '192.0.2.20',
      IPv4Mask: '24',
      deviceType: 'dpdk'
    };

    const permutations = [
      { stored: [legacyEth0, legacyEth1], reported: [repEth0, repNewPort] },
      { stored: [legacyEth0, legacyEth1], reported: [repNewPort, repEth0] },
      { stored: [legacyEth1, legacyEth0], reported: [repEth0, repNewPort] },
      { stored: [legacyEth1, legacyEth0], reported: [repNewPort, repEth0] }
    ];

    const summarize = (res) => ({
      interfaceDevIds: res.interfaces.map((i) => i.devId).sort(),
      interfacesByName: res.interfaces
        .map((i) => ({ name: i.name, devId: i.devId, isAssigned: i.isAssigned }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      addedInterfaces: res.addedInterfaces.map((i) => ({
        name: i.name,
        devId: i.devId,
        isAssigned: i.isAssigned,
        locked: i.locked
      })),
      missingInterfaces: res.missingInterfaces.map((i) => ({
        name: i.name,
        devId: i.devId
      })),
      recoveredDevIds: res.recoveredDevIds.map((r) => ({
        existingName: r.existing.name,
        devId: r.devId
      })),
      droppedReported: res.droppedReported.map((r) => ({
        name: r.name,
        devId: r.devId
      }))
    });

    const results = permutations.map(({ stored, reported }) =>
      mergeInterfaceInventory(stored, reported)
    );
    const summaries = results.map(summarize);

    for (const summary of summaries) {
      expect(summary).toEqual(summaries[0]);
      expect(summary.interfaceDevIds).toEqual([
        '',
        'pci:0000:00:04.00',
        'pci:0000:00:05.00'
      ]);
      expect(summary.interfacesByName).toEqual([
        { name: 'ens9', devId: 'pci:0000:00:05.00', isAssigned: false },
        { name: 'eth0', devId: 'pci:0000:00:04.00', isAssigned: true },
        { name: 'eth1', devId: '', isAssigned: true }
      ]);
      expect(summary.addedInterfaces).toEqual([
        { name: 'ens9', devId: 'pci:0000:00:05.00', isAssigned: false, locked: true }
      ]);
      expect(summary.missingInterfaces).toEqual([
        { name: 'eth1', devId: '' }
      ]);
      expect(summary.recoveredDevIds).toEqual([
        { existingName: 'eth0', devId: 'pci:0000:00:04.00' }
      ]);
      expect(summary.droppedReported).toEqual([]);
      // Identity-corruption invariant: new port devId must never be backfilled onto legacy eth1
      expect(summary.recoveredDevIds.map((r) => r.devId)).not.toContain('pci:0000:00:05.00');
    }

    // Subsequent report with a third port sharing the cloned MAC must still not backfill eth1
    const followUp = mergeInterfaceInventory(results[0].interfaces, [
      repEth0,
      repNewPort,
      {
        name: 'ens10',
        devId: 'pci:0000:00:06.00',
        driver: 'igb',
        MAC: sharedMac,
        link: 'up',
        IPv4: '192.0.2.30',
        IPv4Mask: '24',
        deviceType: 'dpdk'
      }
    ]);
    const followUpEth1 = followUp.interfaces.find((i) => i.name === 'eth1');
    expect(followUpEth1.devId).toBe('');
    expect(followUp.recoveredDevIds).toHaveLength(0);
    expect(followUp.addedInterfaces.map((i) => i.devId)).toEqual(['pci:0000:00:06.00']);
  });

  test('multi-row cloned-MAC group does not disambiguate duplicate stored names and drops invalid devIds while retaining distinct valid unassigned ports', () => {
    const sharedMac = '52:54:00:de:ad:77';
    const dupA = makeStoredInterface({
      name: 'eth0',
      devId: '',
      MAC: sharedMac,
      isAssigned: true,
      type: 'WAN'
    });
    const dupB = makeStoredInterface({
      name: 'eth0',
      devId: '',
      MAC: sharedMac,
      isAssigned: false,
      type: 'LAN'
    });

    const dupResult = mergeInterfaceInventory([dupA, dupB], [
      {
        name: 'eth0',
        devId: 'pci:0000:00:07.00',
        driver: 'igb',
        MAC: sharedMac,
        link: 'up',
        IPv4: '192.0.2.40',
        IPv4Mask: '24',
        deviceType: 'dpdk'
      },
      {
        name: 'ens10',
        devId: 'pci:0000:00:08.00',
        driver: 'igb',
        MAC: sharedMac,
        link: 'up',
        IPv4: '192.0.2.42',
        IPv4Mask: '24',
        deviceType: 'dpdk'
      },
      {
        name: 'ens11',
        devId: '',
        driver: 'igb',
        MAC: sharedMac,
        link: 'up',
        IPv4: '192.0.2.41',
        IPv4Mask: '24',
        deviceType: 'dpdk'
      }
    ]);

    // Duplicate stored name cannot disambiguate: both legacy rows keep '', distinct valid reports are retained as unassigned, invalid report is dropped
    expect(dupResult.recoveredDevIds).toHaveLength(0);
    expect(dupResult.missingInterfaces).toHaveLength(2);
    expect(dupResult.interfaces.slice(0, 2).map((i) => i.devId)).toEqual(['', '']);
    expect(dupResult.addedInterfaces.map((i) => ({ name: i.name, devId: i.devId, isAssigned: i.isAssigned }))).toEqual([
      { name: 'eth0', devId: 'pci:0000:00:07.00', isAssigned: false },
      { name: 'ens10', devId: 'pci:0000:00:08.00', isAssigned: false }
    ]);
    expect(dupResult.droppedReported.map((r) => ({ name: r.name, devId: r.devId }))).toEqual([
      { name: 'ens11', devId: '' }
    ]);
  });

  test('Pass 3 does not backfill a devId onto duplicate-name devId-less stored rows when MAC is omitted (both stored orders) or when multiple unused reports share the name', () => {
    const sharedMac = '52:54:00:de:ad:66';
    const dupAId = new mongoose.Types.ObjectId();
    const dupBId = new mongoose.Types.ObjectId();
    const dupA = makeStoredInterface({
      _id: dupAId,
      name: 'eth0',
      devId: '',
      MAC: sharedMac,
      isAssigned: true,
      type: 'WAN'
    });
    const dupB = makeStoredInterface({
      _id: dupBId,
      name: 'eth0',
      devId: '',
      MAC: sharedMac,
      isAssigned: false,
      type: 'LAN'
    });

    const maclessReport = {
      name: 'eth0',
      devId: 'pci:0000:00:09.00',
      driver: 'igb',
      MAC: '',
      link: 'up',
      IPv4: '192.0.2.60',
      IPv4Mask: '24',
      deviceType: 'dpdk'
    };

    const resAB = mergeInterfaceInventory([dupA, dupB], [maclessReport]);
    const resBA = mergeInterfaceInventory([dupB, dupA], [maclessReport]);

    const summarizeByIdentity = (res) => ({
      storedA: res.interfaces.find((i) => i._id.toString() === dupAId.toString()).devId,
      storedB: res.interfaces.find((i) => i._id.toString() === dupBId.toString()).devId,
      interfaceDevIds: res.interfaces.map((i) => i.devId).sort(),
      addedDevIds: res.addedInterfaces.map((i) => ({ name: i.name, devId: i.devId, isAssigned: i.isAssigned })),
      missingIds: res.missingInterfaces.map((i) => i._id.toString()).sort(),
      recoveredCount: res.recoveredDevIds.length,
      droppedCount: res.droppedReported.length
    });

    const summaryAB = summarizeByIdentity(resAB);
    const summaryBA = summarizeByIdentity(resBA);

    // Both stored row orders produce identical results and neither legacy row acquires the devId
    expect(summaryAB).toEqual(summaryBA);
    expect(summaryAB.storedA).toBe('');
    expect(summaryAB.storedB).toBe('');
    expect(summaryAB.interfaceDevIds).toEqual(['', '', 'pci:0000:00:09.00']);
    expect(summaryAB.addedDevIds).toEqual([
      { name: 'eth0', devId: 'pci:0000:00:09.00', isAssigned: false }
    ]);
    expect(summaryAB.missingIds).toEqual([dupAId.toString(), dupBId.toString()].sort());
    expect(summaryAB.recoveredCount).toBe(0);
    expect(summaryAB.droppedCount).toBe(0);

    // Report-side ambiguity: single devId-less stored row with two unused reports sharing the same name
    const singleStoredId = new mongoose.Types.ObjectId();
    const singleStored = makeStoredInterface({
      _id: singleStoredId,
      name: 'eth0',
      devId: '',
      MAC: '',
      isAssigned: true,
      type: 'WAN'
    });
    const rep1 = { ...maclessReport, devId: 'pci:0000:00:09.00' };
    const rep2 = { ...maclessReport, devId: 'pci:0000:00:0a.00' };

    const multiRep12 = mergeInterfaceInventory([singleStored], [rep1, rep2]);
    const multiRep21 = mergeInterfaceInventory([singleStored], [rep2, rep1]);
    for (const res of [multiRep12, multiRep21]) {
      expect(res.interfaces.find((i) => i._id.toString() === singleStoredId.toString()).devId).toBe('');
      expect(res.addedInterfaces.map((i) => i.devId).sort()).toEqual([
        'pci:0000:00:09.00',
        'pci:0000:00:0a.00'
      ]);
      expect(res.recoveredDevIds).toHaveLength(0);
    }
  });

  test('Pass 3 pairs an unused report from an unresolved cloned-MAC group with a uniquely named legacy row lacking a stored MAC', () => {
    const sharedMac = '52:54:00:de:ad:55';
    const legacyEth0Id = new mongoose.Types.ObjectId();
    const legacyEth1Id = new mongoose.Types.ObjectId();
    const legacyNoMacId = new mongoose.Types.ObjectId();

    const legacyEth0 = makeStoredInterface({
      _id: legacyEth0Id,
      name: 'eth0',
      devId: '',
      MAC: sharedMac,
      isAssigned: true,
      type: 'WAN'
    });
    const legacyEth1 = makeStoredInterface({
      _id: legacyEth1Id,
      name: 'eth1',
      devId: '',
      MAC: sharedMac,
      isAssigned: true,
      type: 'LAN'
    });
    const legacyNoMac = makeStoredInterface({
      _id: legacyNoMacId,
      name: 'eth2',
      devId: '',
      MAC: '',
      isAssigned: true,
      type: 'LAN',
      IPv4: '10.0.2.1',
      linkStatus: 'down'
    });

    const repEth0 = {
      name: 'eth0',
      devId: 'pci:0000:00:04.00',
      driver: 'igb',
      MAC: sharedMac,
      link: 'up',
      IPv4: '192.0.2.10',
      IPv4Mask: '24',
      deviceType: 'dpdk'
    };
    const repEth2 = {
      name: 'eth2',
      devId: 'pci:0000:00:05.00',
      driver: 'igb',
      MAC: sharedMac,
      link: 'up',
      IPv4: '10.0.2.50',
      IPv4Mask: '24',
      deviceType: 'dpdk'
    };

    const res = mergeInterfaceInventory([legacyEth0, legacyEth1, legacyNoMac], [repEth0, repEth2]);

    // No duplicate interface appended: legacyNoMac is updated in place via Pass 3
    expect(res.interfaces).toHaveLength(3);
    expect(res.addedInterfaces).toHaveLength(0);
    expect(res.droppedReported).toHaveLength(0);

    const outEth0 = res.interfaces.find((i) => i._id.toString() === legacyEth0Id.toString());
    const outEth1 = res.interfaces.find((i) => i._id.toString() === legacyEth1Id.toString());
    const outEth2 = res.interfaces.find((i) => i._id.toString() === legacyNoMacId.toString());

    expect(outEth0.devId).toBe('pci:0000:00:04.00');
    expect(outEth1.devId).toBe('');
    expect(outEth2.devId).toBe('pci:0000:00:05.00');
    expect(outEth2.MAC).toBe(sharedMac);
    expect(outEth2.IPv4).toBe('10.0.2.1');
    expect(outEth2.hasIpOnDevice).toBe(true);
    expect(outEth2.linkStatus).toBe('up');
    expect(outEth2.isAssigned).toBe(true);

    // recoveredDevIds continues to record MAC-based recoveries only
    expect(res.recoveredDevIds.map((r) => ({ name: r.existing.name, devId: r.devId }))).toEqual([
      { name: 'eth0', devId: 'pci:0000:00:04.00' }
    ]);
    expect(res.missingInterfaces.map((i) => i._id.toString())).toEqual([legacyEth1Id.toString()]);
  });

  test('Pass 3 keeps an unresolved cloned-MAC group report blocked when its name still competes inside the group or conflicts outside', () => {
    const sharedMac = '52:54:00:de:ad:44';
    const groupDupAId = new mongoose.Types.ObjectId();
    const groupDupBId = new mongoose.Types.ObjectId();
    const outsideLegacyId = new mongoose.Types.ObjectId();

    const groupDupA = makeStoredInterface({
      _id: groupDupAId,
      name: 'eth2',
      devId: '',
      MAC: sharedMac,
      isAssigned: true,
      type: 'WAN'
    });
    const groupDupB = makeStoredInterface({
      _id: groupDupBId,
      name: 'eth2',
      devId: '',
      MAC: sharedMac,
      isAssigned: false,
      type: 'LAN'
    });
    const outsideLegacy = makeStoredInterface({
      _id: outsideLegacyId,
      name: 'eth2',
      devId: '',
      MAC: '',
      isAssigned: true,
      type: 'LAN'
    });

    const repEth2 = {
      name: 'eth2',
      devId: 'pci:0000:00:0b.00',
      driver: 'igb',
      MAC: sharedMac,
      link: 'up',
      IPv4: '10.0.2.99',
      IPv4Mask: '24',
      deviceType: 'dpdk'
    };

    const res = mergeInterfaceInventory([groupDupA, groupDupB, outsideLegacy], [repEth2]);

    // Competing unresolved rows named 'eth2' exist inside the cloned-MAC group -> outsideLegacy must NOT acquire the devId
    expect(res.interfaces.find((i) => i._id.toString() === groupDupAId.toString()).devId).toBe('');
    expect(res.interfaces.find((i) => i._id.toString() === groupDupBId.toString()).devId).toBe('');
    expect(res.interfaces.find((i) => i._id.toString() === outsideLegacyId.toString()).devId).toBe('');
    expect(res.addedInterfaces.map((i) => ({ name: i.name, devId: i.devId, isAssigned: i.isAssigned }))).toEqual([
      { name: 'eth2', devId: 'pci:0000:00:0b.00', isAssigned: false }
    ]);
    expect(res.recoveredDevIds).toHaveLength(0);
  });

  // --- Third-round review regression tests ---

  test('dedupeReportedInterfaces is order-independent: a devId-less name-only report never attaches its name to a competing valid-devId report', () => {
    const sharedMac = '52:54:00:de:ad:33';
    const legacyEth0Id = new mongoose.Types.ObjectId();

    const legacyEth0 = makeStoredInterface({
      _id: legacyEth0Id,
      name: 'eth0',
      devId: '',
      MAC: '',
      isAssigned: true,
      type: 'WAN',
      linkStatus: 'down'
    });

    const validA = {
      name: '',
      devId: 'pci:0000:00:0c.00',
      driver: 'igb',
      MAC: sharedMac,
      link: 'up',
      IPv4: '192.0.2.70',
      IPv4Mask: '24',
      deviceType: 'dpdk'
    };
    const validB = {
      name: '',
      devId: 'pci:0000:00:0d.00',
      driver: 'igb',
      MAC: sharedMac,
      link: 'up',
      IPv4: '192.0.2.71',
      IPv4Mask: '24',
      deviceType: 'dpdk'
    };
    const nameOnly = {
      name: 'eth0',
      devId: '',
      driver: 'igb',
      MAC: sharedMac,
      link: 'up',
      IPv4: '',
      IPv4Mask: '',
      deviceType: 'dpdk'
    };

    const reportPermutations = [
      [validA, validB, nameOnly],
      [validA, nameOnly, validB],
      [validB, validA, nameOnly],
      [validB, nameOnly, validA],
      [nameOnly, validA, validB],
      [nameOnly, validB, validA]
    ];

    const summarize = (res) => ({
      legacyDevId: res.interfaces.find((i) => i._id.toString() === legacyEth0Id.toString()).devId,
      legacyAssigned: res.interfaces.find((i) => i._id.toString() === legacyEth0Id.toString()).isAssigned,
      added: res.addedInterfaces
        .map((i) => ({ name: i.name, devId: i.devId, isAssigned: i.isAssigned }))
        .sort((a, b) => a.devId.localeCompare(b.devId)),
      recoveredCount: res.recoveredDevIds.length,
      droppedCount: res.droppedReported.length
    });

    const summaries = reportPermutations.map((reported) =>
      summarize(mergeInterfaceInventory([legacyEth0], reported))
    );

    for (const summary of summaries) {
      expect(summary).toEqual(summaries[0]);
      // Legacy row never acquires an arbitrary devId from either competing valid report
      expect(summary.legacyDevId).toBe('');
      expect(summary.legacyAssigned).toBe(true);
      expect(summary.added).toEqual([
        { name: '', devId: 'pci:0000:00:0c.00', isAssigned: false },
        { name: '', devId: 'pci:0000:00:0d.00', isAssigned: false }
      ]);
      expect(summary.recoveredCount).toBe(0);
      expect(summary.droppedCount).toBe(0);
    }
  });

  test('Pass 3 allows a compatible MAC-less valid report to match a legacy row when another same-name report has a conflicting MAC (in both report orders)', () => {
    const legacyEth0Id = new mongoose.Types.ObjectId();

    const legacyEth0 = makeStoredInterface({
      _id: legacyEth0Id,
      name: 'eth0',
      devId: '',
      MAC: '52:54:00:aa:bb:10',
      isAssigned: true,
      type: 'WAN',
      linkStatus: 'down'
    });

    const compatibleMacless = {
      name: 'eth0',
      devId: 'pci:0000:00:0e.00',
      driver: 'igb',
      MAC: '',
      link: 'up',
      IPv4: '192.0.2.80',
      IPv4Mask: '24',
      deviceType: 'dpdk'
    };
    const conflictingMac = {
      name: 'eth0',
      devId: 'pci:0000:00:0f.00',
      driver: 'igb',
      MAC: '52:54:00:aa:bb:99',
      link: 'up',
      IPv4: '192.0.2.81',
      IPv4Mask: '24',
      deviceType: 'dpdk'
    };

    const resAB = mergeInterfaceInventory([legacyEth0], [compatibleMacless, conflictingMac]);
    const resBA = mergeInterfaceInventory([legacyEth0], [conflictingMac, compatibleMacless]);

    const summarize = (res) => {
      const legacy = res.interfaces.find((i) => i._id.toString() === legacyEth0Id.toString());
      return {
        totalCount: res.interfaces.length,
        legacyDevId: legacy.devId,
        legacyMac: legacy.MAC,
        legacyLink: legacy.linkStatus,
        legacyAssigned: legacy.isAssigned,
        added: res.addedInterfaces.map((i) => ({
          name: i.name,
          devId: i.devId,
          MAC: i.MAC,
          isAssigned: i.isAssigned
        })),
        missingCount: res.missingInterfaces.length,
        droppedCount: res.droppedReported.length
      };
    };

    const summaryAB = summarize(resAB);
    const summaryBA = summarize(resBA);

    expect(summaryAB).toEqual(summaryBA);
    expect(summaryAB).toEqual({
      totalCount: 2,
      legacyDevId: 'pci:0000:00:0e.00',
      legacyMac: '52:54:00:aa:bb:10',
      legacyLink: 'up',
      legacyAssigned: true,
      added: [
        {
          name: 'eth0',
          devId: 'pci:0000:00:0f.00',
          MAC: '52:54:00:aa:bb:99',
          isAssigned: false
        }
      ],
      missingCount: 0,
      droppedCount: 0
    });
  });

  test('Pass 3 rejects conflicting VLAN tags and parent IDs so a VLAN 10 report never backfills a same-name legacy VLAN 20 row (in both stored row orders)', () => {
    const sharedMac = '52:54:00:de:ad:22';
    const groupVlan10AId = new mongoose.Types.ObjectId();
    const groupVlan10BId = new mongoose.Types.ObjectId();
    const legacyVlan20Id = new mongoose.Types.ObjectId();

    const groupVlan10A = makeStoredInterface({
      _id: groupVlan10AId,
      name: 'eth0.10',
      devId: '',
      MAC: sharedMac,
      vlanTag: '10',
      parentDevId: 'pci:0000:00:03.00',
      isAssigned: true,
      type: 'LAN'
    });
    const groupVlan10B = makeStoredInterface({
      _id: groupVlan10BId,
      name: 'eth1.10',
      devId: '',
      MAC: sharedMac,
      vlanTag: '10',
      parentDevId: 'pci:0000:00:04.00',
      isAssigned: true,
      type: 'LAN'
    });
    const legacyVlan20 = makeStoredInterface({
      _id: legacyVlan20Id,
      name: 'eth2.20',
      devId: '',
      MAC: '',
      vlanTag: '20',
      parentDevId: 'pci:0000:00:05.00',
      isAssigned: true,
      type: 'LAN',
      IPv4: '10.20.0.1',
      linkStatus: 'down'
    });

    const repVlan10A = {
      name: 'eth0.10',
      devId: 'vlan.10.pci:0000:00:03.00',
      driver: 'igb',
      MAC: sharedMac,
      link: 'up',
      IPv4: '10.10.0.1',
      IPv4Mask: '24',
      deviceType: 'dpdk'
    };
    const repVlan10SameName = {
      name: 'eth2.20',
      devId: 'vlan.10.pci:0000:00:04.00',
      driver: 'igb',
      MAC: sharedMac,
      link: 'up',
      IPv4: '10.10.0.2',
      IPv4Mask: '24',
      deviceType: 'dpdk'
    };

    const resOrder1 = mergeInterfaceInventory(
      [groupVlan10A, groupVlan10B, legacyVlan20],
      [repVlan10A, repVlan10SameName]
    );
    const resOrder2 = mergeInterfaceInventory(
      [legacyVlan20, groupVlan10B, groupVlan10A],
      [repVlan10A, repVlan10SameName]
    );

    const summarize = (res) => {
      const outVlan20 = res.interfaces.find((i) => i._id.toString() === legacyVlan20Id.toString());
      const outVlan10A = res.interfaces.find((i) => i._id.toString() === groupVlan10AId.toString());
      const outVlan10B = res.interfaces.find((i) => i._id.toString() === groupVlan10BId.toString());
      return {
        vlan10ADevId: outVlan10A.devId,
        vlan10BDevId: outVlan10B.devId,
        vlan20: {
          devId: outVlan20.devId,
          vlanTag: outVlan20.vlanTag,
          parentDevId: outVlan20.parentDevId,
          MAC: outVlan20.MAC,
          linkStatus: outVlan20.linkStatus,
          isAssigned: outVlan20.isAssigned
        },
        added: res.addedInterfaces.map((i) => ({
          name: i.name,
          devId: i.devId,
          vlanTag: i.vlanTag,
          parentDevId: i.parentDevId,
          isAssigned: i.isAssigned
        })),
        missingIds: res.missingInterfaces.map((i) => i._id.toString()).sort(),
        recovered: res.recoveredDevIds.map((r) => ({ name: r.existing.name, devId: r.devId }))
      };
    };

    const summary1 = summarize(resOrder1);
    const summary2 = summarize(resOrder2);

    expect(summary1).toEqual(summary2);
    expect(summary1.vlan10ADevId).toBe('vlan.10.pci:0000:00:03.00');
    expect(summary1.vlan10BDevId).toBe('');
    expect(summary1.vlan20).toEqual({
      devId: '',
      vlanTag: '20',
      parentDevId: 'pci:0000:00:05.00',
      MAC: '',
      linkStatus: 'down',
      isAssigned: true
    });
    expect(summary1.added).toEqual([
      {
        name: 'eth2.20',
        devId: 'vlan.10.pci:0000:00:04.00',
        vlanTag: '10',
        parentDevId: 'pci:0000:00:04.00',
        isAssigned: false
      }
    ]);
    expect(summary1.missingIds).toEqual([groupVlan10BId.toString(), legacyVlan20Id.toString()].sort());
    expect(summary1.recovered).toEqual([
      { name: 'eth0.10', devId: 'vlan.10.pci:0000:00:03.00' }
    ]);

    // Same VLAN tag (20) but conflicting parentDevId must also be rejected in Pass 3
    const parentConflictRes = mergeInterfaceInventory([legacyVlan20], [
      {
        name: 'eth2.20',
        devId: 'vlan.20.pci:0000:00:09.00',
        driver: 'igb',
        MAC: '',
        link: 'up',
        IPv4: '10.20.0.99',
        IPv4Mask: '24',
        deviceType: 'dpdk'
      }
    ]);
    const unchangedVlan20 = parentConflictRes.interfaces.find(
      (i) => i._id.toString() === legacyVlan20Id.toString()
    );
    expect(unchangedVlan20.devId).toBe('');
    expect(unchangedVlan20.parentDevId).toBe('pci:0000:00:05.00');
    expect(parentConflictRes.addedInterfaces.map((i) => i.devId)).toEqual(['vlan.20.pci:0000:00:09.00']);
  });

  // --- Fourth-round review regression tests ---

  test('same-valid-devId duplicate reports with conflicting names clear merged name order-independently so neither MAC-less legacy row acquires the devId', () => {
    const legacyEth0Id = new mongoose.Types.ObjectId();
    const legacyEth1Id = new mongoose.Types.ObjectId();

    const legacyEth0 = makeStoredInterface({
      _id: legacyEth0Id,
      name: 'eth0',
      devId: '',
      MAC: '',
      isAssigned: true,
      type: 'WAN',
      IPv4: '192.0.2.10',
      linkStatus: 'down'
    });
    const legacyEth1 = makeStoredInterface({
      _id: legacyEth1Id,
      name: 'eth1',
      devId: '',
      MAC: '',
      isAssigned: true,
      type: 'LAN',
      IPv4: '10.0.1.10',
      linkStatus: 'down'
    });

    const repEth0 = {
      name: 'eth0',
      devId: 'pci:0000:00:08.00',
      driver: 'igb',
      MAC: '',
      link: 'up',
      IPv4: '192.0.2.50',
      IPv4Mask: '24',
      deviceType: 'dpdk'
    };
    const repEth1 = {
      name: 'eth1',
      devId: 'pci:0000:00:08.00',
      driver: 'igb',
      MAC: '',
      link: 'up',
      IPv4: '192.0.2.50',
      IPv4Mask: '24',
      deviceType: 'dpdk'
    };

    const resAB = mergeInterfaceInventory([legacyEth0, legacyEth1], [repEth0, repEth1]);
    const resBA = mergeInterfaceInventory([legacyEth0, legacyEth1], [repEth1, repEth0]);

    const summarize = (res) => {
      const outEth0 = res.interfaces.find((i) => i._id.toString() === legacyEth0Id.toString());
      const outEth1 = res.interfaces.find((i) => i._id.toString() === legacyEth1Id.toString());
      return {
        totalCount: res.interfaces.length,
        eth0: { devId: outEth0.devId, linkStatus: outEth0.linkStatus, isAssigned: outEth0.isAssigned },
        eth1: { devId: outEth1.devId, linkStatus: outEth1.linkStatus, isAssigned: outEth1.isAssigned },
        added: res.addedInterfaces.map((i) => ({
          name: i.name,
          devId: i.devId,
          IPv4: i.IPv4,
          linkStatus: i.linkStatus,
          isAssigned: i.isAssigned
        })),
        missingIds: res.missingInterfaces.map((i) => i._id.toString()).sort(),
        recoveredCount: res.recoveredDevIds.length,
        droppedCount: res.droppedReported.length
      };
    };

    const summaryAB = summarize(resAB);
    const summaryBA = summarize(resBA);

    expect(summaryAB).toEqual(summaryBA);
    expect(summaryAB).toEqual({
      totalCount: 3,
      eth0: { devId: '', linkStatus: 'down', isAssigned: true },
      eth1: { devId: '', linkStatus: 'down', isAssigned: true },
      added: [
        {
          name: '',
          devId: 'pci:0000:00:08.00',
          IPv4: '192.0.2.50',
          linkStatus: 'up',
          isAssigned: false
        }
      ],
      missingIds: [legacyEth0Id.toString(), legacyEth1Id.toString()].sort(),
      recoveredCount: 0,
      droppedCount: 0
    });
  });

  test('Pass 3 allows a uniquely corroborated partial VLAN report omitting devId, VLAN metadata, and MAC to refresh a stored valid-devId VLAN without deleting or unlocking it (in both stored row orders)', () => {
    const parentId = new mongoose.Types.ObjectId();
    const assignedVlanId = new mongoose.Types.ObjectId();
    const unassignedVlanId = new mongoose.Types.ObjectId();

    const parentEth0 = makeStoredInterface({
      _id: parentId,
      name: 'eth0',
      devId: 'pci:0000:00:03.00',
      MAC: '52:54:00:11:22:01',
      isAssigned: true,
      locked: true
    });
    const assignedVlan = makeStoredInterface({
      _id: assignedVlanId,
      name: 'eth0.10',
      devId: 'vlan.10.pci:0000:00:03.00',
      parentDevId: 'pci:0000:00:03.00',
      vlanTag: '10',
      MAC: '52:54:00:11:22:01',
      isAssigned: true,
      locked: true,
      IPv4: '10.10.0.1',
      linkStatus: 'down'
    });
    const unassignedVlan = makeStoredInterface({
      _id: unassignedVlanId,
      name: 'eth0.20',
      devId: 'vlan.20.pci:0000:00:03.00',
      parentDevId: 'pci:0000:00:03.00',
      vlanTag: '20',
      MAC: '52:54:00:11:22:01',
      isAssigned: false,
      locked: true,
      IPv4: '',
      linkStatus: 'down'
    });

    const reported = [
      {
        name: 'eth0',
        devId: 'pci:0000:00:03.00',
        driver: 'igb',
        MAC: '52:54:00:11:22:01',
        link: 'up',
        IPv4: '192.0.2.10',
        IPv4Mask: '24',
        deviceType: 'dpdk'
      },
      // Partial VLAN reports omitting devId, vlanTag, parentDevId, and MAC
      {
        name: 'eth0.10',
        link: 'up',
        IPv4: '10.10.0.1',
        IPv4Mask: '24'
      },
      {
        name: 'eth0.20',
        link: 'up',
        IPv4: '10.20.0.2',
        IPv4Mask: '24'
      }
    ];

    const resOrder1 = mergeInterfaceInventory([parentEth0, assignedVlan, unassignedVlan], reported);
    const resOrder2 = mergeInterfaceInventory([unassignedVlan, assignedVlan, parentEth0], reported);

    const summarize = (res) => {
      const outAssigned = res.interfaces.find((i) => i._id.toString() === assignedVlanId.toString());
      const outUnassigned = res.interfaces.find((i) => i._id.toString() === unassignedVlanId.toString());
      return {
        totalCount: res.interfaces.length,
        assigned: {
          devId: outAssigned.devId,
          vlanTag: outAssigned.vlanTag,
          parentDevId: outAssigned.parentDevId,
          locked: outAssigned.locked,
          isAssigned: outAssigned.isAssigned,
          linkStatus: outAssigned.linkStatus
        },
        unassigned: {
          devId: outUnassigned.devId,
          vlanTag: outUnassigned.vlanTag,
          parentDevId: outUnassigned.parentDevId,
          locked: outUnassigned.locked,
          isAssigned: outUnassigned.isAssigned,
          IPv4: outUnassigned.IPv4,
          linkStatus: outUnassigned.linkStatus
        },
        removedVlanCount: res.removedVlans.length,
        addedCount: res.addedInterfaces.length,
        droppedCount: res.droppedReported.length
      };
    };

    const summary1 = summarize(resOrder1);
    const summary2 = summarize(resOrder2);

    expect(summary1).toEqual(summary2);
    expect(summary1).toEqual({
      totalCount: 3,
      assigned: {
        devId: 'vlan.10.pci:0000:00:03.00',
        vlanTag: '10',
        parentDevId: 'pci:0000:00:03.00',
        locked: true,
        isAssigned: true,
        linkStatus: 'up'
      },
      unassigned: {
        devId: 'vlan.20.pci:0000:00:03.00',
        vlanTag: '20',
        parentDevId: 'pci:0000:00:03.00',
        locked: true,
        isAssigned: false,
        IPv4: '10.20.0.2',
        linkStatus: 'up'
      },
      removedVlanCount: 0,
      addedCount: 0,
      droppedCount: 0
    });

    // Explicit conflicting vlanTag or parentDevId must STILL be rejected
    const tagConflictRes = mergeInterfaceInventory([assignedVlan], [
      { name: 'eth0.10', vlanTag: '99', link: 'up', IPv4: '10.99.0.1', IPv4Mask: '24' }
    ]);
    expect(tagConflictRes.interfaces[0].locked).toBe(false);
    expect(tagConflictRes.interfaces[0].linkStatus).toBe('down');

    const parentConflictRes = mergeInterfaceInventory([assignedVlan], [
      { name: 'eth0.10', parentDevId: 'pci:0000:00:09.00', link: 'up', IPv4: '10.10.0.9', IPv4Mask: '24' }
    ]);
    expect(parentConflictRes.interfaces[0].locked).toBe(false);
    expect(parentConflictRes.interfaces[0].linkStatus).toBe('down');

    // Non-unique same-name stored VLANs must NOT match a single partial report in either stored order
    const dupNamedVlan20 = makeStoredInterface({
      _id: new mongoose.Types.ObjectId(),
      name: 'eth0.10',
      devId: 'vlan.20.pci:0000:00:03.00',
      parentDevId: 'pci:0000:00:03.00',
      vlanTag: '20',
      MAC: '52:54:00:11:22:01',
      isAssigned: true,
      locked: true,
      linkStatus: 'down'
    });
    const ambig1 = mergeInterfaceInventory([assignedVlan, dupNamedVlan20], [{ name: 'eth0.10', link: 'up' }]);
    const ambig2 = mergeInterfaceInventory([dupNamedVlan20, assignedVlan], [{ name: 'eth0.10', link: 'up' }]);
    for (const res of [ambig1, ambig2]) {
      expect(res.matchedPairs).toHaveLength(0);
      expect(res.interfaces.every((i) => i.linkStatus === 'down' && i.locked === false)).toBe(true);
    }
  });

  test('Pass 2 single-stored-row branch recovers devId when a name-corroborated valid-devId report co-occurs with an ID-less observation, while keeping two distinct valid devIds ambiguous (in both report orders)', () => {
    const sharedMac = '52:54:00:de:ad:77';
    const legacyEth0Id = new mongoose.Types.ObjectId();

    const legacyEth0 = makeStoredInterface({
      _id: legacyEth0Id,
      name: 'eth0',
      devId: '',
      MAC: sharedMac,
      isAssigned: true,
      type: 'WAN',
      IPv4: '192.0.2.10',
      linkStatus: 'down'
    });

    const validReport = {
      name: 'eth0',
      devId: 'pci:0000:00:03.00',
      driver: 'igb',
      MAC: sharedMac,
      link: 'up',
      IPv4: '192.0.2.10',
      IPv4Mask: '24',
      deviceType: 'dpdk'
    };
    const idlessReport = {
      name: 'eth0',
      devId: '',
      driver: 'igb',
      MAC: sharedMac,
      link: 'down',
      IPv4: '',
      IPv4Mask: '',
      deviceType: 'dpdk'
    };

    const resAB = mergeInterfaceInventory([legacyEth0], [validReport, idlessReport]);
    const resBA = mergeInterfaceInventory([legacyEth0], [idlessReport, validReport]);

    const summarize = (res) => {
      const out = res.interfaces.find((i) => i._id.toString() === legacyEth0Id.toString());
      return {
        totalCount: res.interfaces.length,
        devId: out.devId,
        MAC: out.MAC,
        linkStatus: out.linkStatus,
        isAssigned: out.isAssigned,
        recovered: res.recoveredDevIds.map((r) => ({ name: r.existing.name, devId: r.devId })),
        addedCount: res.addedInterfaces.length,
        droppedDevIds: res.droppedReported.map((d) => d.devId)
      };
    };

    const summaryAB = summarize(resAB);
    const summaryBA = summarize(resBA);

    expect(summaryAB).toEqual(summaryBA);
    expect(summaryAB).toEqual({
      totalCount: 1,
      devId: 'pci:0000:00:03.00',
      MAC: sharedMac,
      linkStatus: 'up',
      isAssigned: true,
      recovered: [{ name: 'eth0', devId: 'pci:0000:00:03.00' }],
      addedCount: 0,
      droppedDevIds: ['']
    });

    // Two distinct valid devIds sharing the same MAC and name MUST remain ambiguous in both orders
    const secondValidReport = {
      ...validReport,
      devId: 'pci:0000:00:04.00'
    };
    const ambigAB = mergeInterfaceInventory([legacyEth0], [validReport, secondValidReport]);
    const ambigBA = mergeInterfaceInventory([legacyEth0], [secondValidReport, validReport]);
    for (const res of [ambigAB, ambigBA]) {
      const out = res.interfaces.find((i) => i._id.toString() === legacyEth0Id.toString());
      expect(out.devId).toBe('');
      expect(out.linkStatus).toBe('down');
      expect(res.recoveredDevIds).toHaveLength(0);
      expect(res.addedInterfaces).toHaveLength(0);
      expect(res.droppedReported.map((d) => d.devId).sort()).toEqual([
        'pci:0000:00:03.00',
        'pci:0000:00:04.00'
      ]);
    }
  });

  test('whitespace-only or third duplicate report never erases a valid-devId name conflict or lets MAC-less legacy rows acquire the devId by arrival order', () => {
    const legacyEth0Id = new mongoose.Types.ObjectId();
    const legacyEth1Id = new mongoose.Types.ObjectId();

    const legacyEth0 = makeStoredInterface({
      _id: legacyEth0Id,
      name: 'eth0',
      devId: '',
      MAC: '',
      isAssigned: true,
      type: 'WAN',
      IPv4: '192.0.2.10',
      linkStatus: 'down'
    });
    const legacyEth1 = makeStoredInterface({
      _id: legacyEth1Id,
      name: 'eth1',
      devId: '',
      MAC: '',
      isAssigned: true,
      type: 'LAN',
      IPv4: '10.0.1.1',
      linkStatus: 'down'
    });

    const baseReport = {
      devId: 'pci:0000:00:08.00',
      driver: 'igb',
      MAC: '',
      link: 'up',
      IPv4: '192.0.2.50',
      IPv4Mask: '24',
      deviceType: 'dpdk'
    };
    const repEth0 = { ...baseReport, name: 'eth0' };
    const repWhitespace = { ...baseReport, name: ' ' };
    const repEth1 = { ...baseReport, name: 'eth1' };
    const repEth2 = { ...baseReport, name: 'eth2' };

    const summarize = (res) => {
      const outEth0 = res.interfaces.find((i) => i._id.toString() === legacyEth0Id.toString());
      const outEth1 = res.interfaces.find((i) => i._id.toString() === legacyEth1Id.toString());
      const added = res.addedInterfaces.map((i) => ({
        name: i.name,
        devId: i.devId,
        IPv4: i.IPv4,
        linkStatus: i.linkStatus,
        isAssigned: i.isAssigned
      }));
      return {
        totalCount: res.interfaces.length,
        eth0: { devId: outEth0.devId, linkStatus: outEth0.linkStatus, isAssigned: outEth0.isAssigned },
        eth1: { devId: outEth1.devId, linkStatus: outEth1.linkStatus, isAssigned: outEth1.isAssigned },
        added,
        missingIds: res.missingInterfaces.map((i) => i._id.toString()).sort(),
        recoveredCount: res.recoveredDevIds.length,
        droppedCount: res.droppedReported.length
      };
    };

    const expected = {
      totalCount: 3,
      eth0: { devId: '', linkStatus: 'down', isAssigned: true },
      eth1: { devId: '', linkStatus: 'down', isAssigned: true },
      added: [
        {
          name: '',
          devId: 'pci:0000:00:08.00',
          IPv4: '192.0.2.50',
          linkStatus: 'up',
          isAssigned: false
        }
      ],
      missingIds: [legacyEth0Id.toString(), legacyEth1Id.toString()].sort(),
      recoveredCount: 0,
      droppedCount: 0
    };

    // All 6 permutations with whitespace-only report + third report after a recorded conflict
    const reportOrders = [
      [repEth0, repWhitespace, repEth1],
      [repEth1, repWhitespace, repEth0],
      [repWhitespace, repEth0, repEth1],
      [repWhitespace, repEth1, repEth0],
      [repEth0, repEth1, repWhitespace],
      [repEth1, repEth0, repWhitespace],
      [repEth0, repEth1, repEth0],
      [repEth1, repEth0, repEth1],
      [repEth0, repEth1, repEth2],
      [repEth0, { ...baseReport, name: '' }, repEth1]
    ];

    const summaries = reportOrders.map((reports) =>
      summarize(mergeInterfaceInventory([legacyEth0, legacyEth1], reports))
    );
    for (const summary of summaries) {
      expect(summary).toEqual(expected);
    }

    // Even when the whitespace-only report has a strictly higher score than eth0/eth1,
    // both arrival orders still record the conflict and produce identical results
    const lowEth0 = { devId: 'pci:0000:00:08.00', name: 'eth0', driver: 'igb', MAC: '', link: 'down', IPv4: '' };
    const lowEth1 = { devId: 'pci:0000:00:08.00', name: 'eth1', driver: 'igb', MAC: '', link: 'down', IPv4: '' };
    const highBlank = { ...baseReport, name: '   ' };
    expect(summarize(mergeInterfaceInventory([legacyEth0, legacyEth1], [lowEth0, highBlank, lowEth1]))).toEqual(expected);
    expect(summarize(mergeInterfaceInventory([legacyEth0, legacyEth1], [lowEth1, highBlank, lowEth0]))).toEqual(expected);
  });

  test('Pass 2 rejects MAC+tag VLAN candidates with conflicting known parentDevIds while still allowing omitted parentDevId (in both stored row orders)', () => {
    const sharedMac = '52:54:00:cc:dd:10';
    const parentEth0Id = new mongoose.Types.ObjectId();
    const legacyVlan3Id = new mongoose.Types.ObjectId();
    const legacyVlanNoParentId = new mongoose.Types.ObjectId();

    const parentEth0 = makeStoredInterface({
      _id: parentEth0Id,
      name: 'eth0',
      devId: 'pci:0000:00:03.00',
      parentDevId: '',
      vlanTag: '',
      MAC: sharedMac,
      isAssigned: true,
      locked: true,
      linkStatus: 'down'
    });
    const legacyVlan3 = makeStoredInterface({
      _id: legacyVlan3Id,
      name: 'eth0.10',
      devId: '',
      parentDevId: 'pci:0000:00:03.00',
      vlanTag: '10',
      MAC: sharedMac,
      isAssigned: true,
      locked: true,
      IPv4: '10.10.3.1',
      linkStatus: 'down'
    });
    const legacyVlanNoParent = makeStoredInterface({
      _id: legacyVlanNoParentId,
      name: 'eth1.10',
      devId: '',
      parentDevId: '',
      vlanTag: '10',
      MAC: sharedMac,
      isAssigned: true,
      locked: true,
      IPv4: '10.10.4.1',
      linkStatus: 'down'
    });

    const repParentEth0 = {
      name: 'eth0',
      devId: 'pci:0000:00:03.00',
      driver: 'igb',
      MAC: sharedMac,
      link: 'up',
      IPv4: '192.0.2.10',
      IPv4Mask: '24',
      deviceType: 'dpdk'
    };
    const repVlan4 = {
      name: 'eth0.10',
      devId: 'vlan.10.pci:0000:00:04.00',
      driver: 'igb',
      MAC: sharedMac,
      link: 'up',
      IPv4: '10.10.4.99',
      IPv4Mask: '24',
      deviceType: 'dpdk'
    };

    // Single-stored-row Pass 2 group for (sharedMac, vlanTag=10):
    // must NOT backfill vlan.10.pci:0000:00:04.00 onto legacy row owned by pci:0000:00:03.00
    const summarizeSingle = (res) => {
      const outLegacy = res.interfaces.find((i) => i._id.toString() === legacyVlan3Id.toString());
      const outAdded = res.addedInterfaces.map((i) => ({
        devId: i.devId,
        vlanTag: i.vlanTag,
        parentDevId: i.parentDevId,
        MAC: i.MAC,
        isAssigned: i.isAssigned
      }));
      return {
        totalCount: res.interfaces.length,
        legacy: {
          devId: outLegacy.devId,
          vlanTag: outLegacy.vlanTag,
          parentDevId: outLegacy.parentDevId,
          linkStatus: outLegacy.linkStatus,
          isAssigned: outLegacy.isAssigned
        },
        added: outAdded,
        recoveredCount: res.recoveredDevIds.length,
        droppedCount: res.droppedReported.length
      };
    };

    const singleOrder1 = summarizeSingle(mergeInterfaceInventory([parentEth0, legacyVlan3], [repParentEth0, repVlan4]));
    const singleOrder2 = summarizeSingle(mergeInterfaceInventory([legacyVlan3, parentEth0], [repParentEth0, repVlan4]));
    const singleOrder3 = summarizeSingle(mergeInterfaceInventory([parentEth0, legacyVlan3], [repVlan4, repParentEth0]));
    const singleOrder4 = summarizeSingle(mergeInterfaceInventory([legacyVlan3, parentEth0], [repVlan4, repParentEth0]));
    expect(singleOrder1).toEqual(singleOrder2);
    expect(singleOrder1).toEqual(singleOrder3);
    expect(singleOrder1).toEqual(singleOrder4);
    expect(singleOrder1).toEqual({
      totalCount: 3,
      legacy: {
        devId: '',
        vlanTag: '10',
        parentDevId: 'pci:0000:00:03.00',
        linkStatus: 'down',
        isAssigned: true
      },
      added: [
        {
          devId: 'vlan.10.pci:0000:00:04.00',
          vlanTag: '10',
          parentDevId: 'pci:0000:00:04.00',
          MAC: sharedMac,
          isAssigned: false
        }
      ],
      recoveredCount: 0,
      droppedCount: 0
    });

    // Multi-stored-row Pass 2 group for (sharedMac, vlanTag=10) in both stored row orders:
    // conflicting parent (legacyVlan3) is rejected, while omitted parent (legacyVlanNoParent) is allowed
    const repVlan4ForEth1 = { ...repVlan4, name: 'eth1.10' };
    const summarizeMulti = (res) => {
      const out3 = res.interfaces.find((i) => i._id.toString() === legacyVlan3Id.toString());
      const outNoParent = res.interfaces.find((i) => i._id.toString() === legacyVlanNoParentId.toString());
      return {
        totalCount: res.interfaces.length,
        legacy3: { devId: out3.devId, parentDevId: out3.parentDevId, linkStatus: out3.linkStatus },
        legacyNoParent: { devId: outNoParent.devId, vlanTag: outNoParent.vlanTag, linkStatus: outNoParent.linkStatus },
        recovered: res.recoveredDevIds.map((r) => ({ id: r.existing._id.toString(), devId: r.devId })),
        addedDevIds: res.addedInterfaces.map((i) => i.devId),
        droppedCount: res.droppedReported.length
      };
    };

    // Report named eth0.10 conflicts with legacyVlan3's parentDevId -> neither legacy row acquires it
    const multiConflict1 = summarizeMulti(mergeInterfaceInventory([legacyVlan3, legacyVlanNoParent], [repVlan4]));
    const multiConflict2 = summarizeMulti(mergeInterfaceInventory([legacyVlanNoParent, legacyVlan3], [repVlan4]));
    expect(multiConflict1).toEqual(multiConflict2);
    expect(multiConflict1).toEqual({
      totalCount: 3,
      legacy3: { devId: '', parentDevId: 'pci:0000:00:03.00', linkStatus: 'down' },
      legacyNoParent: { devId: '', vlanTag: '10', linkStatus: 'down' },
      recovered: [],
      addedDevIds: ['vlan.10.pci:0000:00:04.00'],
      droppedCount: 0
    });

    // Report named eth1.10 matches legacyVlanNoParent (omitted parentDevId) while legacyVlan3 stays untouched
    const multiAllowed1 = summarizeMulti(mergeInterfaceInventory([legacyVlan3, legacyVlanNoParent], [repVlan4ForEth1]));
    const multiAllowed2 = summarizeMulti(mergeInterfaceInventory([legacyVlanNoParent, legacyVlan3], [repVlan4ForEth1]));
    expect(multiAllowed1).toEqual(multiAllowed2);
    expect(multiAllowed1).toEqual({
      totalCount: 2,
      legacy3: { devId: '', parentDevId: 'pci:0000:00:03.00', linkStatus: 'down' },
      legacyNoParent: { devId: 'vlan.10.pci:0000:00:04.00', vlanTag: '10', linkStatus: 'up' },
      recovered: [{ id: legacyVlanNoParentId.toString(), devId: 'vlan.10.pci:0000:00:04.00' }],
      addedDevIds: [],
      droppedCount: 0
    });

    // Single-stored-row legitimate omission on either side still matches in Pass 2
    const storedOmitParentRes = mergeInterfaceInventory([legacyVlanNoParent], [repVlan4ForEth1]);
    expect(storedOmitParentRes.interfaces).toHaveLength(1);
    expect(storedOmitParentRes.interfaces[0].devId).toBe('vlan.10.pci:0000:00:04.00');
    expect(storedOmitParentRes.recoveredDevIds).toHaveLength(1);

    const reportOmitParentRes = mergeInterfaceInventory([legacyVlan3], [
      { name: 'eth0.10', devId: '', vlanTag: '10', parentDevId: '', MAC: sharedMac, link: 'up', IPv4: '10.10.3.1', IPv4Mask: '24' }
    ]);
    expect(reportOmitParentRes.interfaces).toHaveLength(1);
    expect(reportOmitParentRes.interfaces[0].devId).toBe('');
    expect(reportOmitParentRes.interfaces[0].parentDevId).toBe('pci:0000:00:03.00');
    expect(reportOmitParentRes.interfaces[0].linkStatus).toBe('up');
    expect(reportOmitParentRes.matchedPairs).toHaveLength(1);
  });

  test('Pass 2 rejects uppercase VLAN.10.<different-parent> report against stored tag-10 legacy row in both stored row orders and both report orders', () => {
    const sharedMac = '52:54:00:cc:dd:20';
    const parentEth0Id = new mongoose.Types.ObjectId();
    const legacyVlan3Id = new mongoose.Types.ObjectId();

    const parentEth0 = makeStoredInterface({
      _id: parentEth0Id,
      name: 'eth0',
      devId: 'pci:0000:00:03.00',
      parentDevId: '',
      vlanTag: '',
      MAC: sharedMac,
      isAssigned: true,
      locked: true,
      linkStatus: 'down'
    });
    const legacyVlan3 = makeStoredInterface({
      _id: legacyVlan3Id,
      name: 'eth0.10',
      devId: '',
      parentDevId: 'pci:0000:00:03.00',
      vlanTag: '10',
      MAC: sharedMac,
      isAssigned: true,
      locked: true,
      IPv4: '10.10.3.1',
      linkStatus: 'down'
    });

    const repParentEth0 = {
      name: 'eth0',
      devId: 'pci:0000:00:03.00',
      driver: 'igb',
      MAC: sharedMac,
      link: 'up',
      IPv4: '192.0.2.10',
      IPv4Mask: '24',
      deviceType: 'dpdk'
    };
    const repUpperVlan4ExplicitTag = {
      name: 'eth0.10',
      devId: 'VLAN.10.pci:0000:00:04.00',
      vlanTag: '10',
      driver: 'igb',
      MAC: sharedMac,
      link: 'up',
      IPv4: '10.10.4.99',
      IPv4Mask: '24',
      deviceType: 'dpdk'
    };
    const repUpperVlan4ImplicitTag = {
      name: 'eth0.10',
      devId: 'VLAN.10.pci:0000:00:04.00',
      driver: 'igb',
      MAC: sharedMac,
      link: 'up',
      IPv4: '10.10.4.99',
      IPv4Mask: '24',
      deviceType: 'dpdk'
    };

    const summarize = (res) => {
      const outLegacy = res.interfaces.find((i) => i._id.toString() === legacyVlan3Id.toString());
      return {
        totalCount: res.interfaces.length,
        legacy: {
          devId: outLegacy.devId,
          vlanTag: outLegacy.vlanTag,
          parentDevId: outLegacy.parentDevId,
          linkStatus: outLegacy.linkStatus,
          isAssigned: outLegacy.isAssigned
        },
        added: res.addedInterfaces.map((i) => ({
          devId: i.devId,
          MAC: i.MAC,
          isAssigned: i.isAssigned
        })),
        recoveredCount: res.recoveredDevIds.length,
        droppedCount: res.droppedReported.length
      };
    };

    for (const repUpperVlan4 of [repUpperVlan4ExplicitTag, repUpperVlan4ImplicitTag]) {
      const storedOrders = [
        [parentEth0, legacyVlan3],
        [legacyVlan3, parentEth0]
      ];
      const reportOrders = [
        [repParentEth0, repUpperVlan4],
        [repUpperVlan4, repParentEth0]
      ];

      const summaries = [];
      for (const stored of storedOrders) {
        for (const reports of reportOrders) {
          summaries.push(summarize(mergeInterfaceInventory(stored, reports)));
        }
      }

      for (const summary of summaries) {
        expect(summary).toEqual(summaries[0]);
        expect(summary.totalCount).toBe(3);
        expect(summary.legacy).toEqual({
          devId: '',
          vlanTag: '10',
          parentDevId: 'pci:0000:00:03.00',
          linkStatus: 'down',
          isAssigned: true
        });
        expect(summary.recoveredCount).toBe(0);
        expect(summary.droppedCount).toBe(0);
        expect(summary.added).toHaveLength(1);
        expect(summary.added[0]).toEqual({
          devId: 'VLAN.10.pci:0000:00:04.00',
          MAC: sharedMac,
          isAssigned: false
        });
      }
    }
  });

  test('Pass 2 rejects lowercase vlan.10.<different-parent> conflict in reversed report order across both stored row orders', () => {
    const sharedMac = '52:54:00:cc:dd:30';
    const parentEth0Id = new mongoose.Types.ObjectId();
    const legacyVlan3Id = new mongoose.Types.ObjectId();

    const parentEth0 = makeStoredInterface({
      _id: parentEth0Id,
      name: 'eth0',
      devId: 'pci:0000:00:03.00',
      parentDevId: '',
      vlanTag: '',
      MAC: sharedMac,
      isAssigned: true,
      locked: true,
      linkStatus: 'down'
    });
    const legacyVlan3 = makeStoredInterface({
      _id: legacyVlan3Id,
      name: 'eth0.10',
      devId: '',
      parentDevId: 'pci:0000:00:03.00',
      vlanTag: '10',
      MAC: sharedMac,
      isAssigned: true,
      locked: true,
      IPv4: '10.10.3.1',
      linkStatus: 'down'
    });

    const repParentEth0 = {
      name: 'eth0',
      devId: 'pci:0000:00:03.00',
      driver: 'igb',
      MAC: sharedMac,
      link: 'up',
      IPv4: '192.0.2.10',
      IPv4Mask: '24',
      deviceType: 'dpdk'
    };
    const repVlan4 = {
      name: 'eth0.10',
      devId: 'vlan.10.pci:0000:00:04.00',
      driver: 'igb',
      MAC: sharedMac,
      link: 'up',
      IPv4: '10.10.4.99',
      IPv4Mask: '24',
      deviceType: 'dpdk'
    };

    const resReversed1 = mergeInterfaceInventory([parentEth0, legacyVlan3], [repVlan4, repParentEth0]);
    const resReversed2 = mergeInterfaceInventory([legacyVlan3, parentEth0], [repVlan4, repParentEth0]);

    for (const res of [resReversed1, resReversed2]) {
      const outLegacy = res.interfaces.find((i) => i._id.toString() === legacyVlan3Id.toString());
      expect(res.interfaces).toHaveLength(3);
      expect(outLegacy.devId).toBe('');
      expect(outLegacy.vlanTag).toBe('10');
      expect(outLegacy.parentDevId).toBe('pci:0000:00:03.00');
      expect(outLegacy.linkStatus).toBe('down');
      expect(outLegacy.isAssigned).toBe(true);
      expect(res.recoveredDevIds).toHaveLength(0);
      expect(res.droppedReported).toHaveLength(0);
      expect(res.addedInterfaces).toHaveLength(1);
      expect(res.addedInterfaces[0]).toMatchObject({
        devId: 'vlan.10.pci:0000:00:04.00',
        vlanTag: '10',
        parentDevId: 'pci:0000:00:04.00',
        MAC: sharedMac,
        isAssigned: false
      });
    }
  });

  test('appending an uppercase-prefix VLAN devId populates vlanTag and overrides conflicting reported parentDevId', () => {
    const existing = [
      makeStoredInterface({
        name: 'eth0',
        devId: 'pci:0000:00:03.00',
        MAC: '52:54:00:dd:ee:01',
        isAssigned: true
      }),
      makeStoredInterface({
        name: 'eth1',
        devId: 'pci:0000:00:04.00',
        MAC: '52:54:00:dd:ee:02',
        isAssigned: false
      })
    ];

    const reported = [
      {
        name: 'eth0',
        devId: 'pci:0000:00:03.00',
        driver: 'igb',
        MAC: '52:54:00:dd:ee:01',
        link: 'up',
        IPv4: '192.0.2.10',
        IPv4Mask: '24',
        gateway: '192.0.2.1',
        metric: '0',
        mtu: 1500,
        dhcp: 'no',
        internetAccess: true,
        deviceType: 'dpdk'
      },
      {
        name: 'eth1',
        devId: 'pci:0000:00:04.00',
        driver: 'igb',
        MAC: '52:54:00:dd:ee:02',
        link: 'up',
        IPv4: '198.51.100.20',
        IPv4Mask: '24',
        gateway: '',
        metric: '',
        mtu: 1500,
        dhcp: 'no',
        deviceType: 'dpdk'
      },
      {
        name: 'eth1.10',
        devId: 'VLAN.10.pci:0000:00:04.00',
        parentDevId: 'pci:0000:00:03.00',
        driver: 'igb',
        MAC: '52:54:00:dd:ee:02',
        link: 'up',
        IPv4: '10.10.4.1',
        IPv4Mask: '24',
        deviceType: 'dpdk'
      }
    ];

    const res = mergeInterfaceInventory(existing, reported);

    expect(res.droppedReported).toHaveLength(0);
    expect(res.addedInterfaces).toHaveLength(1);
    expect(res.interfaces).toHaveLength(3);

    const addedVlan = res.addedInterfaces[0];
    expect(addedVlan.devId).toBe('VLAN.10.pci:0000:00:04.00');
    expect(addedVlan.vlanTag).toBe('10');
    expect(addedVlan.parentDevId).toBe('pci:0000:00:04.00');
    expect(addedVlan.parentDevId).not.toBe('pci:0000:00:03.00');

    const storedVlan = res.interfaces.find((i) => i.devId === 'VLAN.10.pci:0000:00:04.00');
    expect(storedVlan).toBeDefined();
    expect(storedVlan.vlanTag).toBe('10');
    expect(storedVlan.parentDevId).toBe('pci:0000:00:04.00');
    expect(res.interfaces.filter((i) => i.parentDevId === 'pci:0000:00:03.00')).toHaveLength(0);
  });
});
