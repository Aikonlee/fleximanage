const { redact } = require('../utils/redact');

const FRAGMENTS = [
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

describe('log secret redaction', () => {
  test.each(FRAGMENTS)('redacts object key containing %s', (fragment) => {
    const key = `device-${fragment}`;
    const out = redact({ [key]: 'super-secret-value', name: 'edge-1' });
    expect(out[key]).toBe('[REDACTED]');
    expect(out.name).toBe('edge-1');
  });

  test.each(FRAGMENTS)('redacts URL query value for %s', (fragment) => {
    const url = `/api/devices?${fragment}=super-secret-value&org=acme`;
    const out = redact(url);
    expect(out).toBe(`/api/devices?${fragment}=[REDACTED]&org=acme`);
    expect(out).not.toContain('super-secret-value');
  });

  test('redacts hyphenated and mixed-case query keys', () => {
    const url = 'https://mgmt.example/path?pre-shared-key=abc&PIN=9999&keep=yes#frag';
    expect(redact(url)).toBe(
      'https://mgmt.example/path?pre-shared-key=[REDACTED]&PIN=[REDACTED]&keep=yes#frag'
    );
  });
});
