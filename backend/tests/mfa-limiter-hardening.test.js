/** @jest-environment node */

const fs = require('fs');
const path = require('path');

jest.mock('redis', () => {
  const clients = [];
  const control = { execErr: null, execReplies: [1, 1] };

  const create = () => {
    const queued = [];
    const client = {
      on: jest.fn(),
      auth: jest.fn(),
      quit: jest.fn(),
      incr: jest.fn(),
      expire: jest.fn(),
      ttl: jest.fn(),
      decr: jest.fn(),
      del: jest.fn(),
      scan: jest.fn()
    };
    const multi = {
      incr: jest.fn((key) => {
        queued.push(['incr', key]);
        return multi;
      }),
      expire: jest.fn((key, seconds, mode) => {
        queued.push(['expire', key, seconds, mode]);
        return multi;
      }),
      exec: jest.fn((cb) => {
        queued.push(['exec']);
        if (typeof cb === 'function') cb(control.execErr, control.execReplies);
        return multi;
      })
    };
    client.multi = jest.fn(() => multi);
    client.queue = queued;
    client.multiApi = multi;
    clients.push(client);
    return client;
  };

  return {
    createClient: jest.fn(create),
    __clients: clients,
    __control: control
  };
});

jest.mock('../configs', () => {
  const config = {
    get: jest.fn(key => (key === 'redisUrl' ? 'redis://127.0.0.1:6379' : undefined))
  };
  return () => config;
});

jest.mock('../logging/logging', () => {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };
  const factory = () => logger;
  factory.logger = logger;
  return factory;
});

const redis = require('redis');
const logging = require('../logging/logging');
const MfaRateLimitStore = require('../utils/mfaRateLimitStore');

const logger = logging.logger;
const usersSource = fs.readFileSync(
  path.join(__dirname, '../routes/users.js'),
  'utf8'
);

beforeEach(() => {
  redis.__clients.length = 0;
  redis.createClient.mockClear();
  redis.__control.execErr = null;
  redis.__control.execReplies = [1, 1];
  logger.error.mockClear();
  logger.info.mockClear();
  logger.warn.mockClear();
});

test('incr submits INCR and EXPIRE NX in one MULTI before exec', done => {
  redis.__control.execReplies = [4, 1];
  const store = new MfaRateLimitStore(30000);
  const before = Date.now();

  store.incr('user-1', (err, current, resetTime) => {
    const client = redis.__clients[0];
    expect(err).toBeNull();
    expect(current).toBe(4);
    expect(client.multi).toHaveBeenCalledTimes(1);
    expect(client.incr).not.toHaveBeenCalled();
    expect(client.expire).not.toHaveBeenCalled();
    expect(client.queue).toEqual([
      ['incr', 'mfa:limit:user-1'],
      ['expire', 'mfa:limit:user-1', 30, 'NX'],
      ['exec']
    ]);
    expect(resetTime).toBeInstanceOf(Date);
    expect(resetTime.getTime()).toBeGreaterThanOrEqual(before + 30000);
    expect(resetTime.getTime()).toBeLessThanOrEqual(Date.now() + 30000);
    done();
  });
});

test('MULTI exec errors fail closed and do not report a hit', done => {
  redis.__control.execErr = new Error('connection refused');
  const store = new MfaRateLimitStore(30000);

  store.incr('user-1', (err, current, resetTime) => {
    const client = redis.__clients[0];
    expect(err).toBe(redis.__control.execErr);
    expect(current).toBeUndefined();
    expect(resetTime).toBeUndefined();
    expect(client.queue[0][0]).toBe('incr');
    expect(client.queue[1]).toEqual(['expire', 'mfa:limit:user-1', 30, 'NX']);
    expect(client.queue[2]).toEqual(['exec']);
    done();
  });
});

test('a non-numeric INCR reply fails closed', done => {
  redis.__control.execReplies = [new Error('WRONGTYPE')];
  const store = new MfaRateLimitStore();

  store.incr('user-1', (err, current, resetTime) => {
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('MFA rate limit increment failed');
    expect(current).toBeUndefined();
    expect(resetTime).toBeUndefined();
    done();
  });
});

test('redis socket errors are logged and do not escape the listener', () => {
  const store = new MfaRateLimitStore(30000);
  expect(redis.createClient).not.toHaveBeenCalled();

  store.incr('user-1', () => {});

  const client = redis.__clients[0];
  expect(client.on).toHaveBeenCalledTimes(1);
  expect(client.on).toHaveBeenCalledWith('error', expect.any(Function));
  const handler = client.on.mock.calls[0][1];

  expect(() => handler(new Error('ECONNRESET'))).not.toThrow();
  expect(logger.error).toHaveBeenCalledWith(
    'MFA rate limit redis client error',
    { params: { err: 'ECONNRESET' } }
  );

  logger.error.mockClear();
  expect(() => handler(undefined)).not.toThrow();
  expect(logger.error).toHaveBeenCalledWith(
    'MFA rate limit redis client error',
    { params: { err: 'undefined' } }
  );
});

test('MFA routes authenticate before the rate limiter', () => {
  const routes = ['/mfa/verify', '/mfa/verifyRecoveryCode'];
  routes.forEach((route) => {
    const marker = `router.route('${route}')`;
    const start = usersSource.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const next = usersSource.indexOf('router.route(', start + marker.length);
    const block = usersSource.slice(start, next === -1 ? usersSource.length : next);
    const postAt = block.indexOf('.post(');
    const post = block.slice(postAt);
    const authAt = post.indexOf('auth.verifyUserOrLoginJWT');
    const limitAt = post.indexOf('verifyMfaRateLimit');
    expect(authAt).toBeGreaterThan(-1);
    expect(limitAt).toBeGreaterThan(authAt);
  });

  expect(usersSource).toMatch(/windowMs:\s*1000\s*\*\s*30/);
  expect(usersSource).toMatch(/max:\s*5/);
  expect(usersSource).toMatch(/keyGenerator\s*:/);
});
