# flexiWAN FlexiManage - SD-WAN Management Platform

**Production URL**: https://manage.miwide.com:3443

## About This Fork

This is a customized fork of flexiWAN's SD-WAN management platform, enhanced with modern UI improvements, advanced permission management, and production-ready deployment configurations.

### Development Progress Summary (Dec 2025)

#### ✅ Completed Milestones

**System Environment Upgrades**
- ✅ Upgraded to Node.js v20.18.1 (from v10+)
- ✅ Upgraded to Mongoose v7+ with full compatibility refactoring
- ✅ Updated MongoDB to v8.0.15 ARM64 with replica set support (3 nodes)
- ✅ Redis 5.0.5 in production
- ✅ Python aiosmtpd for email services

**Mongoose v7+ Compatibility Fixes**
- ✅ Replaced deprecated `.remove()` with `.deleteMany()`/`.deleteOne()` (50+ files)
- ✅ Fixed chained `.populate()` calls using array syntax
- ✅ Converted callback-based `.exec()` to async/await patterns
- ✅ Updated MongoDB transaction handling for WriteConflict resilience
- ✅ All 50+ backend services and models verified and updated

**Frontend & API Connectivity**
- ✅ Fixed server-injected baseUrl configuration for API endpoints
- ✅ Automatic protocol detection (http/https) based on request context
- ✅ Support for both localhost and domain-based access patterns
- ✅ Frontend build system updated (React 18)

**Device Management Workflow**
- ✅ Device registration API fully functional
- ✅ Device approval/unapproval status toggling
- ✅ Device update operations with proper error handling
- ✅ Device deletion with transaction support
- ✅ WebSocket connection management for approved devices

**Production Deployment**
- ✅ HTTPS production deployment on port 3443
- ✅ SSL/TLS certificate management (Let's Encrypt)
- ✅ Cloudflare Turnstile CAPTCHA integration
- ✅ Multi-factor authentication (MFA) support
- ✅ CORS configuration for cross-origin requests

**Code Quality & Security**
- ✅ Comprehensive error handling improvements
- ✅ Enhanced logging with proper context
- ✅ Database transaction safety verified
- ✅ Create-admin.js script optimized (safe, non-destructive)
- ✅ Super admin cross-account management
- ✅ User permission management enhancements

#### 📊 Development Statistics
- **Total Commits**: 9 feature/fix commits
- **Files Modified**: 50+ backend services
- **Lines Changed**: +1,400 / -750
- **Test Coverage**: Device lifecycle (register, approve, update, delete)
- **Backend Restarts**: 16 (stable operation)
- **PM2 Status**: All services online, healthy

### Recent UI & UX Improvements (2025)

#### UI Enhancements
- ✅ Unified table styling system with gradient headers and responsive design
- ✅ Enhanced Organizations page layout with proper spacing and divider lines
- ✅ Improved Tokens and AccessKeys pages with vertically centered action buttons
- ✅ Responsive design improvements across all management pages
- ✅ Better error messaging and user feedback

#### Backend & Permission System
- ✅ Enhanced error message handling for better user feedback
- ✅ Super admin cross-account management capabilities
- ✅ Flexible user deletion policy (removed "last owner" restriction for non-admin users)
- ✅ Super administrator protection (cannot be deleted)
- ✅ Improved account name resolution in error messages

## About flexiWAN

flexiWAN is the world's first open source [SD-WAN](https://flexiwan.com/). The platform offers a complete SD-WAN solution comprising of flexiEdge (the edge router) and flexiManage (the central management system) with core SD-WAN functionality.

# flexiManage

This repository contains the flexiManage backend component from flexiWAN. flexiManage service is used for managing [flexiEdge devices](https://docs.flexiwan.com/overview/arch.html#flexiedge). It allows users to create users and accounts and manage the entire network inventory of the organizations in the account.

Our hosted service https://manage.flexiwan.com provides a free access to the flexiManage service for a 30 days trial where users can create an account and use up to 5 flexiEdge devices during the free trial. Users may request extension of the trial by contacting our account team (team@flexiwan.com). One account is allowed per company and users are not allowed to open additional accounts in order to gain additional free trials.

## What is included in this repository

The flexiManage backend component provides REST API for managing the flexiWAN network, configuring and connecting to the flexiWAN flexiEdge devices. 
The repository includes two git submodules which are used by the flexiWAN SaaS service and are not open. 

When pulling the flexiManage repository, 
these submodules would be seen as an empty directory:
* client - a git submodule for the flexiWAN SaaS UI. The UI provides the user side logic and design for managing the network. It uses REST to access flexiManage
* backend/billing - a git submodule for managing the flexiWAN SaaS billing

These submodules are not required for running the backend serivce and are used for the UI and Billing additions on top of flexiManage.
To experience the complete flexiWAN system, open a free account on our [hosted system](https://flexiwan.com/pricing).

## Install and use flexiManage locally

### Prerequisites
FlexiManage requires the following to run:
* **Node.js v20.18.1+** (updated from v10+)
* npm v10.9.4+
* **MongoDB v8.0.15 ARM64**, running as a replica-set with 3 nodes on ports 27017, 27018, 27019
* Redis 5.0.5+, running on port 6379
* A mailer application or trapper of your choice, running on port 1025 (Such as [python aiosmtpd](https://pypi.org/project/aiosmtpd/))

### System Requirements

#### Recommended System Specifications
- **CPU**: 4+ cores
- **RAM**: 8GB minimum
- **Storage**: 20GB+ for MongoDB replica set
- **Network**: Stable internet connection for device management

#### Database Setup
MongoDB replica set is required for transactions. Setup 3 nodes:
```bash
# Node 1 (primary)
mongod --port 27017 --dbpath /data/db1 --replSet rs

# Node 2
mongod --port 27018 --dbpath /data/db2 --replSet rs

# Node 3
mongod --port 27019 --dbpath /data/db3 --replSet rs

# Initialize replica set (run once from any node)
mongosh --port 27017
> rs.initiate({
    _id: "rs",
    members: [
      {_id: 0, host: "localhost:27017"},
      {_id: 1, host: "localhost:27018"},
      {_id: 2, host: "localhost:27019"}
    ]
  })
```

### Installing
##### Getting the source code:
```
mkdir fleximanage
cd fleximanage
git clone https://github.com/Aikonlee/fleximanage.git .
```

##### Installing dependencies:
```
cd backend
npm install
```

### Running
```
npm start
```

Or with PM2 for production:
```
pm2 start expressserver.js --name fleximanage-backend
pm2 save
```

### Creating an Admin User

#### Automatic Admin Creation
Use the provided script to create or verify admin user:
```bash
node scripts/create-admin.js
```

This script:
- Creates a new admin account if none exists (password: 'admin')
- Verifies existing admin account (does NOT reset passwords)
- Sets up proper permissions and roles
- Safe to run multiple times without side effects

#### Default Credentials (New Installation)
- Email: `admin@flexiwan.com`
- Password: `admin`
- Role: Super Administrator

⚠️ **IMPORTANT**: Change default password immediately after first login in production environments.

### Creating a User (API Method)

To create your first user, use the procedure below:
1) Register a new user:
```
curl -X POST -k "https://manage.miwide.com:3443/api/users/register" \
  -H "accept: application/json" \
  -H "Content-Type: application/json" \
  -d "{
    \"accountName\":\"account\",
    \"userFirstName\":\"user\",
    \"userLastName\":\"lastname\",
    \"email\":\"user@example.com\",
    \"password\":\"xxxxxxxx\",
    \"userJobTitle\":\"eng\",
    \"userPhoneNumber\":\"\",
    \"country\":\"US\",
    \"companySize\":\"0-10\",
    \"serviceType\":\"Provider\",
    \"numberSites\":\"10\",
    \"companyType\":\"\",
    \"companyDesc\":\"\",
    \"captcha\":\"\"
  }"
```

2) You should get an email to user@example.com with a verification link. In the verification link, copy the id and t (token) parameters and execute the verification API:
```
curl -X POST -k "https://manage.miwide.com:3443/api/users/verify-account" \
  -H "accept: application/json" \
  -H "Content-Type: application/json" \
  -d "{
    \"id\":\"<id parameter in the verification link>\",
    \"token\":\"<token parameter in the verification link>\"
  }"
```

3) Execute a login API:
```
curl -X POST -sD - -k "https://manage.miwide.com:3443/api/users/login" \
  -H "accept: application/json" \
  -H "Content-Type: application/json" \
  -d "{
    \"username\":\"user@example.com\",
    \"password\":\"xxxxxxxx\",
    \"captcha\":\"\"
  }"
```

Check the response header and use the Refresh-JWT as bearer token for any REST API:
```
Refresh-JWT: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJfaWQiOiI1ZTh...TlNo
```

## Device Management

### Device Registration Workflow

1. **Device Registration**: Device calls `/api/connect/register` with token
2. **Admin Approval**: Administrator approves device in UI
3. **WebSocket Connection**: Device connects to management system after approval
4. **Configuration Sync**: Device receives and applies configurations

### Supported Devices
- flexiEdge routers (v6.4.32+)
- Architecture: x86-64, ARM64
- Network interfaces: Multi-WAN support
- VPN Tunnels: IPSec, IKEv2

## Troubleshooting

### Device Connection Issues
- Verify device is approved: Check UI status
- Check network connectivity: Device → Management system
- Review firewall rules: Ensure port 3443 is open
- Check device logs: `systemctl status fwagent`

### API Connectivity Problems
- Verify API baseUrl: Check browser console (Press F12)
- Check CORS headers: Review browser Network tab
- Verify DNS resolution: `nslookup manage.miwide.com`
- Check SSL certificate: `openssl s_client -connect manage.miwide.com:3443`

### Database Connection Issues
- Verify MongoDB replica set: `mongosh --port 27017` → `rs.status()`
- Check connection string: Review `backend/configs.js`
- Review database logs: Check MongoDB logs directory

### Backend Startup Issues
- Check Node.js version: `node --version` (requires v20+)
- Verify dependencies: `cd backend && npm list mongoose`
- Review error logs: `tail -f logs/app.log`
- Check database connectivity: `npm run check-db`

## Documentation

- [Full flexiManage API Documentation](https://docs.flexiwan.com/management/management-login.html)
- [flexiEdge Router Documentation](https://docs.flexiwan.com/)
- [SD-WAN Concepts](https://flexiwan.com/learn/)
- [Community Forum](https://community.flexiwan.com/)

## Version History

### v6.4.32+ (Current)
- Mongoose v7+ compatibility
- Node.js v20.18.1 support
- MongoDB 8.0.15 ARM64 support
- Enhanced device management
- Improved CORS handling

### Previous Versions
See [CHANGELOG.md](CHANGELOG.md) for complete version history.

## Versioning

FlexiManage uses [SemVer](https://semver.org/) scheme for versioning.

## Contributing

We welcome contributions! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/improvement`)
3. Make your changes with clear commit messages
4. Test thoroughly before submitting
5. Submit a pull request with detailed description

## Support

For issues and questions:
- [GitHub Issues](https://github.com/Aikonlee/fleximanage/issues)
- [Community Forum](https://community.flexiwan.com/)
- Email: team@flexiwan.com

## License

This project is licensed under the GNU AGPLv3 License - see the [LICENSE.md](LICENSE.md) file for details.

## Other Open Source Used

This project uses other Open Source components listed [here](OPENSOURCE.md).

## Related Projects

- [flexiEdge](https://github.com/flexiwan/flexiedge) - Edge router
- [flexiWAN](https://github.com/flexiwan/flexiwan) - Main repository
- [flexiWAN Docs](https://docs.flexiwan.com/) - Documentation
Check the documentation REST API section for more details.  You can create an access-key for your account API key.

### Documentation
For full documentation of flexiManage, please refer to [flexiManage documentation](https://docs.flexiwan.com/management/management-login.html).

## Versioning

FlexiManage uses [SemVer](https://semver.org/) scheme for versioning.

## License

This project is licensed under the GNU AGPLv3 License - see the [LICENSE.md](https://gitlab.com/flexiwangroup/fleximanage/blob/master/LICENSE) file for details

## Other Open Source Used

This project uses other Open Source components listed [here](https://gitlab.com/flexiwangroup/fleximanage/blob/master/OPENSOURCE.md).
