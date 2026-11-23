/** @jest-environment node */

jest.mock('express', () => {
  const router = { get: jest.fn(), put: jest.fn() };
  return { Router: () => router, __router: router };
});
jest.mock('../logging/logging', () => () => ({ info: jest.fn(), error: jest.fn() }));
jest.mock('../models/devices', () => ({ devices: { findOne: jest.fn() } }));
jest.mock('../authenticate', () => ({ verifyPermission: () => (req, res, next) => next() }));
jest.mock('../utils/membershipUtils', () => ({ getAccessTokenOrgList: jest.fn() }));
jest.mock('../deviceLogic/dispatcher', () => ({ apply: jest.fn() }));

const express = require('express');
const { devices } = require('../models/devices');
const { getAccessTokenOrgList } = require('../utils/membershipUtils');
const dispatcher = require('../deviceLogic/dispatcher');

require('../routes/interfaces-routing');

const getHandler = express.__router.get.mock.calls[0][2];
const putHandler = express.__router.put.mock.calls[0][2];

const clone = (value) => JSON.parse(JSON.stringify(value));

function makeDevice () {
  const device = {
    status: 'running',
    bgp: { enable: false },
    interfaces: [
      { _id: 'if1', routing: 'NONE', ospf: { area: '0', keyId: '', key: '' } }
    ],
    toObject () {
      return clone({
        status: this.status,
        bgp: this.bgp,
        interfaces: this.interfaces
      });
    },
    save: jest.fn(async function save () { return this; })
  };
  device.interfaces.id = (id) => device.interfaces.find((iface) => iface._id === id);
  return device;
}

beforeEach(() => {
  jest.clearAllMocks();
  getAccessTokenOrgList.mockResolvedValue(['org-1']);
  dispatcher.apply.mockResolvedValue(undefined);
});

test('running device modify job diffs pre-image from post routing/ospf mutation', async () => {
  const device = makeDevice();
  devices.findOne.mockResolvedValue(device);

  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const user = { _id: 'user-1' };
  await putHandler({
    user,
    query: {},
    params: { deviceId: 'dev-1', interfaceId: 'if1' },
    body: { protocol: 'OSPF', ospf: { area: '1', keyId: 'k', key: 'secret' } }
  }, res);

  expect(res.status).toHaveBeenCalledWith(200);
  expect(dispatcher.apply).toHaveBeenCalledTimes(1);
  const [preImages, op, applyUser, data] = dispatcher.apply.mock.calls[0];
  expect(op).toBe('modify');
  expect(applyUser).toBe(user);
  expect(data.org).toBe('org-1');
  expect(data.newDevice).toBe(device);
  expect(preImages).toHaveLength(1);
  expect(preImages[0]).not.toBe(device);
  expect(preImages[0].interfaces[0].routing).toBe('NONE');
  expect(preImages[0].interfaces[0].ospf.area).toBe('0');
  expect(device.interfaces[0].routing).toBe('OSPF');
  expect(device.interfaces[0].ospf.area).toBe('1');
  expect(preImages[0]).not.toEqual(clone(device));

  // A5: PUT response must never return the OSPF shared key in plaintext.
  const putBody = res.json.mock.calls[0][0];
  expect(putBody.ospf.key).toBeUndefined();
  expect('key' in putBody.ospf).toBe(false);
  expect(putBody.ospf.keyConfigured).toBe(true);
  expect(JSON.stringify(putBody)).not.toContain('secret');
});

test('GET interface routing omits ospf.key and returns keyConfigured boolean', async () => {
  const device = makeDevice();
  device.interfaces[0].routing = 'OSPF';
  device.interfaces[0].ospf = { area: '0.0.0.1', keyId: '7', key: 'top-secret-ospf', cost: 20 };
  devices.findOne.mockResolvedValue(device);

  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await getHandler({
    user: { _id: 'viewer-1' },
    query: {},
    params: { deviceId: 'dev-1', interfaceId: 'if1' }
  }, res);

  expect(res.status).toHaveBeenCalledWith(200);
  const body = res.json.mock.calls[0][0];
  expect(body.ospf).toEqual({
    area: '0.0.0.1',
    keyId: '7',
    cost: 20,
    keyConfigured: true
  });
  expect('key' in body.ospf).toBe(false);
  expect(JSON.stringify(body)).not.toContain('top-secret-ospf');

  // When key is empty, keyConfigured is false and key is still absent.
  device.interfaces[0].ospf = { area: '0', keyId: '', key: '' };
  const res2 = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await getHandler({
    user: { _id: 'viewer-1' },
    query: {},
    params: { deviceId: 'dev-1', interfaceId: 'if1' }
  }, res2);
  const body2 = res2.json.mock.calls[0][0];
  expect(body2.ospf).toEqual({ area: '0', keyId: '', keyConfigured: false });
  expect('key' in body2.ospf).toBe(false);
});

test('PUT interface routing preserves stored ospf.key when omitted and matches GET projection', async () => {
  const device = makeDevice();
  device.interfaces[0].routing = 'OSPF';
  device.interfaces[0].ospf = { area: '0.0.0.1', keyId: '7', key: 'persisted-secret', cost: 20 };
  devices.findOne.mockResolvedValue(device);

  const putRes = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await putHandler({
    user: { _id: 'user-1' },
    query: {},
    params: { deviceId: 'dev-1', interfaceId: 'if1' },
    body: {
      protocol: 'OSPF',
      ospf: { area: '0.0.0.2', keyId: '7', cost: 15, key: undefined, keyConfigured: false }
    }
  }, putRes);

  expect(putRes.status).toHaveBeenCalledWith(200);
  // Stored key remains unchanged and read-only keyConfigured is not persisted.
  expect(device.interfaces[0].ospf).toEqual({
    area: '0.0.0.2',
    keyId: '7',
    key: 'persisted-secret',
    cost: 15
  });
  expect('keyConfigured' in device.interfaces[0].ospf).toBe(false);

  const putBody = putRes.json.mock.calls[0][0];
  expect('key' in putBody.ospf).toBe(false);
  expect(JSON.stringify(putBody)).not.toContain('persisted-secret');

  const getRes = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await getHandler({
    user: { _id: 'viewer-1' },
    query: {},
    params: { deviceId: 'dev-1', interfaceId: 'if1' }
  }, getRes);

  expect(putBody.ospf).toEqual(getRes.json.mock.calls[0][0].ospf);
  expect(putBody.ospf).toEqual({
    area: '0.0.0.2',
    keyId: '7',
    cost: 15,
    keyConfigured: true
  });
});
