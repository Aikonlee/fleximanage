const express = require('express');
const router = express.Router();
const logger = require('../logging/logging')({ module: module.filename, type: 'req' });
const { devices } = require('../models/devices');
const { verifyPermission } = require('../authenticate');
const { applyRoutingConfig, removeRoutingConfig } = require('../deviceLogic/routingHandler');

/**
 * Get routing configuration for a specific interface
 */
router.get('/api/devices/:deviceId/interfaces/:interfaceId/routing',
  verifyPermission('devices', 'get'),
  async (req, res) => {
    try {
      const device = await devices.findById(req.params.deviceId);
      if (!device) {
        return res.status(404).json({ error: 'Device not found' });
      }

      const iface = device.interfaces.id(req.params.interfaceId);
      if (!iface) {
        return res.status(404).json({ error: 'Interface not found' });
      }

      res.status(200).json({
        routing: iface.routing || {
          protocol: 'none',
          ospf: {
            enabled: false,
            area: '0.0.0.0',
            cost: 10,
            priority: 1,
            networkType: 'broadcast',
            passive: false
          },
          bgp: {
            enabled: false,
            advertise: true,
            asPath: '',
            localPref: 100,
            med: 0
          }
        }
      });
    } catch (error) {
      logger.error('Failed to get routing configuration', {
        params: { deviceId: req.params.deviceId, interfaceId: req.params.interfaceId, error: error.message }
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

      // Validate protocol
      const validProtocols = ['none', 'ospf', 'bgp', 'ospf-bgp'];
      if (protocol && !validProtocols.includes(protocol)) {
        return res.status(400).json({ error: `Invalid protocol. Must be one of: ${validProtocols.join(', ')}` });
      }

      const device = await devices.findById(req.params.deviceId);
      if (!device) {
        return res.status(404).json({ error: 'Device not found' });
      }

      const iface = device.interfaces.id(req.params.interfaceId);
      if (!iface) {
        return res.status(404).json({ error: 'Interface not found' });
      }

      // Update routing configuration
      if (!iface.routing) {
        iface.routing = {
          protocol: 'none',
          ospf: {
            enabled: false,
            area: '0.0.0.0',
            cost: 10,
            priority: 1,
            networkType: 'broadcast',
            passive: false
          },
          bgp: {
            enabled: false,
            advertise: true,
            asPath: '',
            localPref: 100,
            med: 0
          }
        };
      }

      // Update protocol
      if (protocol) {
        iface.routing.protocol = protocol;

        // Enable/disable protocols based on selection
        if (protocol === 'none') {
          iface.routing.ospf.enabled = false;
          iface.routing.bgp.enabled = false;
        } else if (protocol === 'ospf') {
          iface.routing.ospf.enabled = true;
          iface.routing.bgp.enabled = false;
        } else if (protocol === 'bgp') {
          iface.routing.ospf.enabled = false;
          iface.routing.bgp.enabled = true;
        } else if (protocol === 'ospf-bgp') {
          iface.routing.ospf.enabled = true;
          iface.routing.bgp.enabled = true;
        }
      }

      // Update OSPF settings
      if (ospf) {
        iface.routing.ospf = { ...iface.routing.ospf, ...ospf };
      }

      // Update BGP settings
      if (bgp) {
        iface.routing.bgp = { ...iface.routing.bgp, ...bgp };
      }

      // Save device
      await device.save();

      // Apply configuration to device
      if (device.status === 'running') {
        if (protocol === 'none') {
          await removeRoutingConfig(device, iface);
        } else {
          await applyRoutingConfig(device, iface);
        }
      }

      logger.info('Routing configuration updated', {
        params: {
          deviceId: req.params.deviceId,
          interfaceId: req.params.interfaceId,
          protocol: iface.routing.protocol
        }
      });

      res.status(200).json({
        message: 'Routing configuration updated successfully',
        routing: iface.routing
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
