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

const configs = require('../configs.js')();
const express = require('express');
const createError = require('http-errors');
const bodyParser = require('body-parser');
const cors = require('./cors');
const tokens = require('../models/tokens');
const { devices } = require('../models/devices');
const jwt = require('jsonwebtoken');
const mongoConns = require('../mongoConns.js')();
const { verifyAgentVersion } = require('../versioning');
const DevSwUpdater = require('../deviceLogic/DevSwVersionUpdateManager');
const webHooks = require('../utils/webhooks')();
const logger = require('../logging/logging')({ module: module.filename, type: 'req' });
const { getAgentBroker } = require('../utils/httpUtils');
// billing support
const flexibilling = require('../flexibilling');
const { getCpuInfo, getOptimizedCpuInfo } = require('../utils/deviceUtils');
const geoip = require('geoip-lite');
const { normalizeRegistrationInterfaces } = require('../deviceLogic/interfaceInventory');
const connectRouter = express.Router();
connectRouter.use(bodyParser.json());

// error formatter
const formatErr = (err, msg) => {
  // Check for unique error. err.name is 'MongoServerError' since mongodb driver v4
  // (was 'MongoError' before) - match on the version-independent code instead
  if (err.code === 11000) {
    return {
      status: 407,
      error: 'Device ' + msg.machine_id + ' already exists, must be deleted first'
    };
  } else if (err.message) {
    return ({ status: 408, error: err.message });
  } else {
    return ({ status: 500, error: 'Unable to format error' });
  }
};

// Generate token
const genToken = function (data) {
  return jwt.sign(data, configs.get('deviceTokenSecretKey'));
};

// Express middleware for /register API
const checkDeviceVersion = async (req, res, next) => {
  // Newer fwagent builds send the field as agent_version instead of
  // fwagent_version - accept either and normalize onto req.body so the
  // rest of the registration flow (which reads fwagent_version) still works
  if (!req.body.fwagent_version && req.body.agent_version) {
    req.body.fwagent_version = req.body.agent_version;
  }
  const agentVer = req.body.fwagent_version;
  const { valid, statusCode, err } = verifyAgentVersion(agentVer);
  if (!valid) {
    logger.warn('Device version validation failed', {
      params: {
        agentVersion: agentVer,
        reason: err,
        machineId: req.body.machine_id
      },
      req: req
    });
    const swUpdater = DevSwUpdater.getSwVerUpdaterInstance();
    const { versions } = await swUpdater.getLatestSwVersions();
    // console.log('versions=' + versions);
    res.setHeader('latestVersion', versions.device); // set last device version
    return next(createError(statusCode, err));
  }
  next();
};

// Try to determine the coordinates for a device
function getCoordinates (interfaces, sourceIp) {
  let ll = null;
  const lookupIp = (ip) => {
    const geoIpInfo = geoip.lookup(ip);
    if (geoIpInfo) {
      ll = geoIpInfo.ll;
      return true; // Stop the interface loop
    }
    return false;
  };
  // Try first to find location based on source IP
  if (!sourceIp || !lookupIp(sourceIp)) {
    if (interfaces) {
      interfaces
        // Check WAN interfaces IPs
        .filter((i) => i.type === 'WAN')
        // Put LTE last
        .sort((i1, i2) => {
          if (i1.deviceType === 'lte' && i2.deviceType !== 'lte') return 1;
          if (i1.deviceType !== 'lte' && i2.deviceType === 'lte') return -1;
          return 0;
        })
        // Try to find first location
        .some((i) => {
          // Try to match public IP first
          if (i.PublicIP) return lookupIp(i.PublicIP);
          if (i.IPv4) return lookupIp(i.IPv4);
        });
    }
  }
  return ll;
}

// Register device. When device connects for the first
// time, it tries to authenticate by accessing this URL
// Register Error Codes:
// 400 - Wrong version or Too high Agent version
// 401 - Invalid token
// 402 - Maximum number of free devices reached
// 403 - Too low Agent version
// 404 - Token not found
// 405 -
// 406 -
// 407 - Device Already Exists
// 408 - Mongo error
// 500 - General Error
connectRouter.route('/register')
  .post(cors.corsWithOptions, checkDeviceVersion, (req, res, next) => {
    var sourceIP = req.ip || 'Unknown';
    if (sourceIP.substr(0, 7) === '::ffff:') sourceIP = sourceIP.substr(7);
    jwt.verify(req.body.token, configs.get('deviceTokenSecretKey'), function (err, decoded) {
      if (err) {
        logger.warn('Device registration: JWT verification failed', {
          params: {
            machine_id: req.body.machine_id,
            error: err.message,
            tokenLength: req.body.token ? req.body.token.length : 0
          },
          req: req
        });
        return next(createError(401, 'Invalid token'));
      } else {
        if (!decoded.org || !decoded.account) {
          logger.warn('Device registration: Invalid token claims', {
            params: {
              machine_id: req.body.machine_id,
              hasOrg: !!decoded.org,
              hasAccount: !!decoded.account
            },
            req: req
          });
          return next(createError(401, 'Invalid token'));
        }
        tokens.find({ token: req.body.token, org: decoded.org })
          .then(async (resp) => {
            if (resp.length === 1) { // exactly one token found
              // create device and add token new token to the device
              const deviceToken = genToken({
                machine_id: req.body.machine_id,
                machine_name: req.body.machine_name
              });

              // Try to auto populate interfaces parameters
              const ifs = JSON.parse(req.body.interfaces);

              if (!ifs || !Array.isArray(ifs) || ifs.length === 0) {
                return next(createError(500, 'Device without interfaces is not allowed'));
              }

              // Validate, dedupe, and normalize reported interfaces via shared inventory helper
              const { interfaces, dropped } = normalizeRegistrationInterfaces(ifs, {
                sourceIP,
                defaultDev: req.body.default_dev,
                defaultRoute: req.body.default_route
              });
              if (dropped.length > 0 || ifs.length !== interfaces.length) {
                logger.warn('Unsupported interfaces were filtered out',
                  { params: { ifs, interfaces, dropped } });
              }

              if (interfaces.length === 0) {
                return next(createError(500, 'The interfaces are not supported'));
              }

              // Prepare device versions array
              const versions = {
                agent: req.body.fwagent_version || '',
                router: req.body.router_version || '',
                device: req.body.device_version || ''
              };

              const requestCpuInfo = req.body.cpuInfo
                ?.replaceAll('\'', '"').replaceAll('False', 'false').replaceAll('True', 'true');
              const parsedCpuInfo = requestCpuInfo ? JSON.parse(requestCpuInfo) : null;

              // Count WAN interfaces for optimization
              const wanInterfaceCount = interfaces.filter(ifc => ifc.type === 'WAN').length;

              // Get optimized CPU configuration with intelligent defaults
              const cpuInfo = getOptimizedCpuInfo(parsedCpuInfo, {
                hasQos: false, // New devices don't have QoS yet
                wanInterfaces: wanInterfaceCount || 1
              });

              // Log optimization if applied
              if (parsedCpuInfo?.hwCores > 2 &&
                  (!parsedCpuInfo?.vppCores || parsedCpuInfo.vppCores === 1) &&
                  cpuInfo.vppCores > 1) {
                logger.info('Auto-optimized VPP cores for multi-core device', {
                  params: {
                    machineId: req.body.machine_id,
                    hwCores: cpuInfo.hwCores,
                    optimizedVppCores: cpuInfo.vppCores,
                    wanInterfaces: wanInterfaceCount
                  }
                });
              }

              const requestDistro = JSON.parse(req.body.distro?.replaceAll('\'', '"') || '{}');

              // Check that account didn't cross its device limit
              const account = decoded.account;
              // Get max allowed devices for free from the ChargeBee plan
              const maxDevices = await flexibilling.getMaxDevicesAllowed(account);

              // Initialize session
              let session;
              let keepCount; // current number of docs per account
              let keepOrgCount; // current number of docs per account
              mongoConns.getMainDB().startSession()
                .then((_session) => {
                  session = _session;
                  return session.startTransaction();
                })
                .then(() => {
                  return devices.countDocuments({
                    account: account, org: decoded.org
                  }).session(session);
                })
                .then((orgCount) => {
                  keepOrgCount = orgCount;
                  return devices.countDocuments({ account: account }).session(session);
                })
                .then(async (count) => {
                  keepCount = count;
                  if (count >= maxDevices) {
                    if (session) await session.abortTransaction();
                    return next(createError(402, 'Maximum number of free devices reached'));
                  }

                  // Get device location
                  let ll = getCoordinates(interfaces, sourceIP);
                  if (!ll) ll = [40.416775, -3.703790]; // Default coordinate

                  // Create the device
                  devices.create([{
                    account: decoded.account,
                    org: decoded.org,
                    name: '',
                    description: '',
                    hostname: req.body.machine_name,
                    ipList: req.body.ip_list,
                    machineId: req.body.machine_id,
                    serial: req.body.serial || '0',
                    fromToken: resp[0].name,
                    interfaces: interfaces,
                    deviceToken: deviceToken,
                    isApproved: false,
                    isConnected: false,
                    coords: ll,
                    cpuInfo: cpuInfo,
                    distro: {
                      version: requestDistro?.version ?? '',
                      codename: requestDistro?.codename ?? ''
                    },
                    versions: versions
                  }], { session: session })
                    .then(async (result) => {
                      await flexibilling.registerDevice({
                        account: result[0].account,
                        count: keepCount,
                        org: decoded.org,
                        orgCount: keepOrgCount,
                        increment: 1
                      }, session);

                      // commit transaction
                      await session.commitTransaction();
                      session = null;

                      // Send register device webhook for first device
                      if (keepCount === 0) {
                        const webHookMessage = {
                          _id: result[0]._id.toString(),
                          account: decoded.account,
                          org: decoded.org
                        };
                        if (!await webHooks.sendToWebHook(configs.get('webHookRegisterDeviceUrl'),
                          webHookMessage,
                          configs.get('webHookRegisterDeviceSecret'))) {
                          logger.error('Web hook call failed for registered device',
                            { params: { message: webHookMessage } });
                        }
                      }

                      logger.info('Device registered successfully',
                        {
                          params: {
                            _id: result[0]._id.toString(),
                            deviceId: req.body.machine_id,
                            account: decoded.account,
                            org: decoded.org
                          },
                          req: req
                        });
                      res.statusCode = 200;
                      res.setHeader('Content-Type', 'application/json');
                      const server = getAgentBroker(decoded.server);
                      res.json({ deviceToken: deviceToken, server: server });
                    }, async (err) => {
                      // abort transaction on error
                      if (session) {
                        await session.abortTransaction();
                        session = null;
                      }

                      logger.warn('Device registration failed',
                        { params: { deviceId: req.body.machine_id, err: err }, req: req });
                      const fErr = formatErr(err, req.body);
                      return next(createError(fErr.status, fErr.error));
                    })
                    .catch(async (err) => {
                      if (session) {
                        // abort transaction on error
                        await session.abortTransaction();
                        session = null;
                      }
                      next(err);
                    });
                }, (err) => next(err))
                .catch((err) => next(err));
            } else if (resp.length === 0) {
              return next(createError(404, 'Token not found'));
            } else {
              return next(
                createError(
                  500,
                  'general token error, please contact the administrator'
                )
              );
            }
          }, (err) => next(err))
          .catch((err) => next(err));
      }
    }
    );
  });

// Default exports
module.exports = {
  connectRouter: connectRouter,
  checkDeviceVersion: checkDeviceVersion
};
