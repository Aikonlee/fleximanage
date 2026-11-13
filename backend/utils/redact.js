// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com

/**
 * Masks secrets before data is written to logs.
 *
 * Any key that looks like a credential (password, secret, token, MFA recovery
 * codes, ...) is replaced by '[REDACTED]', at any depth. The input is never
 * modified, a redacted copy is returned. Mongoose documents and other objects
 * with toJSON() are serialized first, the same way JSON.stringify would.
 */

const SENSITIVE_KEY = new RegExp(
  '^(' + [
    '.*passw(or)?d.*',
    'pass',
    'pwd',
    '.*secrets?',
    'recoveryCodes',
    'salt',
    'token',
    'refreshToken',
    'accessToken',
    'refresh-jwt',
    'authorization',
    'cookie',
    'captcha',
    'apiKey',
    'privateKey'
  ].join('|') + ')$',
  'i'
);

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 10;

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
    if (SENSITIVE_KEY.test(key) && val !== null && val !== undefined && val !== '') {
      out[key] = REDACTED;
    } else {
      out[key] = redact(val, depth + 1, seen);
    }
  }
  return out;
};

module.exports = { redact, SENSITIVE_KEY };
