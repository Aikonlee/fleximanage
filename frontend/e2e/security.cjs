/* Requires the isolated Turnstile-test-key deployment, never a production key. */
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { chromium, request } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { expect } = require((process.env.PLAYWRIGHT_MODULE || 'playwright') + '/test');
const twofactor = require(path.join(process.env.FLEXIMANAGE_BACKEND, 'node_modules/node-2fa'));
const root = process.env.E2E_STATE_DIR;
const state = JSON.parse(fs.readFileSync(path.join(root, 'fixture-state.json')));
const owner = state.users.find(user => user.role === 'owner');
const base = process.env.E2E_API_URL;
const credentials = { username: owner.username, password: owner.password, captcha: process.env.E2E_CAPTCHA_TOKEN };
const checks = []; let api, browser;
const record = name => { checks.push(name); console.log('PASS ' + name); };
const headers = token => ({ Authorization: `Bearer ${token}` });
async function attempt() {
  const response = await api.post('/api/users/login', { data: credentials });
  assert.equal(response.status(), 200);
  return response;
}
async function main() {
  api = await request.newContext({ baseURL: base, ignoreHTTPSErrors: true });
  const config = await (await api.get('/api/public/config')).json();
  assert.equal(config.captchaEnforced, true);
  assert.equal(config.captchaSiteKey, '1x00000000000000000000AA', 'Security suite requires an isolated test-key server');
  const rejected = await api.post('/api/users/login', { data: { username: owner.username, password: owner.password } });
  assert.equal(rejected.status(), 401);
  const registration = await api.post('/api/users/register', { data: { password: owner.password, email: 'captcha-rejected@example.invalid' } });
  assert.equal(registration.status(), 401);
  const original = (await attempt()).headers()['refresh-jwt']; assert.ok(original);
  record('server rejects missing CAPTCHA for login and registration; official dummy challenge succeeds');

  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const blocked = await browser.newContext({ ignoreHTTPSErrors: true });
  await blocked.route('https://challenges.cloudflare.com/**', route => route.abort());
  const blockedPage = await blocked.newPage(); await blockedPage.goto(base + '/login');
  await blockedPage.locator('input[name="username"]').fill(owner.username);
  await blockedPage.locator('input[name="password"]').fill(owner.password);
  await expect(blockedPage.getByRole('button', { name: 'Sign In', exact: true })).toBeDisabled();
  await blocked.close(); record('browser cannot submit when verification widget is unavailable');

  const setup = await browser.newContext({ ignoreHTTPSErrors: true });
  await setup.addInitScript(token => localStorage.setItem('token', token), original);
  const settings = await setup.newPage(); settings.on('dialog', dialog => dialog.accept().catch(() => {}));
  await settings.goto(base + '/users/profile');
  await settings.getByRole('button', { name: 'Set up two-factor authentication' }).click();
  const secret = await settings.getByRole('dialog').locator('code').textContent();
  const otp = () => twofactor.generateToken(secret).token;
  await settings.getByLabel('Authenticator code').fill(otp());
  await settings.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(settings.getByText('Authenticator verification is enabled.')).toBeVisible();
  const mfaSession = await settings.evaluate(() => localStorage.getItem('token'));
  const recoveryResponse = settings.waitForResponse(response => response.url().includes('/mfa/generateRecoveryCodes'));
  await settings.getByRole('button', { name: 'Generate recovery codes' }).click();
  const codes = (await (await recoveryResponse).json()).codes; assert.equal(codes.length, 10);
  const existing = await api.get('/api/users/mfa/generateRecoveryCodes', { headers: headers(mfaSession) });
  assert.deepEqual((await existing.json()).codes, []);
  await setup.close();
  assert.equal((await api.get('/api/devices', { headers: headers(original) })).status(), 401);
  record('browser authenticator enrollment and recovery generation work; old first-factor JWT is rejected');

  const partial = await attempt(); const partialToken = (await partial.json()).token;
  assert.ok(partialToken); assert.ok(!partial.headers()['refresh-jwt']);
  assert.equal((await api.get('/api/devices', { headers: headers(partialToken) })).status(), 401);
  record('password-only MFA login yields an interim token that cannot access devices');

  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto(base + '/login');
  await page.locator('input[name="username"]').fill(owner.username);
  await page.locator('input[name="password"]').fill(owner.password);
  await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeEnabled({ timeout: 30000 });
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  const input = page.getByLabel('Authenticator code'); await input.waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('token')), null);
  await input.fill(otp() === '000000' ? '111111' : '000000');
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.getByText('Invalid Code', { exact: true })).toBeVisible();
  await input.fill(otp()); await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.locator('.header-logout-btn')).toBeVisible();
  const verified = await page.evaluate(() => JSON.parse(atob(localStorage.getItem('token').split('.')[1])));
  assert.equal(verified.mfaVerified, true);
  await context.close(); record('real browser password -> rejected OTP -> valid OTP completes MFA sign-in');

  // Wait for the per-user 30-second verification window used by the preceding UI checks.
  await new Promise(resolve => setTimeout(resolve, 31000));
  const recoveryLogin = (await (await attempt()).json()).token;
  const recover = (code, extra = {}) => api.post('/api/users/mfa/verifyRecoveryCode', { headers: { ...headers(recoveryLogin), ...extra }, data: { recoveryCode: code } });
  const raced = await Promise.all([recover(codes[0]), recover(codes[0])]);
  assert.deepEqual(raced.map(response => response.status()).sort(), [200, 403]);
  assert.equal((await recover(codes[1])).status(), 200);
  assert.equal((await recover(codes[0])).status(), 403);
  record('recovery code is consumed atomically; a used code does not block another valid code');
  const attempts = [];
  for (let i = 0; i < 6; i++) attempts.push((await recover('invalid-recovery-code', { 'X-Forwarded-For': `192.0.2.${i + 1}` })).status());
  assert.ok(attempts.includes(429)); record('MFA attempt limit follows verified user identity despite changing forwarded IP');
}
main().then(() => fs.writeFileSync(path.join(root, 'security-results.json'), JSON.stringify({ passed: checks }, null, 2)))
  .catch(error => { console.error(error.message); process.exitCode = 1; })
  .finally(async () => { if (browser) await browser.close(); if (api) await api.dispose(); });
