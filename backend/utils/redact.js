// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com

/**
 * Masks secrets before data is written to logs.
 *
 * Any key that looks like a credential (password, secret, token, MFA recovery
 * codes, ...) is replaced by '[REDACTED]', at any depth. Keys are normalized
 * (lowercase, non-alphanumerics removed) and then matched by substring, so
 * hyphenated names such as refresh-token and x-api-key are covered. String
 * values that are URLs have those same names scrubbed in the query string;
 * the path and non-sensitive parameters are preserved. The input is never
 * modified, a redacted copy is returned. Mongoose documents and other
 * objects with toJSON() are serialized first, the same way JSON.stringify would.
 */

// Substrings of the normalized key. Longer names stay listed when a shorter
// fragment already covers them, so the set is explicit. refreshjwt keeps the
// previous exact key refresh-jwt, which none of the other fragments imply.
// Do not add one-letter names here: normalized substring matching would
// redact ordinary keys such as status, list, and result.
const SENSITIVE_FRAGMENTS = [
  'token',
  'secret',
  'password',
  'passwd',
  'pwd',
  'pass',
  'apikey',
  'privatekey',
  'authorization',
  'cookie',
  'recoverycode',
  'captcha',
  'salt',
  'logintoken',
  'refreshjwt',
  'presharedkey',
  'tunnelkey',
  'cakey',
  'serverkey',
  'clientkey',
  'tlskey',
  'dhkey',
  'key1',
  'key2',
  'key3',
  'key4',
  'pin',
  'puk'
];

// Whole query-parameter names whose values are opaque (email verify and reset
// links use `t`). Compared to the entire key, never as a substring.
const OPAQUE_QUERY_KEYS = new Set(['t']);

const isOpaqueQueryKey = (key) => OPAQUE_QUERY_KEYS.has(String(key).toLowerCase());

// Compatibility export. Same names as the normalized substring check, including
// separators between letters (refresh-token, x-api-key, Refresh-Token).
const SENSITIVE_KEY = new RegExp(
  SENSITIVE_FRAGMENTS.map(fragment => {
    return fragment.split('').join('[^a-z0-9]*');
  }).join('|'),
  'i'
);

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 10;

const normalizeKey = (key) => String(key).toLowerCase().replace(/[^a-z0-9]/g, '');

const isSensitiveKey = (key) => {
  if (isOpaqueQueryKey(key)) return true;
  const normalized = normalizeKey(key);
  return SENSITIVE_FRAGMENTS.some(fragment => normalized.includes(fragment));
};

const decodeQueryKey = (rawKey) => {
  try {
    return decodeURIComponent(String(rawKey).replace(/\+/g, ' '));
  } catch (err) {
    return rawKey;
  }
};

// Whole-string values only. A URL buried in a sentence is left unchanged.
const isUrlLike = (value) => {
  const queryAt = value.indexOf('?');
  if (queryAt === -1) return false;
  const hashAt = value.indexOf('#');
  if (hashAt !== -1 && hashAt < queryAt) return false;
  const head = value.slice(0, queryAt);
  if (/\s/.test(head)) return false;
  if (
    head === '' ||
    head.startsWith('/') ||
    head.startsWith('./') ||
    head.startsWith('../')
  ) return true;
  return /^[a-z][a-z0-9+.-]*:/i.test(head);
};

const redactUrlLike = (value) => {
  if (typeof value !== 'string' || !isUrlLike(value)) return value;
  const queryAt = value.indexOf('?');
  const head = value.slice(0, queryAt);
  const rest = value.slice(queryAt + 1);
  const hashAt = rest.indexOf('#');
  const query = hashAt === -1 ? rest : rest.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : rest.slice(hashAt);
  let changed = false;
  const scrubbed = query.split('&').map(part => {
    if (!part) return part;
    const eq = part.indexOf('=');
    if (eq === -1) return part;
    const rawKey = part.slice(0, eq);
    const rawVal = part.slice(eq + 1);
    if (rawVal === '' || !isSensitiveKey(decodeQueryKey(rawKey))) return part;
    changed = true;
    return `${rawKey}=${REDACTED}`;
  }).join('&');
  if (!changed) return value;
  return `${head}?${scrubbed}${hash}`;
};

// Request logs keep the path and drop the query string. Email links put the
// verify/reset secret in `t`, and other query values are not needed in the
// URL field. redact() still runs so a sensitive fragment left on the path
// is masked. The hash, when it appears after the query, is preserved.
const redactLoggedUrl = (url) => {
  if (typeof url !== 'string') return redact(url);
  const queryAt = url.indexOf('?');
  if (queryAt === -1) return redact(url);
  const hashAt = url.indexOf('#');
  if (hashAt !== -1 && hashAt < queryAt) return redact(url);
  const hash = hashAt === -1 ? '' : url.slice(hashAt);
  return redact(url.slice(0, queryAt) + hash);
};

const redact = (value, depth = 0, seen = new WeakSet()) => {
  if (typeof value === 'string') return redactUrlLike(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth > MAX_DEPTH) return '[Truncated]';
  if (value instanceof Date) return value;
  if (Buffer.isBuffer(value)) return value;
  if (typeof value.toJSON === 'function' && !Array.isArray(value)) {
    const json = value.toJSON();
    if (json !== value) return redact(json, depth, seen);
  }
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) return value.map(v => redact(v, depth + 1, seen));

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (isSensitiveKey(key) && val !== null && val !== undefined && val !== '') {
      out[key] = REDACTED;
    } else {
      out[key] = redact(val, depth + 1, seen);
    }
  }
  return out;
};

module.exports = { redact, redactLoggedUrl, SENSITIVE_KEY, SENSITIVE_FRAGMENTS, OPAQUE_QUERY_KEYS };
