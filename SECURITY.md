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
