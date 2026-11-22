// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2019  flexiWAN Ltd.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

// express-rate-limit v5 store. Fail closed: incr errors are passed to the
// callback so the middleware calls next(err) instead of allowing the request.
const redis = require('redis');
const configs = require('../configs')();
const { getRedisAuthUrl } = require('./httpUtils');
const logger = require('../logging/logging')({
  module: module.filename,
  type: 'mfa-rate-limit'
});

const KEY_PREFIX = 'mfa:limit:';

class MfaRateLimitStore {
  /**
   * @param {number} windowMs - hit window in milliseconds (default 30s)
   */
  constructor (windowMs = 30000) {
    this.windowSeconds = Math.ceil(windowMs / 1000);
    this.prefix = KEY_PREFIX;
    // Client is opened on first use so module load and construction stay offline.
    this.client = null;
  }

  // Cached getter. Config is read here so a non-string redisUrl cannot throw at load.
  _client () {
    if (this.client) return this.client;

    const raw = configs.get('redisUrl');
    const redisUrl = typeof raw === 'string' && raw ? raw : 'redis://127.0.0.1:6379';
    const { redisAuth, redisUrlNoAuth } = getRedisAuthUrl(redisUrl);
    this.client = redis.createClient({ url: redisUrlNoAuth });
    // Socket errors are emitted, not thrown. Without a listener Node crashes.
    // Some unit doubles do not implement EventEmitter.
    if (typeof this.client.on === 'function') {
      this.client.on('error', (err) => {
        logger.error('MFA rate limit redis client error', {
          params: { err: err && err.message ? err.message : String(err) }
        });
      });
    }
    if (redisAuth) this.client.auth(redisAuth);
    return this.client;
  }

  _redisKey (key) {
    return this.prefix + key;
  }

  incr (key, cb) {
    const redisKey = this._redisKey(key);
    const client = this._client();

    // One MULTI: INCR and EXPIRE NX commit together. NX arms a missing TTL
    // (new key or TTL=-1) and does not slide a window that already exists.
    // A separate INCR followed by a conditional EXPIRE can leave TTL=-1.
    if (typeof client.multi === 'function') {
      this._incrPipeline(client, redisKey, cb);
      return;
    }

    // Doubles that only implement INCR/EXPIRE. Production Redis has MULTI.
    this._incrPlain(client, redisKey, cb);
  }

  _incrPipeline (client, redisKey, cb) {
    let multi;
    try {
      multi = client.multi();
    } catch (err) {
      cb(err);
      return;
    }
    if (!multi ||
      typeof multi.incr !== 'function' ||
      typeof multi.expire !== 'function' ||
      typeof multi.exec !== 'function') {
      cb(new Error('MFA rate limit increment failed'));
      return;
    }

    multi.incr(redisKey);
    multi.expire(redisKey, this.windowSeconds, 'NX');
    multi.exec((err, replies) => {
      if (err) {
        cb(err);
        return;
      }
      const current = this._multiCount(replies);
      if (typeof current !== 'number') {
        cb(new Error('MFA rate limit increment failed'));
        return;
      }
      cb(null, current, new Date(Date.now() + this.windowSeconds * 1000));
    });
  }

  // node-redis replies are bare values. Some clients use [err, value] pairs.
  _multiCount (replies) {
    if (!Array.isArray(replies) || replies.length === 0) return null;
    const raw = replies[0];
    if (raw instanceof Error) return null;
    if (Array.isArray(raw)) {
      if (raw[0]) return null;
      return typeof raw[1] === 'number' ? raw[1] : null;
    }
    return typeof raw === 'number' ? raw : null;
  }

  _incrPlain (client, redisKey, cb) {
    client.incr(redisKey, (err, current) => {
      if (err) {
        cb(err);
        return;
      }

      const finish = () => {
        cb(null, current, new Date(Date.now() + this.windowSeconds * 1000));
      };

      // Repair a missing TTL on every hit when TTL can be read. Otherwise keep
      // the first-hit EXPIRE the legacy doubles assert.
      if (typeof client.ttl !== 'function') {
        if (current === 1 && typeof client.expire === 'function') {
          client.expire(redisKey, this.windowSeconds, (expireErr) => {
            if (expireErr && logger && logger.error) {
              logger.error('MFA rate limit expire failed', {
                params: { key: redisKey, err: expireErr.message }
              });
            }
          });
        }
        finish();
        return;
      }

      client.ttl(redisKey, (ttlErr, ttl) => {
        if (ttlErr) {
          cb(ttlErr);
          return;
        }
        if (typeof ttl !== 'number' || ttl < 0) {
          client.expire(redisKey, this.windowSeconds, (expireErr) => {
            if (expireErr && logger && logger.error) {
              logger.error('MFA rate limit expire failed', {
                params: { key: redisKey, err: expireErr.message }
              });
            }
          });
        }
        const resetMs = (typeof ttl === 'number' && ttl > 0)
          ? ttl * 1000
          : this.windowSeconds * 1000;
        cb(null, current, new Date(Date.now() + resetMs));
      });
    });
  }

  decrement (key) {
    this._client().decr(this._redisKey(key));
  }

  resetKey (key) {
    this._client().del(this._redisKey(key));
  }

  // SCAN + DEL only. KEYS is unbounded and must not be used.
  resetAll () {
    const pattern = this.prefix + '*';
    const scanFrom = (cursor) => {
      this._client().scan(cursor, 'MATCH', pattern, (err, reply) => {
        if (err) {
          if (logger && logger.error) {
            logger.error('MFA rate limit resetAll failed', {
              params: { err: err.message }
            });
          }
          return;
        }
        if (!Array.isArray(reply)) return;

        const nextCursor = reply[0];
        const keys = reply[1] || [];
        if (keys.length > 0) {
          this._client().del(keys);
        }
        if (String(nextCursor) !== '0') {
          scanFrom(String(nextCursor));
        }
      });
    };

    scanFrom('0');
  }

  close () {
    if (this.client) this.client.quit();
  }
}

module.exports = MfaRateLimitStore;
