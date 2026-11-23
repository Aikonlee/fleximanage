const dns = require('dns');
const http = require('http');

jest.mock('fetch-with-proxy', () => ({
  __esModule: true,
  default: jest.fn(async () => ({
    ok: true,
    json: async () => ({ status: 'success' })
  }))
}));

const fetch = require('fetch-with-proxy').default;
const createWebHooks = require('../utils/webhooks');
const { setAuthCookies } = require('../utils/authCookies');

const VALID_USER_SECRET = 'user-token-secret-value-32-bytes!';
const VALID_DEVICE_SECRET = 'device-token-secret-value-32byte!';
const PLACEHOLDER = 'CHANGE_ME_IN_PRODUCTION';

function mockLookup (addresses) {
  const list = addresses.map((address) => ({
    address,
    family: address.includes(':') ? 6 : 4
  }));
  return jest.spyOn(dns.promises, 'lookup').mockImplementation(async () => list);
}

describe('blocked webhook ranges', () => {
  const { isBlockedWebhookTarget } = createWebHooks;

  it.each([
    '0.0.0.0',
    '0.1.2.3',
    '0.255.255.255',
    '100.64.0.0',
    '100.64.1.1',
    '100.127.255.255',
    'fc00::1',
    'fd00::1',
    'fd12:3456::abcd',
    '::ffff:0.0.0.1',
    '::ffff:10.1.2.3',
    '::ffff:100.64.0.1',
    '::ffff:127.0.0.1',
    'https://[fc00::2]/hook',
    'https://[::ffff:100.127.1.1]/hook',
    'https://0.2.3.4/hook'
  ])('blocks %s', (target) => {
    expect(isBlockedWebhookTarget(target)).toBe(true);
  });

  it.each([
    '1.0.0.1',
    '100.63.255.255',
    '100.128.0.1',
    '8.8.8.8',
    '2001:db8::5',
    'fec0::1',
    '::ffff:8.8.8.8',
    '::ffff:1.1.1.1',
    'https://[2001:db8::5]/hook'
  ])('allows %s', (target) => {
    expect(isBlockedWebhookTarget(target)).toBe(false);
  });
});

describe('pinned webhook lookup', () => {
  const hooks = createWebHooks();

  beforeEach(() => {
    fetch.mockClear();
    fetch.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ status: 'success' })
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('passes a lookup pinned to the validated address and disables redirects', async () => {
    mockLookup(['203.0.113.10', '203.0.113.11']);
    const sent = hooks.sendToWebHook('https://hooks.example/hook', { ok: true });
    await expect(sent).resolves.toBe(true);
    const options = fetch.mock.calls[0][1];
    expect(options.redirect).toBe('error');
    expect(options.agent).toBeInstanceOf(http.Agent);
    const pinned = await new Promise((resolve, reject) => {
      options.agent.options.lookup('attacker.example', { all: true }, (err, addresses) => {
        if (err) reject(err);
        else resolve(addresses);
      });
    });
    expect(pinned).toEqual([{ address: '203.0.113.10', family: 4 }]);
    const direct = createWebHooks.lookupPinnedTo('2001:db8::5');
    const one = await new Promise((resolve, reject) => {
      direct('ignored.example', (err, address, family) => {
        if (err) reject(err);
        else resolve({ address, family });
      });
    });
    expect(one).toEqual({ address: '2001:db8::5', family: 6 });
  });

  it('fails instead of following a 302 redirect response', async () => {
    mockLookup(['203.0.113.10']);
    const jsonSpy = jest.fn(async () => ({ status: 'success' }));
    fetch.mockImplementation(async (_url, options) => {
      expect(options.redirect).toBe('error');
      return {
        status: 302,
        ok: false,
        headers: { get: () => 'http://169.254.169.254/latest/meta-data/' },
        json: jsonSpy
      };
    });
    await expect(hooks.sendToWebHook('https://hooks.example/hook', { ok: true }))
      .resolves.toBe(false);
    expect(jsonSpy).not.toHaveBeenCalled();

    // End-to-end verification with real fetch-with-proxy: redirect:'error' aborts 302 without
    // contacting the redirect destination.
    const realFetch = jest.requireActual('fetch-with-proxy').default;
    const targetHits = [];
    const targetServer = http.createServer((req, res) => {
      targetHits.push(req.url);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'success' }));
    });
    await new Promise((resolve) => targetServer.listen(0, '127.0.0.1', resolve));
    const targetPort = targetServer.address().port;

    const redirectServer = http.createServer((req, res) => {
      res.writeHead(302, { Location: `http://127.0.0.1:${targetPort}/secret` });
      res.end();
    });
    await new Promise((resolve) => redirectServer.listen(0, '127.0.0.1', resolve));
    const redirectPort = redirectServer.address().port;

    try {
      await expect(realFetch(`http://127.0.0.1:${redirectPort}/hook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true }),
        redirect: 'error'
      })).rejects.toThrow(/redirect/i);
      expect(targetHits).toEqual([]);
    } finally {
      await new Promise((resolve) => redirectServer.close(resolve));
      await new Promise((resolve) => targetServer.close(resolve));
    }
  });

  it('logs and returns false when background delivery cannot resolve the domain', async () => {
    jest.spyOn(dns.promises, 'lookup').mockRejectedValue(Object.assign(new Error('ENOTFOUND'), {
      code: 'ENOTFOUND'
    }));
    const sent = await hooks.sendToWebHook('https://missing.example/hook', { ok: true });
    expect(sent).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('still rejects a resolved private address', async () => {
    mockLookup(['10.1.2.3']);
    await expect(hooks.sendToWebHook('https://rebind.example/hook', { ok: true }))
      .rejects.toThrow(/resolves to 10\.1\.2\.3/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('auth cookie secure flag', () => {
  it('uses req.secure and ignores a client-supplied forwarded proto', () => {
    const res = { cookie: jest.fn() };
    setAuthCookies({
      secure: false,
      headers: { 'x-forwarded-proto': 'https' }
    }, res, 'access', 'refresh');
    expect(res.cookie).toHaveBeenCalledTimes(2);
    for (const call of res.cookie.mock.calls) {
      expect(call[2].secure).toBe(false);
    }

    const secureRes = { cookie: jest.fn() };
    setAuthCookies({ secure: true, headers: { 'x-forwarded-proto': 'http' } }, secureRes, 'a', 'b');
    for (const call of secureRes.cookie.mock.calls) {
      expect(call[2].secure).toBe(true);
    }
  });
});

describe('token secret startup guard', () => {
  const envKeys = ['USER_SECRET_KEY', 'DEVICE_SECRET_KEY', 'LISTEN_HOST'];
  let saved;

  beforeEach(() => {
    saved = {};
    for (const key of envKeys) saved[key] = process.env[key];
    for (const key of envKeys) delete process.env[key];
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    jest.restoreAllMocks();
    jest.resetModules();
  });

  function boot (envName) {
    jest.resetModules();
    const printed = [];
    console.log.mockImplementation((line) => printed.push(String(line)));
    console.error.mockImplementation((line) => printed.push(String(line)));
    let loaded;
    let thrown;
    try {
      loaded = require('../configs')(envName);
    } catch (err) {
      thrown = err;
    }
    return { loaded, thrown, printed: printed.join('\n') };
  }

  it('aborts when either token secret is missing, short, or the placeholder', () => {
    const userKey = 'userTokenSecretKey';
    const deviceKey = 'deviceTokenSecretKey';
    const cases = [
      [{ USER_SECRET_KEY: '', DEVICE_SECRET_KEY: VALID_DEVICE_SECRET }, userKey],
      [{ USER_SECRET_KEY: 'short', DEVICE_SECRET_KEY: VALID_DEVICE_SECRET }, userKey],
      [{ USER_SECRET_KEY: PLACEHOLDER, DEVICE_SECRET_KEY: VALID_DEVICE_SECRET }, userKey],
      [{ USER_SECRET_KEY: VALID_USER_SECRET, DEVICE_SECRET_KEY: '' }, deviceKey],
      [{ USER_SECRET_KEY: VALID_USER_SECRET, DEVICE_SECRET_KEY: 'x'.repeat(31) }, deviceKey],
      [{ USER_SECRET_KEY: VALID_USER_SECRET, DEVICE_SECRET_KEY: PLACEHOLDER }, deviceKey]
    ];
    for (const [extra, label] of cases) {
      delete process.env.USER_SECRET_KEY;
      delete process.env.DEVICE_SECRET_KEY;
      Object.assign(process.env, extra);
      const { loaded, thrown, printed } = boot('production');
      expect(loaded).toBeUndefined();
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown.message).toContain(label);
      expect(thrown.message).toContain('at least 32 bytes');
      expect(printed).not.toContain(VALID_USER_SECRET);
      expect(printed).not.toContain(VALID_DEVICE_SECRET);
      expect(printed).not.toContain('short');
      expect(printed).not.toContain('x'.repeat(31));
      expect(thrown.message).not.toContain(PLACEHOLDER);
    }
  });

  it('starts with 32-byte secrets and binds to 127.0.0.1 by default', () => {
    process.env.USER_SECRET_KEY = VALID_USER_SECRET;
    process.env.DEVICE_SECRET_KEY = VALID_DEVICE_SECRET;
    const { loaded, thrown, printed } = boot('production');
    expect(thrown).toBeUndefined();
    expect(loaded.get('listenHost')).toBe('127.0.0.1');
    expect(loaded.get('userTokenSecretKey')).toBe(VALID_USER_SECRET);
    expect(printed).not.toContain(VALID_USER_SECRET);
    expect(printed).not.toContain(VALID_DEVICE_SECRET);
    expect(printed).toContain('***REDACTED***');
  });
});
