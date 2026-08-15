# flexiManage — SD-WAN Management Platform (miwide fork)

**Live deployment**: https://manage.miwide.com:3443

## About

This is a self-hosted fork of [flexiWAN](https://flexiwan.com/)'s open-source SD-WAN management platform (flexiManage). It manages a fleet of flexiEdge routers: device registration/approval, organizations and accounts, tunnels, notifications, QoS/firewall policies, and more, all through a REST API consumed by the bundled React frontend.

## Architecture

```
backend/    Express app (Node.js). Two parallel routing layers - see below.
frontend/   React 18 SPA, built to frontend/build/ and served as static
            files by the backend (see clientStaticDir in configs.js).
```

**Two routing layers coexist in the backend** — this matters when tracing a request or fixing a bug:

1. **openapi-generated services** (`backend/services/*Service.js`), wired up via `backend/api/openapi.yaml` (~14.7k lines) and `utils/openapiRouter.js`. This is where almost all resource CRUD actually lives today: devices, organizations select/summary, tunnels, notifications, tokens, members, policies, etc. These consistently scope queries through `utils/membershipUtils.js#getAccessTokenOrgList()`, which safely returns `[]` for a user with no default organization instead of crashing.
2. **Classic hand-written Express routers** (`backend/routes/*.js`), registered directly in `expressserver.js`. Only a handful are actually mounted today: `users`, `public`, `connect`, `devicestats`, `portals`, `interfaces-routing`, `organizations`, `admin`, `tickets`, `tunnels`. Several others (`devices.js`, `notifications.js`, `tokens.js`, `members.js`, `deviceQueue.js`, `wrapper.js`) were removed in 2026-08 — they'd been disabled since a mongodb-driver-v4 load error and were fully superseded by their openapi equivalents by the time they were cleaned up. **Before editing anything under `routes/`, check `expressserver.js`'s `app.use()` calls to confirm it's actually mounted** — editing an unmounted file is a no-op.

Background workers (periodic jobs, device job queue, WebSocket device connections) live under `periodic/`, `deviceLogic/`, and `websocket/`.

## Verified tech stack (this deployment)

| Component | Version |
|---|---|
| Node.js | v20.18.1 |
| Backend (`flexiwansite`) | v6.5.1 |
| MongoDB | 8.0.15, 3-node replica set (ports 27017/27018/27019) — transactions require the replica set |
| Redis | 7.0.15 |
| Process manager | PM2 (`ecosystem.config.js`, app name `fleximanage-backend`) |
| Frontend | React 18 (`react-scripts build`) |
| Platform | aarch64 (ARM64) |

## Getting started

### Prerequisites
* Node.js v20+, npm
* MongoDB running as a 3-node replica set (transactions won't work standalone)
* Redis
* An SMTP-capable mail path — see [Mail configuration](#mail-configuration) below

### Install
```bash
cd backend && npm install
cd ../frontend && npm install
```

### Run
```bash
# Backend (dev)
cd backend && npm start          # node ./bin/www

# Backend (production, via PM2 — ecosystem.config.js lives in backend/)
cd backend && pm2 start ecosystem.config.js
pm2 save

# Frontend build (backend serves this statically — rebuild after any frontend change)
cd frontend && npm run build
```

Backend config is resolved by `backend/configs.js`: it merges an environment-specific block from `configEnv` with anything set in `backend/.env` (loaded via `dotenv` — see `ecosystem.config.js`). Any config key can be overridden by an env var using its UPPER_SNAKE_CASE form (e.g. `mailerHost` ↔ `MAILER_HOST`). Startup logs the fully-resolved config with secrets redacted (`redactConfigForLogging()`).

### Create an admin user
```bash
# from the repo root (not backend/)
node scripts/create-admin.js   # default admin@flexiwan.com / admin — change immediately
```

### Register a user via API
```bash
curl -X POST -k "https://manage.miwide.com:3443/api/users/register" \
  -H "Content-Type: application/json" \
  -d '{"accountName":"account","userFirstName":"user","userLastName":"lastname",
       "email":"user@example.com","password":"xxxxxxxx","userJobTitle":"eng",
       "country":"US","companySize":"0-10","serviceType":"Provider","numberSites":"10"}'
```
This sends a verification email; POST the `id`/`t` query params from that link to `/api/users/verify-account`, then `/api/users/login` to get a `Refresh-JWT` bearer token for the rest of the API. A newly registered account has **no organization** until one is explicitly created (`POST /api/organizations`) — most other endpoints require one selected.

## Mail configuration

`backend/utils/mailer.js` supports two providers, selected by `mailerProvider` (`MAILER_PROVIDER` env var):

- **`smtp`** (default) — nodemailer. Either point `mailerHost`/`mailerPort` at a relay, or set `mailerService` (e.g. `MAILER_SERVICE=gmail`) to use nodemailer's well-known-provider shorthand plus `mailerUser`/`mailerPassword` auth. For Gmail this must be an **App Password** (requires 2-Step Verification), not the account password — and the from-address must match the authenticated account or Gmail will reject/rewrite it.
- **`wecom`** — sends via the WeCom Exmail HTTP API instead of SMTP, useful where outbound port 25 is blocked. Requires `wecomCorpId`/`wecomCorpSecret`/`wecomAgentId`, and the server's public IP must be added to that self-built app's trusted-IP list in the WeCom admin console.

## Device management

1. Device calls `POST /api/connect/register` with a registration token
2. Admin approves the device in the UI
3. Device opens a WebSocket connection once approved (`websocket/Connections.js`)
4. Configuration is pushed/synced via the device job queue

Supported: flexiEdge routers v6.4.32+, x86-64/ARM64, multi-WAN, IPSec/IKEv2 tunnels.

## Troubleshooting

**Device won't connect**: confirm it's approved in the UI, port 3443 reachable, check `systemctl status fwagent` on the device.

**API/CORS errors in the browser**: check the injected `baseUrl` (browser console), `corsWhiteList` in `configs.js`, DNS, and the TLS cert (`openssl s_client -connect manage.miwide.com:3443`).

**Mongo errors**: confirm replica-set health with `rs.status()` on any node; connection strings live in `backend/configs.js`/`.env`.

**A route "does nothing"**: check whether it's actually mounted in `expressserver.js` — see [Architecture](#architecture) above. `require()`-ing a route file successfully doesn't mean it's live.

**Startup errors**: `node --version` (need v20+), `tail -f logs/app.log`, `pm2 logs fleximanage-backend`.

## Recent engineering notes

A round of bug-hunting/hardening landed 2026-08, worth knowing about when working nearby:

- **MongoDB driver v4 error-name drift**: `err.name === 'MongoError'` checks (used for duplicate-key detection and error branching in ~10 files) silently stopped matching after the driver upgrade to v4+ (`MongoServerError` now). Fixed to match on `err.code === 11000` / `err.name.startsWith('Mongo')`, which is version-independent.
- **Crashes for accounts with no default organization**: `routes/tunnels.js`, `routes/deviceStats.js`, `routes/organizations.js` dereferenced `req.user.defaultOrg._id` unconditionally, crashing for any freshly-registered account (which has no org yet). Now return a clean 400. Frontend (`Tunnels.js`, `NotificationsSettings.js`) updated to surface/handle this gracefully instead of a raw stack-trace-shaped error.
- **`/api/organizations/summary` traffic stats always read zero**: called `.toArray()` on a Mongoose `Aggregate` (which has no such method — that's a raw-driver Cursor thing), silently swallowed by a surrounding try/catch.
- **Startup config log leaked secrets**: full resolved config (including `mailerPassword`, JWT secret keys, DB connection strings with embedded credentials) was logged verbatim on every boot. Now redacted (`configs.js#redactConfigForLogging`).
- Removed six unmounted, fully-superseded legacy route files (`routes/{devices,notifications,tokens,members,deviceQueue,wrapper}.js`) — see [Architecture](#architecture).
- Added Gmail/WeCom SMTP provider support and reworked the email-verification UX (resend link, correct "already verified" handling) — see [Mail configuration](#mail-configuration).

## Documentation

- [flexiManage API docs](https://docs.flexiwan.com/management/management-login.html)
- [flexiEdge docs](https://docs.flexiwan.com/)
- [Community forum](https://community.flexiwan.com/)

## Versioning

Uses [SemVer](https://semver.org/).

## License

GNU AGPLv3 — see [LICENSE](LICENSE).

## Other open source used

Listed in [OPENSOURCE.md](OPENSOURCE.md).
