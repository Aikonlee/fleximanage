// Load the maintained ESM library through Node rather than Jest 29's CJS loader.
jest.mock('cidr-tools', () => process.getBuiltinModule('module').createRequire(__filename)('cidr-tools'));
// Schema validation must never open a network connection or select a live database.
jest.mock('../mongoConns', () => {
  const mongoose = require('mongoose');
  const main = mongoose.createConnection();
  const analytics = mongoose.createConnection();
  const vpn = mongoose.createConnection();
  return () => ({ getMainDB: () => main, getAnalyticsDB: () => analytics, getVpnDB: () => vpn });
});
