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
const net = require('net');
const { Types } = require('mongoose');
const Service = require('./Service');
const DeviceTemplates = require('../models/deviceTemplates');
const { getAccessTokenOrgList } = require('../utils/membershipUtils');

const FORBIDDEN_CONFIG_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const selectFields = {
  org: 1,
  name: 1,
  description: 1,
  version: 1,
  config: 1,
  createdBy: 1,
  createdAt: 1,
  updatedAt: 1
};

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

function extractApplicableStaticRoute (config) {
  if (!isPlainObject(config) || !hasSafeConfigStructure(config, new Set())) {
    return {
      error: Service.rejectResponse(
        'Invalid template config: must be a plain object without "$" or "__proto__" keys',
        400
      )
    };
  }

  const topKeys = Object.getOwnPropertyNames(config);
  if (
    Object.getOwnPropertySymbols(config).length > 0 ||
    topKeys.length !== 1 ||
    topKeys[0] !== 'staticroutes'
  ) {
    return {
      error: Service.rejectResponse(
        'Template config is not applicable: config must contain only staticroutes ' +
        'with a single { destination, gateway } entry',
        400
      )
    };
  }

  const routes = config.staticroutes;
  if (
    !Array.isArray(routes) ||
    routes.length !== 1 ||
    !(0 in routes) ||
    Object.getOwnPropertySymbols(routes).length > 0 ||
    !Object.getOwnPropertyNames(routes).every((k) => k === '0' || k === 'length')
  ) {
    return {
      error: Service.rejectResponse(
        'Template config is not applicable: staticroutes must be an array with exactly one route',
        400
      )
    };
  }

  const route = routes[0];
  if (!isPlainObject(route)) {
    return {
      error: Service.rejectResponse(
        'Template config is not applicable: static route entry must be a plain object',
        400
      )
    };
  }

  const routeKeys = Object.getOwnPropertyNames(route);
  if (
    Object.getOwnPropertySymbols(route).length > 0 ||
    routeKeys.length !== 2 ||
    !routeKeys.includes('destination') ||
    !routeKeys.includes('gateway')
  ) {
    return {
      error: Service.rejectResponse(
        'Template config is not applicable: static route must contain only destination and gateway',
        400
      )
    };
  }

  if (typeof route.destination !== 'string' || typeof route.gateway !== 'string') {
    return {
      error: Service.rejectResponse(
        'Invalid template static route: destination and gateway must be non-empty strings',
        400
      )
    };
  }

  const destination = route.destination.trim();
  const gateway = route.gateway.trim();
  if (!destination || !gateway) {
    return {
      error: Service.rejectResponse(
        'Invalid template static route: destination and gateway must be non-empty strings',
        400
      )
    };
  }

  const cidrParts = destination.split('/');
  if (cidrParts.length !== 2) {
    return {
      error: Service.rejectResponse(
        'Invalid template static route: destination must be a valid IPv4 CIDR',
        400
      )
    };
  }

  const [destIp, destPrefix] = cidrParts;
  if (!net.isIPv4(destIp)) {
    return {
      error: Service.rejectResponse(
        'Invalid template static route: destination must be a valid IPv4 CIDR',
        400
      )
    };
  }

  if (/^0+$/.test(destPrefix)) {
    return {
      error: Service.rejectResponse(
        'Invalid template static route: default route 0.0.0.0/0 is not allowed',
        400
      )
    };
  }

  if (!/^[1-9]\d*$/.test(destPrefix)) {
    return {
      error: Service.rejectResponse(
        'Invalid template static route: destination must be a valid IPv4 CIDR',
        400
      )
    };
  }

  const prefixLength = Number(destPrefix);
  if (prefixLength < 1 || prefixLength > 32) {
    return {
      error: Service.rejectResponse(
        'Invalid template static route: destination must be a valid IPv4 CIDR',
        400
      )
    };
  }

  return { destination, gateway };
}

function isValidObjectId (id) {
  return typeof id === 'string' && Types.ObjectId.isValid(id) &&
    String(new Types.ObjectId(id)) === id.toLowerCase();
}

function validateWriteOrg (user, org) {
  if (org !== undefined && org !== null && typeof org !== 'string') {
    return Service.rejectResponse('Invalid organization query parameter', 400);
  }
  const normalizedOrg = typeof org === 'string' ? org.trim() : '';
  if (user.accessToken) {
    if (!normalizedOrg) {
      return Service.rejectResponse(
        'Organization query parameter must be specified for this operation',
        400
      );
    }
  } else if (org !== undefined && org !== null && org !== '') {
    return Service.rejectResponse(
      'Organization query parameter is only available in Access Key',
      400
    );
  }
  return null;
}

function formatTemplate (doc) {
  const {
    _id, org, name, description, version, config, createdBy, createdAt, updatedAt
  } = doc;
  return {
    _id, org, name, description, version, config, createdBy, createdAt, updatedAt
  };
}

function handleError (e) {
  if (e && e.code === 11000) {
    return Service.rejectResponse(
      'Device template with this name and version already exists',
      400
    );
  }
  if (e && (e.name === 'ValidationError' || e.name === 'CastError')) {
    return Service.rejectResponse(e.message || 'Bad Request', 400);
  }
  return Service.rejectResponse(e.message || 'Internal Server Error', e.status || 500);
}

class DeviceTemplatesService {
  /**
   * Get all Device Templates
   **/
  static async devicetemplatesGET ({ offset, limit, org }, { user }) {
    try {
      if (!user) {
        return Service.rejectResponse('Forbidden', 403);
      }
      const orgList = await getAccessTokenOrgList(user, org, false);
      if (!Array.isArray(orgList) || orgList.length === 0) {
        if (org) {
          return Service.rejectResponse(
            'You do not have permission to access this organization',
            403
          );
        }
        return Service.successResponse([]);
      }

      const templates = await DeviceTemplates.find(
        { org: { $in: orgList } },
        selectFields
      ).skip(offset).limit(limit);

      return Service.successResponse(templates);
    } catch (e) {
      return handleError(e);
    }
  }

  /**
   * Add a new Device Template (version 1)
   **/
  static async devicetemplatesPOST ({ org, name, description, config }, { user }) {
    try {
      if (!user) {
        return Service.rejectResponse('Forbidden', 403);
      }
      const orgValidationError = validateWriteOrg(user, org);
      if (orgValidationError) {
        return orgValidationError;
      }
      const requestedOrg = user.accessToken ? org.trim() : org;
      const orgList = await getAccessTokenOrgList(user, requestedOrg, true, null, '', true);
      if (!Array.isArray(orgList) || orgList.length === 0) {
        return Service.rejectResponse(
          'You do not have permission to access this organization',
          403
        );
      }

      const trimmedName = typeof name === 'string' ? name.trim() : '';
      if (!trimmedName) {
        return Service.rejectResponse('Template name is required', 400);
      }

      if (description !== undefined && typeof description !== 'string') {
        return Service.rejectResponse('Template description must be a string', 400);
      }

      if (!isValidTemplateConfig(config)) {
        return Service.rejectResponse(
          'Invalid template config: must be a plain object without "$" or "__proto__" keys',
          400
        );
      }

      const targetOrg = orgList[0].toString();
      const hasDuplicate = await DeviceTemplates.countDocuments({
        org: targetOrg,
        name: trimmedName,
        version: 1
      });
      if (hasDuplicate) {
        return Service.rejectResponse(
          'Device template with this name and version already exists',
          400
        );
      }

      const payload = {
        org: targetOrg,
        name: trimmedName,
        description: description !== undefined ? description : '',
        version: 1,
        config
      };
      if (user._id) {
        payload.createdBy = user._id;
      }

      const result = await DeviceTemplates.create(payload);
      return Service.successResponse(formatTemplate(result), 201);
    } catch (e) {
      return handleError(e);
    }
  }

  /**
   * Get a Device Template by id
   **/
  static async devicetemplatesIdGET ({ id, org }, { user }) {
    try {
      if (!user) {
        return Service.rejectResponse('Forbidden', 403);
      }
      const orgList = await getAccessTokenOrgList(user, org, false);
      if (!Array.isArray(orgList) || orgList.length === 0) {
        if (org) {
          return Service.rejectResponse(
            'You do not have permission to access this organization',
            403
          );
        }
        if (!isValidObjectId(id)) {
          return Service.rejectResponse('Invalid device template id', 400);
        }
        return Service.rejectResponse('Not found', 404);
      }

      if (!isValidObjectId(id)) {
        return Service.rejectResponse('Invalid device template id', 400);
      }

      const template = await DeviceTemplates.findOne(
        { org: { $in: orgList }, _id: id },
        selectFields
      );

      if (!template) {
        return Service.rejectResponse('Not found', 404);
      }

      return Service.successResponse(template);
    } catch (e) {
      return handleError(e);
    }
  }

  /**
   * Create a new version of a Device Template (immutable versioning)
   **/
  static async devicetemplatesIdPUT ({ id, org, config, description }, { user }) {
    try {
      if (!user) {
        return Service.rejectResponse('Forbidden', 403);
      }
      const orgValidationError = validateWriteOrg(user, org);
      if (orgValidationError) {
        return orgValidationError;
      }
      const requestedOrg = user.accessToken ? org.trim() : org;
      const orgList = await getAccessTokenOrgList(user, requestedOrg, true, null, '', true);
      if (!Array.isArray(orgList) || orgList.length === 0) {
        return Service.rejectResponse(
          'You do not have permission to access this organization',
          403
        );
      }

      if (!isValidObjectId(id)) {
        return Service.rejectResponse('Invalid device template id', 400);
      }

      if (description !== undefined && typeof description !== 'string') {
        return Service.rejectResponse('Template description must be a string', 400);
      }

      if (!isValidTemplateConfig(config)) {
        return Service.rejectResponse(
          'Invalid template config: must be a plain object without "$" or "__proto__" keys',
          400
        );
      }

      const existing = await DeviceTemplates.findOne({
        org: { $in: orgList },
        _id: id
      });

      if (!existing) {
        return Service.rejectResponse('Not found', 404);
      }

      const targetOrg = existing.org.toString();
      const latest = await DeviceTemplates.findOne(
        { org: targetOrg, name: existing.name },
        { version: 1 }
      ).sort({ version: -1 });

      const maxVersion = (latest && typeof latest.version === 'number')
        ? latest.version
        : existing.version;
      const nextVersion = maxVersion + 1;

      const payload = {
        org: targetOrg,
        name: existing.name,
        description: description !== undefined ? description : (existing.description || ''),
        version: nextVersion,
        config
      };
      if (user._id) {
        payload.createdBy = user._id;
      }

      const created = await DeviceTemplates.create(payload);
      return Service.successResponse(formatTemplate(created), 200);
    } catch (e) {
      return handleError(e);
    }
  }

  /**
   * Delete a Device Template
   **/
  static async devicetemplatesIdDELETE ({ id, org }, { user }) {
    try {
      if (!user) {
        return Service.rejectResponse('Forbidden', 403);
      }
      const orgValidationError = validateWriteOrg(user, org);
      if (orgValidationError) {
        return orgValidationError;
      }
      const requestedOrg = user.accessToken ? org.trim() : org;
      const orgList = await getAccessTokenOrgList(user, requestedOrg, true, null, '', true);
      if (!Array.isArray(orgList) || orgList.length === 0) {
        return Service.rejectResponse(
          'You do not have permission to access this organization',
          403
        );
      }

      if (!isValidObjectId(id)) {
        return Service.rejectResponse('Invalid device template id', 400);
      }

      const { deletedCount } = await DeviceTemplates.deleteOne({
        org: { $in: orgList },
        _id: id
      });

      if (deletedCount === 0) {
        return Service.rejectResponse('Not found', 404);
      }

      return Service.successResponse(null, 204);
    } catch (e) {
      return handleError(e);
    }
  }

  /**
   * Apply a Device Template version to a single approved device
   **/
  static async devicetemplatesIdApplyPOST ({ id, org, deviceId }, { user, server }, response) {
    try {
      if (!user) {
        return Service.rejectResponse('Forbidden', 403);
      }
      const orgValidationError = validateWriteOrg(user, org);
      if (orgValidationError) {
        return orgValidationError;
      }
      if (!isValidObjectId(id)) {
        return Service.rejectResponse('Invalid device template id', 400);
      }
      if (!isValidObjectId(deviceId)) {
        return Service.rejectResponse('Invalid device id', 400);
      }

      const requestedOrg = user.accessToken ? org.trim() : org;
      const orgList = await getAccessTokenOrgList(user, requestedOrg, true, null, '', true);
      if (!Array.isArray(orgList) || orgList.length === 0) {
        return Service.rejectResponse(
          'You do not have permission to access this organization',
          403
        );
      }

      const template = await DeviceTemplates.findOne(
        { _id: id, org: { $in: orgList } },
        selectFields
      );
      if (!template) {
        return Service.rejectResponse('Not found', 404);
      }

      const routeResult = extractApplicableStaticRoute(template.config);
      if (routeResult.error) {
        return routeResult.error;
      }
      const { destination, gateway } = routeResult;

      const Devices = require('../models/devices');
      const device = await Devices.findOne({ _id: deviceId, org: { $in: orgList } });
      if (!device || (template.org && device.org && String(device.org) !== String(template.org))) {
        return Service.rejectResponse('Device not found', 404);
      }
      if (!device.isApproved) {
        return Service.rejectResponse('Device must be first approved', 409);
      }

      const result = await require('./DevicesService').devicesIdStaticroutesPOST(
        {
          id: deviceId,
          org: requestedOrg,
          staticRouteRequest: {
            destination,
            gateway,
            redistributeViaOSPF: false
          }
        },
        { user, server },
        response,
        {
          requireApproved: true,
          expectedOrg: orgList[0]
        }
      );

      if (!result || result.error || result.code >= 400) {
        return result || Service.rejectResponse('Failed to apply device template', 500);
      }

      const routeId = result.payload && result.payload._id;
      return Service.successResponse(
        {
          templateId: id,
          version: template.version,
          deviceId,
          routeId,
          destination,
          gateway
        },
        202
      );
    } catch (e) {
      return handleError(e);
    }
  }
}

module.exports = DeviceTemplatesService;
