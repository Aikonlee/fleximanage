# Home Page Statistics - Quick Reference

**URL:** https://manage.miwide.com:3443/home  
**API:** `GET /api/organizations/summary`  
**Backend:** `/root/fleximanage/backend/routes/organizations.js` (Lines 297-426)

---

## Quick Field Mapping Table

### Devices Status

| Frontend Display | Frontend State | Backend Field | Database Query |
|-----------------|----------------|---------------|----------------|
| Running | `deviceStats.running` | `data.devices.running` | `devices.countDocuments({ org, 'deviceStatus.state': 'running' })` |
| Not Running/NA | `deviceStats.notRunning` | *(calculated)* | `total - running` |
| Connected | `deviceStats.connected` | `data.devices.connected` | `devices.countDocuments({ org, isConnected: true })` |
| Not Connected | `deviceStats.notConnected` | *(calculated)* | `total - connected` |
| Not Approved | `deviceStats.notApproved` | *(calculated)* | `total - approved` |
| Warning | `deviceStats.warning` | *(placeholder)* | `0` (not implemented) |

### Tunnels Status

| Frontend Display | Frontend State | Backend Field | Database Query |
|-----------------|----------------|---------------|----------------|
| Connected | `tunnelStats.connected` | `data.tunnels.active` | `tunnels.countDocuments({ org, isActive: true })` |
| Not Connected | `tunnelStats.notConnected` | *(calculated)* | `total - active` |
| Pending | `tunnelStats.pending` | *(placeholder)* | `0` (not implemented) |
| Unknown | `tunnelStats.unknown` | *(placeholder)* | `0` (not implemented) |

### Traffic Statistics

| Frontend Display | Frontend State | Backend Field | Data Source |
|-----------------|----------------|---------------|-------------|
| Total Traffic | `trafficStats.total` | `data.traffic.total` | Aggregated from `deviceStats` collection |
| Unit | `trafficStats.unit` | `data.traffic.unit` | Bytes/KBytes/MBytes/GBytes |
| Raw Bytes | `trafficStats.totalBytes` | `data.traffic.totalBytes` | Sum of all `rx_bytes` + `tx_bytes` |
| Last Update | `trafficStats.lastUpdate` | `data.traffic.lastUpdate` | Current timestamp |

---

## Backend Response Structure

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

## Database Collections

### 1. `devices` Collection
**Queried Fields:**
- `org` - Organization ID
- `deviceStatus.state` - vRouter running state (`'running'`, `'stopped'`, `'failed'`, `''`)
- `isConnected` - Boolean, device connected to management
- `isApproved` - Boolean, device approved by admin

### 2. `tunnels` Collection
**Queried Fields:**
- `org` - Organization ID
- `isActive` - Boolean, tunnel is active/connected

### 3. `deviceStats` Collection
**Queried Fields:**
- `org` - Organization ID
- `device` - Device reference
- `time` - Statistics timestamp
- `stats.<interface>.rx_bytes` - Bytes received per interface
- `stats.<interface>.tx_bytes` - Bytes transmitted per interface

---

## Traffic Calculation Formula

```javascript
// For each device in organization:
//   For each interface on device:
//     totalBytes += rx_bytes + tx_bytes

// Example:
Device 1:
  - eth0: rx_bytes: 1000000000, tx_bytes: 500000000
  - eth1: rx_bytes: 2000000000, tx_bytes: 1000000000
  
Device 2:
  - eth0: rx_bytes: 500000000, tx_bytes: 300000000

Total = (1000000000 + 500000000) + (2000000000 + 1000000000) + (500000000 + 300000000)
      = 5,300,000,000 bytes
      = 5.30 GBytes (displayed as "5.30 GBytes")
```

---

## Frontend Calculations

**Home.js** (Lines 43-56):

```javascript
// Devices
notRunning = total - running
notConnected = total - connected
notApproved = total - approved
warning = 0  // placeholder

// Tunnels
notConnected = total - active
pending = 0  // placeholder
unknown = 0  // placeholder
```

---

## Key Backend Code Locations

### Devices Statistics (Lines 312-326)
```javascript
const totalDevices = await devices.countDocuments({ org: orgId });
const runningDevices = await devices.countDocuments({ org: orgId, 'deviceStatus.state': 'running' });
const connectedDevices = await devices.countDocuments({ org: orgId, isConnected: true });
const approvedDevices = await devices.countDocuments({ org: orgId, isApproved: true });
```

### Tunnels Statistics (Lines 328-334)
```javascript
const totalTunnels = await tunnels.countDocuments({ org: orgId });
const activeTunnels = await tunnels.countDocuments({ org: orgId, isActive: true });
```

### Traffic Statistics (Lines 336-398)
```javascript
// 1. Get all devices in org
const deviceList = await devices.find({ org: orgId }).select('_id machineId').lean();

// 2. Aggregate latest stats for each device
const latestStats = await deviceStats.aggregate([...]);

// 3. Sum all rx_bytes + tx_bytes
latestStats.forEach(deviceStat => {
  Object.values(deviceStat.latestStats).forEach(interfaceStats => {
    totalBytes += interfaceStats.rx_bytes + interfaceStats.tx_bytes;
  });
});

// 4. Convert to appropriate unit (Bytes → KB → MB → GB)
```

---

## Status Indicators Reference

### Device States (`deviceStatus.state`)
- `'running'` - vRouter is running (counted in "Running")
- `'stopped'` - vRouter is stopped (counted in "Not Running")
- `'failed'` - vRouter failed (counted in "Not Running")
- `'pending'` - Operation in progress (counted in "Not Running")
- `''` (empty) - Not started (counted in "Not Running")

### Connection States (`isConnected`)
- `true` - Device is online (counted in "Connected")
- `false` - Device is offline (counted in "Not Connected")

### Approval States (`isApproved`)
- `true` - Device is approved (counted in approved devices)
- `false` - Device is pending approval (counted in "Not Approved")

### Tunnel States (`isActive`)
- `true` - Tunnel is active (counted in "Connected")
- `false` - Tunnel is inactive (counted in "Not Connected")

---

## Data Flow Diagram

```
Frontend (Home.js)
    │
    ├─ useEffect() triggers fetchDashboardData()
    │
    └─ api.get('/organizations/summary')
            │
            ▼
Backend (organizations.js)
    │
    ├─ Query devices collection
    │   ├─ Total: all devices
    │   ├─ Running: deviceStatus.state === 'running'
    │   ├─ Connected: isConnected === true
    │   └─ Approved: isApproved === true
    │
    ├─ Query tunnels collection
    │   ├─ Total: all tunnels
    │   └─ Active: isActive === true
    │
    ├─ Aggregate deviceStats collection
    │   ├─ Get latest stats per device
    │   ├─ Sum rx_bytes + tx_bytes
    │   └─ Convert to human-readable unit
    │
    └─ Return JSON response
            │
            ▼
Frontend (Home.js)
    │
    ├─ setDeviceStats()
    ├─ setTunnelStats()
    ├─ setTrafficStats()
    │
    └─ Render tables with statistics
```

---

## File References

**Frontend:**
- `/root/fleximanage/frontend/src/pages/Home.js` - Home page component

**Backend:**
- `/root/fleximanage/backend/routes/organizations.js` - API endpoint (Lines 297-426)
- `/root/fleximanage/backend/models/devices.js` - Device schema
- `/root/fleximanage/backend/models/tunnels.js` - Tunnel schema

**Documentation:**
- `/root/fleximanage/docs/HOME_PAGE_STATISTICS_MAPPING.md` - Complete detailed mapping

---

**Status:** ✅ **COMPLETE**

All Home page statistics are now fully documented with their backend field mappings!
