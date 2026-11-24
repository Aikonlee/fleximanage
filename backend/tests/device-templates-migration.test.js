/** @jest-environment node */

function matchesFilter (doc, filter) {
  for (const [key, cond] of Object.entries(filter)) {
    if (key === '$nor') {
      if (cond.some((sub) => matchesFilter(doc, sub))) {
        return false;
      }
      continue;
    }

    const exists = Object.prototype.hasOwnProperty.call(doc, key) && doc[key] !== undefined;
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('$exists' in cond && exists !== cond.$exists) {
        return false;
      }
      if ('$ne' in cond && doc[key] === cond.$ne) {
        return false;
      }
      continue;
    }

    if (doc[key] !== cond) {
      return false;
    }
  }
  return true;
}

function applyUpdate (docs, filter, update) {
  let matched = 0;
  for (const doc of docs) {
    if (!matchesFilter(doc, filter)) {
      continue;
    }
    matched += 1;
    if (update.$set) {
      for (const [path, value] of Object.entries(update.$set)) {
        const [parent, child] = path.split('.');
        if (!doc[parent] || typeof doc[parent] !== 'object') {
          doc[parent] = {};
        }
        doc[parent][child] = value;
      }
    }
    if (update.$unset) {
      for (const path of Object.keys(update.$unset)) {
        const [parent, child] = path.split('.');
        if (doc[parent] && typeof doc[parent] === 'object') {
          delete doc[parent][child];
        }
      }
    }
  }
  return { matchedCount: matched, modifiedCount: matched };
}

function loadMigrationWithConfig ({ allowManagerToDel }) {
  jest.resetModules();

  const membershipUpdateMany = jest.fn();
  const accessTokensUpdateMany = jest.fn();

  jest.doMock('../mongoConns.js', () => {
    const mongooseLib = require('mongoose');
    const main = mongooseLib.createConnection();
    return () => ({ getMainDB: () => main });
  });

  jest.doMock('../configs', () => () => ({
    get: (key) => {
      if (key === 'allowManagerToDel') return allowManagerToDel;
      return false;
    }
  }));

  jest.doMock('../logging/logging', () => () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  }));

  jest.doMock('../models/accesstokens', () => ({
    updateMany: accessTokensUpdateMany
  }));

  const membershipModule = require('../models/membership');
  membershipModule.membership.updateMany = membershipUpdateMany;
  const migration = require('../migrations/1795515372000-add_devicetemplates_permissions');

  return {
    migration,
    membershipUpdateMany,
    accessTokensUpdateMany,
    preDefinedPermissions: membershipModule.preDefinedPermissions,
    setPermission: membershipModule.setPermission
  };
}

function makeMembershipFixtures () {
  return [
    { id: 'acct-owner', to: 'account', role: 'owner', perms: { devices: 15, linkmonitors: 15 } },
    { id: 'acct-mgr', to: 'account', role: 'manager', perms: { devices: 7, linkmonitors: 7 } },
    { id: 'grp-mgr', to: 'group', role: 'manager', perms: { devices: 7, linkmonitors: 7 } },
    { id: 'org-mgr', to: 'organization', role: 'manager', perms: { devices: 7, linkmonitors: 7 } },
    { id: 'acct-view', to: 'account', role: 'viewer', perms: { devices: 1, linkmonitors: 1 } },
    { id: 'grp-view', to: 'group', role: 'viewer', perms: { devices: 1, linkmonitors: 1 } },
    { id: 'org-view', to: 'organization', role: 'viewer', perms: { devices: 1, linkmonitors: 1 } },
    { id: 'unknown-role', to: 'account', role: 'custom', perms: { devices: 1 } },
    { id: 'missing-role', to: 'account', perms: { devices: 1 } },
    { id: 'invalid-combo', to: 'group', role: 'owner', perms: { devices: 1 } }
  ];
}

function makeAccessTokenFixtures () {
  return [
    {
      id: 'tok-owner',
      to: 'account',
      role: 'owner',
      permissions: { devices: 15, linkmonitors: 15 }
    },
    {
      id: 'tok-acct-mgr',
      to: 'account',
      role: 'manager',
      permissions: { devices: 7, linkmonitors: 7 }
    },
    {
      id: 'tok-grp-mgr',
      to: 'group',
      role: 'manager',
      permissions: { devices: 7, linkmonitors: 7 }
    },
    {
      id: 'tok-org-mgr',
      to: 'organization',
      role: 'manager',
      permissions: { devices: 7, linkmonitors: 7 }
    },
    {
      id: 'tok-acct-view',
      to: 'account',
      role: 'viewer',
      permissions: { devices: 1, linkmonitors: 1 }
    },
    {
      id: 'tok-grp-view',
      to: 'group',
      role: 'viewer',
      permissions: { devices: 1, linkmonitors: 1 }
    },
    {
      id: 'tok-org-view',
      to: 'organization',
      role: 'viewer',
      permissions: { devices: 1, linkmonitors: 1 }
    },
    {
      id: 'tok-unknown',
      to: 'account',
      role: 'custom',
      permissions: { devices: 1 }
    },
    {
      id: 'tok-missing-role',
      to: 'account',
      permissions: { devices: 1 }
    },
    {
      id: 'tok-no-perms',
      to: 'account',
      role: 'owner'
    },
    {
      id: 'tok-null-perms',
      to: 'account',
      role: 'owner',
      permissions: null
    }
  ];
}

afterEach(async () => {
  const mongoose = require('mongoose');
  await Promise.all(mongoose.connections.map((conn) => conn.close(true)));
});

describe('1795515372000-add_devicetemplates_permissions migration', () => {
  test.each([
    { allowManagerToDel: false, expectedManagerMask: 7 },
    { allowManagerToDel: true, expectedManagerMask: 15 }
  ])(
    'assigns role-aware masks when allowManagerToDel=$allowManagerToDel',
    async ({ allowManagerToDel, expectedManagerMask }) => {
      const {
        migration,
        membershipUpdateMany,
        accessTokensUpdateMany,
        preDefinedPermissions,
        setPermission
      } = loadMigrationWithConfig({ allowManagerToDel });

      const memberships = makeMembershipFixtures();
      const tokens = makeAccessTokenFixtures();

      membershipUpdateMany.mockImplementation(async (filter, update) =>
        applyUpdate(memberships, filter, update)
      );
      accessTokensUpdateMany.mockImplementation(async (filter, update) =>
        applyUpdate(tokens, filter, update)
      );

      const expectedMgr = setPermission(1, 1, 1, allowManagerToDel ? 1 : 0);
      expect(expectedMgr).toBe(expectedManagerMask);
      expect(preDefinedPermissions.account_manager.devicetemplates).toBe(expectedMgr);
      expect(preDefinedPermissions.group_manager.devicetemplates).toBe(expectedMgr);
      expect(preDefinedPermissions.organization_manager.devicetemplates).toBe(expectedMgr);

      await migration.up();

      // Verify every updateMany call used { upsert: false }
      for (const call of membershipUpdateMany.mock.calls) {
        expect(call[2]).toEqual({ upsert: false });
      }
      for (const call of accessTokensUpdateMany.mock.calls) {
        expect(call[2]).toEqual({ upsert: false });
      }

      const memById = Object.fromEntries(memberships.map((m) => [m.id, m]));
      expect(memById['acct-owner'].perms.devicetemplates).toBe(15);
      expect(memById['acct-mgr'].perms.devicetemplates).toBe(expectedManagerMask);
      expect(memById['grp-mgr'].perms.devicetemplates).toBe(expectedManagerMask);
      expect(memById['org-mgr'].perms.devicetemplates).toBe(expectedManagerMask);
      expect(memById['acct-view'].perms.devicetemplates).toBe(1);
      expect(memById['grp-view'].perms.devicetemplates).toBe(1);
      expect(memById['org-view'].perms.devicetemplates).toBe(1);
      expect(memById['unknown-role'].perms.devicetemplates).toBe(1);
      expect(memById['missing-role'].perms.devicetemplates).toBe(1);
      expect(memById['invalid-combo'].perms.devicetemplates).toBe(1);

      const tokById = Object.fromEntries(tokens.map((t) => [t.id, t]));
      expect(tokById['tok-owner'].permissions.devicetemplates).toBe(15);
      expect(tokById['tok-acct-mgr'].permissions.devicetemplates).toBe(expectedManagerMask);
      expect(tokById['tok-grp-mgr'].permissions.devicetemplates).toBe(expectedManagerMask);
      expect(tokById['tok-org-mgr'].permissions.devicetemplates).toBe(expectedManagerMask);
      expect(tokById['tok-acct-view'].permissions.devicetemplates).toBe(1);
      expect(tokById['tok-grp-view'].permissions.devicetemplates).toBe(1);
      expect(tokById['tok-org-view'].permissions.devicetemplates).toBe(1);
      expect(tokById['tok-unknown'].permissions.devicetemplates).toBe(1);
      expect(tokById['tok-missing-role'].permissions.devicetemplates).toBe(1);
      expect(tokById['tok-no-perms'].permissions).toBeUndefined();
      expect(tokById['tok-null-perms'].permissions).toBeNull();

      // Verify down() only unsets devicetemplates and preserves other permissions
      await migration.down();

      for (const m of memberships) {
        expect(m.perms.devicetemplates).toBeUndefined();
        expect(m.perms.devices).toBeDefined();
      }
      for (const t of tokens) {
        if (t.permissions && typeof t.permissions === 'object') {
          expect(t.permissions.devicetemplates).toBeUndefined();
          expect(t.permissions.devices).toBeDefined();
        }
      }
      expect(tokById['tok-no-perms'].permissions).toBeUndefined();
      expect(tokById['tok-null-perms'].permissions).toBeNull();
    }
  );
});
