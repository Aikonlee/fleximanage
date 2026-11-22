/** @jest-environment node */
const http = require('http');
const express = require('express');

jest.mock('passport', () => ({
  serializeUser: jest.fn(),
  deserializeUser: jest.fn(),
  authenticate: jest.fn((strategy, opts, callback) => (req, res, next) => {
    callback(null, false, { message: 'No auth token' });
  }),
  use: jest.fn()
}));
jest.mock('passport-local', () => ({ Strategy: class {} }));
jest.mock('passport-jwt', () => ({
  Strategy: class Strategy {},
  ExtractJwt: { fromAuthHeaderAsBearerToken: () => () => null }
}));
jest.mock('../models/users', () => ({
  serializeUser: () => () => {},
  deserializeUser: () => () => {},
  authenticate: () => () => {},
  findOne: jest.fn()
}));
jest.mock('../models/accounts', () => ({ findOne: jest.fn() }));
jest.mock('../models/accesstokens', () => ({ findOne: jest.fn() }));
jest.mock('../models/membership', () => ({
  permissionMasks: {},
  getUserPermissions: jest.fn()
}));
jest.mock('../utils/membershipUtils', () => ({
  orgUpdateFromNull: jest.fn(),
  getUserOrgByID: jest.fn()
}));
jest.mock('../utils/recaptcha', () => () => ({ verifyReCaptcha: jest.fn() }));
jest.mock('../utils/authCookies', () => ({ setAuthCookies: jest.fn() }));
jest.mock('../logging/logging', () => () => ({
  warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn()
}));
jest.mock('../configs', () => () => ({ get: () => false }));
jest.mock('../authSessions', () => ({
  validateAccess: jest.fn(),
  rotateRefresh: jest.fn()
}));
jest.mock('../tokens', () => ({
  verifyToken: jest.fn(),
  getToken: jest.fn(),
  getRefreshToken: jest.fn()
}));

const auth = require('../authenticate');

function request (app, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const req = http.get({ hostname: '127.0.0.1', port, path, headers }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          server.close(() => {
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks).toString('utf8')
            });
          });
        });
      });
      req.on('error', (err) => server.close(() => reject(err)));
    });
  });
}

function buildApp () {
  const app = express();
  // Same order as expressserver.js: public mounts, then the global JWT gate.
  // Case sensitive routing stays at the Express default (off).
  app.get('/hello', (req, res) => res.status(200).send('Hello World'));
  app.get('/api/version', (req, res) => res.status(200).json({ version: 'test' }));
  app.use('/api/public', (req, res) => res.status(200).json({ public: true }));
  app.use(auth.verifyUserJWT);
  app.get('/api/configuration/restServers', (req, res) => {
    res.status(200).json({ secret: true });
  });
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ message: err.message });
  });
  return app;
}

describe('auth gate path case', () => {
  const app = buildApp();

  test('rejects an uppercase protected path without Authorization', async () => {
    const upper = await request(app, '/API/configuration/restServers', {
      Origin: 'https://evil.example'
    });
    expect(upper.status).toBe(401);
    expect(upper.body).not.toContain('secret');
    expect(upper.headers['access-control-allow-origin']).toBeUndefined();

    const lower = await request(app, '/api/configuration/restServers');
    expect(lower.status).toBe(401);
    expect(lower.body).not.toContain('secret');
  });

  test('still serves public paths mounted before the gate', async () => {
    const hello = await request(app, '/hello');
    expect(hello.status).toBe(200);
    expect(hello.body).toBe('Hello World');

    const version = await request(app, '/api/version');
    expect(version.status).toBe(200);

    const pub = await request(app, '/api/public/tiles/0/0/0');
    expect(pub.status).toBe(200);
    expect(JSON.parse(pub.body).public).toBe(true);

    // Case-insensitive routing still reaches the public mount, which is before the gate.
    const pubUpper = await request(app, '/API/public/tiles/0/0/0');
    expect(pubUpper.status).toBe(200);
  });

  test('does not reflect Origin when the JWT gate rejects', async () => {
    const req = {
      method: 'GET',
      path: '/API/configuration/restServers',
      originalUrl: '/API/configuration/restServers',
      headers: {},
      header: (name) => (name === 'Origin' ? 'https://evil.example' : undefined)
    };
    const headers = {};
    const res = {
      setHeader: (name, value) => { headers[name.toLowerCase()] = value; },
      getHeaders: () => headers
    };
    const next = jest.fn();
    auth.verifyUserJWT(req, res, next);
    await new Promise(setImmediate);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }));
    expect(headers['access-control-allow-origin']).toBeUndefined();
  });

  test('lets non-API paths through the gate', () => {
    const req = {
      method: 'GET',
      path: '/hello',
      originalUrl: '/hello',
      headers: {},
      header: () => undefined
    };
    const res = { setHeader () {}, getHeaders: () => ({}) };
    const next = jest.fn();
    auth.verifyUserJWT(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });
});
