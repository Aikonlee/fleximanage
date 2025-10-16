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
const mongoose = require('mongoose');
const createError = require('http-errors');
const logger = require('../logging/logging')({ module: module.filename, type: 'req' });

const deviceStatus = require('../periodic/deviceStatus')();

const tunnelsRouter = express.Router();
tunnelsRouter.use(bodyParser.json());

// retrieves the list of tunnels
tunnelsRouter
  .route('/')
// When options message received, reply origin based on whitelist
  .options(cors.corsWithOptions, (req, res) => { res.sendStatus(200); })
  .get(cors.corsWithOptions, verifyPermission('tunnels', 'get'), (req, res, next) => {
    tunnels
      .find({ org: req.user.defaultOrg._id, isActive: true })
      .populate('deviceA')
      .populate('deviceB')
      .then((resp) => {
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
        return res.json(resp);
      }, (err) => {
        next(err);
      })
      .catch((err) => {
        next(err);
      });
  });

// deletes the tunnel
tunnelsRouter
  .route('/:tunnelId')
// When options message received, reply origin based on whitelist
  .options(cors.corsWithOptions, (req, res) => { res.sendStatus(200); })
  .delete(cors.corsWithOptions, verifyPermission('tunnels', 'del'), (req, res, next) => {
    const tunnelId = req.params.tunnelId;
    const orgId = req.user.defaultOrg._id;
    
    logger.info('Deleting tunnel', { params: { tunnelId, orgId } });
    
    tunnels
      .findOneAndUpdate(
        // Query - match by ID and org
        { _id: mongoose.Types.ObjectId(tunnelId), org: orgId, isActive: true },
        // Update
        { isActive: false },
        // Options
        { upsert: false, new: true })
      .then((resp) => {
        if (resp != null) {
          logger.info('Tunnel deleted successfully', { params: { tunnelId, num: resp.num } });
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          return res.json(resp);
        } else {
          logger.warn('Tunnel not found or already deleted', { params: { tunnelId, orgId } });
          return next(createError(404, 'Tunnel not found or already inactive'));
        }
      }, (err) => {
        logger.error('Error deleting tunnel', { params: { tunnelId, error: err.message } });
        next(err);
      })
      .catch((err) => {
        logger.error('Error deleting tunnel', { params: { tunnelId, error: err.message } });
        next(err);
      });
  });

// Default exports
module.exports = tunnelsRouter;
