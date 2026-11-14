/* eslint-disable new-cap */
// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2019  flexiWAN Ltd.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

/* eslint-disable max-len */
const { devices, interfaces, versions } = require('../devices.js');
const mongoose = require('mongoose');

let deviceModel;
let interfaceModel;
let versionsModel;
const requiredModelErrors = 'interfaces validation failed: ' +
                            'name: Interface name must be set, ' +
                            'driver: Driver name must be set';

beforeEach(() => {
  deviceModel = new devices({
    account: new mongoose.Types.ObjectId('4edd40c86762e0fb12000002'),
    org: new mongoose.Types.ObjectId('4edd40c86762e0fb12000001'),
    machineId: 'C9B35F0D-DF7C-43D5-8F8F-C2C576FEBAF7',
    fromToken: 'Token-A',
    versions: {
      device: '1.0.0',
      agent: '1.0.0',
      router: '1.0.0',
      vpp: '1.0',
      frr: '1.0'
    }
  });

  versionsModel = new versions({
    device: '1.0.0',
    agent: '1.0.0',
    router: '1.0.0',
    vpp: '1.0-rc0',
    frr: '1.0'
  });

  interfaceModel = new interfaces({
    name: 'eth0',
    pciaddr: '00:02.00',
    driver: 'igb-1000',
    MAC: 'ab:45:90:ed:89:16',
    dhcp: 'no',
    IPv4: '192.168.100.1',
    IPv4Mask: '24',
    IPv6: '2001:db8:85a3:8d3:1319:8a2e:370:7348',
    IPv6Mask: '64',
    PublicIP: '72.168.10.30',
    PublicPort: '',
    NatType: '',
    useStun: true,
    isAssigned: false,
    routing: 'None',
    type: 'None'
  });
});

// Device schema tests:
describe('Minimal required device schema', () => {
  it('Should be a valid device model if all required fields are present', () => {
    return deviceModel.validate().then(() => null, error => error).then((err) => {
      expect(err).toBe(null);
    });
  });

  it('Should be an invalid device model if account field is missing', () => {
    deviceModel.account = null;
    return deviceModel.validate().then(() => null, error => error).then((err) => {
      expect(err.message).toBe('devices validation failed: account: Path `account` is required.');
    });
  });

  it('Should be an invalid device model if org field is missing', () => {
    deviceModel.org = null;
    return deviceModel.validate().then(() => null, error => error).then((err) => {
      expect(err.message).toBe('devices validation failed: org: Path `org` is required.');
    });
  });

  it('Should be an invalid device model if machineId field is missing', () => {
    deviceModel.machineId = null;
    return deviceModel.validate().then(() => null, error => error).then((err) => {
      expect(err.message).toBe('devices validation failed: machineId: MachineId is required');
    });
  });

  it('Should be an invalid device model if fromToken field is missing', () => {
    deviceModel.fromToken = null;
    return deviceModel.validate().then(() => null, error => error).then((err) => {
      expect(err.message).toBe('devices validation failed: fromToken: fromToken is required');
    });
  });

  it('Should be an invalid device model if versions field is missing', () => {
    deviceModel.versions = null;
    return deviceModel.validate().then(() => null, error => error).then((err) => {
      expect(err.message).toBe('devices validation failed: versions: Device versions must be set');
    });
  });
});

describe('Device schema', () => {
  it('Should be a invalid if account is an invalid', () => {
    deviceModel.account = 'invalid-account';

    return deviceModel.validate().then(() => null, error => error).then((err) => {
      expect(err.errors.account).toMatchObject({ name: 'CastError', kind: 'ObjectId', path: 'account', value: 'invalid-account' });
    });
  });

  it('Should be a invalid if org is an invalid', () => {
    deviceModel.org = 'invalid-org';

    return deviceModel.validate().then(() => null, error => error).then((err) => {
      expect(err.errors.org).toMatchObject({ name: 'CastError', kind: 'ObjectId', path: 'org', value: 'invalid-org' });
    });
  });

  it('Should be a invalid if device name is invalid', () => {
    deviceModel.name = 'invalid^device^name';

    return deviceModel.validate().then(() => null, error => error).then((err) => {
      expect(err.message).toBe('devices validation failed: name: Device name format is invalid');
    });
  });

  it('Should be a invalid if device description is invalid', () => {
    deviceModel.description = null;

    return deviceModel.validate().then(() => null, error => error).then((err) => {
      expect(err.message).toBe(
        'devices validation failed: description: Device description format is invalid'
      );
    });
  });

  it('Should be a invalid if device site name is invalid', () => {
    deviceModel.site = null;

    return deviceModel.validate().then(() => null, error => error).then((err) => {
      expect(err.message).toBe('devices validation failed: site: Device site format is invalid');
    });
  });

  it('Should be a invalid if device hostname is invalid', () => {
    deviceModel.hostname = null;

    return deviceModel.validate().then(() => null, error => error).then((err) => {
      expect(err.message).toBe(
        'devices validation failed: hostname: Device hostname should ' +
        'contain English characters, digits, hyphens and dots');
    });
  });

  it('Should be a invalid if device IP list is invalid', () => {
    deviceModel.ipList = 'invalid-ip-list';

    return deviceModel.validate().then(() => null, error => error).then((err) => {
      expect(err.message).toBe(
        'devices validation failed: ipList: ipList should be a list of comma separated IP addresses'
      );
    });
  });

  it('Should be a invalid if device machine id is invalid', () => {
    deviceModel.machineId = 'invalid-machine-id';

    return deviceModel.validate().then(() => null, error => error).then((err) => {
      expect(err.message).toBe(
        'devices validation failed: machineId: machineId should be a valid machine ID'
      );
    });
  });

  it('Should be a invalid if device token name is invalid', () => {
    deviceModel.fromToken = 'invalid^token';

    return deviceModel.validate().then(() => null, error => error).then((err) => {
      expect(err.message).toBe(
        'devices validation failed: fromToken: Token name format is invalid'
      );
    });
  });
});

// Interfaces schema tests:
describe('Minimal required interface schema', () => {
  it('Should be a valid interface model if all required fields are present', () => {
    const interfaceRequiredSchema = new interfaces({
      name: 'eth0',
      driver: 'e100'
    });
    return interfaceRequiredSchema.validate().then(() => null, error => error).then((err) => {
      expect(err).toBe(null);
    });
  });

  it('Should be an invalid interface model if not all required fields are present', () => {
    const invalidSchema = new { interfaces }.interfaces({});
    return invalidSchema.validate().then(() => null, error => error).then((err) => {
      expect(err.message).toBe(requiredModelErrors);
    });
  });
});

describe('Interface schema', () => {
  it('Should be invalid if interface name invalid', () => {
    interfaceModel.name = null;

    return interfaceModel.validate().then(() => null, error => error).then((err) => {
      expect(err.message).toBe(
        'interfaces validation failed: name: Interface name must be set'
      );
    });
  });

  it('Should be invalid if IPv4 address is invalid', () => {
    interfaceModel.IPv4 = null;

    return interfaceModel.validate().then(() => null, error => error).then((err) => {
      expect(err.message).toBe(
        'interfaces validation failed: IPv4: IPv4 should be a valid ip address'
      );
    });
  });

  it('Should be invalid if IPv4 mask is invalid', () => {
    interfaceModel.IPv4Mask = '/';

    return interfaceModel.validate().then(() => null, error => error).then((err) => {
      expect(err.message).toBe(
        'interfaces validation failed: IPv4Mask: IPv4Mask should be a valid mask'
      );
    });
  });

  it('Should be valid if both IPv4 address and mask are empty strings', () => {
    interfaceModel.IPv4 = '';
    interfaceModel.IPv4Mask = '';

    return interfaceModel.validate().then(() => null, error => error).then((err) => {
      expect(err).toBe(null);
    });
  });

  it('Should be invalid if IPv6 address is invalid', () => {
    interfaceModel.IPv6 = null;

    return interfaceModel.validate().then(() => null, error => error).then((err) => {
      expect(err.message).toBe(
        'interfaces validation failed: IPv6: IPv6 should be a valid ip address'
      );
    });
  });

  it('Should be invalid if IPv6 mask is invalid', () => {
    interfaceModel.IPv6Mask = '/';

    return interfaceModel.validate().then(() => null, error => error).then((err) => {
      expect(err.message).toBe(
        'interfaces validation failed: IPv6Mask: IPv6Mask should be a valid mask'
      );
    });
  });

  it('Should be invalid if PublicIP is invalid', () => {
    interfaceModel.PublicIP = null;

    return interfaceModel.validate().then(() => null, error => error).then((err) => {
      expect(err.message).toBe(
        'interfaces validation failed: PublicIP: PublicIP should be a valid IPv4 or IPv6 address'
      );
    });
  });

  it('Should be invalid if dev_id address is invalid', () => {
    interfaceModel.devId = null;

    return interfaceModel.validate().then(() => null, error => error).then((err) => {
      expect(err.message).toBe(
        'interfaces validation failed: devId: devId should be a valid devId address'
      );
    });
  });

  it('Should be invalid if driver name is invalid', () => {
    interfaceModel.driver = '$%@^%!@#$';

    return interfaceModel.validate().then(() => null, error => error).then((err) => {
      expect(err.message).toBe(
        'interfaces validation failed: driver: driver should be a valid driver name'
      );
    });
  });

  it('Should be invalid if MAC address is invalid', () => {
    interfaceModel.MAC = 'invali-mac';

    return interfaceModel.validate().then(() => null, error => error).then((err) => {
      expect(err.message).toBe(
        'interfaces validation failed: MAC: MAC should be a valid MAC address'
      );
    });
  });

  it('Should be invalid if routing is invalid', () => {
    interfaceModel.routing = 'invalid-routing-protocol-name';

    return interfaceModel.validate().then(() => null, error => error).then((err) => {
      expect(err.message).toBe(
        'interfaces validation failed: routing: routing should be a valid protocol name'
      );
    });
  });

  it('Should be invalid if type is invalid', () => {
    interfaceModel.type = 'invalid-interface-type';

    return interfaceModel.validate().then(() => null, error => error).then((err) => {
      expect(err.message).toBe(
        'interfaces validation failed: type: type should be a valid interface type'
      );
    });
  });
});

// Versions schema test
describe('Minimal required versions schema', () => {
  it('Should be a valid versions model if all required fields are present', () => {
    return versionsModel.validate().then(() => null, error => error).then((err) => {
      expect(err).toBe(null);
    });
  });

  it('Should be an invalid versions model if `agent` field is missing', () => {
    versionsModel.agent = null;
    return versionsModel.validate().then(() => null, error => error).then((err) => {
      expect(err.message).toBe('versions validation failed: agent: Agent version must be set');
    });
  });
});

describe('Versions schema', () => {
  it('Should be a valid versions schema of all fields are valid', () => {
    return versionsModel.validate().then(() => null, error => error).then((err) => {
      expect(err).toBe(null);
    });
  });

  it('Should be invalid if device version is invalid', () => {
    versionsModel.device = 'invalid-device-version';
    return versionsModel.validate().then(() => null, error => error).then((err) => {
      expect(err.message).toBe(
        'versions validation failed: device: Version must be a valid Semver version'
      );
    });
  });

  it('Should be invalid if agent version is invalid', () => {
    versionsModel.agent = 'invalid-agent-version';
    return versionsModel.validate().then(() => null, error => error).then((err) => {
      expect(err.message).toBe(
        'versions validation failed: agent: Version must be a valid Semver version'
      );
    });
  });

  it('Should be invalid if router version is invalid', () => {
    versionsModel.router = 'invalid-router-version';
    return versionsModel.validate().then(() => null, error => error).then((err) => {
      expect(err.message).toBe(
        'versions validation failed: router: Version must be a valid Semver version'
      );
    });
  });

  it('Should be invalid if vpp version is invalid', () => {
    versionsModel.vpp = 'invalid-vpp-version';
    return versionsModel.validate().then(() => null, error => error).then((err) => {
      expect(err.message).toBe(
        'versions validation failed: vpp: Version must be a valid VPP version'
      );
    });
  });

  it('Should be invalid if frr version is invalid', () => {
    versionsModel.frr = 'invalid-frr-version';
    return versionsModel.validate().then(() => null, error => error).then((err) => {
      expect(err.message).toBe(
        'versions validation failed: frr: Version must be a valid FRR version'
      );
    });
  });
});
