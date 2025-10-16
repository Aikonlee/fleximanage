# FlexiManage Frontend

React Web UI for the flexiWAN (flexiManage) backend – an open source SD‑WAN management platform.  
This project provides a comprehensive, production-ready administration console targeting the APIs exposed by the flexiManage backend.

> The project includes both responsive UI components and real-time dashboard functionality with live traffic statistics and device monitoring.

---

## 📊 Development Progress Summary

**Last Updated**: October 15, 2025  
**Version**: 6.3.37  
**Status**: ✅ Production Ready

### Recent Milestones

- ✅ **October 15, 2025**: Complete MongoDB and Tunnels documentation committed (3,420+ lines)
- ✅ **October 14, 2025**: MongoDB systemd auto-start configuration with standardized paths
- ✅ **October 14, 2025**: Tunnels page implementation with full CRUD operations
- ✅ **October 13, 2025**: FlexiManage systemd service integration with PM2
- ✅ **October 12, 2025**: Frontend README update with deployment guide

### System Architecture Status

| Component | Status | Version | Auto-Start | Details |
|-----------|--------|---------|------------|---------|
| **Frontend** | ✅ Running | Build: latest | Via Backend | Served as static files |
| **Backend** | ✅ Running | 6.3.37 | systemd + PM2 | Port 3443 (HTTPS) |
| **MongoDB** | ✅ Running | 8.0.15 ARM64 | systemd (3 nodes) | Ports 27017-27019 |
| **Redis** | ✅ Running | 5.0.5+ | systemd | Port 6379 |
| **Email** | ✅ Running | aiosmtpd | systemd | Port 1025 |

---

## 🚀 Current Implementation Status

### ✅ **Fully Implemented Features**

- **🏠 Dashboard**: 
  - Real-time device statistics (running, connected, approved status)
  - Live traffic monitoring with automatic unit conversion (Bytes → MBytes → GBytes)
  - Tunnel status tracking (connected, pending, unknown)
  - Dynamic data fetching from backend analytics
  - Professional status tables with color-coded indicators

- **🖥️ Device Management**: 
  - Complete device listing with status indicators
  - Device information modal with detailed hardware specs
  - Real-time connection status monitoring
  - Device configuration and approval workflow
  - ✅ Bulk device selection for tunnel creation
  - ✅ "Create Tunnels" button with topology selection
  - ✅ Device status tracking (Connected, Running, Approved)
  - ✅ Interface management and configuration

- **🔗 Tunnel Management** (Updated Oct 14, 2025): 
  - ✅ Complete tunnel listing page with real-time data
  - ✅ Tunnel creation via Devices page (Full Mesh / Hub-Spoke topologies)
  - ✅ Tunnel deletion with confirmation dialogs
  - ✅ Auto-refresh every 30 seconds
  - ✅ Statistics dashboard (Total, Connected, Inactive)
  - ✅ Detailed tunnel information display:
    - Device A/B names and interfaces
    - Path labels and encryption methods
    - Average latency and drop rate
    - Connection status with color-coded badges
  - ✅ Official FlexiWAN API integration (`POST /devices/apply`)
  - ✅ Backend unchanged (using official API only)
  - 📄 Documentation: `/docs/TUNNELS_PAGE_GUIDE.md`

- **🌐 Network Management**: 
  - Network topology visualization
  - Interface configuration
  - Network settings management
  - Organization-based network isolation

- **🔐 Security & Access Control**:
  - JWT-based authentication with role-based permissions
  - Firewall policy management interface
  - QoS policy configuration
  - Access token management with centered table layouts

- **👥 User & Organization Management**:
  - Multi-organization support
  - User role management
  - Member invitation system
  - Organization settings and billing

- **📊 Monitoring & Analytics**:
  - Real-time device monitoring
  - Traffic analytics with backend integration
  - Performance metrics dashboard
  - Notification system

### 🔧 **Authentication & Security**
- **Cloudflare Turnstile Integration**: Complete captcha support for login/registration
- **Role-Based Access Control**: Permission-based route guards
- **JWT Token Management**: Secure token handling with refresh capabilities
- **Session Management**: Persistent login with secure storage

### 🆕 **Recent Improvements** (October 2025)

#### Tunnel Management Enhancements
- ✅ **New Tunnels Page**: Complete rewrite with modern UI
  - Real-time data fetching from official API
  - Device name resolution with interface details
  - Color-coded status badges (Connected/Inactive)
  - Encryption method indicators (PSK/None)
  - Statistics cards showing tunnel counts
- ✅ **Tunnel Creation**: Integrated into Devices page
  - Full Mesh topology: Creates n×(n-1)/2 tunnels
  - Hub-and-Spoke topology: Creates n-1 tunnels
  - Real-time tunnel count preview
  - Official API compliance (`POST /devices/apply`)
- ✅ **Documentation**: Comprehensive guides added
  - User guide: `/docs/TUNNELS_PAGE_GUIDE.md`
  - API documentation: `/docs/TUNNEL_CREATION_OFFICIAL_API.md`
  - Limits analysis: `/docs/TUNNEL_CREATION_LIMITS_ANALYSIS.md`

#### MongoDB Configuration Fixes
- ✅ **Standardized Paths**: All services use `/run/mongodb/` (not `/var/run/`)
- ✅ **Corrected Parameters**: Fixed `--pidfilepath` (lowercase, official format)
- ✅ **Auto-Start Configuration**: Systemd services for 3-node replica set
- ✅ **Documentation**: `/scripts/README_MONGODB_SYSTEMD_EN.md`

#### System Stability Improvements
- ✅ **Swap Configuration**: 1GB swapfile created and enabled
- ✅ **Service Dependencies**: Proper systemd dependency chain
- ✅ **PM2 Integration**: Backend managed by PM2 under systemd
- ✅ **Boot Auto-Start**: All services (MongoDB, Redis, FlexiManage) start on boot

## 🛠️ Technology Stack

- **React 18**: Modern React with hooks and functional components
- **React Router 6**: Advanced client-side routing with route guards
- **Bootstrap 5 & React-Bootstrap**: Responsive UI framework with custom components
- **Axios**: HTTP client with request/response interceptors
- **React Icons**: Comprehensive icon library (Font Awesome, Bootstrap icons)
- **Recharts**: Data visualization for analytics dashboards
- **JWT Authentication**: Token-based authentication with permission decoding

### 🎨 **UI/UX Features**
- **Responsive Design**: Mobile-first approach with Bootstrap grid system
- **Custom Styling**: Tailored CSS with professional color schemes
- **Unified Table Components**: Consistent table layouts across all pages
- **Real-time Updates**: Live data refresh without page reloads
- **Status Indicators**: Color-coded status badges and progress indicators

## 🚀 Getting Started

### Prerequisites

- **Node.js 20+** with NVM
- **npm 6+**
- **MongoDB 8.0.15** replica set (3 nodes on ports 27017-27019)
- **Redis 5.0.5+** (port 6379)
- **PM2 Process Manager** (`npm install -g pm2`)
- **Email Server** (aiosmtpd on port 1025)

### System Architecture

FlexiManage runs as a production service with:
- **Backend**: Managed by PM2 and systemd
- **MongoDB**: Systemd auto-start replica set
- **Redis**: Systemd service
- **Frontend**: Served as static files from backend at port 3443

### Production Setup

#### 1. Install Required Services

```bash
# Install MongoDB replica set (ARM64)
sudo bash scripts/install_mongodb_arm64.sh

# Configure MongoDB systemd auto-start
sudo bash scripts/setup_mongodb_systemd.sh

# Install Redis
sudo bash scripts/install_redis.sh

# Install email server (aiosmtpd)
sudo bash scripts/install_aiosmtpd.sh

# Install PM2 globally
npm install -g pm2
```

#### 2. Install Backend Dependencies

```bash
cd backend
npm install
```

#### 3. Build Frontend for Production

```bash
cd frontend
npm install
npm run build
```

The optimized build will be in `frontend/build/` and served by the backend.

#### 4. Configure FlexiManage Systemd Service

```bash
# Set up FlexiManage auto-start service
sudo bash scripts/setup_fleximanage_systemd.sh

# The script will:
# - Create systemd service unit
# - Configure PM2 to manage Node.js backend
# - Set up dependencies (MongoDB, Redis)
# - Enable boot auto-start
# - Start the service
```

#### 5. Verify Installation

```bash
# Check service status
systemctl status fleximanage
systemctl status mongod-27017 mongod-27018 mongod-27019
systemctl status redis-server

# Check PM2 processes
pm2 list

# Check listening ports
ss -tlnp | grep -E ':(3002|3443|27017|27018|27019|6379)'
```

### Access the Application

- **Production HTTPS**: https://manage.miwide.com:3443
- **API Endpoint**: https://manage.miwide.com:3443/api
- **HTTP (dev)**: http://manage.miwide.com:3002

### Development Mode

For frontend development with hot-reload:

```bash
cd frontend
npm install

# Configure API endpoint
export REACT_APP_API_URL=http://manage.miwide.com:3002/api

# Start development server
npm start
```

Access at http://localhost:3000 (proxies API requests to backend)

### Service Management

```bash
# Start/stop/restart FlexiManage
systemctl start fleximanage
systemctl stop fleximanage
systemctl restart fleximanage

# View logs
journalctl -u fleximanage -f
pm2 logs fleximanage-backend

# Monitor PM2 processes
pm2 monit
```

## 📁 Project Structure

```
frontend/
├── public/
│   ├── index.html              # Main HTML template
│   ├── manifest.json           # PWA manifest
│   └── favicon.ico             # Application icon
├── src/
│   ├── components/             # Reusable UI components
│   │   ├── Header.js           # Navigation header with user menu
│   │   ├── Sidebar.js          # Main navigation sidebar
│   │   ├── Forbidden.js        # 403 permission denied component
│   │   └── *.css               # Component-specific styles
│   ├── pages/                  # Main application pages
│   │   ├── Home.js             # Dashboard with real-time stats
│   │   ├── Devices.js          # Device management interface
│   │   ├── Tunnels.js          # Tunnel monitoring and config
│   │   ├── Network.js          # Network topology and settings
│   │   ├── Firewall.js         # Security policy management
│   │   ├── QoS.js              # Quality of Service policies
│   │   ├── Monitoring.js       # Analytics and monitoring
│   │   ├── Login.js            # Authentication with Turnstile
│   │   ├── Register.js         # User registration
│   │   ├── Tokens.js           # API token management
│   │   ├── Settings.js         # System configuration
│   │   ├── account/            # Account management pages
│   │   │   ├── Profile.js      # User profile settings
│   │   │   ├── Organizations.js # Organization management
│   │   │   ├── Members.js      # Team member management
│   │   │   ├── Billing.js      # Billing and subscription
│   │   │   ├── AccessKeys.js   # API access keys
│   │   │   └── NotificationsSettings.js # Alert preferences
│   │   └── *.css               # Page-specific stylesheets
│   ├── services/               # API and external services
│   │   ├── api.js              # Axios HTTP client configuration
│   │   └── meta.js             # Metadata and utility functions
│   ├── auth/                   # Authentication logic
│   │   └── permissions.js      # JWT decoding and role-based access
│   ├── constants/              # Application constants
│   │   ├── branding.js         # Brand configuration
│   │   ├── countries.js        # Country/region data
│   │   └── serviceTypes.js     # Service type definitions
│   ├── styles/                 # Global stylesheets
│   │   ├── index.css           # Global styles and Bootstrap overrides
│   │   └── unified-table.css   # Consistent table styling
│   ├── App.js                  # Main application component with routing
│   ├── index.js                # React application entry point
│   └── setupProxy.js           # Development proxy configuration
├── package.json                # Dependencies and scripts
└── README.md                   # This documentation
```

## 🔐 Authentication & Access Control

### Default Credentials
- **Username:** `admin@flexiwan.com`
- **Password:** `admin`

### JWT-Based Authentication
The application uses JWT tokens with role-based permissions:

```javascript
// Token structure includes permission claims
{
  "sub": "user_id",
  "username": "admin@flexiwan.com", 
  "defaultOrg": { "_id": "org_id", "name": "Organization" },
  "perms": {
    "devices": 7,      // Full access (read/write/delete)
    "tunnels": 1,      // Read-only access
    "accounts": 7      // Full access
  }
}
```

### Permission-Based Route Guards
Routes are protected based on JWT permission claims:

| Route Path | Required Permission | Access Level |
|------------|-------------------|--------------|
| `/` (Home) | `devices` | Read (1) |
| `/devices` | `devices` | Read (1) |
| `/tunnels` | `tunnels` | Read (1) |
| `/firewall` | `firewallpolicies` | Read (1) |
| `/qos` | `qospolicies` | Read (1) |
| `/monitoring` | `devices` | Read (1) |
| `/network` | `organizations` | Read (1) |
| `/account/*` | `accounts` | Read (1) |
| `/account/organizations` | `organizations` | Read (1) |
| `/account/access-keys` | `accesstokens` | Read (1) |

## 🔌 Backend Integration & API

### API Configuration
The frontend communicates with the FlexiManage backend through a well-defined REST API:

```javascript
// Default API endpoints
const API_ENDPOINTS = {
  HTTP: 'http://manage.miwide.com:3002/api',
  HTTPS: 'https://manage.miwide.com:3443/api',
  WebSocket: 'wss://manage.miwide.com:3443'
};
```

### Environment Configuration
Configure API endpoints using environment variables:

```bash
# Development
REACT_APP_API_URL=http://manage.miwide.com:3002/api npm start

# Production
REACT_APP_API_URL=https://manage.miwide.com:3443/api npm run build
```

### Real-Time Data Integration
The frontend fetches live data from multiple backend services:

- **Dashboard Statistics**: `/api/dashboard/stats` - Real-time device and traffic metrics
- **Device Management**: `/api/devices` - Device status, configuration, and health
- **Tunnel Monitoring**: `/api/tunnels` - VPN tunnel status and bandwidth
- **Traffic Analytics**: Backend aggregates device statistics for monthly traffic totals
- **WebSocket Events**: Live device connection status and notifications

### API Client Features
```javascript
// Configured with interceptors for:
- JWT token attachment
- Automatic token refresh
- Error handling and retry logic
- Request/response logging
- CORS support
```

## Cloudflare Turnstile (Login & Registration)

If the backend is configured with Cloudflare Turnstile keys it will expect a captcha token on registration (already implemented server side) and now also on login. To enable the widget on this frontend login page:

1. Obtain keys from https://dash.cloudflare.com/profile/api-tokens (Turnstile section)
2. Export the site key at dev/build time:
   ```bash
   REACT_APP_TURNSTILE_SITE_KEY=<YOUR_SITE_KEY> npm start
   # or for a production build
   REACT_APP_TURNSTILE_SITE_KEY=<YOUR_SITE_KEY> npm run build
   ```
3. Backend env variables (example):
   ```bash
   export CAPTCHA_SITE_KEY=<YOUR_SITE_KEY>
   export CAPTCHA_SECRET_KEY=<YOUR_SECRET_KEY>
   ```
4. Without `CAPTCHA_SECRET_KEY` the backend will treat captcha as always valid (development convenience).

Development / Test Keys:
For quick local setup you can use Cloudflare's public TEST key pair for Turnstile (works on any domain, always validates):

```
Site (public) key: 1x00000000000000000000AA
Secret (server) key: 1x0000000000000000000000000000000AA
```

Export them exactly like real keys. NEVER use these test keys in production.

Adaptive enforcement: The backend now also returns `captchaEnforced` from `GET /api/public/config` which is true only when the backend has a non-empty secret key (`captchaKey`).

Behavior matrix:

| Site Key Present | captchaEnforced | Widget Loads | Result |
|------------------|-----------------|--------------|--------|
| No               | false           | N/A          | No captcha shown, login proceeds normally |
| Yes              | false           | Yes          | Token collected but not required (dev / test mode) |
| Yes              | false           | Fails        | Warning banner; login still allowed |
| Yes              | true            | Yes          | User must complete captcha before submit |
| Yes              | true            | Fails        | Error banner – user may be blocked (operator should fix key/network) |

Watchdog: After 6 seconds, if a site key exists but the widget has not rendered, a warning (non-enforced) or danger (enforced) alert appears to aid debugging. In non-enforced mode users can still submit. In enforced mode they are advised that login may fail until the issue is resolved.

### Runtime Mechanism for Acquiring captchaSiteKey (No Rebuild Required)

To avoid rebuilding every time the site key is changed, the frontend determines the Cloudflare Turnstile site key based on the following priority:
1. Build-time environment variable `REACT_APP_TURNSTILE_SITE_KEY`
2. Runtime-injected `window.__TURNSTILE_SITE_KEY__` (can be manually written in a script tag in `index.html`)
3. Fetched from the backend public endpoint `GET /api/public/config` which returns `captchaSiteKey`
   (since enhancement: also returns `captchaEnforced` boolean)

If neither 1 nor 2 exists, `Login.js` will automatically request `/api/public/config` after mounting. If the response contains `captchaSiteKey`, it will load the Cloudflare Turnstile script and render the widget on the fly, without requiring a rebuild.

Example of backend public endpoint response:
```json
{
   "captchaSiteKey": "0x4AAAAAAAxxxxxxxxxxxxxxxxxx",
   "companyName": "flexiWAN",
   "allowUsersRegistration": true
}
```

Example of runtime override (for operations to inject in the browser console without a rebuild):
```js
window.__TURNSTILE_SITE_KEY__ = 'NEW_SITE_KEY';
// Manually trigger a page re-render (e.g., by navigating away and back to the login page) to reload the script
```

To disable Turnstile: ensure that the key is not provided in any of the three locations (build variable, global injection, or API response).

The frontend does not expose the backend's SECRET (only the public site key is transmitted).

## Role-Based Route Guards

The frontend now decodes JWT permissions (`perms` claim) and guards certain routes.

Permission mapping (view requires GET bit = 0x1):
| Route | Permission Key |
|-------|----------------|
| /devices | devices |
| /tunnels | tunnels |
| /firewall | firewallpolicies |
| /qos | qospolicies |
| /monitoring | devices |
| /account, /account/profile | accounts |
| /account/organizations | organizations |
| /account/notifications | notifications |
| /account/billing | billing |
| /account/access-keys | accesstokens |
| /network | organizations |
| /users | accounts |

If user lacks the GET permission bit for the mapped key a 403 placeholder is shown.

Implementation details:
1. Token decoded client-side (no external libs) in `src/auth/permissions.js`.
2. Guard logic inside `App.js` via a lightweight `<Guard />` wrapper.
3. Adjust or extend mapping by editing the route definitions in `App.js`.

Future ideas: central route config, dynamic menu hiding based on same permission map.

## 🎨 UI/UX Design System

### Custom Styling Framework
The application uses a unified design system built on Bootstrap 5:

```css
/* Key design principles */
- Consistent color palette with status indicators
- Responsive grid layouts for all screen sizes  
- Unified table styling across all pages
- Professional typography with proper hierarchy
- Custom components with hover states and transitions
```

### Status Color Coding
```css
.status-running     { color: #28a745; background: #d4edda; } /* Green */
.status-connected   { color: #007bff; background: #cce7ff; } /* Blue */
.status-warning     { color: #ffc107; background: #fff3cd; } /* Yellow */
.status-error       { color: #dc3545; background: #f8d7da; } /* Red */
.status-pending     { color: #6f42c1; background: #e2d9f3; } /* Purple */
```

### Responsive Breakpoints
- **Mobile**: < 768px (Collapsible sidebar, stacked cards)
- **Tablet**: 768px - 1024px (Sidebar overlay, responsive tables)
- **Desktop**: > 1024px (Fixed sidebar, full table views)

## 📊 Recent Enhancements

### ✨ **Latest Updates (October 2025)**
1. **Real-Time Traffic Statistics**: 
   - Dynamic traffic calculation from device analytics
   - Automatic unit conversion (Bytes → KBytes → MBytes → GBytes)
   - Live updates without page refresh

2. **Enhanced Table Layouts**:
   - Centered column headers and data across all pages
   - Consistent table styling for Tokens, Access Keys, and status tables
   - Professional borders and spacing

3. **Improved Dashboard**:
   - Live device status monitoring (running, connected, approved)
   - Real-time tunnel status tracking
   - Professional status tables with color-coded indicators

4. **WebSocket Integration**:
   - Backend HTTPS server properly configured
   - FlexiEdge agent connectivity restored
   - Real-time device communication enabled

5. **Production Infrastructure**:
   - **Systemd Service Management**: Boot auto-start for FlexiManage backend
   - **PM2 Process Manager**: Node.js application lifecycle management with auto-restart
   - **MongoDB Replica Set**: Systemd-managed 3-node cluster (ports 27017-27019)
   - **Redis Cache**: Systemd service for session and cache storage
   - **Service Dependencies**: Automatic startup ordering (MongoDB → Redis → FlexiManage)
   - **Professional Logging**: Centralized logs via systemd journal and PM2
   - **High Availability**: Automatic restart on failure with 10-second delay

## 🚧 Development Status & Roadmap

### Current Implementation Status
This frontend represents a **production-ready** React application that has been:
- ✅ **Fully reconstructed** from analysis of existing backend APIs
- ✅ **Enhanced** with modern React patterns and real-time features
- ✅ **Integrated** with live backend services and WebSocket communication
- ✅ **Styled** with professional UI/UX design system
- ✅ **Production deployed** with systemd service management and PM2 process orchestration
- ✅ **Infrastructure automated** with MongoDB replica set and Redis auto-start

### Production Infrastructure Features
- ✅ **Systemd Service**: FlexiManage auto-starts on system boot
- ✅ **PM2 Process Manager**: Automatic restart on crashes, zero-downtime reloads
- ✅ **MongoDB Replica Set**: High-availability database with 3 nodes
- ✅ **Service Dependencies**: Proper startup ordering and health checks
- ✅ **Centralized Logging**: systemd journal and PM2 log aggregation
- ✅ **Email Notifications**: aiosmtpd SMTP server for system emails

### Next Planned Enhancements
1. **TypeScript Migration**: Incremental conversion starting with services layer
2. **Advanced Analytics**: Recharts integration for traffic visualization
3. **Real-Time Notifications**: Toast system for API events and errors
4. **Mobile Optimization**: Enhanced responsive design for mobile devices
5. **E2E Testing**: Cypress test suite for critical user flows
6. **Load Balancing**: Nginx reverse proxy for production scaling
7. **SSL Automation**: Let's Encrypt integration for automatic certificate renewal

## 🤝 Contributing

### Development Guidelines
When contributing to this project:

1. **API Integration**: Wrap new backend endpoints in `src/services/api.js`
2. **Component Structure**: Use functional components with React hooks
3. **Styling**: Follow the unified design system in `src/styles/`
4. **Permissions**: Implement route guards for new protected pages
5. **Error Handling**: Add proper error boundaries and user feedback

### Code Standards
```javascript
// Example component structure
import React, { useState, useEffect } from 'react';
import { Card, Table } from 'react-bootstrap';
import api from '../services/api';
import './ComponentName.css';

const ComponentName = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const response = await api.get('/endpoint');
      setData(response.data);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="component-name">
      {/* Component JSX */}
    </div>
  );
};

export default ComponentName;
```

## 🏷️ Branding Customization

All user-visible brand strings are centralized in `src/constants/branding.js`:

```javascript
export const BRAND_NAME = 'FlexiManage';
export const BRAND_TAGLINE = 'Open SD-WAN Management Platform';
```

### Customization Steps
1. **Update Brand Constants**: Edit `src/constants/branding.js`
2. **Update HTML Metadata**: Modify `public/index.html` title and meta description
3. **Update PWA Manifest**: Edit `public/manifest.json` for app name and short_name
4. **Rebuild Application**: Run `npm run build` to apply changes

```bash
# Example rebranding workflow
echo 'export const BRAND_NAME = "MySDWAN";' > src/constants/branding.js
echo 'export const BRAND_TAGLINE = "Custom Network Management";' >> src/constants/branding.js
npm run build
```

### Design Guidelines
- Import brand constants in components instead of hardcoding strings
- Maintain consistent branding across all user-facing text
- Update favicons and logos in the `public/` directory
- Consider updating CSS custom properties for brand colors

## 📈 Performance & Monitoring

### Build Optimization
- **Code Splitting**: Automatic route-based code splitting
- **Tree Shaking**: Unused code elimination in production builds
- **Asset Optimization**: Image compression and lazy loading
- **Bundle Analysis**: Use `npm run build` with `--analyze` flag

### Production Monitoring
```javascript
// Web Vitals tracking included
import { getCLS, getFID, getFCP, getLCP, getTTFB } from 'web-vitals';

// Performance metrics automatically collected
getCLS(console.log);
getFID(console.log);
getFCP(console.log);
getLCP(console.log);
getTTFB(console.log);
```

## 🔧 Troubleshooting

### Common Issues

**Service Not Starting:**
```bash
# Check FlexiManage service status
systemctl status fleximanage

# Check dependencies
systemctl status mongod-27017 mongod-27018 mongod-27019
systemctl status redis-server

# View service logs
journalctl -u fleximanage -n 50

# Check PM2 processes
pm2 list
pm2 logs fleximanage-backend
```

**API Connection Issues:**
```bash
# Check backend availability
curl -X GET "http://manage.miwide.com:3002/api/dashboard/stats"
curl -k -X GET "https://manage.miwide.com:3443/api/dashboard/stats"

# Check listening ports
ss -tlnp | grep -E ':(3002|3443)'

# Verify CORS configuration
# Check browser console for CORS errors
```

**Database Connection Issues:**
```bash
# Check MongoDB replica set status
mongosh --port 27017 --eval 'rs.status()'

# Check Redis connection
redis-cli ping

# Verify service dependencies
systemctl list-dependencies fleximanage
```

**PM2 Process Issues:**
```bash
# Check PM2 daemon
pm2 ping

# Restart PM2 processes
pm2 restart fleximanage-backend

# Reset PM2 daemon
pm2 kill
pm2 resurrect

# Monitor in real-time
pm2 monit
```

**Authentication Problems:**
```bash
# Clear browser storage
localStorage.clear();
sessionStorage.clear();

# Check JWT token validity
# Inspect token in browser developer tools

# Verify backend authentication endpoint
curl -X POST "http://manage.miwide.com:3002/api/users/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin@flexiwan.com","password":"admin"}'
```

**Build Issues:**
```bash
# Clear node modules and reinstall
rm -rf node_modules package-lock.json
npm install

# Clear React build cache
rm -rf build/
npm run build

# Rebuild and restart backend
cd backend && npm install
systemctl restart fleximanage
```

**Service Won't Start on Boot:**
```bash
# Check if service is enabled
systemctl is-enabled fleximanage

# Enable auto-start
systemctl enable fleximanage

# Check boot logs
journalctl -b -u fleximanage
```

## 🚀 Production Deployment Guide

### Complete Installation from Scratch

```bash
# 1. Install MongoDB replica set
sudo bash scripts/install_mongodb_arm64.sh
sudo bash scripts/setup_mongodb_systemd.sh

# 2. Install Redis
sudo bash scripts/install_redis.sh
sudo systemctl enable redis-server
sudo systemctl start redis-server

# 3. Install email server
sudo bash scripts/install_aiosmtpd.sh

# 4. Install Node.js with NVM (if not already installed)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20

# 5. Install PM2 globally
npm install -g pm2

# 6. Install backend dependencies
cd /root/fleximanage/backend
npm install

# 7. Build frontend
cd /root/fleximanage/frontend
npm install
npm run build

# 8. Configure and start FlexiManage service
cd /root/fleximanage
sudo bash scripts/setup_fleximanage_systemd.sh

# 9. Verify all services
systemctl status fleximanage
systemctl status mongod-27017 mongod-27018 mongod-27019
systemctl status redis-server
pm2 list
```

### Post-Installation Verification

```bash
# Check all services are enabled for auto-start
systemctl is-enabled fleximanage
systemctl is-enabled mongod-27017 mongod-27018 mongod-27019
systemctl is-enabled redis-server

# Check listening ports
ss -tlnp | grep -E ':(3002|3443|27017|27018|27019|6379|1025)'

# Test MongoDB replica set
mongosh --port 27017 --eval 'rs.status()'

# Test Redis
redis-cli ping

# Test FlexiManage API
curl -k https://manage.miwide.com:3443/api/dashboard/stats
```

### Updating FlexiManage

```bash
# 1. Pull latest changes
cd /root/fleximanage
git pull origin main

# 2. Update backend dependencies
cd backend
npm install

# 3. Rebuild frontend
cd ../frontend
npm install
npm run build

# 4. Restart service
systemctl restart fleximanage

# 5. Verify
pm2 logs fleximanage-backend
systemctl status fleximanage
```

### Backup and Restore

```bash
# Backup MongoDB data
sudo systemctl stop mongod-27017 mongod-27018 mongod-27019
sudo tar -czf fleximanage-mongodb-backup-$(date +%Y%m%d).tar.gz /data/db2701*
sudo systemctl start mongod-27017 mongod-27018 mongod-27019

# Backup application code and configuration
tar -czf fleximanage-app-backup-$(date +%Y%m%d).tar.gz /root/fleximanage

# Restore MongoDB data
sudo systemctl stop mongod-27017 mongod-27018 mongod-27019
sudo rm -rf /data/db2701*
sudo tar -xzf fleximanage-mongodb-backup-YYYYMMDD.tar.gz -C /
sudo chown -R mongodb:mongodb /data/db2701*
sudo systemctl start mongod-27017 mongod-27018 mongod-27019
```

### System Monitoring

```bash
# Monitor FlexiManage service
journalctl -u fleximanage -f

# Monitor PM2 processes
pm2 monit

# Check system resources
top -p $(pgrep -f fleximanage-backend)

# View MongoDB logs
tail -f /var/log/mongodb/mongod-27017.log

# Check Redis logs
journalctl -u redis-server -f
```

---

## 🧪 Testing & Verification

### Test Scripts

The project includes automated test scripts for verification:

```bash
# Test Tunnels API endpoints
bash /root/fleximanage/scripts/test_tunnels_api.sh

# Verify complete deployment
bash /root/fleximanage/scripts/verify_tunnels_deployment.sh
```

### Manual Testing Checklist

#### Frontend Testing
- [ ] Access web UI: `https://manage.miwide.com:3443`
- [ ] Login with admin credentials
- [ ] Check Dashboard displays device statistics
- [ ] Navigate to Devices page
- [ ] Navigate to Tunnels page
- [ ] Verify all data loads correctly
- [ ] Test tunnel creation (select devices → Create Tunnels)
- [ ] Test tunnel deletion
- [ ] Check auto-refresh functionality

#### Backend API Testing
```bash
# Get authentication token
TOKEN=$(curl -s -k -X POST https://manage.miwide.com:3443/api/tokens \
  -H "Content-Type: application/json" \
  -d '{"username":"admin@example.com","password":"your_password"}' \
  | jq -r '.token')

# Test devices endpoint
curl -k -H "Authorization: Bearer $TOKEN" \
  https://manage.miwide.com:3443/api/devices

# Test tunnels endpoint
curl -k -H "Authorization: Bearer $TOKEN" \
  https://manage.miwide.com:3443/api/tunnels

# Test dashboard stats
curl -k https://manage.miwide.com:3443/api/dashboard/stats
```

#### Database Testing
```bash
# Check MongoDB replica set status
mongosh --port 27017 --eval 'rs.status()' | grep -E '"stateStr"|"name"'

# Count active tunnels
mongosh flexiwan --quiet --eval 'db.tunnels.find({isActive: true}).count()'

# List devices
mongosh flexiwan --quiet --eval 'db.devices.find({}, {name:1, hostname:1, isConnected:1}).limit(5)'

# Check jobs queue
mongosh flexiwan --quiet --eval 'db.jobs.find().sort({_id:-1}).limit(5).pretty()'
```

---

## � Troubleshooting

### Common Issues

#### Issue: Frontend doesn't load / 502 Bad Gateway

**Solution**:
```bash
# Check if backend is running
pm2 list | grep fleximanage

# Check systemd service
systemctl status fleximanage

# Restart services
systemctl restart fleximanage
pm2 restart fleximanage-backend

# Check logs
pm2 logs fleximanage-backend
journalctl -u fleximanage -n 50
```

#### Issue: MongoDB connection failed

**Solution**:
```bash
# Check MongoDB services
systemctl status mongod-27017 mongod-27018 mongod-27019

# Check if replica set is initialized
mongosh --port 27017 --eval 'rs.status()'

# Restart MongoDB services
systemctl restart mongod-27017 mongod-27018 mongod-27019

# Check MongoDB logs
journalctl -u mongod-27017 -n 50
```

#### Issue: Tunnels page shows no data

**Solution**:
```bash
# Check if tunnels exist in database
mongosh flexiwan --eval "db.tunnels.find({isActive: true}).count()"

# Check API response
curl -k -H "Authorization: Bearer $TOKEN" \
  https://manage.miwide.com:3443/api/tunnels | jq

# Check backend logs for errors
pm2 logs fleximanage-backend | grep -i tunnel

# Clear browser cache and reload
# Press Ctrl+Shift+Delete → Clear cache
```

#### Issue: Services don't start on boot

**Solution**:
```bash
# Verify services are enabled
systemctl is-enabled mongod-27017 mongod-27018 mongod-27019
systemctl is-enabled redis-server
systemctl is-enabled fleximanage

# Enable services if needed
sudo systemctl enable mongod-27017 mongod-27018 mongod-27019
sudo systemctl enable redis-server
sudo systemctl enable fleximanage

# Check service dependencies
systemctl list-dependencies fleximanage
```

#### Issue: High memory usage

**Solution**:
```bash
# Check memory usage
free -h
ps aux | grep -E 'mongod|node|redis' | sort -k4 -rn

# Adjust MongoDB cache size (edit service files)
# Adjust Node.js memory limit in PM2 config

# Monitor swap usage
swapon --show
vmstat 5

# Add more swap if needed (already have 1GB)
```

### Log Locations

| Service | Log Location |
|---------|--------------|
| FlexiManage Backend | `pm2 logs fleximanage-backend` |
| FlexiManage Systemd | `journalctl -u fleximanage` |
| MongoDB (27017) | `/var/log/mongodb/mongod-27017.log` |
| MongoDB (27018) | `/var/log/mongodb/mongod-27018.log` |
| MongoDB (27019) | `/var/log/mongodb/mongod-27019.log` |
| Redis | `journalctl -u redis-server` |
| System | `/var/log/syslog` |
| PM2 | `~/.pm2/logs/` |

---

## 📚 Additional Documentation

### Project Documentation Files

| Document | Purpose | Location |
|----------|---------|----------|
| **MongoDB Setup** | Systemd service configuration | `/scripts/README_MONGODB_SYSTEMD_EN.md` |
| **Tunnels Guide** | Complete user guide | `/docs/TUNNELS_PAGE_GUIDE.md` |
| **Tunnels API** | Official API adaptation | `/docs/TUNNEL_CREATION_OFFICIAL_API.md` |
| **Limits Analysis** | System constraints | `/docs/TUNNEL_CREATION_LIMITS_ANALYSIS.md` |
| **Quick Test** | Quick testing guide | `/docs/QUICK_TEST_GUIDE.md` |
| **Git Guide** | Commit recommendations | `/GIT_COMMIT_RECOMMENDATION.md` |

### Quick Reference Commands

```bash
# Start all services
sudo systemctl start mongod-27017 mongod-27018 mongod-27019
sudo systemctl start redis-server
sudo systemctl start fleximanage

# Stop all services
sudo systemctl stop fleximanage
sudo systemctl stop redis-server
sudo systemctl stop mongod-27017 mongod-27018 mongod-27019

# Restart FlexiManage only
sudo systemctl restart fleximanage
pm2 restart fleximanage-backend

# View all service statuses
systemctl status mongod-27017 mongod-27018 mongod-27019 redis-server fleximanage

# Check port usage
ss -tlnp | grep -E ':(3002|3443|27017|27018|27019|6379|1025)'

# View real-time logs
pm2 logs --lines 100
journalctl -f -u fleximanage -u mongod-27017 -u redis-server
```

---

## �📞 Support & Documentation

- **Backend Repository**: [FlexiManage Backend](https://github.com/Aikonlivecn/fleximanage)
- **Original Project**: [FlexiWAN flexiManage](https://github.com/flexiwan/fleximanage)
- **API Documentation**: Available at `/api/docs` when backend is running
- **Issue Tracking**: Use GitHub Issues for bug reports and feature requests
- **Development Team**: Miwide Info Technology Co., Ltd.

### Key Contributors
- System Architecture & MongoDB Configuration
- Tunnels Page Implementation
- Official API Integration
- Documentation & Testing Scripts

---

## 📈 Development Roadmap

### Completed ✅
- [x] MongoDB systemd auto-start (3-node replica set)
- [x] Redis systemd integration
- [x] FlexiManage systemd service with PM2
- [x] Tunnels page with full CRUD operations
- [x] Official API integration (no backend modifications)
- [x] Comprehensive documentation (3,420+ lines)
- [x] Test and verification scripts
- [x] Swap configuration for stability
- [x] Boot auto-start for all services

### In Progress 🚧
- [ ] Investigate device 10.248.5.14 tunnel creation issue
- [ ] Monitor tunnel statistics (latency, drop rate)
- [ ] Performance optimization for large datasets

### Planned 📋
- [ ] Enhanced tunnel editing capabilities
- [ ] Bulk tunnel operations
- [ ] Advanced filtering and search
- [ ] Export functionality (CSV/JSON)
- [ ] Real-time WebSocket updates
- [ ] Mobile app support

---

**Version**: 6.3.37 (Production Ready)  
**Last Updated**: October 15, 2025  
**License**: AGPL-3.0  
**Environment**: Ubuntu 24.04.3 LTS ARM64