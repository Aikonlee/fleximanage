# Home Page Statistics - Backend Field Mapping

**Date:** October 16, 2025  
**URL:** https://manage.miwide.com:3443/home  
**API Endpoint:** `GET /api/organizations/summary`  
**Backend File:** `/root/fleximanage/backend/routes/organizations.js` (Lines 297-426)

---

## Overview

The Home page displays network statistics in three main sections:
1. **Devices Status Table** - Device operational statistics
2. **Tunnels Status Table** - Tunnel connection statistics
3. **Traffic Statistics** - Monthly traffic data

All data is fetched from a single API endpoint: `/api/organizations/summary`

---

## API Response Structure

```json
{
  "devices": {
    "total": 10,
    "running": 8,
    "connected": 9,
    "approved": 10
  },
  "tunnels": {
    "total": 25,
    "active": 20
  },
  "traffic": {
    "total": 1234.56,
    "unit": "GBytes",
    "totalBytes": 1325899906842,
    "lastUpdate": "2025-10-16T10:20:30.000Z"
  }
}
```

---

## 1. Devices Status Table

### Frontend Display (Home.js Lines 93-103)

| Column Header | Frontend State | Display Value |
|--------------|----------------|---------------|
| **Running** | `deviceStats.running` | Count of running devices |
| **Not Running/NA** | `deviceStats.notRunning` | Calculated: `total - running` |
| **Connected** | `deviceStats.connected` | Count of connected devices |
| **Not Connected** | `deviceStats.notConnected` | Calculated: `total - connected` |
| **Not Approved** | `deviceStats.notApproved` | Calculated: `total - approved` |
| **Warning** | `deviceStats.warning` | Currently: `0` (placeholder) |

### Backend Data Source (organizations.js Lines 311-326)

#### 1.1 Running Devices
**Frontend Field:** `data.devices.running`  
**Backend Query (Line 314-317):**
```javascript
const runningDevices = await devices.countDocuments({
  org: orgId,
  'deviceStatus.state': 'running'
});
```

**Database:**
- Collection: `devices`
- Field: `deviceStatus.state`
- Condition: `deviceStatus.state === 'running'`
- Returns: Count of devices where vRouter is running

**Related Models:**
- `/root/fleximanage/backend/models/devices.js` - Device schema
- Field: `status` (Line 354-358): `enum: ['', 'running', 'stopped', 'failed']`
- Runtime field: `deviceStatus.state` (set dynamically by deviceStatus service)

---

#### 1.2 Connected Devices
**Frontend Field:** `data.devices.connected`  
**Backend Query (Line 318-321):**
```javascript
const connectedDevices = await devices.countDocuments({
  org: orgId,
  isConnected: true
});
```

**Database:**
- Collection: `devices`
- Field: `isConnected`
- Type: Boolean
- Returns: Count of devices currently connected to management

**Related Models:**
- `/root/fleximanage/backend/models/devices.js`
- Field: `isConnected` (Line 360-363)
- Updated by: `/root/fleximanage/backend/periodic/deviceStatus.js`

---

#### 1.3 Approved Devices
**Frontend Field:** `data.devices.approved`  
**Backend Query (Line 322-325):**
```javascript
const approvedDevices = await devices.countDocuments({
  org: orgId,
  isApproved: true
});
```

**Database:**
- Collection: `devices`
- Field: `isApproved`
- Type: Boolean
- Returns: Count of approved devices

**Related Models:**
- `/root/fleximanage/backend/models/devices.js`
- Field: `isApproved` (Line 1032-1035)
- Default: `false`
- Set by: Admin approval action

---

#### 1.4 Total Devices
**Frontend Field:** `data.devices.total`  
**Backend Query (Line 312):**
```javascript
const totalDevices = await devices.countDocuments({ org: orgId });
```

**Database:**
- Collection: `devices`
- Returns: Total count of all devices in the organization

---

#### 1.5 Calculated Fields (Frontend)

**Not Running/NA** (Home.js Line 44):
```javascript
notRunning: Math.max(0, (data.devices?.total || 0) - (data.devices?.running || 0))
```
- **Calculation:** `total - running`
- **Includes:** Stopped, failed, pending, and offline devices

**Not Connected** (Home.js Line 46):
```javascript
notConnected: Math.max(0, (data.devices?.total || 0) - (data.devices?.connected || 0))
```
- **Calculation:** `total - connected`
- **Includes:** All offline/disconnected devices

**Not Approved** (Home.js Line 47):
```javascript
notApproved: Math.max(0, (data.devices?.total || 0) - (data.devices?.approved || 0))
```
- **Calculation:** `total - approved`
- **Includes:** All pending approval devices

**Warning** (Home.js Line 48):
```javascript
warning: 0  // Placeholder - not currently implemented
```
- **Status:** Not implemented
- **Potential Use:** Could show devices with issues/warnings in the future

---

## 2. Tunnels Status Table

### Frontend Display (Home.js Lines 119-130)

| Column Header | Frontend State | Display Value |
|--------------|----------------|---------------|
| **Connected** | `tunnelStats.connected` | Count of active tunnels |
| **Not Connected** | `tunnelStats.notConnected` | Calculated: `total - active` |
| **Pending** | `tunnelStats.pending` | Currently: `0` (placeholder) |
| **Unknown** | `tunnelStats.unknown` | Currently: `0` (placeholder) |

### Backend Data Source (organizations.js Lines 328-334)

#### 2.1 Active Tunnels
**Frontend Field:** `data.tunnels.active`  
**Backend Query (Line 331-334):**
```javascript
const activeTunnels = await tunnels.countDocuments({
  org: orgId,
  isActive: true
});
```

**Database:**
- Collection: `tunnels`
- Field: `isActive`
- Type: Boolean
- Returns: Count of active/connected tunnels

**Related Models:**
- `/root/fleximanage/backend/models/tunnels.js`
- Field: `isActive` - Tunnel operational status

---

#### 2.2 Total Tunnels
**Frontend Field:** `data.tunnels.total`  
**Backend Query (Line 328):**
```javascript
const totalTunnels = await tunnels.countDocuments({ org: orgId });
```

**Database:**
- Collection: `tunnels`
- Returns: Total count of all tunnels in the organization

---

#### 2.3 Calculated Fields (Frontend)

**Not Connected** (Home.js Line 53):
```javascript
notConnected: Math.max(0, (data.tunnels?.total || 0) - (data.tunnels?.active || 0))
```
- **Calculation:** `total - active`
- **Includes:** Inactive/disconnected tunnels

**Pending** (Home.js Line 54):
```javascript
pending: 0  // Placeholder - not currently implemented
```
- **Status:** Not implemented
- **Potential Use:** Tunnels being established

**Unknown** (Home.js Line 55):
```javascript
unknown: 0  // Placeholder - not currently implemented
```
- **Status:** Not implemented
- **Potential Use:** Tunnels with unknown status

---

## 3. Traffic Statistics

### Frontend Display (Home.js Lines 155-160)

| Display | Frontend State | Display Format |
|---------|----------------|----------------|
| **Total Traffic** | `trafficStats.total` | `{total} {unit}` |
| **Unit** | `trafficStats.unit` | MBytes, GBytes, etc. |
| **Last Update** | `trafficStats.lastUpdate` | ISO timestamp |

### Backend Data Source (organizations.js Lines 336-398)

#### 3.1 Traffic Calculation Process

**Step 1: Get Device List** (Line 337-338)
```javascript
const deviceList = await devices.find({ org: orgId }).select('_id machineId').lean();
const deviceIds = deviceList.map(d => d._id);
```

**Step 2: Aggregate Interface Statistics** (Line 343-366)
```javascript
const latestStats = await deviceStats.aggregate([
  {
    $match: {
      org: orgId,
      device: { $in: deviceIds }
    }
  },
  {
    $sort: { time: -1, createdAt: -1 }
  },
  {
    $group: {
      _id: '$device',
      latestStats: { $first: '$stats' }
    }
  }
]);
```

**Database:**
- Collection: `deviceStats`
- Fields used:
  - `org` - Organization ID
  - `device` - Device reference
  - `time` - Stat collection time
  - `stats` - Interface statistics object
  - `stats.<interface>.rx_bytes` - Received bytes per interface
  - `stats.<interface>.tx_bytes` - Transmitted bytes per interface

**Step 3: Sum Traffic Bytes** (Line 368-375)
```javascript
latestStats.forEach(deviceStat => {
  if (deviceStat.latestStats) {
    Object.values(deviceStat.latestStats).forEach(interfaceStats => {
      if (interfaceStats.rx_bytes) totalBytes += interfaceStats.rx_bytes;
      if (interfaceStats.tx_bytes) totalBytes += interfaceStats.tx_bytes;
    });
  }
});
```

**Calculation:**
- For each device, get latest stats
- For each interface on each device:
  - Add `rx_bytes` (received)
  - Add `tx_bytes` (transmitted)
- Sum all bytes across all devices and interfaces

**Step 4: Convert to Human-Readable Units** (Line 383-396)
```javascript
let total, unit;
if (totalBytes >= 1024 * 1024 * 1024) { // GB
  total = (totalBytes / (1024 * 1024 * 1024)).toFixed(2);
  unit = 'GBytes';
} else if (totalBytes >= 1024 * 1024) { // MB
  total = (totalBytes / (1024 * 1024)).toFixed(2);
  unit = 'MBytes';
} else if (totalBytes >= 1024) { // KB
  total = (totalBytes / 1024).toFixed(2);
  unit = 'KBytes';
} else {
  total = totalBytes;
  unit = 'Bytes';
}
```

**Unit Conversion:**
- ≥ 1 GB: Display in GBytes (1024³ bytes)
- ≥ 1 MB: Display in MBytes (1024² bytes)
- ≥ 1 KB: Display in KBytes (1024 bytes)
- < 1 KB: Display in Bytes

#### 3.2 Traffic Response Fields

**Frontend Fields:** (Home.js Line 66-71)
```javascript
setTrafficStats({
  total: data.traffic.total || 0,
  unit: data.traffic.unit || 'MBytes',
  totalBytes: data.traffic.totalBytes || 0,
  lastUpdate: data.traffic.lastUpdate
});
```

**Backend Response:** (organizations.js Line 398-414)
```javascript
traffic: {
  total: parseFloat(total),      // Formatted value (e.g., 1234.56)
  unit: unit,                     // Unit string (Bytes, KBytes, MBytes, GBytes)
  totalBytes: totalBytes,         // Raw byte count
  lastUpdate: new Date()          // Current timestamp
}
```

**Database Collections Used:**
- `deviceStats` - Stores periodic device interface statistics
- Related model: Check `/root/fleximanage/backend/models/` for deviceStats schema

---

## Data Flow Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                    Frontend: Home.js                             │
│  useEffect() → fetchDashboardData()                             │
│  ↓                                                               │
│  api.get('/organizations/summary')                              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│         Backend: /backend/routes/organizations.js               │
│  GET /api/organizations/summary                                 │
│  ↓                                                               │
│  1. Query devices collection                                    │
│     - Total devices: countDocuments({ org })                    │
│     - Running: countDocuments({ deviceStatus.state: 'running' })│
│     - Connected: countDocuments({ isConnected: true })          │
│     - Approved: countDocuments({ isApproved: true })            │
│  ↓                                                               │
│  2. Query tunnels collection                                    │
│     - Total tunnels: countDocuments({ org })                    │
│     - Active: countDocuments({ isActive: true })                │
│  ↓                                                               │
│  3. Aggregate deviceStats collection                            │
│     - Get latest stats for each device                          │
│     - Sum rx_bytes + tx_bytes from all interfaces               │
│     - Convert to human-readable units                           │
│  ↓                                                               │
│  Return JSON response                                           │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│         Frontend: Home.js - Update State                        │
│  setDeviceStats({ running, notRunning, connected, ... })       │
│  setTunnelStats({ connected, notConnected, ... })               │
│  setTrafficStats({ total, unit, totalBytes, ... })             │
│  ↓                                                               │
│  Render Network Status Tables                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Database Collections and Fields

### devices Collection
```javascript
{
  org: ObjectId,                    // Organization reference
  isConnected: Boolean,             // Connection status
  isApproved: Boolean,              // Approval status
  status: String,                   // ['', 'running', 'stopped', 'failed']
  deviceStatus: {                   // Runtime status (set by deviceStatus service)
    state: String                   // Current operational state
  },
  // ... other fields
}
```

### tunnels Collection
```javascript
{
  org: ObjectId,                    // Organization reference
  isActive: Boolean,                // Tunnel active/connected status
  // ... other fields
}
```

### deviceStats Collection
```javascript
{
  org: ObjectId,                    // Organization reference
  device: ObjectId,                 // Device reference
  time: Date,                       // Stat collection time
  createdAt: Date,                  // Record creation time
  stats: {                          // Interface statistics
    '<interface_name>': {
      rx_bytes: Number,             // Bytes received
      tx_bytes: Number,             // Bytes transmitted
      // ... other metrics
    }
  }
}
```

---

## Frontend Calculated Fields

### Device Calculations (Home.js Lines 43-48)
```javascript
running: data.devices?.running || 0,                              // From backend
notRunning: total - running,                                      // Calculated
connected: data.devices?.connected || 0,                          // From backend
notConnected: total - connected,                                  // Calculated
notApproved: total - approved,                                    // Calculated
warning: 0                                                        // Placeholder
```

### Tunnel Calculations (Home.js Lines 52-56)
```javascript
connected: data.tunnels?.active || 0,                            // From backend
notConnected: total - active,                                    // Calculated
pending: 0,                                                      // Placeholder
unknown: 0                                                       // Placeholder
```

---

## API Error Handling

**No Organization** (organizations.js Line 303-309):
```javascript
if (!orgId) {
  return res.status(200).json({
    devices: { total: 0, running: 0, connected: 0, approved: 0 },
    tunnels: { total: 0, active: 0 },
    traffic: { total: 0, unit: 'MBytes', totalBytes: 0, lastUpdate: null }
  });
}
```

**Traffic Query Error** (organizations.js Line 377-382):
```javascript
catch (err) {
  logger.error('Error querying device stats', {
    params: { orgId, error: err.message, stack: err.stack }
  });
}
// continues with totalBytes = 0
```

**General Error** (organizations.js Line 422-426):
```javascript
catch (err) {
  logger.error('Error getting organization summary', {
    params: { reason: err.message, stack: err.stack }
  });
  return next(createError(500, 'Error getting organization summary'));
}
```

---

## Enhancement Opportunities

### 1. Warning Field Implementation
Currently set to `0`, could be enhanced to show:
- Devices with high CPU/memory usage
- Devices with interface errors
- Devices requiring updates
- Devices with configuration sync issues

### 2. Tunnel Pending/Unknown States
Currently placeholders, could track:
- **Pending**: Tunnels being established
- **Unknown**: Tunnels with indeterminate status

### 3. Traffic Time Period
Currently shows cumulative traffic, could be enhanced to:
- Show traffic for specific time periods (day/week/month)
- Add date range filters
- Show traffic trends/charts

### 4. Real-time Updates
Consider adding:
- WebSocket connection for real-time stats
- Auto-refresh interval
- Live traffic monitoring

---

## Testing Checklist

To verify the statistics are working correctly:

1. **Devices Count**
   - ✅ Total devices = sum of all devices in org
   - ✅ Running = devices with `deviceStatus.state === 'running'`
   - ✅ Connected = devices with `isConnected === true`
   - ✅ Approved = devices with `isApproved === true`
   - ✅ Not Running = Total - Running
   - ✅ Not Connected = Total - Connected
   - ✅ Not Approved = Total - Approved

2. **Tunnels Count**
   - ✅ Total tunnels = sum of all tunnels in org
   - ✅ Active = tunnels with `isActive === true`
   - ✅ Not Connected = Total - Active

3. **Traffic Stats**
   - ✅ Aggregates all device interface rx_bytes + tx_bytes
   - ✅ Shows appropriate unit (Bytes, KBytes, MBytes, GBytes)
   - ✅ Displays with 2 decimal places for KB/MB/GB
   - ✅ Handles empty/no stats gracefully

---

## Related Files

### Frontend:
- `/root/fleximanage/frontend/src/pages/Home.js` - Main home page component
- `/root/fleximanage/frontend/src/services/api.js` - API client
- `/root/fleximanage/frontend/src/pages/Home.css` - Styling

### Backend:
- `/root/fleximanage/backend/routes/organizations.js` - API routes
- `/root/fleximanage/backend/models/devices.js` - Device schema
- `/root/fleximanage/backend/models/tunnels.js` - Tunnel schema
- `/root/fleximanage/backend/periodic/deviceStatus.js` - Device status tracking

---

**Status:** 📋 **ANALYSIS COMPLETE**

This document provides a comprehensive mapping of all Home page statistics to their corresponding backend fields and data sources.
