/** @jest-environment node */

jest.mock('redis', () => ({ createClient: jest.fn() }));
jest.mock('../configs', () => {
  const config = {
    get: jest.fn(key => (key === 'redisUrl' ? 'redis://127.0.0.1:6379' : undefined))
  };
  return () => config;
});
jest.mock('../logging/logging', () => () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

const redis = require('redis');
const configs = require('../configs')();
const MfaRateLimitStore = require('../utils/mfaRateLimitStore');

const createFakeClient = () => ({
  incr: jest.fn(),
  expire: jest.fn(),
  decr: jest.fn(),
  del: jest.fn(),
  scan: jest.fn(),
  quit: jest.fn(),
  auth: jest.fn()
});

let client;

beforeEach(() => {
  client = createFakeClient();
  redis.createClient.mockReset();
  redis.createClient.mockReturnValue(client);
  configs.get.mockImplementation(key => (
    key === 'redisUrl' ? 'redis://127.0.0.1:6379' : undefined
  ));
});

test('incr returns the counter value and reset time', done => {
  const store = new MfaRateLimitStore(30000);
  client.incr.mockImplementation((key, cb) => cb(null, 4));
  const before = Date.now();

  store.incr('user-1', (err, current, resetTime) => {
    expect(err).toBeNull();
    expect(current).toBe(4);
    expect(client.incr).toHaveBeenCalledWith('mfa:limit:user-1', expect.any(Function));
    expect(client.expire).not.toHaveBeenCalled();
    expect(resetTime).toBeInstanceOf(Date);
    expect(resetTime.getTime()).toBeGreaterThanOrEqual(before + 30000);
    expect(resetTime.getTime()).toBeLessThanOrEqual(Date.now() + 30000);
    expect(redis.createClient).toHaveBeenCalledTimes(1);
    expect(redis.createClient).toHaveBeenCalledWith({ url: 'redis://127.0.0.1:6379' });
    expect(client.auth).not.toHaveBeenCalled();
    done();
  });
});

test('incr expires the key with the configured window when the counter is 1', done => {
  const store = new MfaRateLimitStore(30000);
  client.incr.mockImplementation((key, cb) => cb(null, 1));

  store.incr('user-1', (err, current) => {
    expect(err).toBeNull();
    expect(current).toBe(1);
    expect(client.expire).toHaveBeenCalledTimes(1);
    expect(client.expire.mock.calls[0][0]).toBe('mfa:limit:user-1');
    expect(client.expire.mock.calls[0][1]).toBe(30);
    done();
  });
});

test('resetKey deletes the prefixed key', () => {
  const store = new MfaRateLimitStore();
  store.resetKey('user-1');
  expect(client.del).toHaveBeenCalledWith('mfa:limit:user-1');
});

test('incr passes a Redis error to the callback', done => {
  const store = new MfaRateLimitStore();
  const redisErr = new Error('connection refused');
  client.incr.mockImplementation((key, cb) => cb(redisErr));

  store.incr('user-1', (err, current, resetTime) => {
    expect(err).toBe(redisErr);
    expect(current).toBeUndefined();
    expect(resetTime).toBeUndefined();
    expect(client.expire).not.toHaveBeenCalled();
    done();
  });
});

test('decrement decreases the prefixed key', () => {
  const store = new MfaRateLimitStore();
  store.decrement('user-1');
  expect(client.decr).toHaveBeenCalledWith('mfa:limit:user-1');
});

test('resetAll scans the prefix and deletes returned keys', () => {
  client.scan.mockImplementation((cursor, mode, pattern, cb) => {
    expect(mode).toBe('MATCH');
    expect(pattern).toBe('mfa:limit:*');
    if (cursor === '0') cb(null, ['7', ['mfa:limit:a']]);
    else cb(null, ['0', ['mfa:limit:b']]);
  });
  const store = new MfaRateLimitStore();
  store.resetAll();

  expect(client.scan).toHaveBeenCalledWith(
    '0', 'MATCH', 'mfa:limit:*', expect.any(Function)
  );
  expect(client.del).toHaveBeenCalledWith(['mfa:limit:a']);
  expect(client.del).toHaveBeenCalledWith(['mfa:limit:b']);
  expect(client.keys).toBeUndefined();
});

test('close quits the redis client', () => {
  const store = new MfaRateLimitStore();
  client.incr.mockImplementation((key, cb) => cb(null, 1));
  store.incr('k', () => {});
  store.close();
  expect(client.quit).toHaveBeenCalledTimes(1);
});

test('constructor authenticates when the redis URL contains a password', () => {
  configs.get.mockImplementation(key => (
    key === 'redisUrl' ? 'redis://:s3cret@127.0.0.1:6379' : undefined
  ));
  const store = new MfaRateLimitStore();
  store._client();
  expect(redis.createClient).toHaveBeenCalledWith({ url: 'redis://127.0.0.1:6379' });
  expect(client.auth).toHaveBeenCalledWith(':s3cret');
});
