// Fetch public meta (serviceTypes, permission preset keys) with simple caching.
import api from './api';

let _cache = null;
let _ts = 0;
const TTL = 30 * 1000; // 30s

export async function fetchMeta(force = false) {
  const now = Date.now();
  if (!force && _cache && (now - _ts) < TTL) return _cache;
  const resp = await api.get('/public/meta');
  const data = resp.data;
  _cache = data;
  _ts = now;
  return data;
}
