import config from '../config';
import axios from 'axios';
import { hasPermission } from '../auth/permissions';
import { getSessionToken, setSessionToken, clearSession, validPayload, scopeOf } from '../auth/session';

export function inferBaseURL() {
  return (config.apiUrl).replace(/\/+$/, '');
}
const api = axios.create({ baseURL: inferBaseURL(), timeout: config.requestTimeout, headers: { 'Content-Type': 'application/json' } });
api.interceptors.request.use((config) => {
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
  if (!config.authFlow && token && validPayload(token)) config.headers.Authorization = `Bearer ${token}`;
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
  if (token && (response.config.sessionToken === current ||
      (current && response.config.sessionScope === scopeOf(validPayload(current))))) setSessionToken(token);
  return response;
}, (error) => {
  if (!error.config?.authFlow && error.response?.status === 401 && error.config?.sessionToken === getSessionToken() &&
      !/^\/users\/(login|register|verify-account|reverify-account)/.test(error.config?.url || '')) {
    clearSession();
  }
  return Promise.reject(error);
});
export default api;
