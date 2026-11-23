/** @jest-environment node */
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const httpMocks = require('node-mocks-http');

const mockState = {
  clientStaticDir: '',
  removeBranding: false,
  companyName: 'TestCo',
  clientConfig: { jwtInSessionStorage: true },
  logFilePath: path.join(os.tmpdir(), 'fleximanage-csp-test.log')
};

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
};

jest.mock('../configs', () => () => ({
  get: (key) => {
    const map = {
      restServerUrl: ['https://localhost:3443'],
      redisUrl: 'redis://127.0.0.1:6379',
      environment: 'test',
      shouldRedirectHttps: false,
      userIpReqRateLimit: 300,
      clientStaticDir: mockState.clientStaticDir,
      removeBranding: mockState.removeBranding,
      companyName: mockState.companyName,
      validateOpenAPIRequest: false,
      validateOpenAPIResponse: false,
      ticketingSystemUsername: '',
      ticketingSystemToken: '',
      ticketingSystemUrl: '',
      ticketingSystemAccountId: '',
      logFilePath: mockState.logFilePath
    };
    return map[key];
  },
  getClientConfig: () => mockState.clientConfig
}));

jest.mock('../routes/cors', () => ({
  corsWithOptions: (req, res, next) => next()
}));
jest.mock('../utils/openapiRouter', () => () => (req, res, next) => next());
jest.mock('express-openapi-validator', () => ({
  middleware: () => (req, res, next) => next()
}));
jest.mock('swagger-ui-express', () => ({
  serve: (req, res, next) => next(),
  setup: () => (req, res, next) => next()
}));
jest.mock('passport', () => ({
  initialize: () => (req, res, next) => next()
}));
jest.mock('../websocket/Connections', () => () => ({
  verifyDevice: jest.fn(),
  registerConnectCallback: jest.fn(),
  registerCloseCallback: jest.fn(),
  createConnection: jest.fn()
}));
jest.mock('../broker/broker', () => ({
  deviceConnectionOpened: jest.fn(),
  deviceConnectionClosed: jest.fn()
}));
jest.mock('../authenticate', () => ({
  verifyUserJWT: (req, res, next) => next()
}));
jest.mock('../routes/connect', () => {
  const express = require('express');
  return { connectRouter: express.Router() };
});
jest.mock('../deviceLogic/DevSwVersionUpdateManager', () => ({
  getSwVerUpdaterInstance: () => ({
    getLatestSwVersions: jest.fn().mockResolvedValue(null)
  })
}));
jest.mock('../logging/logging', () => () => mockLogger);
jest.mock('../logging/request-logging', () => ({
  reqLogger: (req, res, next) => next(),
  errLogger: (err, req, res, next) => next(err)
}));

const mockNoopPeriodic = () => () => ({
  start: jest.fn(),
  deviceConnectionClosed: jest.fn()
});
jest.mock('../periodic/deviceStatus', () => mockNoopPeriodic());
jest.mock('../periodic/deviceQueue', () => mockNoopPeriodic());
jest.mock('../periodic/deviceSwVersion', () => mockNoopPeriodic());
jest.mock('../periodic/deviceperiodicUpgrade', () => mockNoopPeriodic());
jest.mock('../periodic/notifyUsers', () => mockNoopPeriodic());
jest.mock('../periodic/releasePendingTunnels', () => mockNoopPeriodic());
jest.mock('../periodic/appRules', () => mockNoopPeriodic());
jest.mock('../periodic/applications', () => mockNoopPeriodic());
jest.mock('../periodic/statusesInDb', () => mockNoopPeriodic());
jest.mock('../applicationLogic/initializeApps', () => ({}));

const mockNoopRouter = () => {
  const express = require('express');
  return express.Router();
};
jest.mock('../routes/admin', () => mockNoopRouter());
jest.mock('../routes/tickets', () => () => mockNoopRouter());
jest.mock('../routes/users', () => mockNoopRouter());
jest.mock('../routes/public', () => mockNoopRouter());
jest.mock('../routes/deviceStats', () => mockNoopRouter());
jest.mock('../routes/portals', () => mockNoopRouter());
jest.mock('../routes/interfaces-routing', () => mockNoopRouter());
jest.mock('../utils/roleSelector', () => () => ({
  initializeSelector: jest.fn()
}));

const ExpressServer = require('../expressserver');

function parseCsp (headerValue) {
  const directives = {};
  for (const part of String(headerValue || '').split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [name, ...sources] = trimmed.split(/\s+/);
    directives[name.toLowerCase()] = sources;
  }
  return directives;
}

function invokeApp (app, urlPath = '/') {
  return new Promise((resolve, reject) => {
    const req = httpMocks.createRequest({
      method: 'GET',
      url: urlPath,
      headers: { host: 'localhost:3443' }
    });
    const res = httpMocks.createResponse({ eventEmitter: EventEmitter });
    res.on('end', () => {
      resolve({
        status: res.statusCode,
        headers: res.getHeaders(),
        body: res._getData(),
        locals: res.locals
      });
    });
    app(req, res, (err) => {
      if (err) reject(err);
    });
  });
}

function invokeAppHttp (app, urlPath = '/') {
  return new Promise((resolve, reject) => {
    const httpServer = http.createServer(app);
    httpServer.listen(0, '127.0.0.1', () => {
      const { port } = httpServer.address();
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method: 'GET',
        headers: { host: 'localhost:3443' }
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          httpServer.close(() => {
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks).toString('utf8')
            });
          });
        });
      });
      req.on('error', (err) => httpServer.close(() => reject(err)));
      req.end();
    });
  });
}

describe('CSP script nonce enforcement', () => {
  let tmpDir;
  let staticDir;
  let openApiPath;
  let server;
  let launchSpy;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleximanage-csp-'));
    staticDir = path.join(tmpDir, 'static');
    fs.mkdirSync(staticDir, { recursive: true });
    mockState.clientStaticDir = path.relative(path.join(__dirname, '..'), staticDir);

    openApiPath = path.join(tmpDir, 'openapi.yaml');
    fs.writeFileSync(
      openApiPath,
      'servers:\n  - url: https://localhost:3443/api\ncomponents:\n  schemas: {}\n',
      'utf8'
    );

    const builtHtml = fs.readFileSync(
      path.join(__dirname, '..', '..', 'frontend', 'index.html'),
      'utf8'
    ).replace(
      '<script type="module" src="/src/index.jsx"></script>',
      '<script type="module" crossorigin src="/static/index-abc123.js"></script>'
    );
    fs.writeFileSync(path.join(staticDir, 'index.html'), builtHtml, 'utf8');

    // Prevent ExpressServer from binding sockets or reading TLS certs in unit tests.
    launchSpy = jest.spyOn(ExpressServer.prototype, 'launch').mockImplementation(function () {
      this.addErrorHandler();
      return Promise.resolve();
    });

    server = new ExpressServer(0, 0, openApiPath);
  });

  afterAll(() => {
    if (launchSpy) launchSpy.mockRestore();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    mockLogger.error.mockClear();
    mockLogger.warn.mockClear();
  });

  test('sets a per-request script-src nonce without unsafe-inline and preserves allowlist',
    async () => {
      const first = await invokeApp(server.app, '/');
      const second = await invokeApp(server.app, '/');

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);

      const firstCsp = parseCsp(first.headers['content-security-policy']);
      const secondCsp = parseCsp(second.headers['content-security-policy']);

      const firstScriptSrc = firstCsp['script-src'];
      const secondScriptSrc = secondCsp['script-src'];

      expect(firstScriptSrc).toBeDefined();
      expect(firstScriptSrc).not.toContain("'unsafe-inline'");
      expect(firstScriptSrc).toContain("'self'");
      expect(firstScriptSrc).toContain('https://challenges.cloudflare.com');
      expect(firstScriptSrc).toContain('https://cdn.jsdelivr.net');

      // style-src keeps 'unsafe-inline' as required for dependency inline styles.
      expect(firstCsp['style-src']).toContain("'unsafe-inline'");
      expect(firstCsp['frame-src']).toContain('https://challenges.cloudflare.com');
      expect(firstCsp['object-src']).toEqual(["'none'"]);

      const nonceEntry1 = firstScriptSrc.find((src) => src.startsWith("'nonce-"));
      const nonceEntry2 = secondScriptSrc.find((src) => src.startsWith("'nonce-"));
      expect(nonceEntry1).toMatch(/^'nonce-[A-Za-z0-9+/=]{16,}'$/);
      expect(nonceEntry2).toMatch(/^'nonce-[A-Za-z0-9+/=]{16,}'$/);
      expect(nonceEntry1).not.toBe(nonceEntry2);
    }
  );

  test('injects the exact CSP nonce into the served HTML inline config script', async () => {
    const response = await invokeApp(server.app, '/');
    expect(response.status).toBe(200);

    const csp = parseCsp(response.headers['content-security-policy']);
    const nonceToken = csp['script-src'].find((src) => src.startsWith("'nonce-"));
    const expectedNonce = nonceToken.slice("'nonce-".length, -1);

    expect(response.body).not.toContain('__CSP_NONCE__');

    const inlineMatch = response.body.match(
      /<script([^>]*)>([\s\S]*?window\.__FLEXIWAN_SERVER_CONFIG__[\s\S]*?)<\/script>/i
    );
    expect(inlineMatch).not.toBeNull();
    expect(inlineMatch[1]).toContain(`nonce="${expectedNonce}"`);
    expect(inlineMatch[2]).toContain('"jwtInSessionStorage":true');

    // External module script tag remains intact.
    expect(response.body).toContain(
      '<script type="module" crossorigin src="/static/index-abc123.js"></script>'
    );
  });

  test('also nonces the inline script on SPA fallback routes and without placeholder attr',
    async () => {
      const indexPath = path.join(staticDir, 'index.html');
      const originalHtml = fs.readFileSync(indexPath, 'utf8');
      try {
        const plainHtml = originalHtml.replace('<script nonce="__CSP_NONCE__">', '<script>');
        fs.writeFileSync(indexPath, plainHtml, 'utf8');

        const response = await invokeApp(server.app, '/devices/overview');
        expect(response.status).toBe(200);

        const csp = parseCsp(response.headers['content-security-policy']);
        const nonceToken = csp['script-src'].find((src) => src.startsWith("'nonce-"));
        const expectedNonce = nonceToken.slice("'nonce-".length, -1);

        const inlineMatch = response.body.match(
          /<script([^>]*)>([\s\S]*?window\.__FLEXIWAN_SERVER_CONFIG__[\s\S]*?)<\/script>/i
        );
        expect(inlineMatch).not.toBeNull();
        expect(inlineMatch[1]).toContain(`nonce="${expectedNonce}"`);
      } finally {
        fs.writeFileSync(indexPath, originalHtml, 'utf8');
      }
    }
  );

  test('fails closed and omits the inline script when no valid nonce is available', () => {
    for (const locals of [{}, { cspNonce: '' }, { cspNonce: 'bad"nonce' }]) {
      const req = httpMocks.createRequest({ method: 'GET', url: '/' });
      const res = httpMocks.createResponse();
      res.locals = locals;

      server.sendIndexFile(req, res);

      const html = res._getData();
      expect(html).not.toContain('window.__FLEXIWAN_SERVER_CONFIG__');
      expect(html).not.toContain('__CSP_NONCE__');
      // External bundle script is still present.
      expect(html).toContain(
        '<script type="module" crossorigin src="/static/index-abc123.js"></script>'
      );
    }
    expect(mockLogger.error).toHaveBeenCalledTimes(3);
  });

  test('routes /index.html and equivalent/encoded/slash paths through sendIndexFile with nonce and Cache-Control: no-store', async () => {
    fs.mkdirSync(path.join(staticDir, 'static'), { recursive: true });
    fs.writeFileSync(path.join(staticDir, 'static', 'index-abc123.js'), 'console.log("ok");', 'utf8');

    const equivalentPaths = [
      '/',
      '/index.html',
      '//index.html',
      '/%69ndex.html',
      '/index%2ehtml',
      '/./index.html',
      '/sub/../index.html',
      '/index.html/',
      '/devices/overview'
    ];

    for (const urlPath of equivalentPaths) {
      const response = await invokeAppHttp(server.app, urlPath);
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).not.toContain('__CSP_NONCE__');

      const csp = parseCsp(response.headers['content-security-policy']);
      const nonceToken = csp['script-src'].find((src) => src.startsWith("'nonce-"));
      const expectedNonce = nonceToken.slice("'nonce-".length, -1);

      const inlineMatch = response.body.match(
        /<script([^>]*)>([\s\S]*?window\.__FLEXIWAN_SERVER_CONFIG__[\s\S]*?)<\/script>/i
      );
      expect(inlineMatch).not.toBeNull();
      expect(inlineMatch[1]).toContain(`nonce="${expectedNonce}"`);
      expect(inlineMatch[2]).toContain('"jwtInSessionStorage":true');
    }

    // Non-entry static assets are still served by express.static.
    const assetResponse = await invokeAppHttp(server.app, '/static/index-abc123.js');
    expect(assetResponse.status).toBe(200);
    expect(assetResponse.body).toContain('console.log("ok");');
  });

  test('mounts mongoSanitize after body parsers and redacts URLs in morgan dev logging', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'expressserver.js'), 'utf8');
    const jsonPos = source.indexOf('this.app.use(express.json())');
    const urlEncodedPos = source.indexOf('this.app.use(express.urlencoded(');
    const sanitizePos = source.indexOf('this.app.use(mongoSanitize())');
    expect(jsonPos).toBeGreaterThan(-1);
    expect(urlEncodedPos).toBeGreaterThan(-1);
    expect(sanitizePos).toBeGreaterThan(jsonPos);
    expect(sanitizePos).toBeGreaterThan(urlEncodedPos);

    expect(source).not.toContain("morgan('dev')");
    expect(source).toContain('redacted-url');
    const morgan = require('morgan');
    const formatted = morgan['redacted-url']({
      originalUrl: '/reset-password?id=507f1f77bcf86cd799439011&t=super-secret-reset-token'
    });
    expect(formatted).toBe('/reset-password');
    expect(formatted).not.toContain('super-secret-reset-token');
  });
});
