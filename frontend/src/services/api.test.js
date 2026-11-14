import api, { inferBaseURL } from './api';
import { setSessionToken, getSessionToken, clearSession } from '../auth/session';
const token = (org, perms = { devices: 15 }) => `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ _id: 'user', account: 'account', org, exp: Math.floor(Date.now() / 1000) + 3600, perms }))}.signature`;
const adapter = jest.fn();
beforeEach(() => { localStorage.clear(); adapter.mockReset(); api.defaults.adapter = adapter; });
test('uses same-origin API fallback', () => { expect(inferBaseURL()).toBe(process.env.REACT_APP_API_URL || '/api'); });
test('viewer writes rejected before network, selection remains allowed', async () => {
  setSessionToken(token('A', { devices: 1, organizations: 1 }));
  await expect(api.delete('/devices/id')).rejects.toMatchObject({ response: { status: 403 } });
  expect(adapter).not.toHaveBeenCalled();
  adapter.mockImplementation(async config => ({ config, status: 200, headers: {}, data: {} }));
  await expect(api.post('/organizations/select', { org: 'B' })).resolves.toMatchObject({ status: 200 });
});
test('old organization responses cannot overwrite new session or return old data', async () => {
  const oldToken = token('A'); const newToken = token('B');
  setSessionToken(oldToken);
  let finish;
  adapter.mockImplementation(config => new Promise(resolve => { finish = () => resolve({ config, status: 200, headers: { 'refresh-jwt': oldToken }, data: ['old-org'] }); }));
  const request = api.get('/devices');
  await Promise.resolve(); await Promise.resolve();
  setSessionToken(newToken); finish();
  await expect(request).rejects.toMatchObject({ code: 'ERR_CANCELED' });
  expect(getSessionToken()).toBe(newToken);
});
test('late 401 from previous organization cannot log out current session', async () => {
  setSessionToken(token('A'));
  let fail;
  adapter.mockImplementation(config => new Promise((resolve, reject) => { fail = () => reject({ config, response: { status: 401 } }); }));
  const request = api.get('/devices'); await Promise.resolve(); await Promise.resolve();
  const current = token('B'); setSessionToken(current); fail();
  await expect(request).rejects.toMatchObject({ response: { status: 401 } });
  expect(getSessionToken()).toBe(current);
});
test('a response after logout cannot restore a session', async () => {
  const original = token('A'); setSessionToken(original);
  let finish;
  adapter.mockImplementation(config => new Promise(resolve => { finish = () => resolve({ config, status: 200, headers: { 'refresh-jwt': original }, data: [] }); }));
  const request = api.get('/devices'); await Promise.resolve(); await Promise.resolve();
  clearSession(); finish();
  await expect(request).rejects.toMatchObject({ code: 'ERR_CANCELED' });
  expect(getSessionToken()).toBeNull();
});

test('notification configuration and billing use backend service permission domains', async () => {
  setSessionToken(token('A', { notifications: 4, billing: 2 }));
  adapter.mockImplementation(async config => ({ config, status: 200, headers: {}, data: {} }));
  await expect(api.put('/notificationsConf', {})).resolves.toMatchObject({ status: 200 });
  await expect(api.post('/coupons', {})).resolves.toMatchObject({ status: 200 });
});

test('organization selection is accepted after a concurrent refresh within the old organization', async () => {
  const original = token('A'); setSessionToken(original);
  let finish;
  const selected = token('B');
  adapter.mockImplementation(config => new Promise(resolve => { finish = () => resolve({ config, status: 200, headers: { 'refresh-jwt': selected }, data: {} }); }));
  const request = api.post('/organizations/select', { org: 'B' });
  await Promise.resolve(); await Promise.resolve();
  setSessionToken(original + 'rotated'); finish();
  await request;
  expect(getSessionToken()).toBe(selected);
});
