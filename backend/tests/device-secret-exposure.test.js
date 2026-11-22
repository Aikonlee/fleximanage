/** @jest-environment node */
jest.mock('../logging/logging', () => () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
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
jest.mock('../utils/membershipUtils', () => ({
  getAccessTokenOrgList: jest.fn()
}));
jest.mock('../periodic/deviceStatus', () => () => ({
  getDeviceStatus: jest.fn(() => null)
}));
jest.mock('../deviceLogic/dispatcher', () => ({
  apply: jest.fn(async () => ({ ids: [] }))
}));
jest.mock('../utils/deviceQueue', () => {
  const api = new Proxy({}, {
    get (target, prop) {
      if (prop === 'then') return undefined;
      if (!Object.prototype.hasOwnProperty.call(target, prop)) {
        target[prop] = jest.fn();
      }
      return target[prop];
    }
  });
  const factory = () => api;
  return new Proxy(factory, {
    get (target, prop, receiver) {
      if (prop === 'then') return undefined;
      if (Reflect.has(target, prop)) return Reflect.get(target, prop, receiver);
      return api[prop];
    }
  });
});

const { getAccessTokenOrgList } = require('../utils/membershipUtils');
const appStore = require('../models/applicationStore');
const applications = require('../models/applications');
const ApplicationsService = require('../services/ApplicationsService');
const RemoteVpn = require('../applicationLogic/apps/com.flexiwan.remotevpn');

const org = '507f1f77bcf86cd799439011';
const user = { _id: 'viewer-1', role: 'viewer' };
const SECRET_KEYS = 'configuration-keys-should-not-leak';
const SECRET_PRIVATE = 'gsuite-private-key-should-not-leak';

function configuration () {
  return {
    keys: { material: SECRET_KEYS },
    serverPort: 1194,
    networkId: 'branch',
    authentications: {
      gsuite: {
        enabled: true,
        domains: [{
          domain: 'example.com',
          clientEmail: 'svc@example.com',
          groups: 'eng',
          impersonateEmail: 'admin@example.com',
          privateKey: SECRET_PRIVATE
        }]
      },
      office365: {
        enabled: false,
        domains: [{ domain: 'contoso.com', groups: '' }]
      }
    }
  };
}

function purchasedApp (identifier) {
  return {
    _id: '507f1f77bcf86cd799439014',
    org,
    installedVersion: '1.0.0',
    pendingToUpgrade: false,
    statuses: [],
    configuration: configuration(),
    appStoreApp: {
      _id: '507f1f77bcf86cd799439015',
      identifier,
      name: 'Remote VPN',
      versions: [{ version: '1.0.0' }]
    }
  };
}

function query (value) {
  const result = {
    select () { return result; },
    populate () { return result; },
    lean () { return Promise.resolve(value); },
    then (resolve, reject) {
      return Promise.resolve(value).then(resolve, reject);
    }
  };
  return result;
}

function assertNoSecrets (value) {
  const text = JSON.stringify(value);
  expect(text).not.toContain(SECRET_KEYS);
  expect(text).not.toContain(SECRET_PRIVATE);
  expect(text).not.toContain('privateKey');
  expect(text).not.toContain('"keys"');
}

beforeEach(() => {
  getAccessTokenOrgList.mockReset();
  getAccessTokenOrgList.mockResolvedValue([org]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('remotevpn selectConfigurationParams drops privateKey and keys', async () => {
  const vpn = new RemoteVpn();
  const result = await vpn.selectConfigurationParams(configuration());
  const domain = result.authentications.gsuite.domains[0];

  expect(result.keys).toBeUndefined();
  expect(result.keysExist).toBe(1);
  expect(result.serverPort).toBe(1194);
  expect(result.networkId).toBe('branch');
  expect(domain.domain).toBe('example.com');
  expect(domain.clientEmail).toBe('svc@example.com');
  expect(domain.groups).toBe('eng');
  expect(domain.impersonateEmail).toBe('admin@example.com');
  expect(domain.privateKey).toBeUndefined();
  expect(result.authentications.office365.domains[0].domain).toBe('contoso.com');
  assertNoSecrets(result);
});

test('purchased app response keeps public fields and drops secrets', async () => {
  const parsed = await ApplicationsService.selectApplicationParams(
    purchasedApp('com.flexiwan.remotevpn')
  );
  const domain = parsed.configuration.authentications.gsuite.domains[0];

  expect(parsed.configuration.serverPort).toBe(1194);
  expect(parsed.configuration.networkId).toBe('branch');
  expect(parsed.configuration.keys).toBeUndefined();
  expect(domain.domain).toBe('example.com');
  expect(domain.clientEmail).toBe('svc@example.com');
  expect(domain.groups).toBe('eng');
  expect(domain.privateKey).toBeUndefined();
  assertNoSecrets(parsed);
});

test('appstore and purchased responses omit secret configuration paths', async () => {
  const catalog = {
    _id: '507f1f77bcf86cd799439016',
    name: 'Remote VPN',
    identifier: 'com.flexiwan.remotevpn',
    configuration: configuration()
  };
  jest.spyOn(appStore, 'find').mockImplementation(() => query([catalog]));
  jest.spyOn(appStore, 'aggregate').mockImplementation(() => ({
    allowDiskUse: () => Promise.resolve([{
      ...catalog,
      _id: '507f1f77bcf86cd799439017'
    }])
  }));
  jest.spyOn(applications, 'findOne').mockImplementation(() => query(
    purchasedApp('com.example.other')
  ));
  jest.spyOn(applications, 'aggregate').mockImplementation(() => ({
    allowDiskUse: () => Promise.resolve([purchasedApp('com.example.other')])
  }));

  const store = await ApplicationsService.appstoreGET({}, { user });
  const filtered = await ApplicationsService.appstoreGET({
    filters: JSON.stringify([{ key: 'name', op: '==', val: 'Remote VPN' }])
  }, { user });
  const purchased = await ApplicationsService.appstorePurchasedIdGET(
    { org, id: '507f1f77bcf86cd799439014' },
    { user }
  );
  const purchasedList = await ApplicationsService.appstorePurchasedGET(
    { org },
    { user }
  );

  for (const result of [store, filtered, purchased, purchasedList]) {
    expect(result.code).toBe(200);
    assertNoSecrets(result.payload);
  }

  const storeApp = store.payload[0];
  expect(storeApp.name).toBe('Remote VPN');
  expect(storeApp.configuration.serverPort).toBe(1194);
  expect(storeApp.configuration.networkId).toBe('branch');
  expect(storeApp.configuration.authentications.gsuite.domains[0].domain)
    .toBe('example.com');
  expect(storeApp.configuration.authentications.gsuite.domains[0].clientEmail)
    .toBe('svc@example.com');

  const bought = purchased.payload;
  expect(bought.configuration.serverPort).toBe(1194);
  expect(bought.configuration.authentications.office365.domains[0].domain)
    .toBe('contoso.com');
  expect(bought.appStoreApp.identifier).toBe('com.example.other');

  const listed = purchasedList.payload[0];
  expect(listed.installedVersion).toBe('1.0.0');
  expect(listed.configuration.networkId).toBe('branch');
  expect(listed.configuration.authentications.gsuite.domains[0].groups).toBe('eng');
});
