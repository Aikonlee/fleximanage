// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2026  flexiWAN Ltd.

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

const mongoose = require('mongoose');
const mongoConns = require('../mongoConns.js')();
const Schema = mongoose.Schema;

Schema.ObjectId.get(v => v ? v.toString() : v);

/**
 * Link Monitor Schema
 *
 * Account-level reusable object referenced by name from a WAN interface's
 * "Monitor Internet" setting. NOTE: this is the management-side definition
 * only - the flexiEdge device agent (a separate repo, not present here) is
 * what would actually run the ICMP/HTTP probes and report link quality back.
 * Until a flexiEdge release implements the corresponding job handler, this
 * feature is management-side complete but has no effect on a real device.
 */
const linkMonitorSchema = new Schema({
  org: {
    type: Schema.Types.ObjectId,
    ref: 'organizations',
    required: true
  },
  name: {
    type: String,
    required: true,
    maxlength: [50, 'Name length must be at most 50']
  },
  type: {
    type: String,
    enum: ['icmp', 'http'],
    default: 'icmp',
    required: true
  },
  servers: {
    // Target IPs for ICMP monitoring
    type: [String],
    default: []
  },
  urls: {
    // Target URLs for HTTP monitoring
    type: [String],
    default: []
  },
  timeout: {
    // Milliseconds to wait for a response
    type: Number,
    default: 2000
  },
  threshold: {
    // Acceptable success rate percentage
    type: Number,
    default: 60,
    min: [0, 'threshold should be a number between 0-100'],
    max: [100, 'threshold should be a number between 0-100']
  },
  attempts: {
    type: Number,
    default: 3
  }
}, {
  timestamps: true
});

linkMonitorSchema.index({ org: 1, name: 1 }, { unique: true });

module.exports = mongoConns.getMainDB().model('linkMonitors', linkMonitorSchema);
