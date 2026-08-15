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
const Service = require('./Service');
const LinkMonitors = require('../models/linkMonitors');
const { getAccessTokenOrgList } = require('../utils/membershipUtils');

const selectFields = {
  name: 1, type: 1, servers: 1, urls: 1, timeout: 1, threshold: 1, attempts: 1
};

class LinkMonitorsService {
  /**
   * Get all Link Monitors
   **/
  static async linkmonitorsGET ({ offset, limit, org }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, false);
      const linkMonitors = await LinkMonitors.find(
        { org: { $in: orgList } },
        selectFields
      ).skip(offset).limit(limit);

      return Service.successResponse(linkMonitors);
    } catch (e) {
      return Service.rejectResponse(e.message || 'Internal Server Error', e.status || 500);
    }
  }

  /**
   * Get a Link Monitor by id
   **/
  static async linkmonitorsIdGET ({ id, org }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, false);
      const linkMonitor = await LinkMonitors.findOne(
        { org: { $in: orgList }, _id: id },
        selectFields
      );

      if (!linkMonitor) {
        return Service.rejectResponse('Not found', 404);
      }

      return Service.successResponse(linkMonitor);
    } catch (e) {
      return Service.rejectResponse(e.message || 'Internal Server Error', e.status || 500);
    }
  }

  /**
   * Add a new Link Monitor
   **/
  static async linkmonitorsPOST ({ org, ...linkMonitorRequest }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, true);
      const { name, type, servers, urls, timeout, threshold, attempts } = linkMonitorRequest;

      const hasDuplicatedNames = await LinkMonitors.countDocuments({
        org: orgList[0], name
      });
      if (hasDuplicatedNames) {
        return Service.rejectResponse('Duplicated link monitor names are not allowed', 400);
      }

      const result = await LinkMonitors.create({
        org: orgList[0].toString(),
        name,
        type,
        servers: servers || [],
        urls: urls || [],
        timeout,
        threshold,
        attempts
      });

      const linkMonitor = (({ name, type, servers, urls, timeout, threshold, attempts, _id }) => ({
        name, type, servers, urls, timeout, threshold, attempts, _id
      }))(result);
      return Service.successResponse(linkMonitor, 201);
    } catch (e) {
      return Service.rejectResponse(e.message || 'Internal Server Error', e.status || 500);
    }
  }

  /**
   * Modify a Link Monitor
   **/
  static async linkmonitorsIdPUT ({ id, org, ...linkMonitorRequest }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, true);
      const { name, type, servers, urls, timeout, threshold, attempts } = linkMonitorRequest;

      const hasDuplicatedNames = await LinkMonitors.countDocuments({
        org: orgList[0], name, _id: { $ne: id }
      });
      if (hasDuplicatedNames) {
        return Service.rejectResponse('Duplicated link monitor names are not allowed', 400);
      }

      const linkMonitor = await LinkMonitors.findOneAndUpdate(
        { org: { $in: orgList }, _id: id },
        { name, type, servers: servers || [], urls: urls || [], timeout, threshold, attempts },
        { fields: selectFields, new: true }
      );

      if (!linkMonitor) {
        return Service.rejectResponse('Not found', 404);
      }

      return Service.successResponse(linkMonitor);
    } catch (e) {
      return Service.rejectResponse(e.message || 'Internal Server Error', e.status || 500);
    }
  }

  /**
   * Delete a Link Monitor
   **/
  static async linkmonitorsIdDELETE ({ id, org }, { user }) {
    try {
      const orgList = await getAccessTokenOrgList(user, org, true);
      const { deletedCount } = await LinkMonitors.deleteOne({
        org: { $in: orgList }, _id: id
      });

      if (deletedCount === 0) {
        return Service.rejectResponse('Not found', 404);
      }

      return Service.successResponse(null, 204);
    } catch (e) {
      return Service.rejectResponse(e.message || 'Internal Server Error', e.status || 500);
    }
  }
}

module.exports = LinkMonitorsService;
