// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com

/**
 * Masks secrets before data is written to logs.
 *
 * Any key that looks like a credential (password, secret, token, MFA recovery
 * codes, ...) is replaced by '[REDACTED]', at any depth. Keys are normalized
 * (lowercase, non-alphanumerics removed) and then matched by substring, so
 * hyphenated names such as refresh-token and x-api-key are covered. The input
 * is never modified, a redacted copy is returned. Mongoose documents and other
 * objects with toJSON() are serialized first, the same way JSON.stringify would.
 */

// Substrings of the normalized key. Longer names stay listed when a shorter
// fragment already covers them, so the set is explicit. refreshjwt keeps the
// previous exact key refresh-jwt, which none of the other fragments imply.
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
  'refreshjwt'
];

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
  const normalized = normalizeKey(key);
  return SENSITIVE_FRAGMENTS.some(fragment => normalized.includes(fragment));
};

const redact = (value, depth = 0, seen = new WeakSet()) => {
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

module.exports = { redact, SENSITIVE_KEY };
