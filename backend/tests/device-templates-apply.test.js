/** @jest-environment node */
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { Types: { ObjectId } } = require('mongoose');

jest.mock('../models/deviceTemplates', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  countDocuments: jest.fn(),
  create: jest.fn(),
  deleteOne: jest.fn()
}));

jest.mock('../models/devices', () => ({
  findOne: jest.fn(),
  devices: {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn()
  },
  staticroutes: jest.fn(),
  dhcpModel: {}
}));

jest.mock('../utils/membershipUtils', () => ({
  getAccessTokenOrgList: jest.fn()
}));

jest.mock('../services/DevicesService', () => ({
  devicesIdStaticroutesPOST: jest.fn()
}));

jest.mock('../logging/logging', () => () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn()
}));

const DeviceTemplates = require('../models/deviceTemplates');
const Devices = require('../models/devices');
const { getAccessTokenOrgList } = require('../utils/membershipUtils');
const DevicesService = require('../services/DevicesService');
const Service = require('../services/Service');
const Controller = require('../controllers/Controller');
const DeviceTemplatesController = require('../controllers/DeviceTemplatesController');
const DeviceTemplatesService = require('../services/DeviceTemplatesService');

const ownOrg = new ObjectId().toString();
const otherOrg = new ObjectId().toString();
const userId = new ObjectId().toString();
const templateId = new ObjectId().toString();
const deviceId = new ObjectId().toString();
const routeId = new ObjectId().toString();

function makeUser (overrides = {}) {
  return {
    _id: userId,
    defaultOrg: { _id: ownOrg },
    ...overrides
  };
}

function makeTemplate (overrides = {}) {
  return {
    _id: templateId,
    org: ownOrg,
    name: 'branch-static-route',
    description: 'Single static route template',
    version: 3,
    config: {
      staticroutes: [
        {
          destination: '10.20.0.0/24',
          gateway: '192.168.1.1'
        }
      ]
    },
    createdBy: userId,
    ...overrides
  };
}

function makeDevice (overrides = {}) {
  return {
    _id: deviceId,
    org: ownOrg,
    isApproved: true,
    ...overrides
  };
}

function makeResponse () {
  return {
    location: jest.fn(),
    setHeader: jest.fn()
  };
}

describe('DeviceTemplatesService.devicetemplatesIdApplyPOST', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getAccessTokenOrgList.mockResolvedValue([ownOrg]);
    DeviceTemplates.findOne.mockResolvedValue(makeTemplate());
    Devices.findOne.mockResolvedValue(makeDevice());
    DevicesService.devicesIdStaticroutesPOST.mockResolvedValue(
      Service.successResponse(
        {
          _id: routeId,
          destination: '10.20.0.0/24',
          gateway: '192.168.1.1',
          redistributeViaOSPF: false
        },
        201
      )
    );
  });

  describe('authorization and org scope', () => {
    test('rejects missing user with 403 and makes no downstream calls', async () => {
      const res = await DeviceTemplatesService.devicetemplatesIdApplyPOST(
        { id: templateId, deviceId },
        { user: null, server: {} },
        makeResponse()
      );

      expect(res.code).toBe(403);
      expect(getAccessTokenOrgList).not.toHaveBeenCalled();
      expect(DeviceTemplates.findOne).not.toHaveBeenCalled();
      expect(Devices.findOne).not.toHaveBeenCalled();
      expect(DevicesService.devicesIdStaticroutesPOST).not.toHaveBeenCalled();
    });

    test('viewer / empty org scope returns 403 with no downstream call', async () => {
      getAccessTokenOrgList.mockResolvedValue([]);
      const user = makeUser({ role: 'viewer' });

      const res = await DeviceTemplatesService.devicetemplatesIdApplyPOST(
        { id: templateId, deviceId },
        { user, server: {} },
        makeResponse()
      );

      expect(res.code).toBe(403);
      expect(getAccessTokenOrgList).toHaveBeenCalledWith(user, undefined, true, null, '', true);
      expect(DeviceTemplates.findOne).not.toHaveBeenCalled();
      expect(Devices.findOne).not.toHaveBeenCalled();
      expect(DevicesService.devicesIdStaticroutesPOST).not.toHaveBeenCalled();
    });

    test(
      'owner/manager org scope passes and forwards trimmed requestedOrg for access token',
      async () => {
        const user = makeUser({ accessToken: true });
        const server = { name: 'test-server' };
        const response = makeResponse();

        const res = await DeviceTemplatesService.devicetemplatesIdApplyPOST(
          { id: templateId, org: `  ${ownOrg}  `, deviceId },
          { user, server },
          response
        );

        expect(res.code).toBe(202);
        expect(getAccessTokenOrgList).toHaveBeenCalledWith(user, ownOrg, true, null, '', true);
        expect(DevicesService.devicesIdStaticroutesPOST).toHaveBeenCalledTimes(1);
        expect(DevicesService.devicesIdStaticroutesPOST).toHaveBeenCalledWith(
          {
            id: deviceId,
            org: ownOrg,
            staticRouteRequest: {
              destination: '10.20.0.0/24',
              gateway: '192.168.1.1',
              redistributeViaOSPF: false
            }
          },
          { user, server },
          response,
          {
            requireApproved: true,
            expectedOrg: ownOrg
          }
        );
      });

    test('rejects org query param rules via validateWriteOrg with 400', async () => {
      const uiRes = await DeviceTemplatesService.devicetemplatesIdApplyPOST(
        { id: templateId, org: ownOrg, deviceId },
        { user: makeUser(), server: {} },
        makeResponse()
      );
      expect(uiRes.code).toBe(400);

      const tokenNoOrgRes = await DeviceTemplatesService.devicetemplatesIdApplyPOST(
        { id: templateId, deviceId },
        { user: makeUser({ accessToken: true }), server: {} },
        makeResponse()
      );
      expect(tokenNoOrgRes.code).toBe(400);
      expect(DevicesService.devicesIdStaticroutesPOST).not.toHaveBeenCalled();
    });
  });

  describe('org isolation (foreign-org template and foreign-org device)', () => {
    test('foreign-org template returns 404 with no device lookup or downstream call', async () => {
      DeviceTemplates.findOne.mockResolvedValue(null);

      const res = await DeviceTemplatesService.devicetemplatesIdApplyPOST(
        { id: templateId, deviceId },
        { user: makeUser(), server: {} },
        makeResponse()
      );

      expect(res.code).toBe(404);
      expect(DeviceTemplates.findOne).toHaveBeenCalledWith(
        { _id: templateId, org: { $in: [ownOrg] } },
        expect.objectContaining({ org: 1, version: 1, config: 1 })
      );
      expect(Devices.findOne).not.toHaveBeenCalled();
      expect(DevicesService.devicesIdStaticroutesPOST).not.toHaveBeenCalled();
    });

    test(
      'foreign-org device (not returned by org-scoped query) returns 404 with no downstream call',
      async () => {
        Devices.findOne.mockResolvedValue(null);

        const res = await DeviceTemplatesService.devicetemplatesIdApplyPOST(
          { id: templateId, deviceId },
          { user: makeUser(), server: {} },
          makeResponse()
        );

        expect(res.code).toBe(404);
        expect(Devices.findOne).toHaveBeenCalledWith({
          _id: deviceId,
          org: { $in: [ownOrg] }
        });
        expect(DevicesService.devicesIdStaticroutesPOST).not.toHaveBeenCalled();
      }
    );

    test(
      'device belonging to a different org than the template returns 404 with no downstream call',
      async () => {
        getAccessTokenOrgList.mockResolvedValue([ownOrg, otherOrg]);
        DeviceTemplates.findOne.mockResolvedValue(makeTemplate({ org: ownOrg }));
        Devices.findOne.mockResolvedValue(makeDevice({ org: otherOrg }));

        const res = await DeviceTemplatesService.devicetemplatesIdApplyPOST(
          { id: templateId, deviceId },
          { user: makeUser(), server: {} },
          makeResponse()
        );

        expect(res.code).toBe(404);
        expect(DevicesService.devicesIdStaticroutesPOST).not.toHaveBeenCalled();
      }
    );
  });

  describe('id and deviceId validation', () => {
    test.each([
      ['malformed template id', { id: 'not-an-objectid', deviceId }],
      ['empty template id', { id: '', deviceId }],
      ['malformed deviceId', { id: templateId, deviceId: 'bad-device-id' }],
      ['missing deviceId', { id: templateId }],
      ['empty deviceId', { id: templateId, deviceId: '' }],
      ['non-string deviceId', { id: templateId, deviceId: 12345 }]
    ])('%s returns 400 with zero lookups or downstream calls', async (_label, params) => {
      const res = await DeviceTemplatesService.devicetemplatesIdApplyPOST(
        params,
        { user: makeUser(), server: {} },
        makeResponse()
      );

      expect(res.code).toBe(400);
      expect(DeviceTemplates.findOne).not.toHaveBeenCalled();
      expect(Devices.findOne).not.toHaveBeenCalled();
      expect(DevicesService.devicesIdStaticroutesPOST).not.toHaveBeenCalled();
    });
  });

  describe('strict template.config validation', () => {
    const protoPollutedTop = JSON.parse(
      '{"staticroutes":[{"destination":"10.20.0.0/24","gateway":"192.168.1.1"}],' +
      '"__proto__":{"polluted":true}}'
    );
    const protoPollutedRoute = JSON.parse(
      '{"staticroutes":[{"destination":"10.20.0.0/24","gateway":"192.168.1.1",' +
      '"__proto__":{"polluted":true}}]}'
    );

    test.each([
      [
        'extra top-level key (hostname)',
        {
          staticroutes: [{ destination: '10.20.0.0/24', gateway: '192.168.1.1' }],
          hostname: 'branch-1'
        }
      ],
      [
        'non-staticroutes config only',
        { hostname: 'branch-1', interfaces: [] }
      ],
      [
        'empty config object',
        {}
      ],
      [
        'two routes in staticroutes',
        {
          staticroutes: [
            { destination: '10.20.0.0/24', gateway: '192.168.1.1' },
            { destination: '10.30.0.0/24', gateway: '192.168.1.1' }
          ]
        }
      ],
      [
        'zero routes in staticroutes',
        { staticroutes: [] }
      ],
      [
        'missing gateway key',
        { staticroutes: [{ destination: '10.20.0.0/24' }] }
      ],
      [
        'missing destination key',
        { staticroutes: [{ gateway: '192.168.1.1' }] }
      ],
      [
        'extra key in route object',
        {
          staticroutes: [
            {
              destination: '10.20.0.0/24',
              gateway: '192.168.1.1',
              redistributeViaOSPF: true
            }
          ]
        }
      ],
      [
        'unsafe $where key at top level',
        {
          staticroutes: [{ destination: '10.20.0.0/24', gateway: '192.168.1.1' }],
          $where: '1 == 1'
        }
      ],
      [
        'unsafe $set key in route object',
        {
          staticroutes: [
            { destination: '10.20.0.0/24', gateway: '192.168.1.1', $set: {} }
          ]
        }
      ],
      [
        'unsafe __proto__ key at top level',
        protoPollutedTop
      ],
      [
        'unsafe __proto__ key in route object',
        protoPollutedRoute
      ],
      [
        'unsafe constructor key',
        {
          staticroutes: [{ destination: '10.20.0.0/24', gateway: '192.168.1.1' }],
          constructor: {}
        }
      ],
      [
        'default route 0.0.0.0/0',
        { staticroutes: [{ destination: '0.0.0.0/0', gateway: '192.168.1.1' }] }
      ],
      [
        'default route with leading-zero prefix 0.0.0.0/00',
        { staticroutes: [{ destination: '0.0.0.0/00', gateway: '192.168.1.1' }] }
      ],
      [
        'default route with triple-zero prefix 0.0.0.0/000',
        { staticroutes: [{ destination: '0.0.0.0/000', gateway: '192.168.1.1' }] }
      ],
      [
        'non-zero IP with zero prefix 10.0.0.0/0',
        { staticroutes: [{ destination: '10.0.0.0/0', gateway: '192.168.1.1' }] }
      ],
      [
        'non-zero IP with double-zero prefix 10.0.0.0/00',
        { staticroutes: [{ destination: '10.0.0.0/00', gateway: '192.168.1.1' }] }
      ],
      [
        'non-canonical leading zero in CIDR prefix 10.20.0.0/08',
        { staticroutes: [{ destination: '10.20.0.0/08', gateway: '192.168.1.1' }] }
      ],
      [
        'out-of-range CIDR prefix 10.20.0.0/33',
        { staticroutes: [{ destination: '10.20.0.0/33', gateway: '192.168.1.1' }] }
      ],
      [
        'missing CIDR slash 10.20.0.0',
        { staticroutes: [{ destination: '10.20.0.0', gateway: '192.168.1.1' }] }
      ],
      [
        'non-IPv4 destination ::/0',
        { staticroutes: [{ destination: '::/0', gateway: '192.168.1.1' }] }
      ],
      [
        'wrong type for config (null)',
        null
      ],
      [
        'wrong type for config (array)',
        [{ destination: '10.20.0.0/24', gateway: '192.168.1.1' }]
      ],
      [
        'wrong type for staticroutes (object instead of array)',
        { staticroutes: { destination: '10.20.0.0/24', gateway: '192.168.1.1' } }
      ],
      [
        'wrong type for destination (number)',
        { staticroutes: [{ destination: 1234, gateway: '192.168.1.1' }] }
      ],
      [
        'empty destination string',
        { staticroutes: [{ destination: '   ', gateway: '192.168.1.1' }] }
      ],
      [
        'empty gateway string',
        { staticroutes: [{ destination: '10.20.0.0/24', gateway: '' }] }
      ]
    ])(
      'rejects %s with 400 and ZERO calls to Devices or DevicesService',
      async (_label, config) => {
        DeviceTemplates.findOne.mockResolvedValue(makeTemplate({ config }));

        const res = await DeviceTemplatesService.devicetemplatesIdApplyPOST(
          { id: templateId, deviceId },
          { user: makeUser(), server: {} },
          makeResponse()
        );

        expect(res.code).toBe(400);
        expect(res.error).toBeTruthy();
        expect(Devices.findOne).not.toHaveBeenCalled();
        expect(DevicesService.devicesIdStaticroutesPOST).not.toHaveBeenCalled();
      }
    );

    test.each([
      ['0.0.0.0/0'],
      ['0.0.0.0/00'],
      ['0.0.0.0/000'],
      ['10.0.0.0/00']
    ])(
      'rejects zero-prefix destination %s with exact default-route 400 message and zero lookups',
      async (destination) => {
        DeviceTemplates.findOne.mockResolvedValue(
          makeTemplate({
            config: {
              staticroutes: [{ destination, gateway: '192.168.1.1' }]
            }
          })
        );

        const res = await DeviceTemplatesService.devicetemplatesIdApplyPOST(
          { id: templateId, deviceId },
          { user: makeUser(), server: {} },
          makeResponse()
        );

        expect(res.code).toBe(400);
        expect(res.error).toBe(
          'Invalid template static route: default route 0.0.0.0/0 is not allowed'
        );
        expect(Devices.findOne).not.toHaveBeenCalled();
        expect(DevicesService.devicesIdStaticroutesPOST).not.toHaveBeenCalled();
      }
    );
  });

  describe('device approval state', () => {
    test('unapproved device returns 409 with exact message and ZERO downstream call', async () => {
      Devices.findOne.mockResolvedValue(makeDevice({ isApproved: false }));

      const res = await DeviceTemplatesService.devicetemplatesIdApplyPOST(
        { id: templateId, deviceId },
        { user: makeUser(), server: {} },
        makeResponse()
      );

      expect(res.code).toBe(409);
      expect(res.error).toBe('Device must be first approved');
      expect(DevicesService.devicesIdStaticroutesPOST).not.toHaveBeenCalled();
    });
  });

  describe('apply execution and downstream propagation', () => {
    test(
      'calls DevicesService.devicesIdStaticroutesPOST once and returns 202 payload',
      async () => {
        const user = makeUser();
        const server = { jobs: true };
        const response = makeResponse();

        const res = await DeviceTemplatesService.devicetemplatesIdApplyPOST(
          { id: templateId, deviceId },
          { user, server },
          response
        );

        expect(DevicesService.devicesIdStaticroutesPOST).toHaveBeenCalledTimes(1);
        expect(DevicesService.devicesIdStaticroutesPOST).toHaveBeenCalledWith(
          {
            id: deviceId,
            org: undefined,
            staticRouteRequest: {
              destination: '10.20.0.0/24',
              gateway: '192.168.1.1',
              redistributeViaOSPF: false
            }
          },
          { user, server },
          response,
          {
            requireApproved: true,
            expectedOrg: ownOrg
          }
        );
        expect(res.code).toBe(202);
        expect(res.payload).toEqual({
          templateId,
          version: 3,
          deviceId,
          routeId,
          destination: '10.20.0.0/24',
          gateway: '192.168.1.1'
        });
      });

    test('propagates downstream 400 error unchanged and does not return 202', async () => {
      const downstreamErr = Service.rejectResponse('Invalid gateway for device interfaces', 400);
      DevicesService.devicesIdStaticroutesPOST.mockResolvedValue(downstreamErr);

      const res = await DeviceTemplatesService.devicetemplatesIdApplyPOST(
        { id: templateId, deviceId },
        { user: makeUser(), server: {} },
        makeResponse()
      );

      expect(res).toBe(downstreamErr);
      expect(res.code).toBe(400);
      expect(res.error).toBe('Invalid gateway for device interfaces');
    });

    test('propagates downstream 500 error unchanged and does not return 202', async () => {
      const downstreamErr = Service.rejectResponse('Agent dispatch failed', 500);
      DevicesService.devicesIdStaticroutesPOST.mockResolvedValue(downstreamErr);

      const res = await DeviceTemplatesService.devicetemplatesIdApplyPOST(
        { id: templateId, deviceId },
        { user: makeUser(), server: {} },
        makeResponse()
      );

      expect(res).toBe(downstreamErr);
      expect(res.code).toBe(500);
      expect(res.error).toBe('Agent dispatch failed');
    });

    test(
      'wraps unexpected thrown exceptions with handleError and does not return 202',
      async () => {
        DevicesService.devicesIdStaticroutesPOST.mockRejectedValue(
          new Error('DB connection lost')
        );

        const res = await DeviceTemplatesService.devicetemplatesIdApplyPOST(
          { id: templateId, deviceId },
          { user: makeUser(), server: {} },
          makeResponse()
        );

        expect(res.code).toBe(500);
        expect(res.error).toBe('DB connection lost');
      }
    );

    test(
      'passes ObjectId orgList[0] as expectedOrg in 4th arg even when access key org is a string',
      async () => {
        const orgObjId = new ObjectId(ownOrg);
        getAccessTokenOrgList.mockResolvedValue([orgObjId]);
        const user = makeUser({ accessToken: true });
        const server = { jobs: true };
        const response = makeResponse();

        const res = await DeviceTemplatesService.devicetemplatesIdApplyPOST(
          { id: templateId, org: ownOrg, deviceId },
          { user, server },
          response
        );

        expect(res.code).toBe(202);
        const fourthArg = DevicesService.devicesIdStaticroutesPOST.mock.calls[0][3];
        expect(fourthArg).toEqual({
          requireApproved: true,
          expectedOrg: orgObjId
        });
        expect(fourthArg.expectedOrg).toBeInstanceOf(ObjectId);
      }
    );

    test('propagates downstream 409 error unchanged and does not return 202', async () => {
      const downstreamErr = Service.rejectResponse('Device is not approved or out of scope', 409);
      DevicesService.devicesIdStaticroutesPOST.mockResolvedValue(downstreamErr);

      const res = await DeviceTemplatesService.devicetemplatesIdApplyPOST(
        { id: templateId, deviceId },
        { user: makeUser(), server: {} },
        makeResponse()
      );

      expect(res).toBe(downstreamErr);
      expect(res.code).toBe(409);
      expect(res.error).toBe('Device is not approved or out of scope');
    });

    test('propagates downstream 404 error unchanged and does not return 202', async () => {
      const downstreamErr = Service.rejectResponse('Device not found', 404);
      DevicesService.devicesIdStaticroutesPOST.mockResolvedValue(downstreamErr);

      const res = await DeviceTemplatesService.devicetemplatesIdApplyPOST(
        { id: templateId, deviceId },
        { user: makeUser(), server: {} },
        makeResponse()
      );

      expect(res).toBe(downstreamErr);
      expect(res.code).toBe(404);
      expect(res.error).toBe('Device not found');
    });
  });

  describe('DeviceTemplatesController.devicetemplatesIdApplyPOST', () => {
    let handleRequestSpy;
    let serviceMock;
    let controller;

    function makeMockRes () {
      const res = {
        statusCode: null,
        body: null,
        status: jest.fn(function (code) {
          res.statusCode = code;
          return res;
        }),
        json: jest.fn(function (payload) {
          res.body = payload;
          return res;
        })
      };
      return res;
    }

    beforeEach(() => {
      handleRequestSpy = jest.spyOn(Controller, 'handleRequest').mockResolvedValue();
      serviceMock = {
        devicetemplatesIdApplyPOST: jest.fn()
      };
      controller = new DeviceTemplatesController(serviceMock);
    });

    afterEach(() => {
      handleRequestSpy.mockRestore();
    });

    test('rejects request body with extra keys with 400 and does not call service', async () => {
      const req = { body: { deviceId, extra: 'unexpected' } };
      const res = makeMockRes();

      await controller.devicetemplatesIdApplyPOST(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.any(String)
      });
      expect(handleRequestSpy).not.toHaveBeenCalled();
      expect(serviceMock.devicetemplatesIdApplyPOST).not.toHaveBeenCalled();
    });

    test('rejects array body with 400 and does not call service', async () => {
      const req = { body: [deviceId] };
      const res = makeMockRes();

      await controller.devicetemplatesIdApplyPOST(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.any(String)
      });
      expect(handleRequestSpy).not.toHaveBeenCalled();
      expect(serviceMock.devicetemplatesIdApplyPOST).not.toHaveBeenCalled();
    });

    test('rejects null and empty object bodies with 400 and does not call service', async () => {
      for (const body of [null, undefined, {}]) {
        const req = { body };
        const res = makeMockRes();

        await controller.devicetemplatesIdApplyPOST(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          error: expect.any(String)
        });
      }
      expect(handleRequestSpy).not.toHaveBeenCalled();
      expect(serviceMock.devicetemplatesIdApplyPOST).not.toHaveBeenCalled();
    });

    test('delegates valid { deviceId } body to Controller.handleRequest', async () => {
      const req = { body: { deviceId } };
      const res = makeMockRes();

      await controller.devicetemplatesIdApplyPOST(req, res);

      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
      expect(handleRequestSpy).toHaveBeenCalledTimes(1);
      expect(handleRequestSpy).toHaveBeenCalledWith(
        req,
        res,
        serviceMock.devicetemplatesIdApplyPOST
      );
    });
  });

  describe('DevicesService.devicesIdStaticroutesPOST apply-mode TOCTOU guard', () => {
    let RealDevicesService;
    const tunnelsModelMock = {
      find: jest.fn()
    };
    const validateStaticRouteMock = jest.fn();
    const dispatcherMock = {
      apply: jest.fn()
    };

    beforeAll(() => {
      jest.isolateModules(() => {
        jest.doMock('../configs', () => () => ({ get: jest.fn() }));
        jest.doMock('../models/tunnels', () => tunnelsModelMock);
        jest.doMock('../models/vrrp', () => ({}));
        jest.doMock('../models/pathlabels', () => ({}));
        jest.doMock('../models/tokens', () => ({}));
        jest.doMock('../models/notifications', () => ({}));
        jest.doMock('../websocket/Connections', () => () => ({}));
        jest.doMock('../periodic/deviceStatus', () => () => ({}));
        jest.doMock('../periodic/statusesInDb', () => () => ({}));
        jest.doMock('../models/analytics/deviceStats', () => ({ deviceStats: {} }));
        jest.doMock('../mongoConns.js', () => () => ({}));
        jest.doMock('../flexibilling', () => ({}));
        jest.doMock('../deviceLogic/dispatcher', () => dispatcherMock);
        jest.doMock('../deviceLogic/interfaces', () => ({ validateOperations: jest.fn() }));
        jest.doMock('../deviceLogic/validators', () => ({
          validateDevice: jest.fn(),
          validateDhcpConfig: jest.fn(),
          validateStaticRoute: validateStaticRouteMock,
          validateQOSPolicy: jest.fn(),
          isLocalOrBroadcastAddress: jest.fn()
        }));
        jest.doMock('../models/validators', () => ({ validateFQDN: jest.fn() }));
        jest.doMock('../utils/deviceUtils', () => ({}));
        jest.doMock('../utils/tunnelUtils', () => ({ generateTunnelParams: jest.fn() }));
        jest.doMock('../utils/deviceQueue', () => () => ({}));
        jest.doMock('../utils/cidr', () => ({}));
        jest.doMock('../utils/filterUtils', () => ({}));
        jest.doMock('../services/TunnelsService', () => ({}));
        jest.doMock('../deviceLogic/events/eventReasons', () => ({}));
        jest.doMock('../deviceLogic/events', () => ({}));
        jest.doMock('../deviceLogic/publicAddressLimiter', () => ({}));
        jest.doMock('../models/applications', () => ({}));
        jest.doMock('../models/applicationStore', () => ({}));
        jest.doMock('../utils/httpUtils', () => ({ getAgentBroker: jest.fn() }));
        jest.doMock('../utils/networks', () => ({ getStartEndIp: jest.fn() }));

        RealDevicesService = jest.requireActual('../services/DevicesService');
      });
    });

    beforeEach(() => {
      Devices.devices.findOne.mockReset();
      Devices.devices.findOneAndUpdate.mockReset();
      Devices.staticroutes.mockReset();
      Devices.staticroutes.mockImplementation(function (data) {
        const oid = new ObjectId(routeId);
        return {
          ...data,
          _id: oid,
          id: oid.toString(),
          validateSync: jest.fn().mockReturnValue(null)
        };
      });
      tunnelsModelMock.find.mockReset();
      tunnelsModelMock.find.mockResolvedValue([]);
      validateStaticRouteMock.mockReset();
      validateStaticRouteMock.mockReturnValue({ valid: true });
      dispatcherMock.apply.mockReset();
      dispatcherMock.apply.mockResolvedValue({ ids: [new ObjectId().toString()] });
    });

    test(
      'returns 409 when requireApproved is true and fetched device is unapproved',
      async () => {
        const orgObjId = new ObjectId(ownOrg);
        const devObjId = new ObjectId(deviceId);
        getAccessTokenOrgList.mockResolvedValue([orgObjId]);
        Devices.devices.findOne.mockReturnValue({
          populate: jest.fn().mockResolvedValue({
            _id: devObjId,
            org: { _id: orgObjId },
            isApproved: false
          })
        });

        const res = await RealDevicesService.devicesIdStaticroutesPOST(
          {
            id: deviceId,
            org: ownOrg,
            staticRouteRequest: {
              destination: '10.20.0.0/24',
              gateway: '192.168.1.1',
              redistributeViaOSPF: false
            }
          },
          { user: makeUser(), server: {} },
          makeResponse(),
          { requireApproved: true, expectedOrg: orgObjId }
        );

        expect(res.code).toBe(409);
        expect(res.error).toBe('Device must be first approved');
        expect(Devices.devices.findOneAndUpdate).not.toHaveBeenCalled();
        expect(dispatcherMock.apply).not.toHaveBeenCalled();
      }
    );

    test(
      'adds org and isApproved: true to atomic filter and returns 409 without dispatch on null',
      async () => {
        const orgObjId = new ObjectId(ownOrg);
        const devObjId = new ObjectId(deviceId);
        getAccessTokenOrgList.mockResolvedValue([orgObjId]);
        Devices.devices.findOne.mockReturnValue({
          populate: jest.fn().mockResolvedValue({
            _id: devObjId,
            org: { _id: orgObjId },
            isApproved: true
          })
        });
        Devices.devices.findOneAndUpdate.mockResolvedValue(null);

        const res = await RealDevicesService.devicesIdStaticroutesPOST(
          {
            id: deviceId,
            org: ownOrg,
            staticRouteRequest: {
              destination: '10.20.0.0/24',
              gateway: '192.168.1.1',
              redistributeViaOSPF: false
            }
          },
          { user: makeUser(), server: {} },
          makeResponse(),
          { requireApproved: true, expectedOrg: orgObjId }
        );

        expect(Devices.devices.findOneAndUpdate).toHaveBeenCalledWith(
          { _id: devObjId, org: orgObjId, isApproved: true },
          expect.objectContaining({ $push: expect.any(Object) }),
          { new: true, runValidators: true }
        );
        expect(res.code).toBe(409);
        expect(dispatcherMock.apply).not.toHaveBeenCalled();
      }
    );

    test(
      'preserves default caller behavior (400 unapproved, { _id } filter, clean copy, 201)',
      async () => {
        const orgObjId = new ObjectId(ownOrg);
        const devObjId = new ObjectId(deviceId);
        getAccessTokenOrgList.mockResolvedValue([orgObjId]);
        const setLocSpy = jest.spyOn(RealDevicesService, 'setLocationHeader').mockImplementation();

        Devices.devices.findOne.mockReturnValueOnce({
          populate: jest.fn().mockResolvedValue({
            _id: devObjId,
            org: { _id: orgObjId },
            isApproved: false
          })
        });

        const unapprovedRes = await RealDevicesService.devicesIdStaticroutesPOST(
          {
            id: deviceId,
            org: ownOrg,
            staticRouteRequest: {
              destination: '10.20.0.0/24',
              gateway: '192.168.1.1'
            }
          },
          { user: makeUser(), server: {} },
          makeResponse()
        );
        expect(unapprovedRes.code).toBe(400);
        expect(unapprovedRes.error).toBe('Device must be first approved');

        const updatedDevice = { _id: devObjId, org: orgObjId, isApproved: true };
        Devices.devices.findOne.mockReturnValueOnce({
          populate: jest.fn().mockResolvedValue({
            _id: devObjId,
            org: { _id: orgObjId },
            isApproved: true
          })
        });
        Devices.devices.findOneAndUpdate.mockResolvedValue(updatedDevice);

        const okRes = await RealDevicesService.devicesIdStaticroutesPOST(
          {
            id: deviceId,
            org: ownOrg,
            staticRouteRequest: {
              destination: '10.20.0.0/24',
              gateway: '192.168.1.1'
            }
          },
          { user: makeUser(), server: {} },
          makeResponse()
        );

        expect(Devices.devices.findOneAndUpdate).toHaveBeenCalledWith(
          { _id: devObjId },
          expect.objectContaining({ $push: expect.any(Object) }),
          { new: true, runValidators: true }
        );
        expect(dispatcherMock.apply).toHaveBeenCalledTimes(1);
        const dispatchedCopy = dispatcherMock.apply.mock.calls[0][3];
        expect(dispatchedCopy).not.toHaveProperty('requireApproved');
        expect(dispatchedCopy).not.toHaveProperty('expectedOrg');
        expect(setLocSpy).toHaveBeenCalledTimes(1);
        expect(okRes.code).toBe(201);
        setLocSpy.mockRestore();
      }
    );

    test(
      'succeeds in apply mode without leaking requireApproved or expectedOrg into dispatcher copy',
      async () => {
        const orgObjId = new ObjectId(ownOrg);
        const devObjId = new ObjectId(deviceId);
        const updatedDevice = { _id: devObjId, org: orgObjId, isApproved: true };
        getAccessTokenOrgList.mockResolvedValue([orgObjId]);
        const setLocSpy = jest.spyOn(RealDevicesService, 'setLocationHeader').mockImplementation();

        Devices.devices.findOne.mockReturnValue({
          populate: jest.fn().mockResolvedValue({
            _id: devObjId,
            org: { _id: orgObjId },
            isApproved: true
          })
        });
        Devices.devices.findOneAndUpdate.mockResolvedValue(updatedDevice);

        const res = await RealDevicesService.devicesIdStaticroutesPOST(
          {
            id: deviceId,
            org: ownOrg,
            staticRouteRequest: {
              destination: '10.20.0.0/24',
              gateway: '192.168.1.1',
              redistributeViaOSPF: false
            }
          },
          { user: makeUser(), server: {} },
          makeResponse(),
          { requireApproved: true, expectedOrg: orgObjId }
        );

        expect(Devices.devices.findOneAndUpdate).toHaveBeenCalledWith(
          { _id: devObjId, org: orgObjId, isApproved: true },
          expect.objectContaining({ $push: expect.any(Object) }),
          { new: true, runValidators: true }
        );
        expect(dispatcherMock.apply).toHaveBeenCalledTimes(1);
        const dispatchedCopy = dispatcherMock.apply.mock.calls[0][3];
        expect(dispatchedCopy).not.toHaveProperty('requireApproved');
        expect(dispatchedCopy).not.toHaveProperty('expectedOrg');
        expect(dispatchedCopy).toEqual(expect.objectContaining({
          org: orgObjId,
          method: 'staticroutes',
          _id: routeId
        }));
        expect(setLocSpy).toHaveBeenCalledTimes(1);
        expect(res.code).toBe(201);
        setLocSpy.mockRestore();
      }
    );
  });

  describe('OpenAPI specification sanity', () => {
    const openapiPath = path.join(__dirname, '..', 'api', 'openapi.yaml');
    const spec = YAML.parse(fs.readFileSync(openapiPath, 'utf8'));

    test(
      'defines POST /devicetemplates/{id}/apply with expected operationId, router extensions, ' +
      'security, and schemas',
      () => {
        const pathItem = spec.paths['/devicetemplates/{id}/apply'];
        expect(pathItem).toBeDefined();
        expect(pathItem.post).toBeDefined();

        const op = pathItem.post;
        expect(op.operationId).toBe('devicetemplatesIdApplyPOST');
        expect(op['x-openapi-router-controller']).toBe('DeviceTemplatesController');
        expect(op['x-openapi-router-service']).toBe('DeviceTemplatesService');
        expect(op.security).toEqual(spec.paths['/devicetemplates'].post.security);

        const reqRef = op.requestBody.content['application/json'].schema.$ref;
        expect(reqRef).toBe('#/components/schemas/DeviceTemplateApplyRequest');

        const reqSchema = spec.components.schemas.DeviceTemplateApplyRequest;
        expect(reqSchema).toBeDefined();
        expect(reqSchema.additionalProperties).toBe(false);
        expect(reqSchema.required).toEqual(['deviceId']);
        expect(Object.keys(reqSchema.properties)).toEqual(['deviceId']);
        expect(reqSchema.properties.deviceId.type).toBe('string');

        const res202Ref = op.responses['202'].content['application/json'].schema.$ref;
        expect(res202Ref).toBe('#/components/schemas/DeviceTemplateApplyResponse');
        expect(spec.components.schemas.DeviceTemplateApplyResponse).toBeDefined();

        for (const code of ['400', '403', '404', '409', '500']) {
          expect(op.responses[code].content['application/json'].schema.$ref).toBe(
            '#/components/schemas/Error'
          );
        }
      });
  });
});
