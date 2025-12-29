/**
 * This module verifies google recaptcha
 */
const fetch = require('fetch-with-proxy').default;
// Use Cloudflare Turnstile endpoint
const verifyURL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

class ReCaptcha {
  constructor (secretKey) {
    this.verifyReCaptcha = this.verifyReCaptcha.bind(this);
    this.secretKey = secretKey;
  }

  /**
     * Verifies a captcha.
     * @async
     * @param  {string}         token captcha to verify
     * @return {boolean|Object}       false if verification failed, verification result otherwise
     */
  async verifyReCaptcha (token, remoteip = undefined) {
    // For an empty key (development), return true
    if (this.secretKey === '') return Promise.resolve(true);
    
    // If no token provided, allow it through (graceful degradation for browser restrictions)
    // The frontend will only omit the token if Turnstile failed to load
    if (!token) {
      // eslint-disable-next-line no-console
      console.warn('[recaptcha] No token provided, allowing registration without captcha verification');
      return Promise.resolve(true);
    }

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'flexiWAN Turnstile checker'
    };
    // Cloudflare Turnstile expects: secret, response, optionally remoteip
    const params = { secret: this.secretKey, response: token };
    if (remoteip) params.remoteip = remoteip;
    const encodedParams = Object.keys(params).map((key) => {
      return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
    }).join('&');

    return fetch(verifyURL, {
      method: 'POST',
      headers: headers,
      body: encodedParams
    })
      .then(response => {
        return response.json()
          .then(json => {
            response.message = json;
            return response;
          },
          error => {
            throw error;
          });
      },
      error => {
        throw error;
      })
      .then(response => {
        // Cloudflare Turnstile returns { success: true/false, ... }
        if (response.message && response.message.success === true) return true;
        return false;
      })
      .catch((error) => {
        // General error handling
        return false;
      });
  }
}

let reCaptchaHandler = null;
module.exports = function (secretKey) {
  if (reCaptchaHandler) return reCaptchaHandler;
  else {
    reCaptchaHandler = new ReCaptcha(secretKey);
    return reCaptchaHandler;
  }
};
