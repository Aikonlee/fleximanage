/** @jest-environment node */
jest.mock('../utils/deviceQueue', () => () => ({
  resetWaitPause: jest.fn()
}));

jest.mock('redis', () => {
  const fakeClient = () => ({
    auth: jest.fn(),
    on: jest.fn(),
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
    publish: jest.fn(),
    get: jest.fn((key, cb) => { if (cb) cb(null, null); }),
    setex: jest.fn((key, ttl, val, cb) => { if (cb) cb(null, 'OK'); }),
    duplicate () { return fakeClient(); }
  });
  return { createClient: jest.fn(() => fakeClient()) };
});

jest.mock('../logging/logging', () => {
  const log = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn()
  };
  const factory = () => log;
  factory.log = log;
  return factory;
});

jest.spyOn(global, 'setInterval').mockImplementation(() => 0);

const getConnections = require('../websocket/Connections');
const { redact } = require('../utils/redact');
const log = require('../logging/logging').log;

const REDACTED = '[REDACTED]';
const MACHINE_ID = 'device-1';
// Longer than the 32-char handshake preview so a prefix cannot satisfy the check.
const DEVICE_JWT = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  'eyJtYWNoaW5lX2lkIjoiZGV2aWNlLTEifQ',
  'sig-must-not-appear-in-logs'
].join('.');

const loggedBlob = () => JSON.stringify(
  ['info', 'warn', 'error', 'debug', 'verbose'].flatMap(level => log[level].mock.calls)
);

describe('device handshake URL redaction', () => {
  let connections;

  beforeAll(() => {
    connections = getConnections();
  });

  beforeEach(() => {
    log.info.mockClear();
    log.warn.mockClear();
    log.error.mockClear();
    log.debug.mockClear();
    log.verbose.mockClear();
  });

  afterAll(() => {
    setInterval.mockRestore();
  });

  test('verifyDevice logs the pathname and not the device JWT', async () => {
    const done = jest.fn();
    await connections.verifyDevice({
      req: {
        url: `/${MACHINE_ID}?token=${DEVICE_JWT}&ready=1`,
        headers: { 'x-forwarded-for': '203.0.113.5' },
        connection: { remoteAddress: '203.0.113.5' }
      }
    }, done);

    const attempt = log.info.mock.calls.find(call => call[0] === 'Device connection attempt');
    expect(attempt).toBeTruthy();
    const params = attempt[1].params;
    expect(params.url).toBe(`/${MACHINE_ID}`);
    expect(params.url).not.toContain('?');
    expect(params.url).not.toContain('token');
    expect(params.url).not.toContain(DEVICE_JWT);

    const blob = loggedBlob();
    expect(blob).not.toContain(DEVICE_JWT);
    expect(blob).not.toContain(DEVICE_JWT.split('.')[1]);
    expect(blob).not.toContain(DEVICE_JWT.split('.')[2]);

    // Same mask the file logger applies before app.log is written.
    const written = JSON.stringify(redact(params));
    expect(written).not.toContain(DEVICE_JWT);
    expect(written).not.toContain(DEVICE_JWT.slice(0, 32));
    expect(written).toContain(`/${MACHINE_ID}`);
    expect(done).toHaveBeenCalledWith(false, 400);
  });

  test('redact scrubs sensitive query params and keeps the rest of a URL', () => {
    const raw = 'wss://mgmt.example/' + MACHINE_ID +
      '?ready=1&token=' + DEVICE_JWT +
      '&refresh-token=refresh-secret&authorization=Bearer%20secret' +
      '&api-key=key-secret&api_key=other-key&x-api-key=header-key' +
      '&page=2#section';
    const input = { url: raw, note: 'kept', token: DEVICE_JWT };
    const out = redact(input);

    expect(input.url).toBe(raw);
    expect(out.note).toBe('kept');
    expect(out.token).toBe(REDACTED);
    expect(out.url.startsWith('wss://mgmt.example/' + MACHINE_ID + '?')).toBe(true);
    expect(out.url).toContain('ready=1');
    expect(out.url).toContain('page=2');
    expect(out.url).toContain('#section');
    expect(out.url).toContain('token=' + REDACTED);
    expect(out.url).toContain('refresh-token=' + REDACTED);
    expect(out.url).toContain('authorization=' + REDACTED);
    expect(out.url).toContain('api-key=' + REDACTED);
    expect(out.url).toContain('api_key=' + REDACTED);
    expect(out.url).toContain('x-api-key=' + REDACTED);
    expect(out.url).not.toContain(DEVICE_JWT);
    expect(out.url).not.toContain('refresh-secret');
    expect(out.url).not.toContain('Bearer%20secret');
    expect(out.url).not.toContain('key-secret');
    expect(out.url).not.toContain('other-key');
    expect(out.url).not.toContain('header-key');

    const pathOnly = `/${MACHINE_ID}?token=${DEVICE_JWT}&ready=1`;
    expect(redact(pathOnly)).toBe(`/${MACHINE_ID}?token=${REDACTED}&ready=1`);
    expect(redact('what? token=' + DEVICE_JWT)).toBe('what? token=' + DEVICE_JWT);
    expect(redact({ organization: 'Acme', password: '' }).password).toBe('');
  });
});
