/* Opt-in real API/browser checks against an isolated fixture tenant. */
const fs = require('fs');
const path = require('path');
const https = require('https');
const assert = require('assert/strict');
const playwrightModule = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium, request } = require(playwrightModule);
const { expect } = require(playwrightModule + '/test');
const express = require(path.join(process.env.FLEXIMANAGE_BACKEND, 'node_modules/express'));
const stateDir = process.env.E2E_STATE_DIR || path.resolve(process.env.FLEXIMANAGE_BACKEND, '../tmp/frontend-e2e-state');
const state = JSON.parse(fs.readFileSync(path.join(stateDir, 'fixture-state.json')));
const backendURL = process.env.E2E_API_URL || 'https://127.0.0.1:3443';
const frontendURL = () => process.env.E2E_FRONTEND_URL || `http://127.0.0.1:${server.address().port}`;
const checks = [];
const record = name => { checks.push(name); console.log(`PASS ${name}`); };
let api, browser, server;
async function login(role) {
  const user = state.users.find(u => u.role === role);
  const response = await api.post('/api/users/login', { data: { username: user.username, password: user.password, captcha: process.env.E2E_CAPTCHA_TOKEN } });
  assert.equal(response.status(), 200, `login ${role}`);
  const token = response.headers()['refresh-jwt']; assert.ok(token, 'Login must return a session JWT');
  return token;
}
async function call(token, method, url, data, status = 200) {
  const response = await api.fetch('/api' + url, { method, headers: { Authorization: `Bearer ${token}` }, data });
  assert.equal(response.status(), status, `${method} ${url}: ${response.status()} ${status === response.status() ? '' : await response.text()}`);
  return response;
}
async function open(token, route) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await context.addInitScript(value => {
    if (!sessionStorage.getItem('e2e-seeded')) {
      localStorage.setItem('token', value); sessionStorage.setItem('e2e-seeded', '1');
    }
  }, token);
  const page = await context.newPage();
  page.on('pageerror', error => console.log('BROWSER ERROR ' + error.message));
  page.on('dialog', dialog => dialog.accept().catch(() => {}));
  await page.goto(`${frontendURL()}${route}`);
  return { page, context };
}
async function main() {
  api = await request.newContext({ baseURL: backendURL, ignoreHTTPSErrors: true });
  const app = express();
  // Loopback preview only; the production backend and authorization code are used unchanged.
  app.use('/api', (req, res) => {
    const target = new URL(req.originalUrl, backendURL);
    const headers = { ...req.headers, host: target.host }; delete headers.origin; delete headers.referer;
    const upstream = https.request(target, { method: req.method, headers, rejectUnauthorized: false }, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    upstream.on('error', error => { res.status(502).end(error.message); }); req.pipe(upstream);
  });
  const build = path.resolve(__dirname, '../build');
  app.use(express.static(build)); app.get('*', (req, res) => res.sendFile(path.join(build, 'index.html')));
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const owner = await login('owner'); const viewer = await login('viewer'); let mixed = await login('mixed');
  const resetOrg = await call(mixed, 'POST', '/organizations/select', { org: state.orgs[0].id });
  mixed = resetOrg.headers()['refresh-jwt'];
  record('real API password login for owner, mixed role and viewer');
  const visible = await (await call(owner, 'GET', '/devices?response=detailed')).json();
  assert.ok(visible.some(d => d._id === state.device.id));
  await call(viewer, 'PUT', `/devices/${state.device.id}`, { name: 'Forbidden rename' }, 403);
  await call(viewer, 'DELETE', `/devices/${state.device.id}`, undefined, 403);
  await call(viewer, 'POST', `/devices/${state.device.id}/apply`, { method: 'start', entity: 'agent', message: 'start-router' }, 403);
  record('device listing works and backend denies viewer edit, delete and start');

  const first = await open(owner, `/devices/${state.device.id}`);
  await first.page.getByRole('button', { name: 'Update Device', exact: true }).waitFor();
  const updated = state.device.name + ' Updated';
  await first.page.locator('input.input-template').first().fill(updated);
  const saved = first.page.waitForResponse(r => r.url().includes(`/api/devices/${state.device.id}`) && r.request().method() === 'PUT');
  await first.page.getByRole('button', { name: 'Update Device', exact: true }).click();
  const savedResponse = await saved;
  assert.ok([200, 202].includes(savedResponse.status()), `device metadata update ${savedResponse.status()}: ${await savedResponse.text()}`);
  const detail = await (await call(owner, 'GET', `/devices/${state.device.id}`)).json();
  assert.equal((Array.isArray(detail) ? detail[0] : detail).name, updated);
  record('browser device metadata update persists through real API');
  await first.context.close();

  const restricted = await open(viewer, `/devices/${state.device.id}`);
  await expect(restricted.page.getByRole('button', { name: 'Update Device', exact: true })).toBeDisabled();
  await restricted.page.goto(`${frontendURL()}/qos/new`);
  await expect(restricted.page.getByText(/permission|forbidden|access denied/i).first()).toBeVisible();
  await restricted.context.close();
  record('viewer sees disabled device actions and cannot open policy creation route');

  const switching = await open(mixed, '/organizations');
  const row = switching.page.getByRole('row').filter({ hasText: state.orgs[1].name });
  await row.getByTitle('Set as Current Organization').click();
  await expect(switching.page.locator('.sidebar-org-name')).toHaveText(state.orgs[1].name);
  await expect(switching.page.locator('.user-dropdown-org')).toHaveText(state.orgs[1].name);
  await switching.page.locator('.sidebar-nav').getByRole('button', { name: 'Traffic Optimization' }).click();
  await switching.page.locator('.sidebar-nav').getByRole('link', { name: 'Quality of Service' }).click();
  await expect(switching.page.getByRole('button', { name: /new/i })).toBeDisabled();
  record('organization selection refreshes sidebar and changes policy action permissions without reload');
  await switching.context.close();

  // Browser create -> read -> update -> delete with a policy never installed on a live device.
  const policy = await open(owner, '/qos/new');
  const policyName = 'E2E QoS ' + Date.now();
  await policy.page.getByRole('textbox').first().fill(policyName);
  const created = policy.page.waitForResponse(r => r.url().endsWith('/api/qosPolicies') && r.request().method() === 'POST');
  await policy.page.getByRole('button', { name: 'Save Policy' }).click();
  const createResponse = await created;
  assert.equal(createResponse.status(), 201, `create QoS: ${await createResponse.text()}`);
  const createdPolicy = await createResponse.json();
  await policy.page.waitForURL('**/qos');
  await policy.page.getByRole('button', { name: /New QoS Policy/ }).waitFor();
  const policyRow = policy.page.getByRole('row').filter({ hasText: policyName });
  await policyRow.getByTitle('Edit').click();
  await expect(policy.page.getByRole('textbox').first()).toHaveValue(policyName);
  const editedName = policyName + ' Updated'; await policy.page.getByRole('textbox').first().fill(editedName);
  const edited = policy.page.waitForResponse(r => r.url().includes(`/api/qosPolicies/${createdPolicy._id}`) && r.request().method() === 'PUT');
  await policy.page.getByRole('button', { name: 'Save Policy' }).click(); assert.equal((await edited).status(), 200);
  const readPolicy = await (await call(owner, 'GET', `/qosPolicies/${createdPolicy._id}`)).json(); assert.equal(readPolicy.name, editedName);
  await call(viewer, 'POST', '/qosPolicies', readPolicy, 403);
  await call(viewer, 'PUT', `/qosPolicies/${createdPolicy._id}`, readPolicy, 403);
  await call(viewer, 'DELETE', `/qosPolicies/${createdPolicy._id}`, undefined, 403);
  const deleted = policy.page.waitForResponse(r => r.url().includes(`/api/qosPolicies/${createdPolicy._id}`) && r.request().method() === 'DELETE');
  await policy.page.getByRole('row').filter({ hasText: editedName }).getByTitle('Delete').click(); assert.equal((await deleted).status(), 204);
  record('QoS browser create/read/update/delete and server-side viewer write rejection');
  await policy.page.goto(`${frontendURL()}/firewall-policies/new`);
  const firewallName = 'E2E Firewall ' + Date.now();
  await policy.page.getByRole('textbox').first().fill(firewallName);
  await policy.page.getByRole('button', { name: 'Add Rule', exact: true }).first().click();
  await policy.page.getByRole('dialog').getByRole('textbox').nth(3).fill('203.0.113.0/24');
  await policy.page.getByRole('button', { name: 'Save Rule', exact: true }).click();
  const firewallCreated = policy.page.waitForResponse(r => r.url().endsWith('/api/firewallpolicies') && r.request().method() === 'POST');
  await policy.page.getByRole('button', { name: 'Save Policy', exact: true }).click();
  const firewallResponse = await firewallCreated;
  assert.equal(firewallResponse.status(), 201, `create firewall: ${await firewallResponse.text()}`);
  const firewall = await firewallResponse.json();
  await policy.page.waitForURL('**/firewall-policies');
  await policy.page.getByRole('row').filter({ hasText: firewallName }).getByTitle('Edit').click();
  await expect(policy.page.getByRole('textbox').first()).toHaveValue(firewallName);
  const firewallUpdatedName = firewallName + ' Updated';
  await policy.page.getByRole('textbox').first().fill(firewallUpdatedName);
  const firewallSaved = policy.page.waitForResponse(r => r.url().includes(`/api/firewallpolicies/${firewall._id}`) && r.request().method() === 'PUT');
  await policy.page.getByRole('button', { name: 'Save Policy', exact: true }).click();
  assert.equal((await firewallSaved).status(), 200);
  const firewallRead = await (await call(owner, 'GET', `/firewallpolicies/${firewall._id}`)).json();
  assert.equal(firewallRead.name, firewallUpdatedName);
  assert.deepEqual(firewallRead.rules[0].classification.destination.ipProtoPort.protocols, ['tcp', 'udp', 'icmp']);
  await call(viewer, 'POST', '/firewallpolicies', firewallRead, 403);
  await call(viewer, 'PUT', `/firewallpolicies/${firewall._id}`, firewallRead, 403);
  await call(viewer, 'DELETE', `/firewallpolicies/${firewall._id}`, undefined, 403);
  const firewallDeleted = policy.page.waitForResponse(r => r.url().includes(`/api/firewallpolicies/${firewall._id}`) && r.request().method() === 'DELETE');
  await policy.page.getByRole('row').filter({ hasText: firewallUpdatedName }).getByTitle('Delete').click();
  assert.equal((await firewallDeleted).status(), 204);
  record('firewall browser create/read/update/delete and server-side viewer write rejection');
  const pathLabel = await (await call(owner, 'POST', '/pathlabels', { name: 'E2E WAN', color: '#00aa00', type: 'DIA', description: 'Test path' }, 201)).json();
  await policy.page.goto(`${frontendURL()}/path-selection-policy/new`);
  const multilinkName = 'E2E Path ' + Date.now();
  await policy.page.getByRole('textbox').first().fill(multilinkName);
  await policy.page.getByRole('button', { name: 'Add Rule', exact: true }).click();
  const ruleDialog = policy.page.getByRole('dialog');
  await ruleDialog.getByRole('textbox').first().fill('Prefix rule');
  await ruleDialog.getByRole('textbox').nth(1).fill('192.0.2.0/24');
  await ruleDialog.locator('select[multiple]').selectOption(pathLabel._id);
  await ruleDialog.getByRole('button', { name: 'Save Rule', exact: true }).click();
  const multilinkCreated = policy.page.waitForResponse(r => r.url().endsWith('/api/mlpolicies') && r.request().method() === 'POST');
  await policy.page.getByRole('button', { name: 'Save Policy', exact: true }).click();
  const multilinkResponse = await multilinkCreated;
  assert.equal(multilinkResponse.status(), 201, `create path policy: ${await multilinkResponse.text()}`);
  const multilink = await multilinkResponse.json();
  await policy.page.waitForURL('**/path-selection-policy');
  await policy.page.getByRole('row').filter({ hasText: multilinkName }).getByTitle('Edit').click();
  await expect(policy.page.getByRole('textbox').first()).toHaveValue(multilinkName);
  await policy.page.getByRole('textbox').nth(1).fill('Edited same-name policy');
  const multilinkSaved = policy.page.waitForResponse(r => r.url().includes(`/api/mlpolicies/${multilink._id}`) && r.request().method() === 'PUT');
  await policy.page.getByRole('button', { name: 'Save Policy', exact: true }).click();
  assert.equal((await multilinkSaved).status(), 200);
  const savedMultilink = await (await call(owner, 'GET', `/mlpolicies/${multilink._id}`)).json();
  assert.equal(savedMultilink.description, 'Edited same-name policy');
  await call(viewer, 'PUT', `/mlpolicies/${multilink._id}`, savedMultilink, 403);
  const foreign = JSON.parse(JSON.stringify(savedMultilink)); delete foreign._id; foreign.name = 'E2E foreign rejected';
  foreign.rules[0].action.links[0].pathlabels = [state.foreignLabel.id];
  await call(owner, 'POST', '/mlpolicies', foreign, 400);
  const multilinkDeleted = policy.page.waitForResponse(r => r.url().includes(`/api/mlpolicies/${multilink._id}`) && r.request().method() === 'DELETE');
  await policy.page.getByRole('row').filter({ hasText: multilinkName }).getByTitle('Delete').click();
  assert.equal((await multilinkDeleted).status(), 204);
  await call(owner, 'DELETE', `/pathlabels/${pathLabel._id}`, undefined, 204);
  record('path selection browser create/edit/delete, populated label roundtrip and cross-org label rejection');
  await policy.page.locator('.header-logout-btn').click();
  await expect(policy.page.getByRole('button', { name: /sign in|login|log in/i }).first()).toBeVisible();
  assert.equal(await policy.page.evaluate(() => localStorage.getItem('token')), null);
  record('logout clears session and returns to login');
  await policy.context.close();
  await call(owner, 'DELETE', `/devices/${state.device.id}`, undefined, 204);
  record('isolated offline device deletion succeeds');
}
main().then(() => {
  fs.writeFileSync(path.join(stateDir, 'results.json'), JSON.stringify({ passed: checks, deviceDataPlane: 'not exercised: offline fixture, no real agent' }, null, 2));
}).catch(async error => {
  console.error(error.message);
  if (browser) for (const context of browser.contexts()) for (const page of context.pages()) {
    console.log('Failed page: ' + page.url());
    console.log((await page.locator('body').innerText().catch(() => '')).slice(-3000));
  }
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close(); if (api) await api.dispose(); if (server) await new Promise(resolve => server.close(resolve));
});
