#!/usr/bin/env node
// Usage: node verify_device_tokens.js <MACHINE_ID> <DEVICE_TOKEN> [<MACHINE_ID> <DEVICE_TOKEN> ...]
const mongoConns = require('../mongoConns')();
const devicesModel = require('../models/devices').devices;

const args = process.argv.slice(2);
if (args.length === 0 || args.length % 2 !== 0) {
  console.error('Usage: node verify_device_tokens.js <MACHINE_ID> <DEVICE_TOKEN> [<MACHINE_ID> <DEVICE_TOKEN> ...]');
  process.exit(2);
}

const mainDB = mongoConns.getMainDB();

function whenConnected(db, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    if (db && db.readyState === 1) return resolve();
    const onConnected = () => { cleanup(); resolve(); };
    const onError = (err) => { cleanup(); reject(err); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Timed out waiting for MongoDB connection')); }, timeoutMs);
    function cleanup() { clearTimeout(timer); db.removeListener('connected', onConnected); db.removeListener('error', onError); }
    db.once('connected', onConnected);
    db.once('error', onError);
  });
}

(async function main() {
  try {
    await whenConnected(mainDB);
  } catch (err) {
    console.error('Failed to connect to MongoDB:', err && err.message);
    process.exit(3);
  }

  for (let i = 0; i < args.length; i += 2) {
    const machineId = args[i];
    const token = args[i + 1];
    console.log('---');
    console.log('Checking machineId:', machineId);

    try {
      const docById = await devicesModel.findOne({ machineId }).lean().exec();
      if (!docById) {
        console.log('  Device document not found by machineId');
      } else {
        console.log('  Found device by machineId. isApproved:', !!docById.isApproved, 'isConnected:', !!docById.isConnected);
        console.log('  Stored deviceToken length:', docById.deviceToken ? docById.deviceToken.length : '(none)');
        const exactMatch = docById.deviceToken === token;
        console.log('  Provided token EXACT MATCH with stored token?:', exactMatch);
      }

      const docByToken = await devicesModel.findOne({ deviceToken: token }).lean().exec();
      if (!docByToken) {
        console.log('  No device found by provided token');
      } else {
        console.log('  Found device by token. machineId:', docByToken.machineId, 'isApproved:', !!docByToken.isApproved);
      }
    } catch (err) {
      console.error('  Error querying DB:', err && err.message ? err.message : err);
    }
  }

  process.exit(0);
})();
