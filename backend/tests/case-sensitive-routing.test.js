/** @jest-environment node */
const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');

jest.mock('../mongoConns', () => {
  const mongooseLib = require('mongoose');
  const main = mongooseLib.createConnection();
  return () => ({ getMainDB: () => main });
});

const Sessions = require('../models/authSessions');

function request (app, urlPath) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const req = http.get({ hostname: '127.0.0.1', port, path: urlPath }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          server.close(() => resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString('utf8')
          }));
        });
      });
      req.on('error', (err) => server.close(() => reject(err)));
    });
  });
}

function buildPublicApp () {
  const app = express();
  app.set('case sensitive routing', true);
  app.get('/', (req, res) => res.status(200).send('index'));
  app.use('/api/public', (req, res) => res.status(200).json({ public: true }));
  app.get('/api/version', (req, res) => res.status(200).json({ version: 'test' }));
  app.get('/api/restServers', (req, res) => res.status(200).json({ version: 'test' }));
  app.get('/hello', (req, res) => res.status(200).send('Hello World'));
  app.use('/ok', (req, res) => res.status(200).send('ok'));
  app.use('/spec', (req, res) => res.status(200).send('spec'));
  app.use((req, res) => res.sendStatus(404));
  return app;
}

describe('auth session grace schema', () => {
  test('persists grace fields and a cleared graceHash does not match a replay', () => {
    const userId = new mongoose.Types.ObjectId();
    const accountId = new mongoose.Types.ObjectId();
    const until = new Date(Date.now() + 15000);
    const doc = new Sessions({
      sid: 'session-id',
      user: userId,
      account: accountId,
      authVersion: 0,
      refreshHash: 'current-hash',
      expiresAt: new Date(Date.now() + 86400000),
      graceHash: 'presented-hash',
      graceUntil: until,
      graceRotationCount: 0,
      notInSchema: 'dropped'
    });

    expect(doc.get('graceHash')).toBe('presented-hash');
    expect(doc.get('graceUntil')).toEqual(until);
    expect(doc.get('graceRotationCount')).toBe(0);
    expect(doc.get('notInSchema')).toBeUndefined();
    expect(Sessions.schema.path('graceHash').options.select).toBe(false);
    expect(Sessions.schema.path('graceUntil').instance).toBe('Date');
    expect(Sessions.schema.path('graceRotationCount').options.default).toBe(0);

    const omitted = new Sessions({
      sid: 'other',
      user: userId,
      account: accountId,
      authVersion: 0,
      refreshHash: 'hash',
      expiresAt: new Date()
    });
    expect(omitted.get('graceRotationCount')).toBe(0);

    // Same write rotateRefresh uses after a one-shot grace consume.
    doc.set({
      refreshHash: 'rotated-hash',
      graceHash: null,
      graceUntil: new Date(0)
    });
    doc.set('graceRotationCount', doc.get('graceRotationCount') + 1);
    expect(doc.get('graceHash')).toBeNull();
    expect(doc.get('graceRotationCount')).toBe(1);
    expect(doc.get('graceHash')).not.toBe('presented-hash');

    const replayFilter = {
      graceHash: 'presented-hash',
      graceUntil: { $gt: new Date() },
      graceRotationCount: { $not: { $gte: 1 } }
    };
    const stored = doc.toObject({ getters: false });
    expect(stored.graceHash).not.toBe(replayFilter.graceHash);
  });
});

describe('case sensitive public routing', () => {
  const app = buildPublicApp();
  const routes = [
    '/',
    '/api/public/tiles/0/0/0',
    '/api/version',
    '/api/restServers',
    '/hello',
    '/ok',
    '/spec'
  ];

  test('expressserver enables case sensitive routing next to app creation', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'expressserver.js'), 'utf8');
    expect(source).toMatch(
      /this\.app = express\(\);\n\s*\/\/[\s\S]*?this\.app\.set\('case sensitive routing', true\);/
    );
  });

  test('lowercase public routes match and uppercase variants do not', async () => {
    for (const route of routes) {
      const lower = await request(app, route);
      expect(lower.status).toBe(200);
      if (route === '/') continue;
      const upper = await request(app, route.replace(/[a-z]/g, (ch) => ch.toUpperCase()));
      expect(upper.status).toBe(404);
    }
  });
});
