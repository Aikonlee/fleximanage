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

1. **openapi-generated services** (`backend/services/*Service.js`), wired up via `backend/api/openapi.yaml` (~14.7k lines) and `utils/openapiRouter.js`. This is where almost all resource CRUD actually lives today: devices, organizations, tunnels, notifications, tokens, members, policies, etc. These consistently scope queries through `utils/membershipUtils.js#getAccessTokenOrgList()`, which safely returns `[]` for a user with no default organization instead of crashing.
2. **Classic hand-written Express routers** (`backend/routes/*.js`), registered directly in `expressserver.js`. Only a handful are actually mounted today: `users`, `public`, `connect`, `devicestats`, `portals`, `interfaces-routing`, `organizations`, `admin`, `tickets`, `tunnels`. Several others (`devices.js`, `notifications.js`, `tokens.js`, `members.js`, `deviceQueue.js`, `wrapper.js`) were removed in 2026-08 — they'd been disabled since a mongodb-driver-v4 load error and were fully superseded by their openapi equivalents by the time they were cleaned up. **Before editing anything under `routes/`, check `expressserver.js`'s `app.use()` calls to confirm it's actually mounted** — editing an unmounted file is a no-op.

**Mount order decides who answers.** The classic routers are mounted *before* `openapiRouter`, so where both define the same path the classic one wins and the openapi service is dead code for that path. Known case: `GET /api/organizations/summary` (the Home page "Network Status") is served by `routes/organizations.js`, **not** `OrganizationsService.organizationsSummaryGET`. When a fix "doesn't take", grep the log message you expect and confirm which handler actually logged it.

Background workers (periodic jobs, device job queue, WebSocket device connections) live under `periodic/`, `deviceLogic/`, and `websocket/`.

### Frontend conventions

- **Page chrome**: every page starts with `components/common/PageHeader` — breadcrumb (`Home » Section » Page`) plus a bold title and an optional actions slot. Don't hand-roll breadcrumbs/`<h1>`s; page-local CSS targeting `h1`/`.breadcrumb` will override the shared style.
- **Tables**: `styles/unified-table.css` (`table unified-table`).
- **Permissions**: the UI decodes the JWT (`auth/permissions.js`). `perms` bitmasks drive the sidebar (`permKey` on menu items in `components/Sidebar.js`) and route guards (`Guard permKey=...` in `App.js`). The JWT also carries `admin` (system administrator); menu groups marked `adminOnly` and admin routes are shown only when it's true. A user must log in again after their `admin` flag changes.
- **Errors**: surface the backend's `error` message to the user (alert/inline). Never swallow a failed request in `console.error` only — that's how a rejected device delete once looked like a success.

## Verified tech stack (this deployment)

| Component | Version |
|---|---|
| Node.js | v20.11.1 (nvm, `/root/.nvm/versions/node/v20.11.1`) |
| Backend (`flexiwansite`) | v6.5.1 |
| MongoDB | 8.0.15, 3-node replica set (ports 27017/27018/27019, systemd `mongod-2701x`) — transactions require the replica set |
| Redis | 7.0.15 (127.0.0.1:6379, device job queue via kue, prefix `deviceq`) |
| Process manager | systemd `fleximanage.service` → PM2 app `fleximanage-backend` (`pm2 start bin/www`) |
| HTTPS | Served directly by Node on :3443 (HTTP on :3000); nginx is not in the request path |
| Frontend | React 18, react-router 6, Bootstrap 5 (`react-scripts build`) |
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

# Backend (production) — this deployment runs it under systemd + PM2
systemctl status fleximanage           # unit wraps: pm2 start bin/www --name fleximanage-backend
pm2 restart fleximanage-backend        # after any backend change
pm2 logs fleximanage-backend           # logs: ~/.pm2/logs/fleximanage-backend-{out,error}.log

# Frontend build (backend serves frontend/build statically — rebuild after any frontend change,
# no backend restart needed)
cd frontend && npm run build
```

`backend/ecosystem.config.js` exists as an alternative PM2 definition, but the running service does **not** use it, so its `logs/pm2-*.log` paths are stale.

Backend config is resolved by `backend/configs.js`: it merges an environment-specific block from `configEnv` with anything set in `backend/.env` (loaded via `dotenv`). Any config key can be overridden by an env var using its UPPER_SNAKE_CASE form (e.g. `mailerHost` ↔ `MAILER_HOST`). Startup logs the fully-resolved config with secrets redacted (`redactConfigForLogging()`).

TLS: `HTTPS_CERT`/`HTTPS_CERT_KEY` point at `backend/bin/cert.manage.miwide.com/`, which holds symlinks to the Let's Encrypt live certs. `backend/bin/renew-cert.sh` (root crontab, monthly) refreshes the symlinks.

### Admin users

System administrators are users with `admin: true` in the `users` collection (list them with `db.users.find({admin: true}, {username: 1})` in `mongosh`). Besides normal access to their own account, they get **Admin › All Organizations** in the UI (`/admin/organizations`), backed by `GET /api/admin/organizations` (`auth.verifyAdmin`): every account, its users and organizations, and the devices installed in each organization (state, versions, IPs, tunnel counts). Organizations or devices whose parent was deleted are listed under "Unknown (Deleted)".

```bash
# reset the admin@flexiwan.com password (also ensures it is verified and admin) — from the repo root
node scripts/reset-admin-password.js '<new-password>'
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

**Deleting a device** (`DELETE /api/devices/:id`, or bulk `DELETE /api/devices`) is refused with 400 while the device has active tunnels or VRRP — delete those first; the Devices page shows the reason. On success `DevicesService.cleanupDeletedDevicesData()` also removes the device's notifications, analytics stats and redis job-queue entries.

## Data model notes

Three MongoDB databases on the same replica set: `flexiwan` (main), `flexiwanAnalytics`, `flexibilling` (plus `flexivpn`). They're separate Mongoose connections, so **a main-DB transaction session can't be used with analytics models** — do analytics writes outside the transaction.

- **Tunnels are soft-deleted** (`isActive: false`) and the inactive docs are reused as a pool of tunnel numbers (`deviceLogic/tunnels.js`; `tunnelids.nextAvailID` only ever grows, capped per org). Don't purge them, and always filter `isActive: true` when counting or listing tunnels.
- **Confusing name**: `flexiwan.notifications` is the per-org notification *settings* (`models/notificationsConf.js`); the actual alerts live in `flexiwanAnalytics.notifications` (`models/notifications.js`). Same for stats: `flexiwanAnalytics.devicestats` is live, `flexiwan.deviceStats` is legacy.
- The device job queue lives in Redis (kue, keys `deviceq:*`); jobs are keyed by the device `machineId`.

## Connecting a test flexiEdge device

To register a real (or virtual) flexiEdge router against this deployment for testing:

1. **Download the flexiEdge ISO** (v6.4.32):
   [flexiEdge.focal.6.4.32.iso.zip](https://imager.flexiwan.com/main/latest/flexiEdge.focal.6.4.32.iso.zip)
   Install it on the target machine/VM as you would any bootable ISO.

2. **Point the agent at this server** — edit the agent config on the device:
   ```bash
   vi /etc/flexiwan/agent/fwagent_config.yaml
   ```
   ```yaml
   agent:
     server: https://manage.miwide.com:3443
     bypass_certificate: true
   ```
   `bypass_certificate: true` skips TLS certificate validation — only use this for testing against a self-signed/internal cert, never in production.

3. Restart the agent (`systemctl restart fwagent`) and register the device from the UI/API (see [Device management](#device-management) above). It will appear as pending until an admin approves it.

## Troubleshooting

**Device won't connect**: confirm it's approved in the UI, port 3443 reachable, check `systemctl status fwagent` on the device.

**API/CORS errors in the browser**: check the injected `baseUrl` (browser console), `corsWhiteList` in `configs.js`, DNS, and the TLS cert (`openssl s_client -connect manage.miwide.com:3443`).

**Mongo errors**: confirm replica-set health with `rs.status()` on any node; connection strings live in `backend/configs.js`/`.env`.

**A route "does nothing"**: check whether it's actually mounted in `expressserver.js` — see [Architecture](#architecture) above. `require()`-ing a route file successfully doesn't mean it's live.

**Startup errors**: `node --version` (need v20+), `pm2 logs fleximanage-backend` (or `~/.pm2/logs/fleximanage-backend-*.log`). Frontend runtime errors reported by browsers go to `logs/client-errors.log`.

**Dashboard numbers look wrong**: check which handler serves the endpoint (see the mount-order note in [Architecture](#architecture)) and whether it counts soft-deleted tunnels (see [Data model notes](#data-model-notes)).

## Recent engineering notes

2026-11:

- **Device delete looked successful but wasn't**: the Devices page swallowed the backend's 400 ("All device tunnels must be deleted before deleting a device"). Failed actions are now reported per device.
- **Device delete left data behind**: notifications, analytics stats and redis queue entries are now removed with the device (see [Device management](#device-management)). Leftovers from earlier deletes were cleaned up once.
- **Home "Network Status" counted deleted tunnels** as "Not Connected": `routes/organizations.js` `/summary` now counts only active tunnels and returns `connected / notConnected / pending / unknown`.
- **Admin overview**: new `GET /api/admin/organizations` and the **Admin › All Organizations** page (see [Admin users](#admin-users)).
- User profile page moved to the shared `PageHeader`; Devices page CSV export; legacy Account/account-Organizations pages retired (routes redirect).

2026-08 — a round of bug-hunting/hardening, worth knowing about when working nearby:

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
