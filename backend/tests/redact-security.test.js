/** @jest-environment node */
const { redact, SENSITIVE_KEY } = require('../utils/redact');

const REDACTED = '[REDACTED]';

test('redacts nested hyphenated and camelCase secret keys', () => {
  const input = {
    username: 'ada',
    session: {
      'refresh-token': 'rt-plain',
      'Refresh-Token': 'rt-mixed',
      'x-api-key': 'header-key',
      apiKey: 'camel-key',
      authorization: 'Bearer secret',
      password: 'hunter2',
      recoveryCodes: ['code-1', 'code-2'],
      organization: 'Acme'
    }
  };

  const out = redact(input);

  expect(out.session['refresh-token']).toBe(REDACTED);
  expect(out.session['Refresh-Token']).toBe(REDACTED);
  expect(out.session['x-api-key']).toBe(REDACTED);
  expect(out.session.apiKey).toBe(REDACTED);
  expect(out.session.authorization).toBe(REDACTED);
  expect(out.session.password).toBe(REDACTED);
  expect(out.session.recoveryCodes).toBe(REDACTED);
  expect(out.session.organization).toBe('Acme');
  expect(out.username).toBe('ada');
  expect(input.session.password).toBe('hunter2');
  expect(input.session.recoveryCodes).toEqual(['code-1', 'code-2']);
});

test('SENSITIVE_KEY matches hyphenated secret key names', () => {
  expect(SENSITIVE_KEY.test('refresh-token')).toBe(true);
  expect(SENSITIVE_KEY.test('Refresh-Token')).toBe(true);
  expect(SENSITIVE_KEY.test('x-api-key')).toBe(true);
  expect(SENSITIVE_KEY.test('x-csrf-token')).toBe(true);
  expect(SENSITIVE_KEY.test('apiKey')).toBe(true);
  expect(SENSITIVE_KEY.test('authorization')).toBe(true);
  expect(SENSITIVE_KEY.test('password')).toBe(true);
  expect(SENSITIVE_KEY.test('recoveryCodes')).toBe(true);
  expect(SENSITIVE_KEY.test('refresh-jwt')).toBe(true);
  expect(SENSITIVE_KEY.test('organization')).toBe(false);
  expect(SENSITIVE_KEY.test('username')).toBe(false);
});

test('keeps depth, circular, toJSON, and empty-value behaviour', () => {
  const child = { password: 'x', label: 'ok' };
  const root = { child };
  child.self = root;
  const circular = redact(root);
  expect(circular.child.password).toBe(REDACTED);
  expect(circular.child.label).toBe('ok');
  expect(circular.child.self).toBe('[Circular]');

  const doc = {
    toJSON () {
      return { apiKey: 'k', name: 'n' };
    }
  };
  expect(redact(doc)).toEqual({ apiKey: REDACTED, name: 'n' });

  expect(redact({ password: '' }).password).toBe('');
  expect(redact({ password: null }).password).toBe(null);
  expect(redact({ token: undefined }).token).toBe(undefined);
  expect(redact(new Date('2020-01-01T00:00:00.000Z'))).toEqual(
    new Date('2020-01-01T00:00:00.000Z')
  );

  let deep = { password: 'bottom' };
  for (let i = 0; i < 12; i++) deep = { wrap: deep };
  const flat = JSON.stringify(redact(deep));
  expect(flat).toContain('[Truncated]');
  expect(flat).not.toContain('bottom');
});
