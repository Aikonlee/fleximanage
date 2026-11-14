jest.mock('fetch-with-proxy', () => ({ default: jest.fn() }));
const fetch = require('fetch-with-proxy').default;
const createCaptcha = require('../recaptcha');

beforeEach(() => fetch.mockReset());
test.each([undefined, null, '', '   ', 123])('rejects missing/invalid challenge %p', async token => {
  expect(await createCaptcha('secret').verifyReCaptcha(token)).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});
test('requires server configuration unless explicitly disabled', async () => {
  expect(await createCaptcha('').verifyReCaptcha('challenge')).toBe(false);
  expect(await createCaptcha('', { enforced: false }).verifyReCaptcha()).toBe(true);
});
test('checks the provider response and sends the challenge to the verification endpoint', async () => {
  fetch.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
  expect(await createCaptcha('secret').verifyReCaptcha('challenge', '127.0.0.1')).toBe(true);
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
  expect(new URLSearchParams(options.body).get('response')).toBe('challenge');
  expect(options.timeout).toBe(10000);
});
test('rejects provider rejection, HTTP error, invalid JSON and network failure', async () => {
  const captcha = createCaptcha('secret');
  fetch.mockResolvedValue({ json: async () => ({ success: false }) });
  expect(await captcha.verifyReCaptcha('challenge')).toBe(false);
  fetch.mockResolvedValue({ ok: false });
  expect(await captcha.verifyReCaptcha('challenge')).toBe(false);
  fetch.mockResolvedValue({ json: async () => { throw new Error('json'); } });
  expect(await captcha.verifyReCaptcha('challenge')).toBe(false);
  fetch.mockRejectedValue(new Error('network'));
  expect(await captcha.verifyReCaptcha('challenge')).toBe(false);
});
