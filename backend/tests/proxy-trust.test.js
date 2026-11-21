/** @jest-environment node */
const express = require('express');
const configureProxyTrust = require('../proxyTrust');

function requestIp (app, transportIp, forwardedFor) {
  const req = Object.create(app.request);
  req.socket = { remoteAddress: transportIp };
  req.headers = forwardedFor ? { 'x-forwarded-for': forwardedFor } : {};
  return req.ip;
}

test('untrusted transport cannot spoof identity with X-Forwarded-For', () => {
  const app = express();
  configureProxyTrust(app);
  expect(requestIp(app, '198.51.100.10', '203.0.113.1')).toBe('198.51.100.10');
  expect(requestIp(app, '198.51.100.10', '203.0.113.2')).toBe('198.51.100.10');
});

test('trusted loopback proxy preserves separate client identities', () => {
  const app = express();
  configureProxyTrust(app);
  expect(requestIp(app, '127.0.0.1', '203.0.113.1')).toBe('203.0.113.1');
  expect(requestIp(app, '::1', '203.0.113.2')).toBe('203.0.113.2');
});

test('untrusted intermediate proxy cannot smuggle a leftmost forged address', () => {
  const app = express();
  configureProxyTrust(app);
  expect(requestIp(app, '127.0.0.1', '203.0.113.1, 198.51.100.11'))
    .toBe('198.51.100.11');
});
