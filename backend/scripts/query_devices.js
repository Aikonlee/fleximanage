#!/usr/bin/env node
// Clean script: query device documents using project's mongoConns and exported model
const mongoConns = require('../mongoConns.js')();
const devicesModel = require('../models/devices').devices;

const ids = process.argv.slice(2);
if (ids.length === 0) {
  console.error('Usage: node backend/scripts/query_devices.js <MACHINE_ID> [<MACHINE_ID> ...]');
  process.exit(2);
}

const mainDB = mongoConns.getMainDB();

function whenConnected(db, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    try {
      if (db && db.readyState === 1) return resolve();
      const onConnected = () => {
        cleanup();
        resolve();
      };
      const onError = (err) => {
        cleanup();
        reject(err);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Timed out waiting for MongoDB connection'));
      }, timeoutMs);
      function cleanup() {
        clearTimeout(timer);
        db.removeListener('connected', onConnected);
        db.removeListener('error', onError);
      }
      db.once('connected', onConnected);
      db.once('error', onError);
    } catch (err) {
      reject(err);
    }
  });
}

(async function main() {
  try {
    await whenConnected(mainDB);
  } catch (err) {
    console.error('Failed to connect to MongoDB:', err && err.message);
    process.exit(3);
  }

  for (const id of ids) {
    try {
      const doc = await devicesModel.findOne({ machineId: id }).lean().exec();
      if (!doc) {
        console.log(`--- ${id} : NOT FOUND`);
        continue;
      }
      console.log(`--- ${id} : FOUND`);
      console.log('machineId:', doc.machineId);
      console.log('fromToken:', doc.fromToken);
      console.log('isApproved:', !!doc.isApproved);
      console.log('isConnected:', !!doc.isConnected);
      console.log('deviceToken:', doc.deviceToken ? `<REDACTED, length=${doc.deviceToken.length}>` : '(none)');
      console.log('createdAt:', doc.createdAt);
      console.log('updatedAt:', doc.updatedAt);
      console.log('name:', doc.name || '(none)');
      console.log('org:', doc.org || '(none)');
    } catch (err) {
      console.error(`Error querying ${id}:`, err && err.message ? err.message : err);
    }
  }
  process.exit(0);
})();
