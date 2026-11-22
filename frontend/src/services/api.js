import config from '../config';
import axios from 'axios';
import { hasPermission, decodeJwtPayload } from '../auth/permissions';
import { getSessionToken, getRefreshToken, setSessionTokens, setSessionToken, clearSession, validPayload, scopeOf } from '../auth/session';

export function inferBaseURL() {
  return (config.apiUrl).replace(/\/+$/, '');
}
const api = axios.create({ baseURL: inferBaseURL(), timeout: config.requestTimeout, headers: { 'Content-Type': 'application/json' } });
let refreshFlight;
export function refreshSession() {
  const token = getSessionToken();
  const refresh = getRefreshToken();
  if (!token) return Promise.reject(new Error('No refresh session available'));
  if (refreshFlight && refreshFlight.token === token) return refreshFlight.promise;
  const promise = api.get('/users/me', { sessionRefresh: true, withCredentials: true, headers: { Authorization: `Bearer ${token}`, ...(refresh ? { 'Refresh-Token': refresh } : {}) } }).then(response => {
    if (getSessionToken() !== token || getRefreshToken() !== refresh) throw new axios.CanceledError('Session changed during refresh');
    const next = response.headers['refresh-jwt'];
    const nextRefresh = response.headers['refresh-token'];
    if (!validPayload(next) || !nextRefresh) throw new Error('Incomplete refresh response');
    setSessionTokens(next, nextRefresh);
    return next;
  }).catch(error => {
    if (getSessionToken() === token && getRefreshToken() === refresh) clearSession();
    throw error;
  }).finally(() => { if (refreshFlight?.promise === promise) refreshFlight = null; });
  refreshFlight = { token, promise };
  return promise;
}
api.interceptors.request.use(async (config) => {
  if (!config.authFlow && !config.sessionRefresh) {
    const token = getSessionToken();
    const claims = decodeJwtPayload(token);
    if (token && claims?.type !== 'login' && !validPayload(token)) {
      if (getRefreshToken()) await refreshSession();
      else { clearSession(); throw new axios.CanceledError('Session expired'); }
    } else if (refreshFlight && refreshFlight.token === token) await refreshFlight.promise;
  }
  const token = getSessionToken();
  config.sessionToken = token;
  config.sessionScope = scopeOf(validPayload(token));
  const payload = validPayload(token);
  const resource = (config.url || '').replace(/^\/api\//, '/').split(/[/?]/).filter(Boolean)[0]?.toLowerCase();
  const domains = { devices: 'devices', organizations: 'organizations', tunnels: 'tunnels',
    mlpolicies: 'mlpolicies', qospolicies: 'qospolicies', firewallpolicies: 'firewallpolicies',
    vrrp: 'vrrp', peers: 'peers', pathlabels: 'pathlabels', linkmonitors: 'linkmonitors',
    appidentifications: 'appidentifications', tokens: 'tokens', accesstokens: 'accesstokens',
    notifications: 'notifications', notificationsconf: 'notifications', accounts: 'accounts',
    members: 'members', coupons: 'billing', appstore: 'applications' };
  const method = (config.method || 'get').toLowerCase();
  const isSelection = /^\/(organizations|accounts)\/select(?:\?|$)/.test(config.url || '');
  if (payload && !['get', 'head', 'options'].includes(method) && domains[resource] && !isSelection &&
      !hasPermission(payload.perms, domains[resource], method)) {
    const error = new Error('You do not have permission to perform this operation');
    error.response = { status: 403, data: { error: error.message } };
    return Promise.reject(error);
  }
  if (!config.authFlow && !config.sessionRefresh && token && validPayload(token)) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
api.interceptors.response.use((response) => {
  const current = getSessionToken();
  // An old organization's slow response must neither replace its successor's JWT nor data.
  if (response.config.sessionToken && response.config.sessionToken !== current &&
      response.config.sessionScope !== scopeOf(validPayload(current))) {
    throw new axios.CanceledError('Session changed while request was in flight');
  }
  const token = response.headers['refresh-jwt'];
  const rotated = response.headers['refresh-token'];
  if (rotated && response.config.sessionToken !== current) throw new axios.CanceledError('Session changed during rotation');
  if (!response.config.authFlow && !response.config.sessionRefresh && token &&
      (response.config.sessionToken === current ||
      (current && response.config.sessionScope === scopeOf(validPayload(current))))) {
    if (rotated) setSessionTokens(token, rotated);
    else setSessionToken(token);
  }
  return response;
}, async (error) => {
  if (error.config?.sessionRefresh) return Promise.reject(error);
  if (refreshFlight && error.config?.sessionToken === refreshFlight.token) {
    try { await refreshFlight.promise; } catch (_) { /* Refresh handler owns session cleanup. */ }
  }
  if (!error.config?.authFlow && error.response?.status === 401 && error.config?.sessionToken === getSessionToken() &&
      !/^\/users\/(login|register|verify-account|reverify-account)/.test(error.config?.url || '')) {
    clearSession();
  }
  return Promise.reject(error);
});
export default api;
