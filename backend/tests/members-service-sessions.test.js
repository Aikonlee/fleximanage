/** @jest-environment node */
// Membership mutations must revoke the affected user's sessions via authSessions.revokeAll.
// revokeAll runs for real (wrapped in a spy) against mocked models so the session-row update
// and the single authVersion increment are observable.
const mongoose = require('mongoose');

jest.mock('../services/Service', () => ({
  successResponse: (body, code = 200) => ({ body, code }),
  rejectResponse: (error, code = 500) => ({ error, code })
}));
jest.mock('../logging/logging', () => () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn()
}));
jest.mock('../configs', () => () => ({ get: () => '' }));
jest.mock('../utils/random-key', () => () => 'random-key');
jest.mock('../utils/mailer', () => {
  const sendMailHTML = jest.fn(async () => true);
  return () => ({ sendMailHTML });
});
jest.mock('../utils/webhooks', () => () => ({ sendToWebHook: jest.fn(async () => true) }));
jest.mock('../tokens', () => ({ getToken: jest.fn(), getRefreshToken: jest.fn() }));
jest.mock('../models/accounts', () => ({}));
jest.mock('../models/organizations', () => ({}));
jest.mock('../models/notificationsConf', () => ({ updateMany: jest.fn(async () => ({})) }));
jest.mock('../utils/membershipUtils', () => ({ getUserOrganizations: jest.fn(async () => ({})) }));
jest.mock('../mongoConns.js', () => {
  const dbSession = {
    startTransaction: jest.fn(), commitTransaction: jest.fn(), abortTransaction: jest.fn()
  };
  return () => ({ getMainDB: () => ({ startSession: async () => dbSession }), dbSession });
});
jest.mock('../models/membership', () => ({
  membership: {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    aggregate: jest.fn(),
    deleteOne: jest.fn(),
    create: jest.fn()
  },
  permissionMasks: { get: 1 },
  preDefinedPermissions: new Proxy({}, { get: (t, key) => ({ preset: key }) }),
  validatePermissionCombination: () => ({ status: true })
}));
jest.mock('../models/users', () => {
  const Users = jest.fn(function (data) {
    Object.assign(this, data, { _id: 'new-user-id' });
    this.validate = jest.fn();
    this.setPassword = jest.fn();
    this.$session = jest.fn();
    this.save = jest.fn();
  });
  Object.assign(Users, {
    findOne: jest.fn(), findById: jest.fn(), updateOne: jest.fn(), findOneAndUpdate: jest.fn()
  });
  return Users;
});
// virtual: keep the same mock flavour as tests/auth-sessions.test.js (see admin-authversion test).
jest.mock('../models/authSessions', () => ({
  updateMany: jest.fn(async () => ({})), exists: jest.fn(async () => true)
}), { virtual: true });
jest.mock('../authSessions', () => {
  const actual = jest.requireActual('../authSessions');
  return { ...actual, revokeAll: jest.fn(actual.revokeAll) };
});
jest.mock('../authenticate', () => ({
  hasRecentReauth: jest.fn(() => true),
  isAppCredential: jest.fn(() => false)
}));

const { membership } = require('../models/membership');
const Users = require('../models/users');
const Sessions = require('../models/authSessions');
const authSessions = require('../authSessions');
const { getToken } = require('../tokens');
const { dbSession } = require('../mongoConns.js')();
const MembersService = require('../services/MembersService');

const oid = () => new mongoose.Types.ObjectId();
// Thenable query stub supporting the chained mongoose helpers used by the service.
const query = value => {
  const promise = Promise.resolve(value);
  const chain = {
    populate: () => chain,
    select: () => chain,
    session: () => chain,
    allowDiskUse: () => chain,
    then: (a, b) => promise.then(a, b)
  };
  return chain;
};
const same = (a, b) => a !== undefined && b !== undefined && String(a) === String(b);

let events;
let callerId, accountId, otherAccountId, targetId, membershipId;
let caller;
// authVersion bookkeeping for the real revokeAll ($inc on Users.findOneAndUpdate).
let authVersions;

beforeEach(() => {
  jest.clearAllMocks();
  events = [];
  [callerId, accountId, otherAccountId, targetId, membershipId] =
    [oid(), oid(), oid(), oid(), oid()];
  caller = {
    _id: callerId,
    email: 'owner@example.invalid',
    username: 'owner@example.invalid',
    defaultAccount: { _id: accountId, name: 'Acct' },
    defaultOrg: { _id: oid() }
  };
  authVersions = new Map([[String(targetId), 0], [String(callerId), 0]]);
  Users.findOneAndUpdate.mockImplementation(async (filter, update) => {
    const key = String(filter._id);
    if (!authVersions.has(key)) return null;
    if (update.$inc) {
      events.push(`revoke:${key}`);
      authVersions.set(key, authVersions.get(key) + update.$inc.authVersion);
    } else {
      events.push(`update-user:${key}`);
    }
    return { _id: filter._id, authVersion: authVersions.get(key) };
  });
  Users.updateOne.mockImplementation(async (filter, update) => {
    events.push(`users.updateOne:${JSON.stringify(update)}`);
    return {};
  });
  Sessions.updateMany.mockImplementation(async filter => {
    events.push(`sessions.revoke:${filter.user}`);
    return {};
  });
});

const incCount = id => Users.findOneAndUpdate.mock.calls
  .filter(([f, u]) => same(f._id, id) && u.$inc).length;

describe('membersIdPUT', () => {
  const request = extra => ({
    id: String(membershipId),
    userId: String(oid()), // caller-supplied id that must NOT drive revocation
    userPermissionTo: 'account',
    userRole: 'manager',
    userEntity: String(accountId),
    ...extra
  });
  const targetMembership = () => ({ _id: membershipId, user: targetId, role: 'viewer' });

  beforeEach(() => {
    membership.findOne.mockImplementation(async q => {
      if (q._id) return same(q._id, membershipId) ? targetMembership() : null;
      if (same(q.user, callerId)) return { _id: oid(), role: 'owner' }; // checkMemberLevel
      return null; // no duplicate role
    });
    membership.findOneAndUpdate.mockImplementation((filter) => {
      events.push('membership.update');
      return query(same(filter._id, membershipId)
        ? {
            _id: membershipId,
            user: { _id: targetId, name: 'T' },
            account: { _id: accountId, name: 'Acct' },
            organization: null,
            to: 'account',
            role: 'manager'
          }
        : null);
    });
    Users.findOne.mockImplementation(() => query({
      _id: targetId, defaultAccount: { _id: otherAccountId }
    }));
  });

  test('revokes the membership user, not the caller-supplied userId', async () => {
    const req = request();
    const result = await MembersService.membersIdPUT(req, { user: caller });
    expect(result.code).toBe(200);
    expect(authSessions.revokeAll).toHaveBeenCalledTimes(1);
    expect(String(authSessions.revokeAll.mock.calls[0][0])).toBe(String(targetId));
    expect(authSessions.revokeAll).not.toHaveBeenCalledWith(req.userId);
    expect(incCount(targetId)).toBe(1);
    expect(events.indexOf('membership.update'))
      .toBeLessThan(events.indexOf(`revoke:${targetId}`));
    // the update is applied to the membership addressed by the path id
    expect(membership.findOneAndUpdate.mock.calls[0][0])
      .toEqual({ _id: String(membershipId), account: accountId });
  });

  test('does not revoke when the membership is not in the caller account', async () => {
    const result = await MembersService.membersIdPUT(request({ id: String(oid()) }),
      { user: caller });
    expect(result.code).toBe(404);
    expect(membership.findOneAndUpdate).not.toHaveBeenCalled();
    expect(authSessions.revokeAll).not.toHaveBeenCalled();
  });

  test('does not revoke when the caller lacks permission', async () => {
    membership.findOne.mockImplementation(async q => (q._id ? targetMembership() : null));
    const result = await MembersService.membersIdPUT(request(), { user: caller });
    expect(result.code).toBe(403);
    expect(membership.findOneAndUpdate).not.toHaveBeenCalled();
    expect(authSessions.revokeAll).not.toHaveBeenCalled();
  });
});

describe('membersIdDELETE', () => {
  const membershipData = () => ({
    _id: membershipId, user: targetId, account: accountId, to: 'account', role: 'viewer', group: ''
  });

  beforeEach(() => {
    membership.findOne.mockImplementation(async q => {
      if (q._id) return membershipData();
      if (same(q.user, callerId)) return { _id: oid(), role: 'owner' };
      return null;
    });
    Users.findById.mockImplementation(() => query({ _id: targetId, admin: false }));
    Users.findOne.mockImplementation(() => query({ _id: targetId }));
    membership.aggregate.mockImplementation(() => query([
      { _id: accountId, count: 1 }, { _id: otherAccountId, count: 1 }
    ]));
    membership.deleteOne.mockImplementation(async () => { events.push('membership.delete'); });
  });

  test('revokes the removed user after the defaultAccount switch and deletion', async () => {
    const result = await MembersService.membersIdDELETE({ id: String(membershipId) },
      { user: caller });
    expect(result.code).toBe(204);
    expect(authSessions.revokeAll).toHaveBeenCalledTimes(1);
    expect(authSessions.revokeAll).toHaveBeenCalledWith(targetId);
    expect(incCount(targetId)).toBe(1);
    const switched = events.findIndex(e => e.includes(String(otherAccountId)));
    expect(switched).toBeGreaterThanOrEqual(0);
    expect(switched).toBeLessThan(events.indexOf(`revoke:${targetId}`));
    expect(events.indexOf('membership.delete')).toBeLessThan(events.indexOf(`revoke:${targetId}`));
  });

  test('revokes sessions bound to the old account; old-account tokens fail', async () => {
    await MembersService.membersIdDELETE({ id: String(membershipId) }, { user: caller });
    // Session rows are revoked for the user regardless of account (no account filter).
    expect(Sessions.updateMany).toHaveBeenCalledWith(
      { user: targetId, revokedAt: null }, { $set: { revokedAt: expect.any(Date) } });
    // An access token minted for the old account no longer validates.
    const after = { _id: targetId, authVersion: 1, defaultAccount: { _id: otherAccountId } };
    const oldToken = {
      sid: 's', _id: String(targetId), account: String(accountId), authVersion: 0
    };
    await expect(authSessions.validateAccess(oldToken, after)).resolves.toBe(false);
    await expect(authSessions.validateAccess({ ...oldToken, authVersion: 1 }, after))
      .resolves.toBe(false);
  });

  test('does not revoke when the caller lacks permission', async () => {
    membership.findOne.mockImplementation(async q => (q._id ? membershipData() : null));
    const result = await MembersService.membersIdDELETE({ id: String(membershipId) },
      { user: caller });
    expect(result.code).toBe(400);
    expect(membership.deleteOne).not.toHaveBeenCalled();
    expect(authSessions.revokeAll).not.toHaveBeenCalled();
  });
});

describe('membersPOST', () => {
  const request = email => ({
    email,
    userFirstName: 'F',
    userLastName: 'L',
    userJobTitle: 'J',
    userPermissionTo: 'account',
    userRole: 'viewer',
    userEntity: String(accountId)
  });

  beforeEach(() => {
    membership.findOne.mockImplementation(async q =>
      (same(q.user, callerId) ? { _id: oid(), role: 'owner' } : null));
    membership.create.mockImplementation(async () => [query({
      _id: membershipId,
      account: { _id: accountId, name: 'Acct' },
      organization: null,
      group: '',
      to: 'account',
      role: 'viewer'
    })]);
    dbSession.commitTransaction.mockImplementation(async () => { events.push('commit'); });
  });

  test('revokes an existing invited user after the transaction commits', async () => {
    Users.findOne.mockImplementation(() => query({
      _id: targetId, name: 'Existing', state: 'verified', mfa: { enabled: false }
    }));
    const result = await MembersService.membersPOST(request('existing@example.invalid'),
      { user: caller, restUiUrl: 'https://ui.invalid' });
    expect(result.code).toBe(201);
    expect(authSessions.revokeAll).toHaveBeenCalledTimes(1);
    expect(authSessions.revokeAll).toHaveBeenCalledWith(targetId);
    expect(incCount(targetId)).toBe(1);
    expect(events.indexOf('commit')).toBeGreaterThanOrEqual(0);
    expect(events.indexOf('commit')).toBeLessThan(events.indexOf(`revoke:${targetId}`));
  });

  test('does not revoke when the transaction fails to commit', async () => {
    Users.findOne.mockImplementation(() => query({ _id: targetId, name: 'Existing' }));
    dbSession.commitTransaction.mockRejectedValue(new Error('commit failed'));
    const result = await MembersService.membersPOST(request('existing@example.invalid'),
      { user: caller, restUiUrl: 'https://ui.invalid' });
    expect(result.code).toBe(500);
    expect(authSessions.revokeAll).not.toHaveBeenCalled();
  });

  test('does not revoke anyone when inviting a brand-new user', async () => {
    Users.findOne.mockImplementation(() => query(null));
    const result = await MembersService.membersPOST(request('new@example.invalid'),
      { user: caller, restUiUrl: 'https://ui.invalid' });
    expect(result.code).toBe(201);
    expect(authSessions.revokeAll).not.toHaveBeenCalled();
  });
});

describe('membersIdResetMfaPOST', () => {
  const ownerOf = account => async q => {
    if (same(q.user, callerId)) {
      return q.role === 'owner' && same(q.account, account) ? { _id: oid(), role: 'owner' } : null;
    }
    return null;
  };

  beforeEach(() => {
    Users.findOne.mockImplementation(async q =>
      (same(q._id, targetId) ? { _id: targetId, authVersion: 0 } : null));
  });

  test('account owner resets a member of the same account and revokes the target', async () => {
    membership.findOne.mockImplementation(async q => {
      if (same(q.user, targetId) && same(q.account, accountId)) return { _id: oid() };
      return ownerOf(accountId)(q);
    });
    const response = { setHeader: jest.fn() };
    const result = await MembersService.membersIdResetMfaPOST({ id: String(targetId) },
      { user: caller }, response);
    expect(result.code).toBe(204);
    expect(Users.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: targetId, $or: [{ authVersion: 0 }, { authVersion: { $exists: false } }] },
      {
        $set: { mfa: { enabled: false, secret: null, unverifiedSecrets: [], recoveryCodes: [] } },
        $inc: { authVersion: 1 }
      },
      { upsert: false, new: true });
    expect(authSessions.revokeAll).toHaveBeenCalledTimes(1);
    expect(String(authSessions.revokeAll.mock.calls[0][0])).toBe(String(targetId));
    expect(authSessions.revokeAll.mock.calls[0][1]).toEqual({
      incrementAuthVersion: false,
      expectedAuthVersion: 1
    });
    expect(incCount(targetId)).toBe(1);
    expect(incCount(callerId)).toBe(0);
    // no replacement token is issued
    expect(getToken).not.toHaveBeenCalled();
    expect(response.setHeader).not.toHaveBeenCalled();
  });

  test('an owner of the caller account cannot reset a user outside that account', async () => {
    membership.findOne.mockImplementation(ownerOf(accountId)); // target has no membership here
    const result = await MembersService.membersIdResetMfaPOST({ id: String(targetId) },
      { user: caller }, { setHeader: jest.fn() });
    expect(result.code).toBe(400);
    expect(membership.findOne).toHaveBeenCalledWith({ user: String(targetId), account: accountId });
    expect(Users.findOneAndUpdate).not.toHaveBeenCalled();
    expect(authSessions.revokeAll).not.toHaveBeenCalled();
  });

  test('being an owner somewhere else does not authorize resetting a member', async () => {
    membership.findOne.mockImplementation(async q => {
      if (same(q.user, targetId) && same(q.account, accountId)) return { _id: oid() };
      return ownerOf(otherAccountId)(q); // caller owns a different account only
    });
    const result = await MembersService.membersIdResetMfaPOST({ id: String(targetId) },
      { user: caller }, { setHeader: jest.fn() });
    expect(result.code).toBe(400);
    expect(Users.findOneAndUpdate).not.toHaveBeenCalled();
    expect(authSessions.revokeAll).not.toHaveBeenCalled();
  });

  test('a malformed target id is rejected without touching any user', async () => {
    const result = await MembersService.membersIdResetMfaPOST({ id: 'not-an-object-id' },
      { user: caller }, { setHeader: jest.fn() });
    expect(result.code).toBe(400);
    expect(membership.findOne).not.toHaveBeenCalled();
    expect(Users.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('self reset revokes the caller and issues no replacement token', async () => {
    const response = { setHeader: jest.fn() };
    const result = await MembersService.membersIdResetMfaPOST({ id: String(callerId) },
      { user: caller }, response);
    expect(result.code).toBe(204);
    expect(membership.findOne).not.toHaveBeenCalled();
    expect(incCount(callerId)).toBe(1);
    expect(getToken).not.toHaveBeenCalled();
    expect(response.setHeader).not.toHaveBeenCalled();
  });

  test('missing target user returns 404 without revoking', async () => {
    const ghost = oid();
    membership.findOne.mockImplementation(async q => {
      if (same(q.user, ghost)) return { _id: oid() };
      return ownerOf(accountId)(q);
    });
    const result = await MembersService.membersIdResetMfaPOST({ id: String(ghost) },
      { user: caller }, { setHeader: jest.fn() });
    expect(result.code).toBe(404);
    expect(authSessions.revokeAll).not.toHaveBeenCalled();
  });
});
