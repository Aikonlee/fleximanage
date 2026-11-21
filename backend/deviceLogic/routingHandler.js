const logger = require('../logging/logging')({ module: module.filename, type: 'job' });

/**
 * Apply routing configuration to device
 * @param {Object} device - Device document
 * @param {Object} iface - Interface object
 */
async function applyRoutingConfig(device, iface) {
    if (!iface.routing || !iface.routing.protocol) {
        logger.warn('No routing configuration found for interface', {
            params: { device: device._id, interface: iface.name }
        });
        return [];
    }

    const routing = iface.routing;
    const tasks = [];

    logger.info('Applying routing configuration', {
        params: {
            device: device._id,
            interface: iface.name,
            protocol: routing.protocol
        }
    });

    // Generate OSPF configuration
    if (routing.ospf?.enabled) {
        tasks.push({
            entity: 'agent',
            message: 'add-ospf-interface',
            params: {
                interface: iface.devId,
                name: iface.name,
                network: iface.IPv4,
                area: routing.ospf.area,
                cost: routing.ospf.cost,
                priority: routing.ospf.priority,
                networkType: routing.ospf.networkType,
                passive: routing.ospf.passive
            }
        });
        logger.info('Generated OSPF configuration', {
            params: { interface: iface.name, area: routing.ospf.area }
        });
    } else if (routing.protocol !== 'none') {
        // Remove OSPF if protocol changed
        tasks.push({
            entity: 'agent',
            message: 'remove-ospf-interface',
            params: {
                interface: iface.devId,
                name: iface.name
            }
        });
    }

    // Generate BGP configuration
    if (routing.bgp?.enabled && routing.bgp?.advertise) {
        tasks.push({
            entity: 'agent',
            message: 'add-bgp-network',
            params: {
                interface: iface.devId,
                name: iface.name,
                network: iface.IPv4,
                asPath: routing.bgp.asPath,
                localPref: routing.bgp.localPref,
                med: routing.bgp.med
            }
        });
        logger.info('Generated BGP configuration', {
            params: { interface: iface.name, network: iface.IPv4 }
        });
    } else if (routing.protocol !== 'none') {
        // Remove BGP if protocol changed
        tasks.push({
            entity: 'agent',
            message: 'remove-bgp-network',
            params: {
                interface: iface.devId,
                name: iface.name,
                network: iface.IPv4
            }
        });
    }

    // Send tasks to device queue
    if (tasks.length > 0) {
        const { queueJob } = require('../utils/jobQueue');
        await queueJob({
            org: device.org,
            title: `Update routing configuration for interface ${iface.name}`,
            tasks: tasks
        }, device._id);
    }

    return tasks;
}

/**
 * Remove all routing configuration from interface
 * @param {Object} device - Device document
 * @param {Object} iface - Interface object
 */
async function removeRoutingConfig(device, iface) {
    const tasks = [
        {
            entity: 'agent',
            message: 'remove-ospf-interface',
            params: {
                interface: iface.devId,
                name: iface.name
            }
        },
        {
            entity: 'agent',
            message: 'remove-bgp-network',
            params: {
                interface: iface.devId,
                name: iface.name,
                network: iface.IPv4
            }
        }
    ];

    const { queueJob } = require('../utils/jobQueue');
    await queueJob({
        org: device.org,
        title: `Remove routing configuration for interface ${iface.name}`,
        tasks: tasks
    }, device._id);

    return tasks;
}

module.exports = {
    applyRoutingConfig,
    removeRoutingConfig
};
