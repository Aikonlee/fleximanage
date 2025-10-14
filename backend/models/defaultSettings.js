/**
 * Default organization settings that are created for every new organization.
 * These settings can be modified later through the UI.
 */
const getDefaultNotificationsSettings = () => {
  return {
    critical: {
      deviceDisconnect: true,
      deviceReboot: true,
      deviceUpgrade: true,
      tunnelDown: true
    },
    warning: {
      deviceConfigSync: true,
      deviceReconfigure: true,
      tunnelModify: true,
      deviceRegistration: true,
      deviceStateChange: true
    },
    info: {
      dailyStats: true
    }
  };
};

module.exports = {
  getDefaultNotificationsSettings
};