# flexiManage Development Baseline (6.5.x)

## Target Baseline & Version Alignment

| Component | Baseline / State | Notes |
| --- | --- | --- |
| Target platform baseline | **flexiWAN 6.5.x** | Active target release line for manage + edge alignment |
| Primary flexiEdge agent tag | **`v6.5.19`** | Pinned primary `flexiagent` target tag |
| Current production flexiManage | Commit **`9a1125a`** (`backend/package.json` version `6.5.1`) | Production baseline; no application behavior changes in P0 |

### Documentation Drift Notice

The official online flexiWAN documentation index still lists **`6.4.1` / flexiManage `6.4.30` / flexiEdge `6.4.32`**. Because upstream public documentation lags behind the 6.5.x release tags we operate against, we must publish and maintain our own internal **6.5.x compatibility matrix** (tracking flexiManage commits, `flexiagent` tags, `flexiRouterVPP` / `flexiRouterSB` / `flexiRouter` / `flexiWANCharts` pins, and tested upgrade paths) rather than relying on the 6.4.x online index.

---

## Open-Registration Monitoring Runbook

Public self-registration is governed by `allowUsersRegistration` (`backend/configs.js`, default `true`) and protected by Cloudflare Turnstile (`captchaEnforced: true` in production, verified server-side via `backend/utils/recaptcha.js`) plus edge rate limiting (`deploy/fleximanage-nginx.conf`).

This runbook documents the exact endpoints, nginx rate-limit zones, application logs, and mail delivery failure signals already present in this repository. Do not modify `allowUsersRegistration` or runtime behavior during routine observation.

### 1. Signup Rate

Monitor both nginx access logs and structured Winston application logs (`logFilePath`: `/var/log/flexiwan/flexiwan.log` in production; `./logs/app.log` default):

- **Endpoint**: `POST /api/users/register` (`backend/routes/users.js`)
- **Nginx access log** (`/var/log/nginx/access.log`, `fleximanage_no_query` format in `deploy/fleximanage-nginx.conf`):
  - Track request volume and HTTP status distribution (`200`, `401`, `429`, `500`) for `POST /api/users/register`.
- **Application log events** (`event.message` in JSON log entries written by `backend/logging/logging.js`):
  - `"Create account request"` (`level: "info"`) — emitted on every `POST /api/users/register` attempt (PII masked).
  - `"Duplicate user registration normalized"` (`level: "warn"`, `params.route: "/register"`) — emitted when an existing email registers again (normalized to HTTP `200`).
  - `"Error in create account process"` (`level: "error"`) — emitted on registration transaction or downstream failures.

Example read-only check (last 1,000 nginx access log lines / current application log):

```bash
# Signup HTTP status breakdown in the last 1,000 nginx access log lines
tail -n 1000 /var/log/nginx/access.log | awk '$6 == "\"POST" && $7 ~ /^\/api\/users\/register\/?$/ { counts[$9]++ } END { for (s in counts) print s, counts[s] }'

# Application signup & duplicate counts
grep -c '"message":"Create account request"' /var/log/flexiwan/flexiwan.log || true
grep -c '"message":"Duplicate user registration normalized"' /var/log/flexiwan/flexiwan.log || true
```

### 2. Nginx 429 Rate-Limit Counts (`flexi_signup` / `flexi_verify`)

`deploy/fleximanage-nginx.conf` defines per-IP rate-limit zones with `limit_req_status 429`:

| Zone | Rate & Burst | Matched Method & URI |
| --- | --- | --- |
| `flexi_signup` | `5r/m`, `burst=5 nodelay` | `POST /api/users/register`, `POST /api/users/reverify-account` |
| `flexi_verify` | `10r/m`, `burst=10 nodelay` | `POST /api/users/verify-account` |
| `flexi_reset` | `6r/m`, `burst=6 nodelay` | `POST /api/users/reset-password` |

Watch both the nginx access log (HTTP `429` responses) and the nginx error log (`limiting requests, excess: ... by zone "..."`). Note that `deploy/fleximanage-nginx.conf` does not set an `error_log` directive, so the nginx error-log path is host-dependent (commonly `/var/log/nginx/error.log`; confirm on the host with `nginx -T 2>/dev/null | grep error_log`):

```bash
# HTTP 429 counts by registration / verification URI (last 1,000 nginx access log lines)
tail -n 1000 /var/log/nginx/access.log | awk '$9 == 429 && $7 ~ /^\/api\/users\/(register|reverify-account|verify-account|reset-password)\/?$/ { counts[$7]++ } END { for (u in counts) print u, counts[u] }'

# Rate-limit rejections by exact nginx zone name (set NGINX_ERROR_LOG to the host's error_log path)
NGINX_ERROR_LOG="${NGINX_ERROR_LOG:-/var/log/nginx/error.log}"
grep -E 'zone "(flexi_signup|flexi_verify|flexi_reset)"' "$NGINX_ERROR_LOG" | tail -n 50
```

### 3. Reverify & Password-Reset Mail Delivery / Queue

In `backend/routes/users.js`:

- `POST /api/users/reverify-account` and `POST /api/users/reset-password` (`type: "reset"`) enforce a per-account 60-second cooldown (`EMAIL_TOKEN_COOLDOWN_MS`) atomically in MongoDB and return a uniform HTTP `200` before detaching `mailer.sendMailHTML(...)` via `setImmediate()`.
- `backend/utils/mailer.js` sends directly through the configured `mailerProvider` (`MAILER_PROVIDER`: `'smtp'` via `nodemailer`, or `'wecom'` via the WeCom Exmail HTTP API). flexiManage does **not** use a separate Redis/Kue queue for outbound emails (Kue prefix `deviceq` is for device jobs only).

Watch the following exact application error messages in `/var/log/flexiwan/flexiwan.log`:

- `"Send mail error"` (`backend/utils/mailer.js`) — SMTP transport failure or WeCom API failure (`WeCom gettoken failed` / `WeCom compose_send failed`).
- `"Account Re-verification email delivery failed"` and `"Account Re-verification process failed"` (`backend/routes/users.js`).
- `"Account Password Reset email delivery failed"` and `"Account Password Reset process failed"` (`backend/routes/users.js`).

```bash
grep -E '"message":"(Send mail error|Account Re-verification email delivery failed|Account Re-verification process failed|Account Password Reset email delivery failed|Account Password Reset process failed)"' /var/log/flexiwan/flexiwan.log | tail -n 50
```

If `MAILER_PROVIDER=smtp` relays through a local MTA (such as Postfix), also inspect the host MTA queue (e.g., `postqueue -p` / `mailq`) for deferred or bounced verification/reset messages. If `MAILER_PROVIDER=wecom`, watch for repeated `WeCom gettoken failed` or `WeCom compose_send failed` errors indicating token/quota issues.

### 4. CAPTCHA Failure Logs

Cloudflare Turnstile verification (`backend/utils/recaptcha.js` calling `https://challenges.cloudflare.com/turnstile/v0/siteverify`) fails closed whenever `captchaEnforced` is active or `NODE_ENV`/`environment` is `production` (missing `CAPTCHA_KEY`, missing token, HTTP error, or network timeout all return `false`).

Note: `errLogger` in `backend/logging/request-logging.js` skips responses with `req.logSeverity < 500`, so HTTP `401` CAPTCHA rejections (`"Wrong Captcha"`) are **not** recorded by `errLogger`. Monitor CAPTCHA failures using the explicit re-verification warning in `backend/routes/users.js` together with nginx `401`/`429` status counts:

- **Re-verification CAPTCHA warning** (`backend/routes/users.js`, `POST /api/users/reverify-account`):
  - Application log (`/var/log/flexiwan/flexiwan.log`): `level: "warn"`, `event.message: "Re-verification captcha failed"`, `event.params.route: "/reverify-account"`.
- **Nginx `401` and `429` status counts** (`/var/log/nginx/access.log`):
  - Track `401` and `429` responses on `POST /api/users/reverify-account`, `POST /api/users/login` (`backend/authenticate.js` `verifyUserLocal`), and `POST /api/users/register` (`backend/routes/users.js`). Note that `401` on `/api/users/login` includes both CAPTCHA and credential failures, and `429` reflects edge rate-limiting (`flexi_signup` / `flexi_login`).

```bash
# Re-verification CAPTCHA warnings in application log
grep '"message":"Re-verification captcha failed"' /var/log/flexiwan/flexiwan.log | tail -n 50

# Nginx 401/429 status counts for reverify, login, and register (last 1,000 access log lines)
tail -n 1000 /var/log/nginx/access.log | awk '($9 == 401 || $9 == 429) && $6 == "\"POST" && $7 ~ /^\/api\/users\/(reverify-account|login|register)\/?$/ { counts[$7 " " $9]++ } END { for (k in counts) print k, counts[k] }' | sort
```

### 5. Triage & Escalation Signals

- **Sustained `flexi_signup` / `flexi_verify` 429 spikes** from single or rotating IPs alongside elevated `"Wrong Captcha"` (`401`) counts indicate automated abuse; verify Turnstile `CAPTCHA_KEY` / `CAPTCHA_SITE_KEY` health and review top source IPs in `/var/log/nginx/access.log`.
- **Sudden 100% CAPTCHA failure rate** across all clients on `/api/users/register`, `/api/users/reverify-account`, and `/api/users/login` indicates outbound connectivity loss to `challenges.cloudflare.com` or invalid Turnstile credentials (fail-closed behavior is working as intended).
- **Spikes in `"Send mail error"` or `"Account Re-verification email delivery failed"`** require checking SMTP relay reachability/auth or WeCom Exmail API status before users retry into the `flexi_signup` rate limit.
