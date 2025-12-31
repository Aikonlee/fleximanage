const mongoose = require('mongoose');
const { MongoConns } = require('./mongoConns');

async function checkDevice() {
  try {
    const dbConn = new MongoConns();
    const mainDB = dbConn.getMainDB();
    
    const devicesModel = mainDB.model('devices', require('./models/devices'));
    const devices = await devicesModel.find().limit(1).lean();
    
    if (devices.length > 0) {
      const device = devices[0];
      console.log('Device ID:', device._id);
      console.log('Interfaces:', device.interfaces.length);
      device.interfaces.forEach((iface, idx) => {
        console.log(`  [${idx}] ${iface.name} - Type: ${iface.type}, isAssigned: ${iface.isAssigned}`);
      });
    } else {
      console.log('No devices found');
    }
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

checkDevice();
