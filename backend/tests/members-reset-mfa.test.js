jest.mock('../mongoConns', () => {
  const m = require('mongoose');
  const main = m.createConnection();
  const analytics = m.createConnection();
  const vpn = m.createConnection();
  return () => ({
    getMainDB: () => main,
    getAnalyticsDB: () => analytics,
    getVpnDB: () => vpn
  });
});
jest.mock('../models/authSessions', () => {
  const rows = [];
  const matchesClause = (row, clause) => Object.entries(clause).every(([field, expected]) => {
    const hasField = Object.prototype.hasOwnProperty.call(row, field) && row[field] !== undefined;
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      const ops = Object.entries(expected);
      if (ops.length === 0) return false;
      return ops.every(([op, val]) => {
        if (op === '$lt') return hasField && typeof row[field] === 'number' && row[field] < val;
        if (op === '$exists') return hasField === Boolean(val);
        return false;
      });
    }
    if (expected === null) return row[field] == null;
    return row[field] === expected;
  });
  return {
    rows,
    updateOne: jest.fn(async (filter, update) => {
      const row = rows.find(item =>
        item.sid === filter.sid &&
        String(item.user) === String(filter.user) &&
        item.revokedAt == null
      );
      if (row) Object.assign(row, update.$set || {});
      return {};
    }),
    updateMany: jest.fn(async (filter, update) => {
      for (const row of rows) {
        if (String(row.user) !== String(filter.user) || row.revokedAt != null) {
          continue;
        }
        if (Array.isArray(filter.$or) && !filter.$or.some(clause => matchesClause(row, clause))) {
          continue;
        }
        Object.assign(row, update.$set || {});
      }
      return {};
    }),
    create: jest.fn(async (doc) => {
      const row = { ...doc };
      rows.push(row);
      return row;
    }),
    exists: jest.fn(async (query) => rows.some(row =>
      row.sid === query.sid &&
      String(row.user) === String(query.user) &&
      String(row.account) === String(query.account) &&
      row.authVersion === query.authVersion &&
      row.revokedAt == null &&
      row.expiresAt > query.expiresAt.$gt
    ))
  };
}, { virtual: true });

const mongoose = require('mongoose');
const MembersService = require('../services/MembersService');
const Users = require('../models/users');
const { membership } = require('../models/membership');
const Sessions = require('../models/authSessions');
const authSessions = require('../authSessions');
const { REAUTH_MAX_AGE_SECONDS, verifyPermissionEx } = require('../authenticate');

const nowSeconds = () => Math.floor(Date.now() / 1000);

const makeSessionUser = (overrides = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  defaultAccount: { _id: new mongoose.Types.ObjectId() },
  accessToken: false,
  authTokenType: 'session',
  authTime: nowSeconds() - 10,
  ...overrides
});

describe('MembersService.membersIdResetMfaPOST', () => {
  let findOneSpy;
  let findOneAndUpdateSpy;
  let membershipFindOneSpy;
  let revokeAllSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    Sessions.rows.length = 0;
    findOneSpy = jest.spyOn(Users, 'findOne').mockResolvedValue(null);
    findOneAndUpdateSpy = jest.spyOn(Users, 'findOneAndUpdate').mockResolvedValue(null);
    membershipFindOneSpy = jest.spyOn(membership, 'findOne').mockResolvedValue(null);
    revokeAllSpy = jest.spyOn(authSessions, 'revokeAll').mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('rejects missing or stale reauth on self and owner paths with no write', async () => {
    const staleSelf = makeSessionUser({ authTime: nowSeconds() - REAUTH_MAX_AGE_SECONDS - 60 });
    const resSelf = await MembersService.membersIdResetMfaPOST(
      { id: staleSelf._id.toString() },
      { user: staleSelf }
    );
    expect(resSelf.code).toBe(403);

    const missingAuthTimeOwner = makeSessionUser({ authTime: null });
    const targetId = new mongoose.Types.ObjectId();
    const resOwner = await MembersService.membersIdResetMfaPOST(
      { id: targetId.toString() },
      { user: missingAuthTimeOwner }
    );
    expect(resOwner.code).toBe(403);

    expect(membershipFindOneSpy).not.toHaveBeenCalled();
    expect(findOneSpy).not.toHaveBeenCalled();
    expect(findOneAndUpdateSpy).not.toHaveBeenCalled();
    expect(revokeAllSpy).not.toHaveBeenCalled();
  });

  test('rejects app credentials on both self and owner paths with no write', async () => {
    const targetId = new mongoose.Types.ObjectId();
    const appKeyUser = makeSessionUser({
      accessToken: true,
      authTokenType: 'app_access_key'
    });
    const appTokenUser = makeSessionUser({
      accessToken: false,
      authTokenType: 'app_access_token'
    });

    const resSelf = await MembersService.membersIdResetMfaPOST(
      { id: appKeyUser._id.toString() },
      { user: appKeyUser }
    );
    expect(resSelf.code).toBe(403);

    const resOwner = await MembersService.membersIdResetMfaPOST(
      { id: targetId.toString() },
      { user: appTokenUser }
    );
    expect(resOwner.code).toBe(403);

    expect(membershipFindOneSpy).not.toHaveBeenCalled();
    expect(findOneSpy).not.toHaveBeenCalled();
    expect(findOneAndUpdateSpy).not.toHaveBeenCalled();
    expect(revokeAllSpy).not.toHaveBeenCalled();
  });

  test('updates MFA atomically with $inc authVersion and revokes older sessions', async () => {
    const owner = makeSessionUser();
    const targetId = new mongoose.Types.ObjectId();
    const targetAccountId = owner.defaultAccount._id;

    // Exercise real authSessions.revokeAll against the in-memory session store.
    revokeAllSpy.mockRestore();
    revokeAllSpy = jest.spyOn(authSessions, 'revokeAll');

    const priorSession = await authSessions.createSession({
      _id: targetId,
      authVersion: 4,
      defaultAccount: { _id: targetAccountId }
    });
    const newerSession = await authSessions.createSession({
      _id: targetId,
      authVersion: 5,
      defaultAccount: { _id: targetAccountId }
    });
    const staleAccessToken = {
      _id: String(targetId),
      account: String(targetAccountId),
      sid: priorSession.sid,
      authVersion: 4
    };
    const newerAccessToken = {
      _id: String(targetId),
      account: String(targetAccountId),
      sid: newerSession.sid,
      authVersion: 5
    };
    expect(await authSessions.validateAccess(staleAccessToken, {
      _id: targetId,
      authVersion: 4,
      defaultAccount: { _id: targetAccountId }
    })).toBe(true);

    membershipFindOneSpy
      .mockResolvedValueOnce({ _id: new mongoose.Types.ObjectId(), role: 'owner' })
      .mockResolvedValueOnce({ _id: new mongoose.Types.ObjectId() });
    findOneSpy.mockResolvedValueOnce({ _id: targetId, authVersion: 4 });
    findOneAndUpdateSpy.mockResolvedValueOnce({ _id: targetId, authVersion: 5 });

    const res = await MembersService.membersIdResetMfaPOST(
      { id: targetId.toString() },
      { user: owner }
    );

    expect(res.code).toBe(204);
    expect(findOneSpy).toHaveBeenCalledTimes(1);
    expect(findOneAndUpdateSpy).toHaveBeenCalledTimes(1);
    expect(findOneAndUpdateSpy).toHaveBeenCalledWith(
      { _id: targetId, authVersion: 4 },
      {
        $set: {
          mfa: {
            enabled: false,
            secret: null,
            unverifiedSecrets: [],
            recoveryCodes: []
          }
        },
        $inc: { authVersion: 1 }
      },
      { upsert: false, new: true }
    );
    expect(revokeAllSpy).toHaveBeenCalledTimes(1);
    expect(revokeAllSpy).toHaveBeenCalledWith(targetId, {
      incrementAuthVersion: false,
      expectedAuthVersion: 5
    });
    await expect(revokeAllSpy.mock.results[0].value).resolves.toBe(5);
    expect(Sessions.rows.find(row => row.sid === priorSession.sid).revokedAt).toBeInstanceOf(Date);
    expect(Sessions.rows.find(row => row.sid === newerSession.sid).revokedAt).toBeNull();
    expect(await authSessions.validateAccess(staleAccessToken, {
      _id: targetId,
      authVersion: 5,
      defaultAccount: { _id: targetAccountId }
    })).toBe(false);
    expect(await authSessions.validateAccess(staleAccessToken, {
      _id: targetId,
      authVersion: 4,
      defaultAccount: { _id: targetAccountId }
    })).toBe(false);
    expect(await authSessions.validateAccess(newerAccessToken, {
      _id: targetId,
      authVersion: 5,
      defaultAccount: { _id: targetAccountId }
    })).toBe(true);
  });

  test('handles missing/zero initial authVersion on self reset', async () => {
    const selfUser = makeSessionUser();
    findOneAndUpdateSpy.mockResolvedValueOnce({ _id: selfUser._id, authVersion: 1 });

    const res = await MembersService.membersIdResetMfaPOST(
      { id: selfUser._id.toString() },
      { user: selfUser }
    );

    expect(res.code).toBe(204);
    expect(findOneSpy).not.toHaveBeenCalled();
    expect(findOneAndUpdateSpy).toHaveBeenCalledTimes(1);
    expect(findOneAndUpdateSpy.mock.calls[0][0]).toEqual({
      _id: selfUser._id,
      $or: [{ authVersion: 0 }, { authVersion: { $exists: false } }]
    });
    expect(revokeAllSpy).toHaveBeenCalledWith(selfUser._id, {
      incrementAuthVersion: false,
      expectedAuthVersion: 1
    });
  });

  test('self reset uses caller authVersion instead of freshly read DB authVersion', async () => {
    const selfUser = makeSessionUser({ authVersion: 2 });
    const storedUser = {
      _id: selfUser._id,
      authVersion: 3,
      mfa: {
        enabled: true,
        secret: 'encrypted-secret',
        unverifiedSecrets: [],
        recoveryCodes: ['code-1']
      }
    };

    findOneSpy.mockResolvedValueOnce({ _id: selfUser._id, authVersion: 3 });
    findOneAndUpdateSpy.mockImplementationOnce(async (filter, update) => {
      if (filter.authVersion !== storedUser.authVersion) return null;
      storedUser.mfa = update.$set.mfa;
      storedUser.authVersion += update.$inc.authVersion;
      return { ...storedUser };
    });

    const res = await MembersService.membersIdResetMfaPOST(
      { id: selfUser._id.toString() },
      { user: selfUser }
    );

    expect(res.code).toBe(409);
    expect(findOneSpy).not.toHaveBeenCalled();
    expect(findOneAndUpdateSpy).toHaveBeenCalledTimes(1);
    expect(findOneAndUpdateSpy.mock.calls[0][0]).toEqual({
      _id: selfUser._id,
      authVersion: 2
    });
    expect(storedUser.mfa.enabled).toBe(true);
    expect(storedUser.mfa.secret).toBe('encrypted-secret');
    expect(storedUser.mfa.recoveryCodes).toEqual(['code-1']);
    expect(storedUser.authVersion).toBe(3);
    expect(revokeAllSpy).not.toHaveBeenCalled();
  });

  test('returns 409 and leaves MFA unchanged on authVersion mismatch', async () => {
    const selfUser = makeSessionUser();
    const storedUser = {
      _id: selfUser._id,
      authVersion: 3,
      mfa: {
        enabled: true,
        secret: 'encrypted-secret',
        unverifiedSecrets: [],
        recoveryCodes: ['code-1']
      }
    };

    findOneSpy.mockResolvedValueOnce({ _id: selfUser._id, authVersion: 2 });
    findOneAndUpdateSpy.mockImplementationOnce(async (filter, update) => {
      if (filter.authVersion !== storedUser.authVersion) return null;
      storedUser.mfa = update.$set.mfa;
      storedUser.authVersion += update.$inc.authVersion;
      return { ...storedUser };
    });

    const res = await MembersService.membersIdResetMfaPOST(
      { id: selfUser._id.toString() },
      { user: selfUser }
    );

    expect(res.code).toBe(409);
    expect(storedUser.mfa.enabled).toBe(true);
    expect(storedUser.mfa.secret).toBe('encrypted-secret');
    expect(storedUser.authVersion).toBe(3);
    expect(revokeAllSpy).not.toHaveBeenCalled();
  });
});

describe('verifyPermissionEx override for membersIdResetMfaPOST', () => {
  test('allows membersIdResetMfaPOST without members:post while blocking other POSTs', () => {
    const readOnlyMembersUser = { perms: { members: 1 } };

    expect(verifyPermissionEx('MembersService', {
      method: 'post',
      user: readOnlyMembersUser,
      openapi: { schema: { operationId: 'membersIdResetMfaPOST' } }
    })).toBeTruthy();

    const otherPostPerm = verifyPermissionEx('MembersService', {
      method: 'post',
      user: readOnlyMembersUser,
      openapi: { schema: { operationId: 'membersPOST' } }
    });
    expect(otherPostPerm).toBe(0);
    expect(otherPostPerm).toBeFalsy();
  });
});

describe('Sessions.updateMany mock filter semantics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Sessions.rows.length = 0;
  });

  test('honors user, revokedAt, $lt, and $exists:false filter conditions', async () => {
    const userA = new mongoose.Types.ObjectId();
    const userB = new mongoose.Types.ObjectId();
    const priorRevokedAt = new Date('2025-01-01T00:00:00.000Z');
    const revokeTime = new Date('2026-01-01T00:00:00.000Z');

    await Sessions.create({ sid: 'older', user: userA, authVersion: 2, revokedAt: null });
    await Sessions.create({ sid: 'missing-ver', user: userA, revokedAt: null });
    await Sessions.create({ sid: 'equal-ver', user: userA, authVersion: 3, revokedAt: null });
    await Sessions.create({ sid: 'newer-ver', user: userA, authVersion: 4, revokedAt: null });
    await Sessions.create({
      sid: 'already-revoked',
      user: userA,
      authVersion: 1,
      revokedAt: priorRevokedAt
    });
    await Sessions.create({ sid: 'other-user', user: userB, authVersion: 1, revokedAt: null });

    await Sessions.updateMany(
      {
        user: userA,
        revokedAt: null,
        $or: [
          { authVersion: { $lt: 3 } },
          { authVersion: { $exists: false } }
        ]
      },
      { $set: { revokedAt: revokeTime } }
    );

    const bySid = sid => Sessions.rows.find(row => row.sid === sid);
    expect(bySid('older').revokedAt).toBe(revokeTime);
    expect(bySid('missing-ver').revokedAt).toBe(revokeTime);
    expect(bySid('equal-ver').revokedAt).toBeNull();
    expect(bySid('newer-ver').revokedAt).toBeNull();
    expect(bySid('already-revoked').revokedAt).toBe(priorRevokedAt);
    expect(bySid('other-user').revokedAt).toBeNull();
  });
});
