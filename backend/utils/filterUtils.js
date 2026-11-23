// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2021  flexiWAN Ltd.

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

const escapeRegExp = require('lodash/escapeRegExp');

const SENSITIVE_FILTER_KEY_PATTERN = /(key|secret|token|password|tunnelKeys)/i;
const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

const invalidFilterError = (message) => {
  const err = new Error(message);
  err.status = 400;
  return err;
};

/**
 * Returns true if a dotted path (or any segment) is malformed or references
 * sensitive credential material (key, secret, token, password, tunnelKeys).
 * @param {string} key
 * @returns {boolean}
 */
const isSensitiveFilterKey = (key) => {
  if (typeof key !== 'string') return true;
  const trimmed = key.trim();
  if (!trimmed || trimmed !== key || trimmed.includes('$')) return true;
  const segments = trimmed.split('.');
  for (const segment of segments) {
    if (!segment || FORBIDDEN_PATH_SEGMENTS.has(segment)) return true;
    if (SENSITIVE_FILTER_KEY_PATTERN.test(segment)) return true;
  }
  return false;
};

/**
 * Validates a filter key against sensitive path restrictions and an optional allowlist.
 * Supports '|' composite keys by validating each branch.
 * @param {string} key
 * @param {Set<string>|Array<string>|null} allowedKeys
 */
const validateFilterKey = (key, allowedKeys = null) => {
  if (typeof key !== 'string' || !key.trim()) {
    throw invalidFilterError('Invalid filter key');
  }
  const allowSet = allowedKeys
    ? (allowedKeys instanceof Set ? allowedKeys : new Set(allowedKeys))
    : null;
  const branches = key.split('|');
  for (const branch of branches) {
    if (isSensitiveFilterKey(branch)) {
      throw invalidFilterError(`Filter key is not allowed: ${branch}`);
    }
    if (allowSet && !allowSet.has(branch)) {
      throw invalidFilterError(`Filter key is not allowed: ${branch}`);
    }
  }
};

/**
 * Validates an array of filter objects against sensitive path restrictions
 * and an optional allowlist.
 * @param {Array} filters
 * @param {Set<string>|Array<string>|null} allowedKeys
 */
const validateFilters = (filters, allowedKeys = null) => {
  if (!Array.isArray(filters)) {
    throw invalidFilterError('Filters must be an array');
  }
  for (const filter of filters) {
    if (!filter || typeof filter !== 'object') {
      throw invalidFilterError('Invalid filter entry');
    }
    validateFilterKey(filter.key, allowedKeys);
  }
};

/**
 * Validates a sort field against sensitive path restrictions and an optional allowlist.
 * @param {string} sortField
 * @param {Set<string>|Array<string>|null} allowedKeys
 */
const validateSortField = (sortField, allowedKeys = null) => {
  if (typeof sortField !== 'string' || !sortField.trim() ||
      sortField.includes('|') || sortField.includes('?')) {
    throw invalidFilterError('Invalid sort field');
  }
  if (isSensitiveFilterKey(sortField)) {
    throw invalidFilterError(`Sort field is not allowed: ${sortField}`);
  }
  if (allowedKeys) {
    const allowSet = allowedKeys instanceof Set ? allowedKeys : new Set(allowedKeys);
    if (!allowSet.has(sortField)) {
      throw invalidFilterError(`Sort field is not allowed: ${sortField}`);
    }
  }
};

/**
 * Builds a case-insensitive RegExp from a user-controlled filter value.
 * Strings are escaped so metacharacters are literal and cannot backtrack.
 * Other types keep RegExp coercion (undefined becomes an empty pattern).
 * @param {*} val raw filter value
 * @param {string} kind 'exact' | 'prefix' | 'contains' | 'notContains'
 * @returns {RegExp}
 */
const convertFilterMatchToRegExp = (val, kind) => {
  const safe = typeof val === 'string' ? escapeRegExp(val) : val;
  switch (kind) {
    case 'prefix':
      return new RegExp('^' + safe, 'i');
    case 'contains':
      return new RegExp(safe, 'i');
    case 'notContains':
      // Same "does not contain" result as ^((?!val).)*$ without nested backtracking.
      return new RegExp('^(?!.*' + safe + ').*$', 'i');
    case 'exact':
    default:
      return new RegExp('^' + safe + '$', 'i');
  }
};

/**
 * Converts API query filter operation to mongoose expression
 * @param {Object} filter a filter object from API request
 * @param {String} filter.key Key to be filtered by
 * @param {String} filter.op filter operation [==, !=, contains...]
 * @param {String} filter.val Value to be filtered
 * @returns {Object} Mongoose expression for the $match stage
*/
const getFilterExpression = ({ key, op, val }) => {
  // The key is required
  if (!key) return undefined;
  // Two sides case '?' means 'A' && 'B' - for example "device?.name" be replaced by
  // 'cond': [{"deviceA.name": "DeviceName"}, {"deviceB.name": "DeviceName"}]
  // where 'cond' depends on 'op' - if negative it will be '$and' and '$or' if opposite
  // Example: 'op' is '==' or 'contains' the condition in that case will be
  // { $or: [{"deviceA.name": "DeviceName"}, {"deviceB.name": "DeviceName"}] }
  const cond = op.includes('!') ? '$and' : '$or';
  if (key.includes('?')) {
    return {
      [cond]: ['A', 'B'].map(side => {
        const sideKey = key.replace(/\?/g, side);
        const expr = getFilterExpression({ key: sideKey, op, val });
        if (cond === '$and') {
          // we need to ignore null values for negative conditions
          return { $or: [{ [sideKey]: null }, expr] };
        }
        return expr;
      })
    };
  }
  // similar to '?', just the 'key' includes several keys divided by '|'
  if (key.includes('|')) {
    return {
      [cond]: key.split('|').map(key => getFilterExpression({ key, op, val }))
    };
  }
  // Special case for dates filtering
  if (['time', 'date', 'created_at', 'lastResolvedStatusChange'].includes(key)) {
    const date1 = new Date(val);
    const date2 = new Date(val);
    date2.setDate(date1.getDate() + 1); // beginning of the next day
    switch (op) {
      case '==':
        return { $and: [{ [key]: { $gte: date1 } }, { [key]: { $lt: date2 } }] };
      case '!=':
        return { $and: [{ [key]: { $lt: date1 } }, { [key]: { $gte: date2 } }] };
      case 'in last days':
        date1.setDate(date1.getDate() - 3); // let's do the last 3 days...
        return { $and: [{ [key]: { $lt: date1 } }, { [key]: { $gte: date2 } }] };
      case '<':
        return { [key]: { $lt: date1 } };
      case '>':
        return { [key]: { $gte: date2 } };
      case '<=':
        return { [key]: { $lt: date2 } };
      case '>=':
        return { [key]: { $gte: date1 } };
      default:
        return undefined;
    }
  }
  // all other types
  const isString = typeof val === 'string';
  switch (op) {
    case '==':
      return { [key]: isString ? convertFilterMatchToRegExp(val, 'exact') : val };
    case '!=':
      // Prefix anchor only: historical $not semantics match "starts with", not equality.
      return {
        [key]: isString ? { $not: convertFilterMatchToRegExp(val, 'prefix') } : { $ne: val }
      };
    case 'contains':
      return { [key]: convertFilterMatchToRegExp(val, 'contains') };
    case '!contains':
      return { [key]: convertFilterMatchToRegExp(val, 'notContains') };
    case '<':
      return { [key]: { $lt: val } };
    case '>':
      return { [key]: { $gt: val } };
    case '<=':
      return { [key]: { $lte: val } };
    case '>=':
      return { [key]: { $gte: val } };
    case 'in':
      if (!Array.isArray(val)) val = val.split(',');
      return { [key]: { $in: val } };
    default:
      return undefined;
  }
};

/**
 * Check if object passes array of filters
 * @param {Object} obj an object to test if it passes filters
 * @param {Array}  filters an array of filters from API request
 * @returns {boolean} returns true if passed
*/
const passFilters = (obj, filters) => {
  // if no filters then returns true
  if (!Array.isArray(filters) || filters.length === 0) return true;
  // the object must pass every filter
  return filters.every(({ key, op, val }) => {
    if (!key || !op) return false;
    const props = key.split('.');
    let objVal = obj;
    // the key can be complex, like 'data.message.title'
    for (const prop of props) {
      if (objVal[prop] === undefined) return false;
      objVal = objVal[prop];
    }
    // must be the same type to compare
    switch (typeof objVal) {
      case 'number':
        val = +val; break;
      case 'boolean':
        val = val === true || val === 'true'; break;
    }
    const isString = typeof val === 'string';
    switch (op) {
      case '==':
        return isString ? convertFilterMatchToRegExp(val, 'exact').test(objVal) : val === objVal;
      case '!=':
        return isString ? !convertFilterMatchToRegExp(val, 'exact').test(objVal) : val !== objVal;
      case '<=':
        return objVal <= val;
      case '>=':
        return objVal >= val;
      case '<':
        return objVal < val;
      case '>':
        return objVal > val;
      case 'contains':
        return convertFilterMatchToRegExp(val, 'contains').test(objVal);
      case '!contains':
        return convertFilterMatchToRegExp(val, 'notContains').test(objVal);
      case 'in':
        if (!Array.isArray(val)) val = val.split(',');
        return val.includes(objVal);
      default:
        return false;
    }
  });
};

/**
 * Converts array of filters from API request to array of mongoose expressions
 * @param {Array}  filters an array of filters from API request
 * @param {Object} [options] validation options
 * @param {Set<string>|Array<string>} [options.allowedKeys] optional explicit key allowlist
 * @returns {Array} an array of mongoose match expressions
 */
const getMatchFilters = (filters, { allowedKeys = null } = {}) => {
  validateFilters(filters, allowedKeys);
  const matchFilters = [];
  for (const filter of filters) {
    const filterExpr = getFilterExpression(filter);
    if (filterExpr !== undefined) {
      matchFilters.push(filterExpr);
    } else {
      throw invalidFilterError('There is an error in filter: ' + JSON.stringify(filter));
    }
  }
  return matchFilters;
};

module.exports = {
  getMatchFilters,
  passFilters,
  isSensitiveFilterKey,
  validateFilterKey,
  validateFilters,
  validateSortField
};
