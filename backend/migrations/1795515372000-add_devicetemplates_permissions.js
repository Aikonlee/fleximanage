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

const { membership, preDefinedPermissions } = require('../models/membership');
const accessTokens = require('../models/accesstokens');
const { removePerms } = require('./utils/updatePerms');
const logger = require('../logging/logging')({
  module: module.filename,
  type: 'migration'
});

const FIELD = 'devicetemplates';
const DEFAULT_MASK = 1;

const ROLE_MASKS = [
  {
    filter: { to: 'account', role: 'owner' },
    mask: preDefinedPermissions.account_owner[FIELD]
  },
  {
    filter: { to: 'account', role: 'manager' },
    mask: preDefinedPermissions.account_manager[FIELD]
  },
  {
    filter: { to: 'group', role: 'manager' },
    mask: preDefinedPermissions.group_manager[FIELD]
  },
  {
    filter: { to: 'organization', role: 'manager' },
    mask: preDefinedPermissions.organization_manager[FIELD]
  },
  {
    filter: { to: 'account', role: 'viewer' },
    mask: preDefinedPermissions.account_viewer[FIELD]
  },
  {
    filter: { to: 'group', role: 'viewer' },
    mask: preDefinedPermissions.group_viewer[FIELD]
  },
  {
    filter: { to: 'organization', role: 'viewer' },
    mask: preDefinedPermissions.organization_viewer[FIELD]
  }
];

const KNOWN_ROLE_FILTERS = ROLE_MASKS.map(({ filter }) => filter);

async function backfillCollection (model, fieldPath, baseFilter = {}) {
  for (const { filter, mask } of ROLE_MASKS) {
    await model.updateMany(
      { ...baseFilter, ...filter },
      { $set: { [fieldPath]: mask } },
      { upsert: false }
    );
  }

  await model.updateMany(
    { ...baseFilter, $nor: KNOWN_ROLE_FILTERS },
    { $set: { [fieldPath]: DEFAULT_MASK } },
    { upsert: false }
  );
}

async function up () {
  try {
    await backfillCollection(membership, `perms.${FIELD}`);
    await backfillCollection(
      accessTokens,
      `permissions.${FIELD}`,
      { permissions: { $exists: true, $ne: null } }
    );
  } catch (err) {
    logger.error('Database migration failed', {
      params: {
        collections: ['membership', 'accesstokens'],
        operation: 'up',
        err: err.message
      }
    });
    throw err;
  }
}

async function down () {
  try {
    await removePerms(membership, FIELD);
  } catch (err) {
    logger.error('Database migration failed', {
      params: {
        collections: ['membership', 'accesstokens'],
        operation: 'down',
        err: err.message
      }
    });
    throw err;
  }
}

module.exports = { up, down };
