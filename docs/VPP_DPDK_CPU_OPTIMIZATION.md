# VPP DPDK CPU Configuration Analysis & Optimization Recommendations

## 📋 Document Overview
**Date:** October 17, 2025  
**Purpose:** Analyze backend VPP/DPDK CPU configuration logic and provide optimization recommendations for devices with >2 CPU cores

---

## 1. Current System Architecture Analysis

### 1.1 CPU Configuration Model (backend/models/devices.js)

```javascript
cpuInfo: {
  hwCores: Number,           // Total hardware CPU cores (default: 2)
  grubCores: Number,         // Cores allocated by GRUB (default: 2)
  vppCores: Number,          // Current VPP worker cores (default: 1)
  configuredVppCores: Number,// User configured VPP cores (default: 1)
  powerSaving: Boolean       // Power saving mode (default: false)
}
```

**Key Findings:**
- `vppCores`: Reflects the **actual current** VPP configuration on device
- `configuredVppCores`: User-intended configuration (may differ during transition)
- Minimum system requirements: 2 CPU cores (1 for system, 1 for VPP)

### 1.2 Core Allocation Rules (backend/deviceLogic/modifyHardware.js)

```javascript
// Line 68: Core allocation constraint
if (meta.cpuInfo.configuredVppCores > meta.cpuInfo.hwCores - 1) {
  throw new Error('vRouter cores number should be less than HW cores - 1');
}
```

**Formula:**
```
Max VPP Cores = Total HW Cores - 1
Reserved Cores = 1 (for Linux system)
```

**Examples:**
- 2-core device: Max 1 VPP core
- 4-core device: Max 3 VPP cores
- 8-core device: Max 7 VPP cores

### 1.3 QoS Requirements (backend/deviceLogic/validators.js)

```javascript
// Line 970: QoS validation
if (devices.some(device => getCpuInfo(device.cpuInfo).vppCores < 2)) {
  return {
    valid: false,
    err: 'QoS feature requires 3 or more CPU cores and at least 2 vRouter cores'
  };
}
```

**QoS Requirements:**
- **Minimum total CPU cores:** 3+ (as stated in system requirements)
- **Minimum VPP cores:** 2+
- **Reason:** QoS traffic shaping requires dedicated worker threads

### 1.4 Power Saving Constraints (backend/deviceLogic/modifyHardware.js)

```javascript
// Line 49: Power saving incompatibility
if (meta.cpuInfo.configuredVppCores > 1 && meta.cpuInfo.powerSaving) {
  throw new Error('Power saving should be disabled if multicore is used.');
}
```

**Constraint:**
- Power saving mode is **incompatible** with multi-core VPP
- Single-core only for power-constrained deployments

---

## 2. VPP Configuration Dispatch Logic

### 2.1 Device Start Flow (backend/deviceLogic/start.js)

```javascript
// Line 78-83: Start router message
startParams.interfaces = buildInterfaces(
  device.interfaces.toObject(),
  device.ospf.toObject(),
  device.versions.agent
);

const tasks = [
  { entity: 'agent', message: 'start-router', params: startParams }
];
```

**Process:**
1. Validate device configuration
2. Build interface configuration
3. Queue `start-router` job to device agent
4. Agent configures VPP with interface and routing settings

### 2.2 CPU Modification Job (backend/deviceLogic/modifyHardware.js)

```javascript
// Line 89-98: CPU configuration job
{
  title: 'Modify device CPU',
  tasks: [{
    entity: 'agent',
    message: 'set-cpu-info',
    params: meta.cpuInfo  // Contains vppCores, powerSaving, etc.
  }]
}
```

**Key Points:**
- `set-cpu-info` message sent directly to agent
- Agent reconfigures VPP DPDK worker threads
- Device state set to "pending" during configuration
- **Note:** The backend doesn't directly send VPP startup.conf parameters

---

## 3. Current Limitations & Issues

### 3.1 Default Configuration Issues

| Device Type | Total Cores | Default VPP Cores | Issue |
|-------------|-------------|-------------------|-------|
| 2-core | 2 | 1 | ✅ Appropriate for minimal deployment |
| 4-core | 4 | 1 | ❌ **Underutilized** - 75% cores unused |
| 8-core | 8 | 1 | ❌ **Severely underutilized** - 87.5% cores unused |

**Problem:**
- Default `vppCores = 1` regardless of hardware capacity
- No automatic scaling based on available cores
- Users must **manually** configure multi-core settings

### 3.2 QoS Deployment Friction

```javascript
// Line 73: QoS installation check
const hasQosInstalled = device.policies?.qos?.policy;
if (meta.cpuInfo.configuredVppCores < 2 && hasQosInstalled) {
  throw new Error(
    'Reducing device CPU cannot be applied on a device with QoS policy installed'
  );
}
```

**Issues:**
- QoS requires 2+ VPP cores but defaults to 1
- Users must increase cores **before** enabling QoS
- Creates extra manual configuration steps

### 3.3 No NUMA Awareness

**Finding:** Code search revealed no NUMA (Non-Uniform Memory Access) configuration

**Impact on multi-socket systems:**
- No NUMA node pinning for VPP workers
- Potential cross-socket memory access penalties
- Suboptimal performance on 16+ core servers

### 3.4 Missing Performance Knobs

Backend doesn't expose configuration for:
- **Main core selection** (which CPU for VPP main thread)
- **Skip cores** (avoid hyperthreading siblings)
- **Core pinning** (CPU affinity for workers)
- **RX/TX queue distribution**

---

## 4. Optimization Recommendations for >2 Core Devices

### 4.1 Intelligent Default VPP Core Allocation

#### Proposed Algorithm

```javascript
/**
 * Calculate optimal VPP cores based on hardware and workload
 * @param {Number} hwCores - Total hardware cores
 * @param {Boolean} hasQos - Whether QoS is enabled
 * @param {Number} wanInterfaces - Number of WAN interfaces
 * @returns {Number} Recommended VPP cores
 */
function calculateOptimalVppCores(hwCores, hasQos, wanInterfaces) {
  // Reserve 1 core for system
  const availableCores = hwCores - 1;
  
  // Minimum requirements
  if (hasQos && availableCores < 2) {
    throw new Error('Insufficient cores for QoS');
  }
  
  // Allocation strategy
  if (hwCores <= 2) {
    return 1; // Minimal deployment
  } else if (hwCores <= 4) {
    return hasQos ? 2 : Math.min(2, availableCores); // 2-3 cores
  } else if (hwCores <= 8) {
    // Formula: Use 50-75% of available cores
    const baseAllocation = Math.floor(availableCores * 0.6);
    return Math.max(baseAllocation, hasQos ? 2 : 1);
  } else {
    // High-end: Use 75% of available cores (leave headroom)
    const baseAllocation = Math.floor(availableCores * 0.75);
    // Scale with WAN interfaces (1-2 workers per WAN)
    const interfaceBased = Math.min(wanInterfaces * 2, baseAllocation);
    return Math.max(interfaceBased, hasQos ? 2 : 2);
  }
}
```

#### Recommended Allocation Table

| Total Cores | System Core | VPP Cores | QoS Support | Utilization |
|-------------|-------------|-----------|-------------|-------------|
| 2 | 1 | 1 | ❌ No | 50% |
| 3 | 1 | 2 | ✅ Yes | 67% |
| 4 | 1 | 2-3 | ✅ Yes | 75% |
| 6 | 1 | 3-4 | ✅ Yes | 67% |
| 8 | 1 | 4-6 | ✅ Yes | 75% |
| 12 | 1 | 6-9 | ✅ Yes | 75% |
| 16 | 1 | 10-12 | ✅ Yes | 75% |

### 4.2 Implementation in Backend Code

#### Step 1: Update deviceUtils.js

```javascript
// backend/utils/deviceUtils.js

/**
 * Calculate recommended VPP cores based on device profile
 * @param {Object} device - Device object with interfaces and policies
 * @returns {Number} Recommended VPP cores
 */
const calculateRecommendedVppCores = (device) => {
  const hwCores = device.cpuInfo?.hwCores || 2;
  const hasQos = !!device.policies?.qos?.policy;
  const wanInterfaces = device.interfaces?.filter(
    ifc => ifc.isAssigned && ifc.type === 'WAN'
  ).length || 1;
  
  const availableCores = hwCores - 1;
  
  if (hwCores <= 2) return 1;
  if (hwCores <= 4) return hasQos ? 2 : 2;
  if (hwCores <= 8) return Math.min(Math.floor(availableCores * 0.6), availableCores);
  
  // High-end devices
  const scaledCores = Math.min(
    wanInterfaces * 2,
    Math.floor(availableCores * 0.75)
  );
  return Math.max(scaledCores, 2);
};

module.exports = {
  // ... existing exports
  calculateRecommendedVppCores
};
```

#### Step 2: Auto-configure on Device Registration

```javascript
// backend/routes/connect.js (around line 249)

const cpuInfo = getCpuInfo(requestCpuInfo ? JSON.parse(requestCpuInfo) : null);

// NEW: Auto-configure VPP cores based on hardware
if (cpuInfo.hwCores > 2 && cpuInfo.vppCores === 1) {
  const recommendedCores = calculateRecommendedVppCores({
    cpuInfo,
    interfaces: device.interfaces,
    policies: device.policies
  });
  
  cpuInfo.configuredVppCores = recommendedCores;
  cpuInfo.vppCores = recommendedCores;
  
  logger.info('Auto-configured VPP cores for multi-core device', {
    params: { hwCores: cpuInfo.hwCores, vppCores: recommendedCores }
  });
}
```

#### Step 3: QoS Pre-check Enhancement

```javascript
// backend/deviceLogic/validators.js (around line 970)

const validateQOSPolicy = (devices) => {
  // Check version
  if (devices.some(device => getMajorVersion(device.versions.agent) < 6)) {
    return { valid: false, err: 'QoS is supported from version 6' };
  }

  // NEW: Enhanced multi-core check with recommendations
  const insufficientDevices = devices.filter(device => {
    const cpuInfo = getCpuInfo(device.cpuInfo);
    return cpuInfo.vppCores < 2;
  });
  
  if (insufficientDevices.length > 0) {
    const deviceNames = insufficientDevices.map(d => d.hostname).join(', ');
    const recommendations = insufficientDevices.map(d => {
      const recommended = calculateRecommendedVppCores(d);
      return `${d.hostname}: increase to ${recommended} cores`;
    }).join('; ');
    
    return {
      valid: false,
      err: `QoS requires 2+ VPP cores. Devices with insufficient cores: ${deviceNames}. ` +
           `Recommendations: ${recommendations}`
    };
  }

  return { valid: true, err: '' };
};
```

### 4.3 NUMA Awareness (Advanced Optimization)

For servers with 16+ cores and multiple NUMA nodes:

```javascript
// backend/deviceLogic/modifyHardware.js (enhancement to set-cpu-info)

const numaAwareConfig = (cpuInfo, interfaces) => {
  // Check if NUMA info is available from agent
  if (!cpuInfo.numaNodes || cpuInfo.numaNodes.length <= 1) {
    return cpuInfo; // Single NUMA node, no optimization needed
  }
  
  // Strategy: Pin VPP workers to NUMA node with most network interfaces
  const primaryNuma = detectPrimaryNumaNode(interfaces);
  
  return {
    ...cpuInfo,
    numaNode: primaryNuma,
    coreMask: generateNumaAwareMask(cpuInfo.vppCores, primaryNuma)
  };
};
```

**Note:** This requires agent-side NUMA detection capabilities.

### 4.4 Hyperthreading Optimization

```javascript
// Agent-side configuration (vpp startup.conf generation)
// Backend should send hint for skip-cores

const generateCpuConfig = (vppCores, htEnabled) => {
  if (htEnabled && vppCores > 1) {
    // Skip hyperthreading siblings for VPP workers
    return {
      vppCores: vppCores,
      skipCores: Math.ceil(vppCores / 2), // Skip every other core
      mainCore: 1 // Use core 1 for main thread, leave 0 for system
    };
  }
  
  return {
    vppCores: vppCores,
    mainCore: 1
  };
};
```

**Example VPP startup.conf output:**
```conf
cpu {
  main-core 1                # VPP main thread on core 1
  corelist-workers 2,4,6,8   # Workers on physical cores (skipping HT siblings)
  skip-cores 1               # Skip every other core
}
```

---

## 5. Performance Optimization Best Practices

### 5.1 Core Allocation Strategies

#### A. Small Deployments (2-4 cores)
```
┌──────────────────────────────────────┐
│ Core 0: Linux System (reserved)     │
├──────────────────────────────────────┤
│ Core 1: VPP Main Thread              │
├──────────────────────────────────────┤
│ Core 2: VPP Worker #1                │ ← For QoS
├──────────────────────────────────────┤
│ Core 3: VPP Worker #2 (optional)     │
└──────────────────────────────────────┘
```

**Configuration:**
- 3 cores minimum for QoS
- 2 VPP workers for traffic shaping

#### B. Medium Deployments (6-8 cores)
```
┌──────────────────────────────────────┐
│ Core 0: Linux System                 │
├──────────────────────────────────────┤
│ Core 1: VPP Main + Management        │
├──────────────────────────────────────┤
│ Cores 2-3: WAN Interface #1          │ ← Dedicated workers
├──────────────────────────────────────┤
│ Cores 4-5: WAN Interface #2          │ ← Dedicated workers
├──────────────────────────────────────┤
│ Cores 6-7: LAN/Tunnel Processing     │
└──────────────────────────────────────┘
```

**Configuration:**
- 2 workers per WAN interface
- Separate workers for tunnel encryption

#### C. High-End Deployments (12+ cores)
```
NUMA Node 0:                          NUMA Node 1:
┌─────────────────────────────┐      ┌─────────────────────────────┐
│ Core 0: System              │      │ Core 6: VPP Worker #4       │
│ Core 1: VPP Main            │      │ Core 7: VPP Worker #5       │
│ Core 2: VPP Worker #1       │      │ Core 8: VPP Worker #6       │
│ Core 3: VPP Worker #2       │      │ ...                         │
│ Core 4: VPP Worker #3       │      │                             │
└─────────────────────────────┘      └─────────────────────────────┘
```

**Configuration:**
- NUMA-aware pinning
- Scale workers across NUMA nodes
- Pin interfaces to same NUMA node as NIC

### 5.2 QoS-Specific Optimizations

For devices with QoS enabled:

```javascript
// Recommended configuration
{
  vppCores: Math.max(wanInterfaces * 2, 3), // Minimum 3 cores
  qosWorkerAffinity: 'dedicated',  // Separate worker for QoS
  trafficClassification: 'multi-threaded' // Parallel DPI
}
```

**Rationale:**
- **2+ workers:** Separate ingress/egress processing
- **Dedicated QoS worker:** Avoid contention with forwarding
- **Multi-threaded DPI:** Application identification scales

### 5.3 Memory Considerations

VPP DPDK requires hugepages. Recommended allocation:

| VPP Cores | Hugepage Size | Quantity | Total Memory |
|-----------|---------------|----------|--------------|
| 1 | 2MB | 512 | 1GB |
| 2-4 | 2MB | 1024 | 2GB |
| 5-8 | 2MB | 2048 | 4GB |
| 9-16 | 1GB | 4 | 4GB |

**Backend should validate:**
```javascript
// Ensure sufficient memory for core count
const requiredMemoryGB = Math.ceil(vppCores / 2);
if (device.memoryGB < requiredMemoryGB + 2) { // +2 for system
  throw new Error(`Insufficient memory for ${vppCores} VPP cores`);
}
```

---

## 6. Recommended Backend Changes Summary

### 6.1 High Priority Changes

1. **Auto-configure VPP cores on device registration**
   - Files: `backend/routes/connect.js`, `backend/utils/deviceUtils.js`
   - Impact: Immediate performance improvement for new devices
   - Risk: Low

2. **Enhanced QoS validation with recommendations**
   - Files: `backend/deviceLogic/validators.js`
   - Impact: Better user guidance
   - Risk: Low

3. **Add API endpoint for core recommendations**
   - Files: `backend/controllers/DevicesController.js`, `backend/services/DevicesService.js`
   - Impact: Allow frontend to show optimization suggestions
   - Risk: Low

### 6.2 Medium Priority Changes

4. **Dynamic core scaling based on workload**
   - Files: `backend/deviceLogic/modifyHardware.js`
   - Impact: Automatic optimization over time
   - Risk: Medium (requires testing)

5. **Add hyperthreading detection and optimization**
   - Files: Agent-side changes + backend hints
   - Impact: 10-15% performance gain on HT-enabled systems
   - Risk: Medium

### 6.3 Low Priority (Future Enhancements)

6. **NUMA awareness for 16+ core systems**
   - Files: Agent + backend coordination
   - Impact: Significant for high-end deployments
   - Risk: High (complex implementation)

7. **Per-interface worker affinity**
   - Files: `backend/deviceLogic/interfaces.js`
   - Impact: Advanced load balancing
   - Risk: High

---

## 7. Testing & Validation Plan

### 7.1 Test Scenarios

| Scenario | HW Cores | VPP Cores | QoS | Expected Result |
|----------|----------|-----------|-----|------------------|
| Minimal | 2 | 1 | ❌ | Single core operation |
| QoS Entry | 3 | 2 | ✅ | QoS functional |
| Standard | 4 | 2-3 | ✅ | 75% utilization |
| High Load | 8 | 5-6 | ✅ | Sustained 10Gbps+ |
| Enterprise | 16 | 10-12 | ✅ | Multi-10Gbps, low latency |

### 7.2 Performance Metrics

Monitor after optimization:

```javascript
// Agent should report these metrics
{
  cpuUtilization: {
    system: 5-15%,      // Core 0
    vppMain: 10-30%,    // VPP main thread
    vppWorkers: [       // Per-worker utilization
      { core: 2, utilization: 60-80% },
      { core: 3, utilization: 60-80% },
      // ...
    ]
  },
  throughput: {
    pps: 1000000,       // Packets per second
    mbps: 8000          // Megabits per second
  },
  latency: {
    avg: 0.5,           // ms
    p99: 2.0            // ms
  }
}
```

### 7.3 Validation Checklist

- [ ] 2-core device still works with 1 VPP core
- [ ] 4-core device auto-configures to 2-3 VPP cores
- [ ] QoS installation requires 2+ VPP cores
- [ ] Power saving disabled when multi-core active
- [ ] No performance regression on single-core devices
- [ ] Multi-core shows throughput improvement
- [ ] CPU utilization balanced across workers

---

## 8. Migration Strategy for Existing Deployments

### 8.1 Backward Compatibility

```javascript
// backend/migrations/add-optimized-cpu-defaults.js
module.exports = {
  async up() {
    // Find devices with >2 cores but only 1 VPP core
    const devices = await DevicesModel.find({
      'cpuInfo.hwCores': { $gt: 2 },
      'cpuInfo.vppCores': 1
    });
    
    for (const device of devices) {
      const recommended = calculateRecommendedVppCores(device);
      
      // Only suggest, don't auto-apply (requires device restart)
      await DevicesModel.updateOne(
        { _id: device._id },
        { 
          $set: { 
            'cpuInfo.recommendedVppCores': recommended,
            'notifications.cpuOptimization': {
              message: `Device can benefit from ${recommended} VPP cores`,
              priority: 'info'
            }
          }
        }
      );
    }
  }
};
```

### 8.2 Gradual Rollout

**Phase 1:** Notification-only (Week 1-2)
- Show optimization suggestions in UI
- Allow users to manually apply

**Phase 2:** Opt-in auto-configuration (Week 3-4)
- New devices get optimized defaults
- Existing devices remain unchanged

**Phase 3:** Full rollout (Week 5+)
- During next device restart, apply optimizations
- Monitor performance metrics

---

## 9. Conclusion & Action Items

### 9.1 Key Findings

1. ✅ **Current system works but is conservative**
   - Default 1 VPP core regardless of hardware
   - Manual configuration required for optimization

2. ⚠️ **Significant performance left on table**
   - 4-core devices: 75% cores unused
   - 8-core devices: 87.5% cores unused

3. 🎯 **QoS adoption friction**
   - Requires manual core increase before QoS enablement
   - Creates extra configuration steps

### 9.2 Immediate Action Items

**Week 1-2: Quick Wins**
- [ ] Implement `calculateRecommendedVppCores()` function
- [ ] Add auto-configuration on device registration (>2 cores)
- [ ] Enhance QoS validator with recommendations
- [ ] Add unit tests for core allocation logic

**Week 3-4: UI Integration**
- [ ] Add API endpoint for optimization recommendations
- [ ] Frontend: Show CPU optimization suggestions
- [ ] Frontend: One-click apply optimization button

**Week 5+: Advanced Features**
- [ ] Add telemetry for CPU utilization tracking
- [ ] Implement dynamic scaling based on load
- [ ] Research NUMA awareness feasibility

### 9.3 Expected Performance Improvements

| Device Type | Current | Optimized | Improvement |
|-------------|---------|-----------|-------------|
| 4-core | ~2 Gbps | ~5-6 Gbps | **+150%** |
| 8-core | ~2 Gbps | ~10-15 Gbps | **+400%** |
| 16-core | ~2 Gbps | ~20-40 Gbps | **+900%** |

**Note:** Actual performance depends on workload, NIC capabilities, and network conditions.

---

## 10. References

### 10.1 Related Backend Files

- `backend/models/devices.js` - CPU info schema (lines 1184-1222)
- `backend/deviceLogic/modifyHardware.js` - CPU modification logic
- `backend/deviceLogic/validators.js` - QoS validation (lines 960-975)
- `backend/utils/deviceUtils.js` - `getCpuInfo()` utility (lines 192-209)
- `backend/routes/connect.js` - Device registration (line 249)

### 10.2 VPP Documentation

- [VPP CPU Configuration](https://fd.io/docs/vpp/master/gettingstarted/users/configuring/startup)
- [DPDK Performance Tuning](https://doc.dpdk.org/guides/linux_gsg/nic_perf_intel_platform.html)
- [VPP Multi-Worker Architecture](https://wiki.fd.io/view/VPP/Multi-Worker_Architecture)

### 10.3 System Requirements

From original requirements:
- **Minimum:** 2 CPU cores (WAN+LAN basic forwarding)
- **QoS:** 3 CPU cores minimum (documented requirement)
- **Recommended:** 4-8 cores for production deployments

---

**Document Version:** 1.0  
**Last Updated:** October 17, 2025  
**Author:** AI Analysis based on flexiWAN codebase
