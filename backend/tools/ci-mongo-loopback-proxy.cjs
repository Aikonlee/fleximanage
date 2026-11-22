#!/usr/bin/env node
'use strict';

// Loopback-only TCP forwarder for CI environments (e.g. GitLab CI Docker executor)
// where the isolated MongoDB service container is reachable at mongo:27017 rather
// than 127.0.0.1:27099. Refuses non-isolated target hosts to prevent ever
// proxying to a staging/production database.

const fs = require('fs');
const net = require('net');

const LISTEN_HOST = '127.0.0.1';
const LISTEN_PORT = 27099;
const ALLOWED_TARGET_HOSTS = new Set(['mongo', '127.0.0.1', 'localhost']);

const args = process.argv.slice(2);
let targetHost = process.env.CI_MONGO_SERVICE_HOST || 'mongo';
let targetPort = Number(process.env.CI_MONGO_SERVICE_PORT || 27017);
let readyFile = null;
let timeoutMs = 30000;

for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--target-host' && args[i + 1]) {
    targetHost = args[++i];
  } else if (args[i] === '--target-port' && args[i + 1]) {
    targetPort = Number(args[++i]);
  } else if (args[i] === '--ready-file' && args[i + 1]) {
    readyFile = args[++i];
  } else if (args[i] === '--timeout-ms' && args[i + 1]) {
    timeoutMs = Number(args[++i]);
  }
}

if (!ALLOWED_TARGET_HOSTS.has(targetHost)) {
  console.error(`Refusing to proxy to non-isolated MongoDB host: ${targetHost}`);
  process.exit(2);
}
if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
  console.error(`Invalid target port: ${targetPort}`);
  process.exit(2);
}

function probeTarget () {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: targetHost, port: targetPort });
    sock.setTimeout(1000);
    sock.once('connect', () => {
      sock.destroy();
      resolve(true);
    });
    sock.once('timeout', () => {
      sock.destroy();
      resolve(false);
    });
    sock.once('error', () => {
      sock.destroy();
      resolve(false);
    });
  });
}

async function waitForTarget () {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeTarget()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function main () {
  const reachable = await waitForTarget();
  if (!reachable) {
    console.error(`Isolated MongoDB service ${targetHost}:${targetPort} did not become reachable within ${timeoutMs}ms`);
    process.exit(1);
  }

  const sockets = new Set();
  const server = net.createServer((client) => {
    const upstream = net.createConnection({ host: targetHost, port: targetPort });
    sockets.add(client);
    sockets.add(upstream);

    client.pipe(upstream);
    upstream.pipe(client);

    const cleanup = () => {
      sockets.delete(client);
      sockets.delete(upstream);
      client.destroy();
      upstream.destroy();
    };
    client.on('error', cleanup);
    upstream.on('error', cleanup);
    client.on('close', cleanup);
    upstream.on('close', cleanup);
  });

  server.on('error', (err) => {
    console.error(`Loopback MongoDB proxy listen error on ${LISTEN_HOST}:${LISTEN_PORT}: ${err.message}`);
    process.exit(1);
  });

  server.listen(LISTEN_PORT, LISTEN_HOST, () => {
    if (readyFile) {
      fs.writeFileSync(readyFile, `${process.pid}\n`, 'utf8');
    }
    console.log(`Loopback MongoDB proxy listening on ${LISTEN_HOST}:${LISTEN_PORT} -> ${targetHost}:${targetPort}`);
  });

  const shutdown = () => {
    for (const sock of sockets) sock.destroy();
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main();
