// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2019  flexiWAN Ltd.

const Device = require('./devices');
const logger = require('../logging/logging')({ module: module.filename, type: 'deviceStatus' });

class DeviceStatus {
  constructor () {}

  /**
   * Updates device connection status when device connects
   * @param {string} deviceId the device ID
   */
  async deviceConnectionOpened (deviceId) {
    try {
      await Device.updateOne(
        { machineId: deviceId },
        { 
          $set: { 
            isConnected: true,
            lastConnected: new Date()
          }
        }
      );
      logger.info('Device status updated to connected', { params: { deviceId } });
    } catch (err) {
      logger.error('Failed to update device connection status', { 
        params: { deviceId, error: err.message }
      });
    }
  }

  /**
   * Updates device connection status when device disconnects
   * @param {string} deviceId the device ID
   */
  async deviceConnectionClosed (deviceId) {
    try {
      await Device.updateOne(
        { machineId: deviceId },
        { 
          $set: { 
            isConnected: false,
            lastDisconnected: new Date()
          }
        }
      );
      logger.info('Device status updated to disconnected', { params: { deviceId } });
    } catch (err) {
      logger.error('Failed to update device disconnection status', {
        params: { deviceId, error: err.message }
      });
    }
  }
}

// Export singleton instance
module.exports = new DeviceStatus();