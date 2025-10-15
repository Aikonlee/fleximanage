# Tunnels Page User Guide

## Overview
The Tunnels page provides comprehensive management and monitoring of network tunnels in your FlexiWAN SD-WAN deployment.

## Accessing the Tunnels Page

Navigate to: **Inventory → Tunnels**

URL: `https://manage.miwide.com:3443/tunnels`

## Page Features

### 1. Statistics Dashboard
At the top of the page, three cards display real-time statistics:
- **Total Tunnels**: Total number of tunnels in the system
- **Connected**: Number of active/connected tunnels
- **Inactive**: Number of inactive/disconnected tunnels

### 2. Tunnels Table
The main table displays all tunnels with the following columns:

| Column | Description |
|--------|-------------|
| **ID** | Tunnel ID number (e.g., #1, #2, #3) |
| **Device A** | Name of the first device in the tunnel |
| **Interface A** | Network interface on Device A |
| **Device B / Peer** | Name of the second device or peer information |
| **Interface B** | Network interface on Device B |
| **Path Label** | Traffic path label (if configured) |
| **AVG Latency** | Average latency in milliseconds |
| **Drop Rate** | Packet drop rate percentage |
| **Encrypt** | Encryption method (PSK, None, etc.) |
| **Status** | Connection status (Connected/Inactive) |
| **Actions** | Delete tunnel button |

## Data Sources

The page fetches real-time data from:
- `GET /api/tunnels` - Tunnel information
- `GET /api/devices?response=detailed` - Device and interface details

## Features

### Auto-Refresh
- The page automatically refreshes every **30 seconds**
- Manual refresh available via the **Refresh** button

### Delete Tunnels
- Click the trash icon in the Actions column
- Confirmation dialog will appear
- Deletion calls: `DELETE /api/tunnels/{tunnelId}`

### Status Indicators
- **Connected** (Green): Tunnel is active and operational
- **Inactive** (Gray): Tunnel is not currently active

### Encryption Badges
- **PSK** (Blue): Pre-shared key encryption
- **None** (Yellow): No encryption configured

## Current Tunnels (Example Data)

Based on the database, you currently have **3 active tunnels**:

1. **Tunnel #1**: Device `68ebd5aa` ↔ Device `68ecc966`
   - Status: Connected (up)
   - Encryption: PSK
   - OSPF Cost: 100

2. **Tunnel #2**: Device `68ebd5aa` ↔ Device `68edb6a5`
   - Status: Connected (up)
   - Encryption: PSK
   - OSPF Cost: 100

3. **Tunnel #3**: Device `68ecc966` ↔ Device `68edb6a5`
   - Status: Connected (up)
   - Encryption: PSK
   - OSPF Cost: 100

## Technical Implementation

### Frontend Components
- **File**: `/root/fleximanage/frontend/src/pages/Tunnels.js`
- **Framework**: React with Bootstrap
- **Icons**: react-icons (FaRoute, FaTrash, FaSync)
- **API Client**: axios via `api.js`

### Backend API Endpoints
- **GET /tunnels**: Retrieve tunnel list (populated with device details)
- **DELETE /tunnels/:tunnelId**: Soft delete tunnel (sets `isActive: false`)

### Data Flow
```
Frontend (Tunnels.js)
    ↓
    ├─→ GET /api/devices?response=detailed
    │   └─→ Build device map for name resolution
    │
    └─→ GET /api/tunnels
        └─→ Populate tunnel table
```

### Key Functions
- `fetchTunnelsAndDevices()`: Fetches data from backend
- `getDeviceName(deviceId)`: Resolves device ID to name
- `getInterfaceName(deviceId, interfaceId)`: Resolves interface ID to name
- `handleDeleteTunnel(tunnelId)`: Deletes tunnel

## Troubleshooting

### No Tunnels Displayed
1. Check if tunnels exist in database:
   ```bash
   mongosh flexiwan --eval "db.tunnels.find({isActive: true}).pretty()"
   ```

2. Verify API access:
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" \
     https://manage.miwide.com:3443/api/tunnels
   ```

3. Check browser console for errors

### Stats Not Showing
- Stats fields (`latency`, `dropRate`) may be null if:
  - Tunnel just created (no statistics collected yet)
  - Devices not sending telemetry data
  - Monitoring not configured

### Device Names Not Resolving
- Ensure devices have names set in device configuration
- Fallback shows device ID (first 8 characters)

## Next Steps

### Create New Tunnels
Navigate to **Inventory → Devices** and use the **Create Tunnels** button to establish new tunnels.

### Monitor Performance
- Check AVG Latency for network performance
- Monitor Drop Rate for connection quality
- Use this data to optimize network topology

## Version Information
- **Build**: main.e2476fa8.js
- **Date**: October 14, 2025
- **Backend**: FlexiWAN 6.x (official API)
- **Frontend**: React 18 + Bootstrap 5
