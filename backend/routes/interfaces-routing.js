const express = require('express');
const router = express.Router();
const logger = require('../logging/logging')({ module: module.filename, type: 'req' });
const { devices } = require('../models/devices');
const { verifyPermission } = require('../authenticate');
const { getAccessTokenOrgList } = require('../utils/membershipUtils');
const dispatcher = require('../deviceLogic/dispatcher');

const ROUTING_PROTOCOLS = ['NONE', 'OSPF', 'BGP', 'OSPF,BGP'];

const normalizeRoutingProtocol = (protocol) => {
  if (protocol === undefined || protocol === null || protocol === '') return null;
  const normalized = String(protocol).trim().toUpperCase().replace('-', ',');
  return ROUTING_PROTOCOLS.includes(normalized) ? normalized : null;
};

const plainSubdoc = (value) => {
  if (!value) return {};
  return typeof value.toObject === 'function' ? value.toObject() : value;
};

/**
 * Get routing configuration for a specific interface
 */
router.get('/api/devices/:deviceId/interfaces/:interfaceId/routing',
  verifyPermission('devices', 'get'),
  async (req, res) => {
    try {
      const orgList = await getAccessTokenOrgList(req.user, req.query?.org, false);
      const device = await devices.findOne({ _id: req.params.deviceId, org: { $in: orgList } });
      if (!device) {
        return res.status(404).json({ error: 'Device not found' });
      }

      const iface = device.interfaces.id(req.params.interfaceId);
      if (!iface) {
        return res.status(404).json({ error: 'Interface not found' });
      }

      res.status(200).json({
        routing: iface.routing || 'NONE',
        ospf: iface.ospf || { area: '0', keyId: '', key: '' },
        bgp: device.bgp || { enable: false }
      });
    } catch (error) {
      logger.error('Failed to get routing configuration', {
        params: {
          deviceId: req.params.deviceId,
          interfaceId: req.params.interfaceId,
          error: error.message
        }
      });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

/**
 * Update routing configuration for a specific interface
 */
router.put('/api/devices/:deviceId/interfaces/:interfaceId/routing',
  verifyPermission('devices', 'put'),
  async (req, res) => {
    try {
      const { protocol, ospf, bgp } = req.body;
      const normalizedProtocol = protocol ? normalizeRoutingProtocol(protocol) : null;
      if (protocol && !normalizedProtocol) {
        return res.status(400).json({
          error: `Invalid protocol. Must be one of: ${ROUTING_PROTOCOLS.join(', ')}`
        });
      }

      const orgList = await getAccessTokenOrgList(req.user, req.query?.org, true, null, '', true);
      const device = await devices.findOne({ _id: req.params.deviceId, org: { $in: orgList } });
      if (!device) {
        return res.status(404).json({ error: 'Device not found' });
      }

      const iface = device.interfaces.id(req.params.interfaceId);
      if (!iface) {
        return res.status(404).json({ error: 'Interface not found' });
      }

      // Snapshot before in-place mutation so modifyDevice can diff pre vs newDevice.
      const origDevice = device.toObject ? device.toObject() : { ...device };

      if (normalizedProtocol) {
        iface.routing = normalizedProtocol;
      }
      if (ospf && typeof ospf === 'object') {
        iface.ospf = { ...plainSubdoc(iface.ospf), ...ospf };
      }
      if (bgp && typeof bgp === 'object') {
        device.bgp = { ...plainSubdoc(device.bgp), ...bgp };
      }

      await device.save();

      if (device.status === 'running') {
        await dispatcher.apply([origDevice], 'modify', req.user, {
          org: orgList[0],
          newDevice: device
        });
      }

      logger.info('Routing configuration updated', {
        params: {
          deviceId: req.params.deviceId,
          interfaceId: req.params.interfaceId,
          protocol: iface.routing
        }
      });

      res.status(200).json({
        message: 'Routing configuration updated successfully',
        routing: iface.routing,
        ospf: iface.ospf,
        bgp: device.bgp
      });
    } catch (error) {
      logger.error('Failed to update routing configuration', {
        params: {
          deviceId: req.params.deviceId,
          interfaceId: req.params.interfaceId,
          error: error.message
        }
      });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

module.exports = router;
