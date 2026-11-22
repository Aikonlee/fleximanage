const configs = require('../configs')();

const ACCESS_COOKIE = 'token';
const REFRESH_COOKIE = 'refreshToken';

// Express maxAge is milliseconds. JWT expiresIn uses the same config values in seconds.
const seconds = (key) => {
  const value = Number(configs.get(key, 'number'));
  return Number.isFinite(value) && value > 0 ? value : 0;
};

const cookieFlags = (req) => {
  const forwarded = req.headers && req.headers['x-forwarded-proto'];
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: Boolean(req.secure || forwarded === 'https')
  };
};

// Express responses always implement these. Header-only doubles in older tests do not.
const setCookie = (res, name, value, options) => {
  if (typeof res.cookie === 'function') res.cookie(name, value, options);
};

const setAuthCookies = (req, res, token, refreshToken) => {
  const flags = cookieFlags(req);
  setCookie(res, ACCESS_COOKIE, token, {
    ...flags,
    maxAge: seconds('userTokenExpiration') * 1000
  });
  setCookie(res, REFRESH_COOKIE, refreshToken, {
    ...flags,
    maxAge: seconds('userRefreshTokenExpiration') * 1000
  });
};

const clearAuthCookies = (res) => {
  if (typeof res.clearCookie !== 'function') return;
  // secure is chosen at issuance and this clearer does not see the request.
  for (const secure of [false, true]) {
    const options = { httpOnly: true, sameSite: 'lax', path: '/', secure };
    res.clearCookie(ACCESS_COOKIE, options);
    res.clearCookie(REFRESH_COOKIE, options);
  }
};

module.exports = { setAuthCookies, clearAuthCookies };
