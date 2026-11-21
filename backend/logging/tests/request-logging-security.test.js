/** @jest-environment node */
jest.mock('express-winston', () => ({
  requestWhitelist: ['url', 'headers', 'method', 'httpVersion', 'originalUrl', 'query'],
  responseWhitelist: [],
  defaultRequestFilter: (req, key) => req[key],
  logger: options => options,
  errorLogger: options => options
}));
jest.mock('../../configs', () => () => ({ get: () => '/dev/null' }));

const expressWinston = require('express-winston');
const { reqLogger, errLogger } = require('../request-logging');

test('request and error logs exclude all request headers and query objects', () => {
  for (const logger of [reqLogger, errLogger]) {
    const fields = logger.requestWhitelist || expressWinston.requestWhitelist;
    expect(fields).not.toContain('headers');
    expect(fields).not.toContain('query');
    expect(fields).not.toContain('originalUrl');
    expect(fields).not.toContain('body');
    const req = {
      headers: {
        authorization: 'Bearer synthetic-jwt',
        'refresh-token': 'synthetic-refresh',
        cookie: 'synthetic-cookie'
      },
      query: { recoveryCode: 'synthetic-recovery' },
      body: { password: 'synthetic-password' }
    };
    for (const key of ['headers', 'query', 'body']) {
      expect(logger.requestFilter(req, key)).toBeUndefined();
    }
  }
});

test('request URL logging drops all query values without changing routing URL', () => {
  const req = {
    url: '/api/users/reset-password?token=reset-secret&captcha=challenge-secret',
    method: 'POST'
  };
  for (const logger of [reqLogger, errLogger]) {
    const filter = logger.requestFilter || expressWinston.defaultRequestFilter;
    expect(filter(req, 'url')).toBe('/api/users/reset-password');
    expect(filter(req, 'method')).toBe('POST');
  }
  expect(req.url).toContain('reset-secret');
});

test('formatted event message cannot retain the raw credential-bearing URL', () => {
  const info = {
    level: 'info',
    message: 'HTTP GET /hello?token=synthetic-secret 200',
    meta: { req: { method: 'GET', url: '/hello', ip: '127.0.0.1' }, res: { statusCode: 200 } }
  };
  const formatted = reqLogger.transports[0].format.transform(info);
  expect(formatted.event.message).not.toContain('synthetic-secret');
  expect(formatted.event.message).toContain('/hello');
});
