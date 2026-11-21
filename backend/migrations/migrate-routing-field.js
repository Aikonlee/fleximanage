const mongoose = require('mongoose');
const { devices } = require('../models/devices');

/**
 * Migrate existing routing field to new structure
 */
async function up() {
    console.log('Starting migration: Update routing field structure...');

    try {
        const allDevices = await devices.find({});
        let updatedCount = 0;

        for (const device of allDevices) {
            let modified = false;

            for (const iface of device.interfaces) {
                // Check if routing needs migration
                if (!iface.routing || typeof iface.routing === 'string') {
                    // Old format: routing is a string or undefined
                    const oldRouting = iface.routing || 'none';
                    
                    // Convert to new structure
                    iface.routing = {
                        protocol: oldRouting === 'static' ? 'none' : (oldRouting === 'OSPF' ? 'ospf' : 'none'),
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
                            localPref: 100
                        }
                    };
                    
                    modified = true;
                } else if (!iface.routing.protocol) {
                    // Routing exists but missing protocol field
                    iface.routing.protocol = 'none';
                    
                    if (!iface.routing.ospf) {
                        iface.routing.ospf = {
                            enabled: false,
                            area: '0.0.0.0',
                            cost: 10,
                            priority: 1,
                            networkType: 'broadcast',
                            passive: false
                        };
                    }
                    
                    if (!iface.routing.bgp) {
                        iface.routing.bgp = {
                            enabled: false,
                            advertise: true,
                            asPath: '',
                            localPref: 100
                        };
                    }
                    
                    modified = true;
                }
            }

            if (modified) {
                await device.save();
                updatedCount++;
                console.log(`✅ Updated device: ${device.hostname || device.name} (${device._id})`);
            }
        }

        console.log(`\n✅ Migration completed successfully!`);
        console.log(`   Total devices processed: ${allDevices.length}`);
        console.log(`   Devices updated: ${updatedCount}`);

    } catch (error) {
        console.error('❌ Migration failed:', error);
        throw error;
    }
}

/**
 * Rollback migration
 */
async function down() {
    console.log('Rolling back migration: Revert routing field to simple string...');

    try {
        const allDevices = await devices.find({});
        let updatedCount = 0;

        for (const device of allDevices) {
            let modified = false;

            for (const iface of device.interfaces) {
                if (iface.routing && typeof iface.routing === 'object') {
                    // Convert back to simple string
                    iface.routing = iface.routing.protocol || 'none';
                    modified = true;
                }
            }

            if (modified) {
                await device.save();
                updatedCount++;
                console.log(`✅ Rolled back device: ${device.hostname || device.name}`);
            }
        }

        console.log(`\n✅ Rollback completed!`);
        console.log(`   Devices rolled back: ${updatedCount}`);

    } catch (error) {
        console.error('❌ Rollback failed:', error);
        throw error;
    }
}

// Run migration
if (require.main === module) {
    const MONGODB_URL = process.env.MONGODB_URL || 'mongodb://localhost:27017/flexiwan';

    mongoose.connect(MONGODB_URL, {
        useNewUrlParser: true,
        useUnifiedTopology: true
    })
        .then(async () => {
            console.log('Connected to MongoDB');

            const action = process.argv[2] || 'up';

            if (action === 'down') {
                await down();
            } else {
                await up();
            }

            await mongoose.disconnect();
            console.log('Disconnected from MongoDB');
            process.exit(0);
        })
        .catch(err => {
            console.error('MongoDB connection error:', err);
            process.exit(1);
        });
}

module.exports = { up, down };
