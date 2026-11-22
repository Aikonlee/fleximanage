import { clearSession, getRefreshToken, getSessionToken, setSessionToken, setSessionTokens } from './session';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  delete window.__FLEXIWAN_SERVER_CONFIG__;
  clearSession();
});

test('missing config stores the access token in localStorage and the refresh token in memory', () => {
  setSessionTokens('access-jwt', 'refresh-jwt');
  expect(getSessionToken()).toBe('access-jwt');
  expect(localStorage.getItem('token')).toBe('access-jwt');
  expect(sessionStorage.getItem('token')).toBeNull();
  expect(getRefreshToken()).toBe('refresh-jwt');
  expect(localStorage.getItem('refreshToken')).toBeNull();
  expect(sessionStorage.getItem('refreshToken')).toBeNull();
});

test('jwtInSessionStorage true uses sessionStorage for the access token only', () => {
  window.__FLEXIWAN_SERVER_CONFIG__ = { jwtInSessionStorage: true };
  localStorage.setItem('token', 'stale');
  setSessionTokens('access-jwt', 'refresh-jwt');
  expect(getSessionToken()).toBe('access-jwt');
  expect(sessionStorage.getItem('token')).toBe('access-jwt');
  expect(localStorage.getItem('token')).toBeNull();
  expect(getRefreshToken()).toBe('refresh-jwt');
  expect(sessionStorage.getItem('refreshToken')).toBeNull();
});

test('jwtInSessionStorage false keeps localStorage', () => {
  window.__FLEXIWAN_SERVER_CONFIG__ = { jwtInSessionStorage: false };
  sessionStorage.setItem('token', 'stale');
  setSessionToken('access-jwt');
  expect(localStorage.getItem('token')).toBe('access-jwt');
  expect(sessionStorage.getItem('token')).toBeNull();
  expect(getSessionToken()).toBe('access-jwt');
});

test('clearing the session removes the access token from both stores', () => {
  localStorage.setItem('token', 'local');
  sessionStorage.setItem('token', 'session');
  localStorage.setItem('refreshToken', 'r');
  clearSession();
  expect(getSessionToken()).toBeNull();
  expect(getRefreshToken()).toBeNull();
  expect(localStorage.getItem('token')).toBeNull();
  expect(sessionStorage.getItem('token')).toBeNull();
  expect(localStorage.getItem('refreshToken')).toBeNull();
});
