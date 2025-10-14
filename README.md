# flexiWAN FlexiManage - SD-WAN Management Platform

**Production URL**: https://manage.miwide.com:3443

## About This Fork

This is a customized fork of flexiWAN's SD-WAN management platform, enhanced with modern UI improvements, advanced permission management, and production-ready deployment configurations.

### Recent Improvements (2025)

#### UI Enhancements
- ✅ Unified table styling system with gradient headers and responsive design
- ✅ Enhanced Organizations page layout with proper spacing and divider lines
- ✅ Improved Tokens and AccessKeys pages with vertically centered action buttons
- ✅ Responsive design improvements across all management pages

#### Backend & Permission System
- ✅ Enhanced error message handling for better user feedback
- ✅ Super admin cross-account management capabilities
- ✅ Flexible user deletion policy (removed "last owner" restriction for non-admin users)
- ✅ Super administrator protection (cannot be deleted)
- ✅ Improved account name resolution in error messages

#### System Configuration
- ✅ HTTPS production deployment (port 3443)
- ✅ Cloudflare Turnstile CAPTCHA integration
- ✅ Multi-factor authentication (MFA) support
- ✅ MongoDB 8.0.15 ARM64 replica set support
- ✅ Email notification system (aiosmtpd)

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
* Node.js v10+
* npm v6+
* MongoDB 4.0.9, running as a replica-set with 3 nodes on ports 27017, 27018, 27019
* Redis 5.0.5, running on port 6379
* A mailer application or trapper of your choice, running on port 1025 (Such as [python mailtrap](https://pypi.org/project/mailtrap/))

### Installing
##### Getting the source code:
```
mkdir flexiManage
cd flexiManage
git clone https://gitlab.com/flexiwangroup/fleximanage.git .
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

### Creating a user
To create your first user, use the procedure below:
1) Register a new user:
```
curl -X POST -k "https://local.flexiwan.com:3443/api/users/register" -H "accept: application/json" -H "Content-Type: application/json" -d "{\"accountName\":\"account\",\"userFirstName\":\"user\",\"userLastName\":\"lastname\",\"email\":\"user@example.com\",\"password\":\"xxxxxxxx\",\"userJobTitle\":\"eng\",\"userPhoneNumber\":\"\",\"country\":\"US\",\"companySize\":\"0-10\",\"serviceType\":\"Provider\",\"numberSites\":\"10\",\"companyType\":\"\",\"companyDesc\":\"\",\"captcha\":\"\"}"
```
2) You should get an email to user@example.com with a verification link. In the verification link, copy the id and t (token) parameters and execute the verification API:
```
curl -X POST -k "https://local.flexiwan.com:3443/api/users/verify-account" -H "accept: application/json" -H "Content-Type: application/json" -d "{\"id\":\"<id parameter in the verification link>\",\"token\":\"<token parameter in the verification link>\"}"
```
3) Execute a login API:
```
curl -X POST -sD - -k "https://local.flexiwan.com:3443/api/users/login" -H "accept: application/json" -H "Content-Type: application/json" -d "{\"username\":\"user@example.com\",\"password\":\"xxxxxxxx\",\"captcha\":\"\"}"
```
Check the response header and use the Refresh-JWT as bearer token for any REST API.
```
Refresh-JWT: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJfaWQiOiI1ZTh...TlNo
```
Check the documentation REST API section for more details.  You can create an access-key for your account API key.

### Documentation
For full documentation of flexiManage, please refer to [flexiManage documentation](https://docs.flexiwan.com/management/management-login.html).

## Versioning

FlexiManage uses [SemVer](https://semver.org/) scheme for versioning.

## License

This project is licensed under the GNU AGPLv3 License - see the [LICENSE.md](https://gitlab.com/flexiwangroup/fleximanage/blob/master/LICENSE) file for details

## Other Open Source Used

This project uses other Open Source components listed [here](https://gitlab.com/flexiwangroup/fleximanage/blob/master/OPENSOURCE.md).
