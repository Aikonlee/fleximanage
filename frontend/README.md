# flexiManage frontend

React 18 management UI for the flexiManage REST API. Uses Vite, React Router,
Bootstrap and Leaflet. Use Node 22 (`nvm use` from the repository root).

```sh
npm ci
npm start        # loopback development server on port 3001
npm run lint -- --max-warnings=0
npm test         # Vitest regression suite
npm run build    # production files in build/, served by the backend
```

The API defaults to same-origin `/api`. For development, Vite proxies `/api` and
`/ws` to `https://localhost:3443`; set `REACT_APP_API_TARGET` to change that proxy.
`REACT_APP_API_URL` or `VITE_API_URL` overrides the browser API base URL at build
time. No server secrets belong in frontend environment variables.

Authentication state is maintained by `src/auth/AuthContext.jsx` and
`src/auth/session.js`. Use `setSessionToken` / `clearSession` for all session
writes and `useAuth()` for permissions and current organization. Login-process
MFA tokens stay in component memory and never authenticate the app.

`components/auth/TurnstileChallenge.jsx` obtains CAPTCHA policy from the backend.
When verification is enabled, a missing widget/challenge never enables submit.
`MfaChallenge.jsx` handles authenticator codes, recovery codes and first setup;
`MfaSettings.jsx` exposes setup and recovery-code generation on the user profile.

Permissions use the backend's GET/POST/PUT/DELETE bit masks (1/2/4/8); PATCH is
mapped to POST by the backend. Use `PermissionButton` for write actions. Cancel,
Back and other local navigation controls must remain available without write
permission. Backend authorization remains authoritative.

`components/device/` contains the device location, status/troubleshooting panels
and configuration dialogs. The device page owns loading, editable state and
commands; the extracted views receive explicit state and action props.

See [e2e/README.md](e2e/README.md) for opt-in browser/API checks. Physical device
configuration delivery and forwarding require an online flexiEdge test router.
