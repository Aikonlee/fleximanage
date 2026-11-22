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

const express = require('express');
const bodyParser = require('body-parser');
const tunnels = require('../models/tunnels');
const cors = require('./cors');
const { verifyPermission } = require('../authenticate');
const { getAccessTokenOrgList } = require('../utils/membershipUtils');
const mongoose = require('mongoose');
const createError = require('http-errors');
const logger = require('../logging/logging')({ module: module.filename, type: 'req' });

const deviceStatus = require('../periodic/deviceStatus')();

const tunnelsRouter = express.Router();
tunnelsRouter.use(bodyParser.json());

function isPlainObject (value) {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// Response-boundary scrub. deviceToken stays readable on the schema for other flows.
function removeSecretFields (value) {
  if (Array.isArray(value)) return value.map(removeSecretFields);
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (!isPlainObject(value)) {
    if (typeof value.toJSON === 'function') {
      const json = value.toJSON();
      if (json !== value) return removeSecretFields(json);
    }
    return value;
  }
  const out = {};
  Object.keys(value).forEach((key) => {
    if (key === 'tunnelKeys' || key === 'deviceToken') return;
    out[key] = removeSecretFields(value[key]);
  });
  return out;
}

function stripTunnelSecrets (payload) {
  return removeSecretFields(payload);
}

// App keys are confined to tokenOrganization/tokenGroup inside the helper.
// Do not scope these routes with req.user.defaultOrg.
async function resolveScopedOrgList (user, org) {
  const orgList = await getAccessTokenOrgList(user, org, true);
  if (!Array.isArray(orgList)) return [];
  return orgList.filter(Boolean).map(id => id.toString());
}

async function loadOrgList (req, next) {
  const org = req.query?.org;
  try {
    const orgList = await resolveScopedOrgList(req.user, org);
    if (!orgList.length && !(req.user && req.user.accessToken)) {
      next(createError(400, 'User has no default organization selected'));
      return null;
    }
    return orgList;
  } catch (err) {
    next(createError(400, err.message || 'Organization access denied'));
    return null;
  }
}

// retrieves the list of tunnels
tunnelsRouter
  .route('/')
// When options message received, reply origin based on whitelist
  .options(cors.corsWithOptions, (req, res) => { res.sendStatus(200); })
  .get(cors.corsWithOptions, verifyPermission('tunnels', 'get'), async (req, res, next) => {
    const orgList = await loadOrgList(req, next);
    if (orgList === null) return;

    try {
      const resp = await tunnels
        .find({ org: { $in: orgList }, isActive: true })
        .select('-tunnelKeys')
        .populate({ path: 'deviceA', select: '-deviceToken' })
        .populate({ path: 'deviceB', select: '-deviceToken' });

      // Populate interface details
      resp.forEach((d) => {
        d.set('interfaceADetails',
          d.deviceA.interfaces.filter((ifc) => {
            return ifc._id.toString() === '' + d.interfaceA;
          })[0],
          { strict: false });
        d.set('interfaceBDetails',
          d.deviceB.interfaces.filter((ifc) => {
            return ifc._id.toString() === '' + d.interfaceB;
          })[0],
          { strict: false });

        try {
          const tunnelId = d.num;
          // Add tunnel status
          d.set(
            'tunnelStatusA',
            deviceStatus.getTunnelStatus(d.deviceA.machineId, tunnelId) ||
              null,
            { strict: false }
          );

          // Add tunnel status
          d.set(
            'tunnelStatusB',
            deviceStatus.getTunnelStatus(d.deviceB.machineId, tunnelId) ||
              null,
            { strict: false }
          );
        } catch (error) {
          // console.error(error);
        }
      });

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      return res.json(stripTunnelSecrets(resp));
    } catch (err) {
      return next(err);
    }
  });

// deletes the tunnel
tunnelsRouter
  .route('/:tunnelId')
// When options message received, reply origin based on whitelist
  .options(cors.corsWithOptions, (req, res) => { res.sendStatus(200); })
  .delete(cors.corsWithOptions, verifyPermission('tunnels', 'del'), async (req, res, next) => {
    const orgList = await loadOrgList(req, next);
    if (orgList === null) return;

    const tunnelId = req.params.tunnelId;
    logger.info('Deleting tunnel', { params: { tunnelId, orgIds: orgList } });

    try {
      const resp = await tunnels.findOneAndUpdate(
        {
          _id: new mongoose.Types.ObjectId(tunnelId),
          org: { $in: orgList },
          isActive: true
        },
        { isActive: false },
        { upsert: false, new: true }
      ).select('-tunnelKeys');

      if (resp != null) {
        logger.info('Tunnel deleted successfully', {
          params: { tunnelId, num: resp.num }
        });
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        return res.json(stripTunnelSecrets(resp));
      }
      logger.warn('Tunnel not found or already deleted', {
        params: { tunnelId, orgIds: orgList }
      });
      return next(createError(404, 'Tunnel not found or already inactive'));
    } catch (err) {
      logger.error('Error deleting tunnel', {
        params: { tunnelId, error: err.message }
      });
      return next(err);
    }
  });

// Default exports
module.exports = tunnelsRouter;
module.exports.resolveScopedOrgList = resolveScopedOrgList;
module.exports.stripTunnelSecrets = stripTunnelSecrets;
