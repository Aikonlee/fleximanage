# Frontend regression and integration checks

Run the regular checks with Node 20:

```sh
cd frontend
npm ci
CI=true npm test -- --watchAll=false --runInBand
CI=true npm run build
```

The opt-in integration suite uses a running backend and MongoDB. It creates its
own account, two organizations, three password-authenticated users and an
approved **offline** device fixture. It never selects an existing tenant or
sends commands to a physical router. Policies created by the suite are not
installed on a device.

Run on the backend host, with Playwright and its Chromium browser installed:

```sh
export FLEXIMANAGE_BACKEND=/root/fleximanage/backend
export E2E_STATE_DIR=/root/fleximanage/tmp/frontend-e2e-state
# Optional when Playwright is installed outside this package:
# export PLAYWRIGHT_MODULE=/absolute/path/to/node_modules/playwright
mkdir -p "$E2E_STATE_DIR"
chmod 700 "$E2E_STATE_DIR"
node frontend/e2e/fixtures.cjs
node frontend/e2e/run.cjs
node frontend/e2e/fixtures.cjs cleanup
```

The fixture manifest contains temporary passwords; keep it outside public and
version-controlled directories. Cleanup is required even after a failed test.
The cleanup command scopes deletion to IDs created by the fixture manifest.
Backend environment settings are loaded from `backend/.env`, as in `bin/www`.

The browser suite serves the compiled frontend through a temporary loopback
preview and proxies API requests to the real backend (`E2E_API_URL`, default
`https://127.0.0.1:3443`). It checks real API password login, device metadata
updates, viewer restrictions, organization switching, QoS/firewall policy CRUD and
logout. `results.json` records successful checks without tokens or passwords.

Configuration delivery, job acknowledgement and packet forwarding require an
online flexiEdge test router and are not covered by the offline fixture.

Set `E2E_FRONTEND_URL=https://localhost:3443` to replay the browser checks against
the deployed frontend instead of the temporary preview.
