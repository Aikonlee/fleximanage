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
const cors = require('./cors');
const { verifyPermission } = require('../authenticate');
const { getToken } = require('../tokens');
const connections = require('../websocket/Connections')();
const organizations = require('../models/organizations');
const users = require('../models/users');
const accounts = require('../models/accounts');
const { membership } = require('../models/membership');
const { devices } = require('../models/devices');
const tunnels = require('../models/tunnels');
const tunnelIds = require('../models/tunnelids');
const tokens = require('../models/tokens');
const AccessToken = require('../models/accesstokens');
const { getUserOrganizations, getUserOrgByID, orgUpdateFromNull } = require('../utils/membershipUtils');
const mongoConns = require('../mongoConns.js')();
const createError = require('http-errors');
const logger = require('../logging/logging')({ module: module.filename, type: 'req' });
const flexibilling = require('../flexibilling');
const { deviceStats } = require('../models/analytics/deviceStats');

const organizationsRouter = express.Router();
organizationsRouter.use(bodyParser.json());

// Error formatter
const formatErr = (err, msg) => {
  // Check for unique error. err.name is 'MongoServerError' since mongodb driver v4
  // (was 'MongoError' before) - match on the version-independent code instead
  if (err.code === 11000) {
    return ({ status: 500, error: 'Organization ' + msg.name + ' already exists' });
  } else {
    return ({ status: 500, error: 'Add organization error' });
  }
};

// Retrieves the list of organizations
organizationsRouter.route('/')
  .options(cors.corsWithOptions, (req, res) => { res.sendStatus(200); })
  .get(cors.corsWithOptions, verifyPermission('organizations', 'get'), async (req, res, next) => {
    try {
      const orgs = await getUserOrganizations(req.user);
      const result = Object.keys(orgs).map((key) => { return orgs[key]; });
      return res.status(200).json(result);
    } catch (err) {
      logger.error('Error getting account organizations', { params: { reason: err.message } });
      return next(createError(500, 'Error getting account organizations'));
    }
  })
// create an organization
  .post(cors.corsWithOptions, verifyPermission('organizations', 'post'), (req, res, next) => {
    let session = null;
    let org = null;
    mongoConns.getMainDB().startSession()
      .then((_session) => {
        session = _session;
        return session.startTransaction();
      })
      .then(() => {
        const orgBody = { ...req.body, account: req.user.defaultAccount };
        return organizations.create([orgBody], { session: session });
      })
      .then((_org) => {
        org = _org[0];
        return users.findOneAndUpdate(
          // Query, use the email
          { _id: req.user._id },
          // Update
          { defaultOrg: org._id },
          // Options
          { upsert: false, new: true, session: session }
        );
      })
      .then((updUser) => {
        if (!updUser) throw new Error('Error updating default organization');
        // Add organization to default account
        return accounts.findOneAndUpdate(
          { _id: updUser.defaultAccount },
          { $addToSet: { organizations: org._id } },
          { upsert: false, new: true, session: session }
        );
      })
      .then((updAccount) => {
        if (!updAccount) throw new Error('Error adding organization to account');
        return session.commitTransaction();
      })
      .then(async () => {
        // Session committed, set to null
        session = null;
        const token = await getToken(req, { org: org._id, orgName: org.name });
        res.setHeader('Refresh-JWT', token);
        return res.status(200).json(org);
      })
      .catch((err) => {
        if (session) session.abortTransaction();
        logger.error('Error adding organization', { params: { reason: err.message } });
        const fErr = formatErr(err, req.body);
        return next(createError(fErr.status, fErr.error));
      });
  });

// set the default organization
organizationsRouter.route('/select')
  .options(cors.corsWithOptions, (req, res) => { res.sendStatus(200); })
  .post(cors.corsWithOptions, verifyPermission('organizations', 'get'), async (req, res, next) => {
    if (!req.user._id || !req.user.defaultAccount) {
      return next(createError(500, 'Error in selecting organization'));
    }
    // Check first that user is allowed for this organization
    let org = [];
    try {
      org = await getUserOrgByID(req.user, req.body.org);
    } catch (err) {
      logger.error('Finding organization for user', { params: { reason: err.message } });
      return next(createError(500, 'Error selecting organization'));
    }
    if (org.length > 0) {
      users.findOneAndUpdate(
        // Query, use the email and account
        { _id: req.user._id, defaultAccount: req.user.defaultAccount._id },
        // Update
        { defaultOrg: req.body.org },
        // Options
        { upsert: false, new: true }
      )
        .populate('defaultOrg')
        .then(async (updUser) => {
          // Success, return OK and refresh JWT with new values
          req.user.defaultOrg = updUser.defaultOrg;
          const token = await getToken(req, {
            org: updUser.defaultOrg._id,
            orgName: updUser.defaultOrg.name
          });
          res.setHeader('Refresh-JWT', token);
          return res.status(200).json(updUser.defaultOrg);
        })
        .catch((err) => {
          logger.error('Error selecting organization', { params: { reason: err.message } });
          return next(createError(500, 'Error selecting organization'));
        });
    } else {
      logger.error('Organization not found for user');
      return next(createError(500, 'Error selecting organization'));
    }
  });

// Get organization summary (dashboard statistics) - MUST come before /:orgId to avoid route matching
organizationsRouter.route('/summary')
  .options(cors.corsWithOptions, (req, res) => { res.sendStatus(200); })
  .get(cors.corsWithOptions, verifyPermission('organizations', 'get'), async (req, res, next) => {
    try {
      const orgId = req.user.defaultOrg;
      
      logger.info('Getting organization summary', {
        params: { orgId: orgId ? orgId.toString() : 'none', userId: req.user._id }
      });
      
      if (!orgId) {
        return res.status(200).json({
          devices: { total: 0, running: 0, connected: 0, approved: 0 },
          tunnels: { total: 0, active: 0, connected: 0, notConnected: 0, pending: 0, unknown: 0 },
          traffic: { total: 0, unit: 'MBytes', totalBytes: 0, lastUpdate: null }
        });
      }

      // Get device statistics
      const totalDevices = await devices.countDocuments({ org: orgId });
      const runningDevices = await devices.countDocuments({
        org: orgId,
        'deviceStatus.state': 'running'
      });
      const connectedDevices = await devices.countDocuments({
        org: orgId,
        isConnected: true
      });
      const approvedDevices = await devices.countDocuments({
        org: orgId,
        isApproved: true
      });

      // Get tunnel statistics
      // Deleted tunnels are kept with isActive=false (their numbers are reused),
      // so only active tunnels count. Classify them like upstream flexiManage:
      //   unknown      - one of the devices is not connected
      //   pending      - devices connected, tunnel is pending
      //   connected    - devices connected, not pending, status up
      //   notConnected - devices connected, not pending, status not up
      const activeTunnelList = await tunnels.find({ org: orgId, isActive: true })
        .select('deviceA deviceB isPending status').lean();
      const tunnelDevIds = [...new Set(activeTunnelList
        .flatMap(t => [t.deviceA, t.deviceB]).filter(Boolean).map(String))];
      const connectedTunnelDevs = new Set((await devices.find({
        _id: { $in: tunnelDevIds }, isConnected: true
      }).select('_id').lean()).map(d => String(d._id)));
      const tunnelStats = { connected: 0, notConnected: 0, pending: 0, unknown: 0 };
      for (const t of activeTunnelList) {
        // deviceB is empty for peer tunnels
        const devs = [t.deviceA, t.deviceB].filter(Boolean).map(String);
        if (devs.some(d => !connectedTunnelDevs.has(d))) tunnelStats.unknown++;
        else if (t.isPending) tunnelStats.pending++;
        else if (t.status === 'up') tunnelStats.connected++;
        else tunnelStats.notConnected++;
      }
      const totalTunnels = activeTunnelList.length;
      const activeTunnels = totalTunnels;

      // Get traffic statistics from deviceStats collection
      // Query the latest stats for each device in the organization
      const deviceList = await devices.find({ org: orgId }).select('_id machineId').lean().exec();
      const deviceIds = deviceList.map(d => d._id);
      
      logger.debug('Traffic calculation - devices found', {
        params: { orgId, deviceCount: deviceIds.length, deviceIds: deviceIds.map(d => d.toString()) }
      });
      
      let totalBytesPerSecond = 0;
      let totalBytes = 0;
      let lastUpdateTime = null;
      
      if (deviceIds.length > 0) {
        try {
          logger.debug('Traffic - attempting to query deviceStats', {
            params: { orgId, deviceCount: deviceIds.length }
          });
          
          // Get the latest stats for each device
          const latestStats = await deviceStats.aggregate([
            {
              $match: {
                org: orgId,
                device: { $in: deviceIds }
              }
            },
            {
              $sort: { time: -1, createdAt: -1 }
            },
            {
              $group: {
                _id: '$device',
                latestStats: { $first: '$stats' },
                latestTime: { $first: '$time' },
                latestCreated: { $first: '$createdAt' }
              }
            }
          ]);

          logger.debug('Traffic - Retrieved device stats', {
            params: { orgId, deviceCount: deviceIds.length, statsCount: latestStats.length, stats: JSON.stringify(latestStats).substring(0, 500) }
          });

          // Aggregate rx_bps and tx_bps from all device interfaces
          // Note: deviceStats stores rates in bytes per second (Bps)
          latestStats.forEach(deviceStat => {
            if (deviceStat.latestStats) {
              // Update last update time with the most recent timestamp
              const statTime = deviceStat.latestCreated || new Date(deviceStat.latestTime * 1000);
              if (!lastUpdateTime || statTime > lastUpdateTime) {
                lastUpdateTime = statTime;
              }
              
              // Sum up bytes per second from all interfaces
              Object.values(deviceStat.latestStats).forEach(interfaceStats => {
                if (interfaceStats.rx_bps) totalBytesPerSecond += interfaceStats.rx_bps;
                if (interfaceStats.tx_bps) totalBytesPerSecond += interfaceStats.tx_bps;
              });
            }
          });

          // Estimate cumulative bytes based on average rate over polling period
          // This gives an approximate total for display purposes
          const statsPollPeriodSeconds = 300; // 5 minutes default
          totalBytes = Math.round(totalBytesPerSecond * statsPollPeriodSeconds);

          logger.debug('Traffic calculation - Calculated total traffic', {
            params: { orgId, totalBytesPerSecond, estimatedBytes: totalBytes, lastUpdate: lastUpdateTime }
          });
        } catch (err) {
          logger.error('Traffic calculation - Error querying device stats', {
            params: { orgId, error: err.message, stack: err.stack }
          });
        }
      }

      // Convert bytes to appropriate unit
      let total, unit;
      if (totalBytes >= 1024 * 1024 * 1024) { // GB
        total = (totalBytes / (1024 * 1024 * 1024)).toFixed(2);
        unit = 'GBytes';
      } else if (totalBytes >= 1024 * 1024) { // MB
        total = (totalBytes / (1024 * 1024)).toFixed(2);
        unit = 'MBytes';
      } else if (totalBytes >= 1024) { // KB
        total = (totalBytes / 1024).toFixed(2);
        unit = 'KBytes';
      } else {
        total = totalBytes;
        unit = 'Bytes';
      }

      const summary = {
        devices: {
          total: totalDevices,
          running: runningDevices,
          connected: connectedDevices,
          approved: approvedDevices
        },
        tunnels: {
          total: totalTunnels,
          active: activeTunnels,
          ...tunnelStats
        },
        traffic: {
          total: parseFloat(total),
          unit: unit,
          totalBytes: totalBytes,
          lastUpdate: lastUpdateTime || new Date()
        }
      };

      logger.info('Returning organization summary', {
        params: { 
          orgId: orgId.toString(),
          devices: totalDevices,
          tunnels: totalTunnels,
          trafficTotal: total,
          trafficUnit: unit,
          trafficBytes: totalBytes
        }
      });

      return res.status(200).json(summary);
    } catch (err) {
      logger.error('Error getting organization summary', {
        params: { reason: err.message, stack: err.stack }
      });
      return next(createError(500, 'Error getting organization summary'));
    }
  });

// Retrieves the organization
organizationsRouter.route('/:orgId')
  .options(cors.corsWithOptions, (req, res) => { res.sendStatus(200); })
  .get(cors.corsWithOptions, verifyPermission('organizations', 'get'), async (req, res, next) => {
    try {
      // Find org with the correct ID
      const resultOrg = await getUserOrgByID(req.user, req.params.orgId);
      return res.status(200).json(resultOrg);
    } catch (err) {
      logger.error('Error getting organization', { params: { reason: err.message } });
      return next(createError(500, 'Error getting organization'));
    }
  })
// deletes organization
  .delete(cors.corsWithOptions, verifyPermission('organizations', 'del'), (req, res, next) => {
    if (!req.user.defaultOrg) {
      return next(createError(400, 'User has no default organization selected'));
    }
    let session = null;
    mongoConns.getMainDB().startSession()
      .then((_session) => {
        session = _session;
        return session.startTransaction();
      })
    // Find and remove organization from account
      .then(async () => {
        // Only allow to delete current default org, this
        // is required to make sure the API permissions
        // are set properly for updating this organization
        if (req.user.defaultOrg._id.toString() === req.params.orgId) {
          return accounts.findOneAndUpdate(
            { _id: req.user.defaultAccount },
            { $pull: { organizations: req.params.orgId } },
            { upsert: false, new: true, session: session }
          );
        } else {
          throw new Error('Please select an organization to delete it');
        }
      })
      .then(async (account) => {
        if (!account) throw new Error('Cannot delete organization');
        // Since the selected org is deleted, need to select another organization available
        req.user.defaultOrg = null;
        await orgUpdateFromNull(req, res);
        return Promise.resolve(true);
      })
    // Remove organization
      .then(() => {
        return organizations.findOneAndRemove({
          _id: req.params.orgId,
          account: req.user.defaultAccount
        }, {
          session: session
        });
      })
    // Remove all memberships that belong to the organization, but keep group even if empty
      .then(() => {
        return membership.deleteMany({ organization: req.params.orgId }, { session: session });
      })
    // Remove organization inventory (devices, tokens, tunnelIds, tunnels)
      .then(() => {
        return tunnels.deleteMany({ org: req.params.orgId }, { session: session });
      })
      .then(() => {
        return tunnelIds.deleteMany({ org: req.params.orgId }, { session: session });
      })
      .then(() => {
        return tokens.deleteMany({ org: req.params.orgId }, { session: session });
      })
      .then(() => {
        return AccessToken.deleteMany({ organization: req.params.orgId }, { session: session });
      })
      .then(async () => {
        // Find all devices for organization
        const orgDevices = await devices.find(
          { org: req.params.orgId },
          { machineId: 1, _id: 0 },
          { session: session }
        );
        // Get the account total device count
        const deviceCount = await devices
          .countDocuments({ account: req.user.defaultAccount._id })
          .session(session);
        const deviceOrgCount = await devices
          .countDocuments({ account: req.user.defaultAccount._id, org: req.params.orgId })
          .session(session);
        // Delete all devices
        await devices.deleteMany({ org: req.params.orgId }, { session: session });
        // Unregister a device (by removing the removed org number)
        await flexibilling.registerDevice({
          account: req.user.defaultAccount._id,
          org: req.params.orgId,
          count: deviceCount,
          orgCount: deviceOrgCount,
          increment: -orgDevices.length
        }, session);
        // Disconnect all devices
        orgDevices.forEach((device) => connections.deviceDisconnect(device.machineId));
        return Promise.resolve(true);
      })
      .then(() => {
        return session.commitTransaction();
      })
      .then(async () => {
        // Session committed, set to null
        session = null;
        return res.status(200).json({ ok: 1 });
      })
      .catch((err) => {
        if (session) session.abortTransaction();
        logger.error('Error deleting organization', { params: { reason: err.message } });
        return next(createError(500, err.message));
      });
  })
  .put(cors.corsWithOptions, verifyPermission('organizations', 'put'), async (req, res, next) => {
    if (!req.user.defaultOrg) {
      return next(createError(400, 'User has no default organization selected'));
    }
    try {
      // Only allow to update current default org, this is required to make sure the API permissions
      // are set properly for updating this organization
      if (req.user.defaultOrg._id.toString() === req.params.orgId) {
        const resultOrg = await organizations.findOneAndUpdate(
          { _id: req.params.orgId },
          { $set: req.body },
          { upsert: false, multi: false, new: true, runValidators: true }
        );
        // Update token
        const token = await getToken(req, { orgName: req.body.name });
        res.setHeader('Refresh-JWT', token);
        return res.status(200).json(resultOrg);
      } else {
        throw new Error('Please select an organization to update it');
      }
    } catch (err) {
      logger.error('Error updating organization', { params: { reason: err.message } });
      return next(createError(400, err.message));
    }
  });

// Default exports
module.exports = {
  organizationsRouter: organizationsRouter
};
