/** Server-side Cloudflare Turnstile verification. */
const fetch = require('fetch-with-proxy').default;
const verifyURL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

class ReCaptcha {
  constructor (secretKey, { enforced = true } = {}) {
    this.secretKey = secretKey;
    this.enforced = enforced;
    this.verifyReCaptcha = this.verifyReCaptcha.bind(this);
  }

  async verifyReCaptcha (token, remoteip = undefined) {
    if (!this.enforced) return true;
    // Missing configuration or a missing challenge must fail closed.
    if (!this.secretKey || typeof token !== 'string' || !token.trim()) return false;
    try {
      const params = new URLSearchParams({ secret: this.secretKey, response: token });
      if (remoteip) params.set('remoteip', remoteip);
      const response = await fetch(verifyURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        timeout: 10000
      });
      if (response.ok === false) return false;
      const result = await response.json();
      return result.success === true;
    } catch (error) {
      return false;
    }
  }
}

module.exports = (secretKey, options) => new ReCaptcha(secretKey, options);
