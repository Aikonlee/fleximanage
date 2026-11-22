import { decodeJwtPayload } from './permissions';

export const TOKEN_KEY = 'token';
const listeners = new Set();
let refreshTokenMemory = null;

// jwtInSessionStorage is injected by the backend into window.__FLEXIWAN_SERVER_CONFIG__.
// Missing config, a missing flag, or any access error keeps the access JWT in localStorage.
function accessTokenStorage() {
  try {
    if (window.__FLEXIWAN_SERVER_CONFIG__?.jwtInSessionStorage === true) return sessionStorage;
  } catch (_err) { /* unavailable storage or config */ }
  return localStorage;
}

export const getSessionToken = () => accessTokenStorage().getItem(TOKEN_KEY);
export const getRefreshToken = () => refreshTokenMemory;
export function setSessionTokens(token, refreshToken) {
  refreshTokenMemory = refreshToken;
  setSessionToken(token);
}
export function setSessionToken(token) {
  if (token) {
    const active = accessTokenStorage();
    const other = active === sessionStorage ? localStorage : sessionStorage;
    other.removeItem(TOKEN_KEY);
    active.setItem(TOKEN_KEY, token);
  } else {
    refreshTokenMemory = null;
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem('refreshToken');
    sessionStorage.removeItem('refreshToken');
    localStorage.removeItem('loginToken');
    sessionStorage.removeItem('loginToken');
  }
  listeners.forEach((listener) => listener());
}
export const clearSession = () => setSessionToken(null);
export function subscribeSession(listener) {
  listeners.add(listener);
  const onStorage = (event) => {
    if (event.key === TOKEN_KEY || event.key === null) {
      refreshTokenMemory = null;
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}
export function validPayload(token) {
  const payload = decodeJwtPayload(token);
  return payload && payload.type !== 'login' && Number.isFinite(payload.exp) && payload.exp * 1000 > Date.now()
    ? payload : null;
}
export const scopeOf = (payload) => JSON.stringify([payload?._id, payload?.account, payload?.org]);
