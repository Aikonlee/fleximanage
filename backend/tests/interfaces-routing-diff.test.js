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
});
