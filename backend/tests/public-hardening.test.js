const http = require('http');
const https = require('https');
const express = require('express');
const { PassThrough } = require('stream');
const publicRouter = require('../routes/public');
const MemoryStore = require('../rateLimitStore');

const MAX_TILE_ZOOM = 24;
const MAX_TILE_INDEX = 2 ** 24;

function tileApp () {
  const app = express();
  app.use('/api/public', publicRouter);
  return app;
}

function request (app, path) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const req = http.get({ hostname: '127.0.0.1', port, path }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          server.close(() => {
            resolve({
              status: res.statusCode,
              body: Buffer.concat(chunks).toString('utf8')
            });
          });
        });
      });
      req.on('error', (err) => server.close(() => reject(err)));
    });
  });
}

function incr (store, key) {
  return new Promise((resolve, reject) => {
    store.incr(key, (err, hits, resetTime) => {
      if (err) reject(err);
      else resolve({ hits, resetTime });
    });
  });
}

describe('public tile coordinates', () => {
  const app = tileApp();

  beforeEach(() => {
    jest.spyOn(https, 'get').mockImplementation((url, options, cb) => {
      const incoming = new PassThrough();
      incoming.statusCode = 200;
      process.nextTick(() => {
        cb(incoming);
        incoming.end('png');
      });
      return { on () { return this; } };
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('rejects non-digits and out-of-range zoom or indexes', async () => {
    const bad = [
      '/api/public/tiles/1e2/0/0',
      '/api/public/tiles/-1/0/0',
      '/api/public/tiles/1.5/0/0',
      '/api/public/tiles/Infinity/0/0',
      '/api/public/tiles/+1/0/0',
      '/api/public/tiles/0x10/0/0',
      `/api/public/tiles/${MAX_TILE_ZOOM + 1}/0/0`,
      `/api/public/tiles/0/${MAX_TILE_INDEX}/0`,
      `/api/public/tiles/1/0/${MAX_TILE_INDEX}`,
      '/api/public/tiles/000000001/0/0'
    ];
    for (const path of bad) {
      const res = await request(app, path);
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body)).toEqual({ error: 'Invalid tile coordinates' });
    }
    expect(https.get).not.toHaveBeenCalled();
  });

  test('proxies in-range digit coordinates, including the zoom and index limits', async () => {
    const ok = [
      '/api/public/tiles/0/0/0',
      `/api/public/tiles/${MAX_TILE_ZOOM}/0/0`,
      `/api/public/tiles/24/${MAX_TILE_INDEX - 1}/${MAX_TILE_INDEX - 1}`
    ];
    for (const path of ok) {
      https.get.mockClear();
      const res = await request(app, path);
      expect(res.status).toBe(200);
      expect(https.get).toHaveBeenCalledTimes(1);
      const upstream = path.replace('/api/public/tiles/', '');
      expect(https.get.mock.calls[0][0]).toBe(`https://a.tile.openstreetmap.org/${upstream}.png`);
    }
  });
});

describe('MemoryStore per-key TTL', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('does not install a process-wide reset interval', () => {
    const spy = jest.spyOn(global, 'setInterval');
    const store = new MemoryStore(5 * 60 * 1000);
    expect(store.windowMs).toBe(5 * 60 * 1000);
    expect(spy).not.toHaveBeenCalled();
    store.resetAll();
    spy.mockRestore();
  });

  test('expires each key on its own window', async () => {
    const store = new MemoryStore(1000);
    expect((await incr(store, 'a')).hits).toBe(1);
    expect((await incr(store, 'a')).hits).toBe(2);
    const firstReset = (await incr(store, 'a')).resetTime;

    jest.advanceTimersByTime(400);
    const second = await incr(store, 'b');
    expect(second.hits).toBe(1);
    expect(second.resetTime.getTime() - firstReset.getTime()).toBe(400);

    jest.advanceTimersByTime(700);
    expect(store.getHitsByKey('a')).toBeUndefined();
    expect(store.getHitsByKey('b')).toBe(1);
    expect((await incr(store, 'a')).hits).toBe(1);
    expect((await incr(store, 'b')).hits).toBe(2);
    store.resetAll();
  });

  test('decrement, resetKey, and resetAll keep the v5 store interface', async () => {
    const store = new MemoryStore(5 * 60 * 1000);
    await incr(store, 'a');
    await incr(store, 'a');
    store.decrement('a');
    expect(store.getHitsByKey('a')).toBe(1);
    await incr(store, 'b');
    store.resetKey('a');
    expect(store.getHitsByKey('a')).toBeUndefined();
    expect(store.getHitsByKey('b')).toBe(1);
    store.decrement('b');
    expect(store.getHitsByKey('b')).toBe(0);
    store.resetAll();
    expect(store.getHitsByKey('b')).toBeUndefined();
  });
});
