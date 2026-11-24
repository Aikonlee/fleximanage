import api, { inferBaseURL } from './api';
import { setSessionToken, setSessionTokens, getSessionToken, getRefreshToken, clearSession } from '../auth/session';
const token = (org, perms = { devices: 15 }) => `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ _id: 'user', account: 'account', org, exp: Math.floor(Date.now() / 1000) + 3600, perms }))}.signature`;
const adapter = vi.fn();
beforeEach(() => { localStorage.clear(); clearSession(); adapter.mockReset(); api.defaults.adapter = adapter; });
test('uses same-origin API fallback', () => { expect(inferBaseURL()).toBe(import.meta.env.REACT_APP_API_URL || '/api'); });
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
  await vi.waitFor(() => expect(adapter).toHaveBeenCalledTimes(1));
  setSessionToken(newToken); finish();
  await expect(request).rejects.toMatchObject({ code: 'ERR_CANCELED' });
  expect(getSessionToken()).toBe(newToken);
});
test('late 401 from previous organization cannot log out current session', async () => {
  setSessionToken(token('A'));
  let fail;
  adapter.mockImplementation(config => new Promise((resolve, reject) => { fail = () => reject({ config, response: { status: 401 } }); }));
  const request = api.get('/devices'); await vi.waitFor(() => expect(adapter).toHaveBeenCalledTimes(1));
  const current = token('B'); setSessionToken(current); fail();
  await expect(request).rejects.toMatchObject({ response: { status: 401 } });
  expect(getSessionToken()).toBe(current);
});
test('a response after logout cannot restore a session', async () => {
  const original = token('A'); setSessionToken(original);
  let finish;
  adapter.mockImplementation(config => new Promise(resolve => { finish = () => resolve({ config, status: 200, headers: { 'refresh-jwt': original }, data: [] }); }));
  const request = api.get('/devices'); await vi.waitFor(() => expect(adapter).toHaveBeenCalledTimes(1));
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
  await vi.waitFor(() => expect(adapter).toHaveBeenCalledTimes(1));
  setSessionToken(original + 'rotated'); finish();
  await request;
  expect(getSessionToken()).toBe(selected);
});

test('expired sessions refresh once before concurrent requests and persist both rotated headers', async () => {
  const expired = `header.${btoa(JSON.stringify({ _id: 'user', account: 'account', org: 'A', exp: 1, perms: { devices: 15 } }))}.signature`;
  const renewed = token('A');
  setSessionTokens(expired, 'old-refresh');
  let finish;
  adapter.mockImplementation(config => config.url === '/users/me'
    ? new Promise(resolve => { finish = () => resolve({ config, status: 200, headers: { 'refresh-jwt': renewed, 'refresh-token': 'new-refresh' }, data: {} }); })
    : Promise.resolve({ config, status: 200, headers: {}, data: {} }));
  const first = api.get('/devices'); const second = api.get('/organizations');
  await vi.waitFor(() => expect(adapter).toHaveBeenCalledTimes(1));
  expect(adapter.mock.calls[0][0]).toMatchObject({ url: '/users/me', headers: { Authorization: `Bearer ${expired}`, 'Refresh-Token': 'old-refresh' } });
  finish(); await Promise.all([first, second]);
  expect(adapter).toHaveBeenCalledTimes(3);
  expect(adapter.mock.calls.slice(1).map(([config]) => config.headers.Authorization)).toEqual([`Bearer ${renewed}`, `Bearer ${renewed}`]);
  expect(getSessionToken()).toBe(renewed);
  expect(getRefreshToken()).toBe('new-refresh');
  expect(localStorage.getItem('refreshToken')).toBeNull();
});

test('refresh failure clears both credentials and blocks the waiting request', async () => {
  const expired = `header.${btoa(JSON.stringify({ _id: 'user', account: 'account', org: 'A', exp: 1 }))}.signature`;
  setSessionTokens(expired, 'old-refresh');
  adapter.mockImplementation(config => Promise.reject({ config, response: { status: 401 } }));
  await expect(api.get('/devices')).rejects.toBeTruthy();
  expect(adapter).toHaveBeenCalledTimes(1);
  expect(getSessionToken()).toBeNull();
  expect(getRefreshToken()).toBeNull();
});

test('late refresh after logout cannot resurrect credentials or dispatch a waiting request', async () => {
  const expired = `header.${btoa(JSON.stringify({ _id: 'user', account: 'account', org: 'A', exp: 1 }))}.signature`;
  setSessionTokens(expired, 'old-refresh');
  let finish;
  adapter.mockImplementation(config => new Promise(resolve => { finish = () => resolve({ config, status: 200, headers: { 'refresh-jwt': token('A'), 'refresh-token': 'new-refresh' }, data: {} }); }));
  const request = api.get('/devices');
  await vi.waitFor(() => expect(adapter).toHaveBeenCalledTimes(1));
  clearSession(); finish();
  await expect(request).rejects.toMatchObject({ code: 'ERR_CANCELED' });
  expect(adapter).toHaveBeenCalledTimes(1);
  expect(getSessionToken()).toBeNull();
  expect(getRefreshToken()).toBeNull();
});

test('a current-session 401 clears access and refresh credentials', async () => {
  setSessionTokens(token('A'), 'old-refresh');
  adapter.mockImplementation(config => Promise.reject({ config, response: { status: 401 } }));
  await expect(api.get('/devices')).rejects.toMatchObject({ response: { status: 401 } });
  expect(getSessionToken()).toBeNull();
  expect(getRefreshToken()).toBeNull();
});

test('an older rotation cannot overwrite a newer same-scope refresh token', async () => {
  const original = token('A'); setSessionTokens(original, 'initial');
  let finish;
  adapter.mockImplementation(config => new Promise(resolve => { finish = () => resolve({ config, status: 200, headers: { 'refresh-jwt': token('A'), 'refresh-token': 'stale' }, data: {} }); }));
  const request = api.get('/devices');
  await vi.waitFor(() => expect(adapter).toHaveBeenCalledTimes(1));
  setSessionTokens(original + 'rotated', 'fresh');
  finish();
  await expect(request).rejects.toMatchObject({ code: 'ERR_CANCELED' });
  expect(getRefreshToken()).toBe('fresh');
});

test('incomplete refresh response fails closed', async () => {
  const expired = `header.${btoa(JSON.stringify({ _id: 'user', account: 'account', org: 'A', exp: 1 }))}.signature`;
  setSessionTokens(expired, 'old-refresh');
  adapter.mockImplementation(async config => ({ config, status: 200, headers: { 'refresh-jwt': token('A') }, data: {} }));
  await expect(api.get('/devices')).rejects.toThrow('Incomplete refresh response');
  expect(getSessionToken()).toBeNull();
  expect(getRefreshToken()).toBeNull();
});

test('refresh token is never written to localStorage', () => {
  setSessionTokens(token('A'), 'memory-refresh');
  expect(getRefreshToken()).toBe('memory-refresh');
  expect(localStorage.getItem('refreshToken')).toBeNull();
});

test('devicetemplates writes enforce client-side devicetemplates permission domain', async () => {
  setSessionToken(token('A', { devicetemplates: 1 }));
  await expect(api.post('/devicetemplates', { name: 't1', config: {} })).rejects.toMatchObject({ response: { status: 403 } });
  expect(adapter).not.toHaveBeenCalled();
});
