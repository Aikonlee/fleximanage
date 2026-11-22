const dns = require('dns');

jest.mock('fetch-with-proxy', () => ({
  __esModule: true,
  default: jest.fn(async () => ({
    ok: true,
    json: async () => ({ status: 'success' })
  }))
}));

const fetch = require('fetch-with-proxy').default;
const createWebHooks = require('../utils/webhooks');
const { isBlockedWebhookTarget } = createWebHooks;
const NotificationsConf = require('../models/notificationsConf');

const PUBLIC_HTTPS = 'https://hooks.slack.com/services/T00/B00/XXX';

function mockLookup (addresses) {
  const list = addresses.map((address) => ({
    address,
    family: address.includes(':') ? 6 : 4
  }));
  return jest.spyOn(dns.promises, 'lookup').mockImplementation(async () => list);
}

function settings (webhookURL) {
  return new NotificationsConf({
    webHookSettings: {
      webhookURL,
      sendCriticalAlerts: true,
      sendWarningAlerts: false
    }
  });
}

describe('isBlockedWebhookTarget', () => {
  it.each([
    '127.0.0.1',
    '127.255.255.254',
    '10.0.0.1',
    '10.255.255.255',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.20',
    '169.254.169.254',
    '169.254.0.1',
    '::1',
    '0:0:0:0:0:0:0:1',
    'fe80::1',
    'febf::abcd',
    '::ffff:127.0.0.1',
    '::ffff:10.1.2.3',
    '::ffff:169.254.169.254',
    '::ffff:192.168.0.5',
    'https://127.0.0.1/hook',
    'https://10.1.2.3:8443/hook',
    'https://user:pass@192.168.1.5/path',
    'https://169.254.169.254/latest/meta-data/',
    'https://[::1]/hook',
    'https://[fe80::1]/hook',
    'https://[::ffff:10.1.2.3]/hook',
    'https://2130706433/hook',
    'https://localhost/hook',
    'https://api.localhost/hook',
    'localhost'
  ])('rejects %s', (target) => {
    expect(isBlockedWebhookTarget(target)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '11.0.0.1',
    '172.15.5.5',
    '172.32.0.1',
    '203.0.113.10',
    '2001:db8::5',
    'fec0::1',
    '::ffff:8.8.8.8',
    'example.com',
    'hooks.slack.com',
    PUBLIC_HTTPS,
    'https://example.com/webhook',
    'https://8.8.8.8/hook',
    ''
  ])('allows %s', (target) => {
    expect(isBlockedWebhookTarget(target)).toBe(false);
  });
});

describe('webHookSchema.webhookURL', () => {
  it('rejects a metadata address at config time', () => {
    const error = settings('https://169.254.169.254/latest/meta-data').validateSync();
    expect(error).toBeDefined();
    expect(error.errors['webHookSettings.webhookURL'].message)
      .toMatch(/loopback, link-local, or private network address/);
  });

  it('rejects RFC1918 and IPv6 loopback literals', () => {
    for (const webhookURL of [
      'https://10.0.0.8/hook',
      'https://172.16.5.5/hook',
      'https://192.168.0.9/hook',
      'https://[::1]/hook',
      'https://[fe80::1]/hook'
    ]) {
      const error = settings(webhookURL).validateSync();
      expect(error && error.errors['webHookSettings.webhookURL']).toBeDefined();
    }
  });

  it('accepts a normal https webhook URL', () => {
    expect(settings(PUBLIC_HTTPS).validateSync()).toBeUndefined();
    expect(settings('https://example.com/hook').validateSync()).toBeUndefined();
  });
});

describe('sendToWebHook target guard', () => {
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

  it('returns true for an empty development URL without fetching', async () => {
    await expect(hooks.sendToWebHook('', { a: 1 })).resolves.toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('throws before fetch for a literal blocked URL', async () => {
    const lookup = mockLookup(['203.0.113.10']);
    await expect(hooks.sendToWebHook('https://169.254.169.254/latest/meta-data', { a: 1 }))
      .rejects.toThrow(/private network address/);
    expect(fetch).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each([
    ['10.1.2.3', 'metadata.example'],
    ['192.168.1.50', 'intranet.example'],
    ['172.31.0.4', 'vpn.example'],
    ['127.0.0.1', 'loop.example'],
    ['169.254.169.254', 'metadata.google.internal'],
    ['::1', 'v6loop.example'],
    ['fe80::1', 'link.example']
  ])('throws when %s is a resolved address for %s', async (address, host) => {
    mockLookup([address]);
    await expect(hooks.sendToWebHook(`https://${host}/hook`, { a: 1 }))
      .rejects.toThrow(new RegExp(`resolves to ${address.replace(/[.*]/g, '\\$&')}`));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('throws when any resolved address is blocked', async () => {
    mockLookup(['203.0.113.10', '10.9.8.7']);
    await expect(hooks.sendToWebHook('https://dual.example/hook', { a: 1 }))
      .rejects.toThrow(/resolves to 10\.9\.8\.7/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends a normal https webhook when DNS returns a public address', async () => {
    const lookup = mockLookup(['203.0.113.10']);
    const sent = await hooks.sendToWebHook(
      PUBLIC_HTTPS,
      { title: 'hi' },
      's3cret',
      'Alert'
    );
    expect(sent).toBe(true);
    expect(lookup).toHaveBeenCalledWith(
      'hooks.slack.com',
      expect.objectContaining({ all: true })
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe(PUBLIC_HTTPS);
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body);
    expect(body.text).toContain('Alert');
    expect(body.text).toContain('title: hi');
    expect(body.secret).toBe('s3cret');
  });

  it('sends when every resolved address is public', async () => {
    mockLookup(['2001:db8::5', '203.0.113.8']);
    await expect(hooks.sendToWebHook('https://example.com/hook', { ok: true }))
      .resolves.toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
