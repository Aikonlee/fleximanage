# Security and maintenance status

## Validation baseline (2026-11-13)

Dependency audits are snapshots of the npm advisory database and must be rerun
with `npm ci` and `npm audit` when dependencies change.

| Scope | Before | After |
| --- | --- | --- |
| Frontend, all dependencies | 72 (3 critical, 38 high) | 0 |
| Backend, all dependencies | 113 (10 critical, 37 high) | 6 low |
| Backend, production dependencies | — | 0 |

Production dependencies now audit clean after explicit compatible UUID, extend,
Pug and yargs overrides. VPN certificate issuance, Redis queue processing and
queue template loading were validated. Backend CI rejects moderate or higher
production advisories and incomplete audits; the frontend uses the same
severity threshold. Full backend audit retains six low development advisories.

## Checks performed

- Frontend lint with zero warnings, 18 unit/component tests and production build.
- 13 focused backend CAPTCHA, path-policy and CIDR regression tests.
- 10 browser/API workflow groups using an isolated tenant and offline device:
  device edits, organization isolation, viewer restrictions, QoS/firewall/path
  policy CRUD, cross-organization label rejection and logout.
- 7 authentication/security groups: fail-closed CAPTCHA, unavailable challenge,
  authenticator enrollment, interim-token isolation, OTP login, atomic recovery
  consumption and per-user throttling despite changed forwarded headers.
- VPN CA/server/client certificate issuance and verification; actual Redis queue
  create/process/complete/remove using isolated queue names.

The model-validation suite now passes 402 tests across 13 suites with Promise
validation, modern ObjectId constructors and structured cast-error assertions.
Its setup uses disconnected Mongoose connections and native ESM loading; it
never opens a live database connection. CI runs this suite in addition to the
13 focused regressions. Other historical backend suites are not claimed as
passing and remain a separate migration task. No physical flexiEdge
is connected: device command acknowledgement, policy delivery, tunnels and
packet forwarding require a later hardware integration test.

## Operational requirements

Use Node >=22.22.2 <23. Keep `.env`, TLS keys, fixture manifests, authenticator
secrets and recovery codes outside Git and public directories. Production
requires real `CAPTCHA_KEY` and `CAPTCHA_SITE_KEY`; test Turnstile keys belong
only on an isolated backend. Production cannot disable CAPTCHA. MFA interim
JWTs never authorize regular API access. Recovery codes are consumed atomically.
The embedded database web console is retired (`/admindb` returns 410).

MFA enrollment currently provides an authenticator URI and manual setup key;
recovery codes are displayed only when generated. Keep them in a secure location.

Historical device validation, membership and Redis queue tests run with
`npm run test:historical` (137 tests). They use modern ObjectId construction and
Promise completion, with application subnets mocked in the validation fixture.
Queue tests use a unique prefix in a dedicated Redis database and close all
clients, removing only their own keys. CI supplies a disposable Redis service.
Physical policy delivery and forwarding remain unverified: no flexiEdge is
currently connected.

## Tunnel deletion semantics and maintenance purge

Tunnel deletion in flexiManage is intentionally a **soft delete**:

- UI/API deletion (`backend/deviceLogic/tunnels.js` `delTunnel` and
  `backend/services/TunnelsService.js` `tunnelsDELETE`) sets `isActive: false`,
  clears `tunnelKeys: null` on device removal, and retains the document in the
  `tunnels` collection.
- Tunnel creation (`backend/deviceLogic/tunnels.js` `generateTunnelPromise`)
  first claims an existing inactive record (`{ isActive: false, org }`) to reuse
  its unique `num` before allocating a new counter value from `tunnelids`
  (`backend/models/tunnelids.js`, bounded by `MAX_TUNNELS_PER_ORG`). Retaining
  inactive records prevents premature exhaustion of per-organization tunnel
  numbers; runtime API/UI behavior remains soft-delete and `tunnelids` counters
  must never be modified during cleanup.
- **No automatic purge exists.** Inactive records stay in MongoDB until reused
  or removed by an authorized manual maintenance action.
- **Historical cleanup note:** One previously authorized maintenance purge
  physically removed exactly seven inactive tunnel records after a full DB
  backup. That cleanup was a one-off historical event; subsequent UI/API
  deletions continue to soft-delete.
- **Prerequisites for any future physical purge:** Any physical removal of
  inactive tunnel documents requires explicit change-control authorization, a
  verified full MongoDB backup, and an isolated restore rehearsal prior to
  modifying production data.
- **Safe purge utility:** `backend/tools/purge-inactive-tunnels.js` is
  read-only by default (prints aggregate candidate counts only, never document
  contents), excludes recent soft deletes by default (`--older-than-days=30`),
  resolves `MONGO_URL` only from the service environment config, filters
  strictly on `{ isActive: false, updatedAt: { $lte: cutoff } }` in `tunnels`
  without touching active records or `tunnelids`, and requires both `--apply`
  and an exact matching `--confirm=<expected-count>` before deleting.
