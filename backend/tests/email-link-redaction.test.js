/** @jest-environment node */
const { redact, redactLoggedUrl, SENSITIVE_FRAGMENTS } = require('../utils/redact');

const REDACTED = '[REDACTED]';
const VERIFY_TOKEN = 'verify-token-opaque-value';
const RESET_TOKEN = 'reset-token-opaque-value';
const USER_ID = '64b0c0ffee00000000000001';

const VERIFY_URL = `/verify-account?id=${USER_ID}&t=${VERIFY_TOKEN}`;
const RESET_URL = `/reset-password?id=${USER_ID}&t=${RESET_TOKEN}`;

describe('email link redaction', () => {
  test('opaque query names are exact-match and not substring fragments', () => {
    expect(SENSITIVE_FRAGMENTS).not.toContain('t');
    const ordinary = redact({ status: 'open', list: 'devices', result: 'ok', note: 'status list result' });
    expect(ordinary).toEqual({ status: 'open', list: 'devices', result: 'ok', note: 'status list result' });
  });

  test.each([
    ['verify-account', VERIFY_URL, VERIFY_TOKEN],
    ['reset-password', RESET_URL, RESET_TOKEN]
  ])('URL logger drops the %s t value', (_label, url, token) => {
    // createRequestEntry and the client-error URL field both call redactLoggedUrl.
    const loggedUrl = redactLoggedUrl(url);
    expect(loggedUrl).not.toContain(token);
    expect(loggedUrl).not.toMatch(/[?&]t=/);
    expect(loggedUrl.startsWith(url.slice(0, url.indexOf('?')))).toBe(true);
    expect(redact(url)).toBe(url.replace(token, REDACTED));
    expect(redact(url)).not.toContain(token);
  });

  test.each([
    ['verify-account', USER_ID, VERIFY_TOKEN],
    ['reset-password', USER_ID, RESET_TOKEN]
  ])('query logger redacts t on the %s link', (_label, id, token) => {
    const query = redact({ id, t: token, status: 'pending', list: '1', result: 'ok' });
    expect(query).toEqual({
      id,
      t: REDACTED,
      status: 'pending',
      list: '1',
      result: 'ok'
    });
    expect(JSON.stringify(query)).not.toContain(token);
  });
});
