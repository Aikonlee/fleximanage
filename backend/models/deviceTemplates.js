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

const FORBIDDEN_CONFIG_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject (value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasSafeConfigStructure (value, seen = new Set()) {
  if (value === null || typeof value !== 'object') {
    return true;
  }
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      if (item !== null && typeof item === 'object') {
        if (!hasSafeConfigStructure(item, seen)) {
          return false;
        }
      }
    }
    return true;
  }

  if (!isPlainObject(value)) {
    return false;
  }

  for (const key of Object.getOwnPropertyNames(value)) {
    if (key.startsWith('$') || FORBIDDEN_CONFIG_KEYS.has(key)) {
      return false;
    }
    const child = value[key];
    if (child !== null && typeof child === 'object') {
      if (!hasSafeConfigStructure(child, seen)) {
        return false;
      }
    }
  }
  return true;
}

function isValidTemplateConfig (value) {
  if (!isPlainObject(value)) {
    return false;
  }
  return hasSafeConfigStructure(value, new Set());
}

/**
 * Device Template Schema
 *
 * Immutable versioned configuration templates scoped to an organization.
 */
const deviceTemplateSchema = new Schema({
  org: {
    type: Schema.Types.ObjectId,
    ref: 'organizations',
    required: true,
    immutable: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  version: {
    type: Number,
    required: true,
    min: [1, 'Version must be at least 1']
  },
  config: {
    type: Schema.Types.Mixed,
    required: true,
    validate: {
      validator: isValidTemplateConfig,
      message: 'Config must be a plain object without keys starting with "$" or "__proto__"'
    }
  },
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'users'
  }
}, {
  timestamps: true
});

deviceTemplateSchema.index({ org: 1, name: 1, version: 1 }, { unique: true });

const DeviceTemplates = mongoConns.getMainDB().model('deviceTemplates', deviceTemplateSchema);
DeviceTemplates.isValidTemplateConfig = isValidTemplateConfig;

module.exports = DeviceTemplates;
