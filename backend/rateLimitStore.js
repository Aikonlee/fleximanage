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

class MemoryStore {
  constructor (windowMs) {
    this.windowMs = windowMs;
    // Per-key windows. A single resetAll timer would wipe unrelated keys together.
    this.hits = Object.create(null);
  }

  incr (key, cb) {
    const now = Date.now();
    let entry = this.hits[key];
    if (!entry || entry.expiresAt <= now) {
      if (entry) this._clearTimer(entry);
      entry = {
        count: 1,
        expiresAt: now + this.windowMs,
        resetTime: new Date(now + this.windowMs)
      };
      this.hits[key] = entry;
      this._arm(key, entry);
    } else {
      entry.count += 1;
    }

    cb(null, entry.count, entry.resetTime);
  }

  decrement (key) {
    const entry = this._current(key);
    // Match the previous store: a zero count is not decremented further.
    if (entry && entry.count > 0) {
      entry.count -= 1;
    }
  }

  // export an API to allow hits all IPs to be reset
  resetAll () {
    Object.keys(this.hits).forEach((key) => this._clearTimer(this.hits[key]));
    this.hits = Object.create(null);
  }

  // export an API to allow hits from one IP to be reset
  resetKey (key) {
    this._clearTimer(this.hits[key]);
    delete this.hits[key];
  }

  // export an API to allow retrieving hits of a specific key
  getHitsByKey (key) {
    const entry = this._current(key);
    return entry ? entry.count : undefined;
  }

  _current (key) {
    const entry = this.hits[key];
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this._clearTimer(entry);
      delete this.hits[key];
      return null;
    }
    return entry;
  }

  _arm (key, entry) {
    const delay = Math.max(0, entry.expiresAt - Date.now());
    const timer = setTimeout(() => {
      if (this.hits[key] === entry) delete this.hits[key];
    }, delay);
    if (timer.unref) timer.unref();
    entry.timer = timer;
  }

  _clearTimer (entry) {
    if (entry && entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
  }
}

module.exports = MemoryStore;
