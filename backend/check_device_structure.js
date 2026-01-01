
const mongoose = require('mongoose');
require('dotenv').config({ path: '.env' });
const mongoConns = require('./mongoConns');

async function checkDevice() {
    try {
        await mongoConns();
        const models = require('./models/devices');
        const Device = models.devices;
        
        console.log('Connected to MongoDB');
        
        const device = await Device.findOne({});
        if (device) {
            console.log('Found device:', JSON.stringify(device.toJSON(), null, 2));
        } else {
            console.log('No devices found');
        }
        
        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

checkDevice();
