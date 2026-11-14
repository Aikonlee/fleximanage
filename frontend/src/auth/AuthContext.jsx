import React, { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { getSessionToken, subscribeSession, validPayload, clearSession, scopeOf } from './session';
import { hasPermission } from './permissions';

const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const token = useSyncExternalStore(subscribeSession, getSessionToken, () => null);
  const payload = useMemo(() => validPayload(token), [token]);
  useEffect(() => {
    if (!token) return undefined;
    if (!payload) { clearSession(); return undefined; }
    const remaining = payload.exp * 1000 - Date.now();
    let timer;
    const expire = () => {
      const left = payload.exp * 1000 - Date.now();
      if (left <= 0) clearSession();
      else timer = setTimeout(expire, Math.min(left, 2147483647));
    };
    timer = setTimeout(expire, Math.max(0, Math.min(remaining, 2147483647)));
    return () => clearTimeout(timer);
  }, [token, payload]);
  const value = useMemo(() => ({
    token, payload, perms: payload?.perms || {}, isAuthenticated: !!payload,
    isAdmin: !!payload?.admin, orgId: payload?.org || null,
    orgName: payload?.orgName || payload?.org_name || '', scope: scopeOf(payload),
    can: (key, method = 'get') => hasPermission(payload?.perms, key, method)
  }), [token, payload]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth requires AuthProvider');
  return auth;
}
