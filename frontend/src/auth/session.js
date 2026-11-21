import { decodeJwtPayload } from './permissions';

export const TOKEN_KEY = 'token';
const listeners = new Set();
export const getSessionToken = () => localStorage.getItem(TOKEN_KEY);
export function setSessionToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('loginToken');
  }
  listeners.forEach((listener) => listener());
}
export const clearSession = () => setSessionToken(null);
export function subscribeSession(listener) {
  listeners.add(listener);
  const onStorage = (event) => {
    if (event.key === TOKEN_KEY || event.key === null) listener();
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
