// Lightweight JWT payload decoder (no external deps)
export function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch (_e) {
    return null;
  }
}

// Extract permissions object from token payload
export function extractPerms(payload) {
  if (!payload || typeof payload !== 'object') return {};
  return payload.perms || {};
}

// Check if user has view (GET) permission for a given domain key
export function hasViewPermission(perms, key) {
  if (!key) return true; // no key required
  return hasPermission(perms, key, 'get');
}

// Utility: given a list of candidate keys, return first allowed one or null
export function firstAllowed(perms, keys) {
  for (const k of keys) {
    if (hasViewPermission(perms, k)) return k;
  }
  return null;
}

// Matches backend/models/membership.js; OpenAPI maps PATCH to POST.
export function hasPermission(perms, key, method = 'get') {
  const mask = { get: 1, post: 2, patch: 2, put: 4, delete: 8, del: 8 }[method.toLowerCase()];
  return !!mask && typeof perms?.[key] === 'number' && (perms[key] & mask) === mask;
}
