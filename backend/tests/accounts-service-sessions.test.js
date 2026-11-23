/** @jest-environment node */
// Changing forceMfa revokes each distinct member once. The replacement JWT must carry the
// post-revocation authVersion and a new live session, not the caller's stale in-memory one.
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

jest.mock('../services/Service', () => ({
  successResponse: (body, code = 200) => ({ body, code }),
  rejectResponse: (error, code = 500) => ({ error, code })
}));
jest.mock('../logging/logging', () => {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return () => logger;
});
jest.mock('../configs', () => () => ({
  get: (key, type) => (type === 'number' ? 3600 : '')
}));
jest.mock('../utils/membershipUtils', () => ({
  getUserAccounts: jest.fn(),
  getUserOrganizations: jest.fn()
}));
jest.mock('../models/accounts', () => ({
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn()
}));
jest.mock('../models/membership', () => ({
  membership: { find: jest.fn() }
}));
jest.mock('../models/users', () => ({
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn()
}));
jest.mock('../tokens', () => {
  const jsonwebtoken = require('jsonwebtoken');
  const sign = (payload) => jsonwebtoken.sign(payload, 'synthetic-key');
  return {
    getToken: jest.fn(async ({ user }, override = {}) => sign({
      _id: String(user._id),
      account: user.defaultAccount && user.defaultAccount._id != null
        ? String(user.defaultAccount._id)
        : null,
      accountName: user.defaultAccount ? user.defaultAccount.name : null,
      sid: user.authSessionId,
      authVersion: user.authVersion ?? 0,
      mfaVerified: user.isLoggedInWithMfa ?? false,
      ...override
    })),
    getRefreshToken: jest.fn(async ({ user }, override = {}) => {
      if (!override.sid || !override.jti) throw new Error('Active session required');
      return sign({
        _id: String(user._id),
        type: 'refresh',
        account: String(user.defaultAccount._id),
        authVersion: user.authVersion ?? 0,
        ...override
      });
    })
  };
});
// virtual: same mock flavour as tests/auth-sessions.test.js (see admin-authversion test).
jest.mock('../models/authSessions', () => {
  const rows = [];
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
        if (String(row.user) === String(filter.user) && row.revokedAt == null) {
          Object.assign(row, update.$set || {});
        }
      }
      return {};
    }),
    findOneAndUpdate: jest.fn(async (filter, update) => {
      const row = rows.find(item =>
        item.sid === filter.sid &&
        String(item.user) === String(filter.user) &&
        String(item.account) === String(filter.account) &&
        item.authVersion === filter.authVersion &&
        item.revokedAt == null &&
        item.expiresAt > filter.expiresAt.$gt &&
        (!filter.refreshHash || item.refreshHash === filter.refreshHash)
      );
      if (!row) return null;
      Object.assign(row, update.$set || {});
      return row;
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
jest.mock('../authSessions', () => {
  const actual = jest.requireActual('../authSessions');
  return { ...actual, revokeAll: jest.fn(actual.revokeAll) };
});

const logger = require('../logging/logging')();
const { getUserAccounts, getUserOrganizations } = require('../utils/membershipUtils');
const { membership } = require('../models/membership');
const Accounts = require('../models/accounts');
const Users = require('../models/users');
const Sessions = require('../models/authSessions');
const authSessions = require('../authSessions');
const { getToken } = require('../tokens');
const AccountsService = require('../services/AccountsService');

const oid = () => new mongoose.Types.ObjectId();
const query = value => {
  const promise = Promise.resolve(value);
  const chain = {
    populate: () => chain,
    then: (a, b) => promise.then(a, b)
  };
  return chain;
};
const same = (a, b) => a !== undefined && b !== undefined && String(a) === String(b);
const response = () => ({
  headers: {},
  setHeader (key, value) { this.headers[key] = value; }
});

let events;
let callerId, accountId, memberA, memberB;
let caller;
let authVersions;

const updatedAccount = (forceMfa) => ({
  _id: accountId,
  name: 'Renamed',
  companyType: 'msp',
  companyDesc: 'desc',
  country: 'US',
  forceMfa
});

const put = (forceMfa, res) => AccountsService.accountsIdPUT({
  id: String(accountId),
  name: 'Renamed',
  companyType: 'msp',
  companyDesc: 'desc',
  country: 'US',
  forceMfa
}, { user: caller }, res);

beforeEach(() => {
  jest.clearAllMocks();
  events = [];
  Sessions.rows.length = 0;
  [callerId, accountId, memberA, memberB] = [oid(), oid(), oid(), oid()];
  caller = {
    _id: callerId,
    username: 'owner@example.invalid',
    authVersion: 0,
    isLoggedInWithMfa: true,
    defaultAccount: { _id: accountId, name: 'Acct' },
    defaultOrg: { _id: oid(), name: 'Org' }
  };
  authVersions = new Map([
    [String(callerId), 0],
    [String(memberA), 0],
    [String(memberB), 0]
  ]);
  Users.findOneAndUpdate.mockImplementation(async (filter, update) => {
    const key = String(filter._id);
    if (!authVersions.has(key)) return null;
    if (update.$inc) {
      events.push(`revoke:${key}`);
      authVersions.set(key, authVersions.get(key) + update.$inc.authVersion);
    }
    return { _id: filter._id, authVersion: authVersions.get(key) };
  });
  Users.findOne.mockImplementation((filter) => {
    const version = authVersions.get(String(filter._id));
    events.push(`reload:${String(filter._id)}:${version}`);
    return query({
      _id: filter._id,
      username: caller.username,
      admin: false,
      authVersion: version,
      defaultAccount: { _id: accountId, name: 'Acct' },
      defaultOrg: caller.defaultOrg
    });
  });
  Sessions.updateMany.mockImplementation(async (filter, update) => {
    events.push(`sessions.revoke:${filter.user}`);
    for (const row of Sessions.rows) {
      if (String(row.user) === String(filter.user) && row.revokedAt == null) {
        Object.assign(row, update.$set || {});
      }
    }
    return {};
  });
  Sessions.create.mockImplementation(async (doc) => {
    events.push(`session:${doc.authVersion}`);
    const row = { ...doc };
    Sessions.rows.push(row);
    return row;
  });
});

const incCount = id => Users.findOneAndUpdate.mock.calls
  .filter(([filter, update]) => same(filter._id, id) && update.$inc).length;

test('forceMfa change revokes every distinct member once', async () => {
  Accounts.findOne.mockResolvedValue({ _id: accountId, forceMfa: false });
  Accounts.findOneAndUpdate.mockResolvedValue(updatedAccount(true));
  membership.find.mockResolvedValue([
    { user: memberA },
    { user: memberA },
    { user: memberB },
    { user: null },
    { user: callerId }
  ]);
  const result = await put(true, response());
  expect(result.code).toBe(200);
  expect(membership.find).toHaveBeenCalledWith({ account: String(accountId) });
  expect(authSessions.revokeAll).toHaveBeenCalledTimes(3);
  const revoked = authSessions.revokeAll.mock.calls.map(call => String(call[0])).sort();
  expect(revoked).toEqual([String(callerId), String(memberA), String(memberB)].sort());
  expect(incCount(callerId)).toBe(1);
  expect(incCount(memberA)).toBe(1);
  expect(incCount(memberB)).toBe(1);
  expect(authVersions.get(String(callerId))).toBe(1);
  expect(events.indexOf('revoke:' + String(memberA)))
    .toBeLessThan(events.indexOf('reload:' + String(callerId) + ':1'));
});

test('forceMfa unchanged does not revoke anyone', async () => {
  Accounts.findOne.mockResolvedValue({ _id: accountId, forceMfa: true });
  Accounts.findOneAndUpdate.mockResolvedValue(updatedAccount(true));
  const res = response();
  const result = await put(true, res);
  expect(result.code).toBe(200);
  expect(result.body.forceMfa).toBe(true);
  expect(membership.find).not.toHaveBeenCalled();
  expect(authSessions.revokeAll).not.toHaveBeenCalled();
  expect(Users.findOne).not.toHaveBeenCalled();
  expect(Sessions.create).not.toHaveBeenCalled();
  expect(res.headers['Refresh-Token']).toBeUndefined();
  expect(getToken).toHaveBeenCalledWith({ user: caller }, { accountName: 'Renamed' });
  const payload = jwt.verify(res.headers['Refresh-JWT'], 'synthetic-key');
  expect(payload.authVersion).toBe(0);
  expect(payload.accountName).toBe('Renamed');
});

test('replacement JWT after a forceMfa change uses the new authVersion and a live session',
  async () => {
    caller.authVersion = 4;
    authVersions.set(String(callerId), 4);
    Accounts.findOne.mockResolvedValue({ _id: accountId, forceMfa: false });
    Accounts.findOneAndUpdate.mockImplementation(async () => {
      events.push('account.update');
      return updatedAccount(true);
    });
    membership.find.mockResolvedValue([{ user: callerId }, { user: callerId }]);
    const res = response();
    const result = await put(true, res);
    expect(result.code).toBe(200);
    expect(incCount(callerId)).toBe(1);
    expect(authVersions.get(String(callerId))).toBe(5);
    expect(caller.authVersion).toBe(4); // request object stays stale
    const access = jwt.verify(res.headers['Refresh-JWT'], 'synthetic-key');
    const refresh = jwt.verify(res.headers['Refresh-Token'], 'synthetic-key');
    expect(access.authVersion).toBe(5);
    expect(refresh.authVersion).toBe(5);
    expect(access.sid).toBe(refresh.sid);
    expect(access.mfaVerified).toBe(true);
    const liveUser = {
      _id: callerId,
      authVersion: 5,
      defaultAccount: { _id: accountId }
    };
    expect(await authSessions.validateAccess(access, liveUser)).toBe(true);
    expect(await authSessions.validateAccess(
      { ...access, authVersion: 4 },
      { ...liveUser, authVersion: 4 }
    )).toBe(false);
    const row = Sessions.rows.find(item => item.sid === access.sid);
    expect(row).toMatchObject({ authVersion: 5, revokedAt: null });
    expect(events.indexOf('account.update'))
      .toBeLessThan(events.indexOf('revoke:' + String(callerId)));
    expect(events.indexOf('revoke:' + String(callerId)))
      .toBeLessThan(events.indexOf('session:5'));
  });

test('accountsSelectPOST retires old session and binds new access+refresh session to destination account',
  async () => {
    const destAccountId = oid();
    const destOrgId = oid();
    const destAccount = {
      _id: destAccountId,
      name: 'DestAcct',
      isSubscriptionValid: true,
      trial_end: null,
      forceMfa: false
    };
    const initialSession = await authSessions.createSession(caller);
    caller.authSessionId = initialSession.sid;

    getUserAccounts.mockResolvedValue([
      { _id: String(accountId), name: 'Acct', forceMfa: false },
      { _id: String(destAccountId), name: 'DestAcct', forceMfa: false }
    ]);
    Accounts.findOne.mockResolvedValue(destAccount);
    getUserOrganizations.mockResolvedValue({
      [String(destOrgId)]: { _id: destOrgId, name: 'DestOrg' }
    });
    const origAccount = { _id: accountId, name: 'Acct' };
    let storedMarker;
    Users.findOneAndUpdate.mockImplementation((filter, update) => {
      if (update.$set && update.$set.accountSwitchMarker) {
        events.push('user.commitAccount');
        storedMarker = update.$set.accountSwitchMarker;
        return query({
          _id: callerId,
          defaultAccount: destAccount,
          defaultOrg: destOrgId
        });
      }
      if (
        update.$unset &&
        'accountSwitchMarker' in update.$unset &&
        filter.accountSwitchMarker === storedMarker
      ) {
        storedMarker = undefined;
      }
      return query({ _id: callerId, defaultAccount: origAccount });
    });

    const res = response();
    res.cookie = jest.fn();
    const req = { user: caller, secure: true, headers: {} };
    const result = await AccountsService.accountsSelectPOST(
      { account: String(destAccountId) }, req, res
    );

    expect(result.code).toBe(201);
    expect(result.body).not.toHaveProperty('accountSwitchMarker');
    expect(storedMarker).toBeUndefined();
    const commitMarker = Users.findOneAndUpdate.mock.calls[0][1].$set.accountSwitchMarker;
    expect(typeof commitMarker).toBe('string');
    expect(commitMarker.length).toBeGreaterThan(0);
    expect(Users.findOneAndUpdate).toHaveBeenLastCalledWith(
      { _id: callerId, accountSwitchMarker: commitMarker },
      { $unset: { accountSwitchMarker: 1 } },
      { upsert: false, new: false }
    );
    expect(getUserOrganizations).toHaveBeenCalledWith(caller, 0, 0, destAccountId);
    // New session must be created BEFORE defaultAccount is committed in Users.
    expect(events.lastIndexOf('session:0'))
      .toBeLessThan(events.indexOf('user.commitAccount'));

    const newAccess = jwt.verify(res.headers['Refresh-JWT'], 'synthetic-key');
    const newRefresh = jwt.verify(res.headers['Refresh-Token'], 'synthetic-key');
    expect(newAccess.account).toBe(String(destAccountId));
    expect(newRefresh.account).toBe(String(destAccountId));
    expect(newAccess.sid).toBe(newRefresh.sid);
    expect(newAccess.sid).not.toBe(initialSession.sid);

    const switchedUser = {
      _id: callerId,
      authVersion: caller.authVersion,
      defaultAccount: { _id: destAccountId }
    };
    expect(await authSessions.validateAccess(newAccess, switchedUser)).toBe(true);
    await expect(authSessions.rotateRefresh(newRefresh, switchedUser))
      .resolves.toMatchObject({ sid: newAccess.sid });

    const oldRow = Sessions.rows.find(row => row.sid === initialSession.sid);
    expect(oldRow.revokedAt).toBeInstanceOf(Date);
    expect(await authSessions.validateAccess({
      _id: String(callerId),
      account: String(destAccountId),
      sid: initialSession.sid,
      authVersion: caller.authVersion
    }, switchedUser)).toBe(false);
    expect(res.cookie).toHaveBeenCalledTimes(2);
  });

test('accountsSelectPOST leaves defaultAccount and original session usable when session issuance fails',
  async () => {
    const destAccountId = oid();
    const destOrgId = oid();
    const originalOrg = caller.defaultOrg;
    const initialSession = await authSessions.createSession(caller);
    caller.authSessionId = initialSession.sid;

    getUserAccounts.mockResolvedValue([
      { _id: String(accountId), name: 'Acct', forceMfa: false },
      { _id: String(destAccountId), name: 'DestAcct', forceMfa: false }
    ]);
    Accounts.findOne.mockResolvedValue({
      _id: destAccountId,
      name: 'DestAcct',
      isSubscriptionValid: true,
      trial_end: null,
      forceMfa: false
    });
    getUserOrganizations.mockResolvedValue({
      [String(destOrgId)]: { _id: destOrgId, name: 'DestOrg' }
    });
    getToken.mockRejectedValueOnce(new Error('Token signing failure'));

    const res = response();
    res.cookie = jest.fn();
    const req = { user: caller, secure: true, headers: {} };
    const result = await AccountsService.accountsSelectPOST(
      { account: String(destAccountId) }, req, res
    );

    expect(result.code).toBe(500);
    // Stored defaultAccount must never be written when session issuance fails.
    expect(Users.findOneAndUpdate).not.toHaveBeenCalled();
    expect(caller.defaultAccount._id).toBe(accountId);
    expect(caller.defaultOrg).toBe(originalOrg);
    expect(caller.authSessionId).toBe(initialSession.sid);
    expect(res.headers['Refresh-JWT']).toBeUndefined();
    expect(res.headers['Refresh-Token']).toBeUndefined();
    expect(res.cookie).not.toHaveBeenCalled();

    // Original session remains valid and usable against the original account.
    const originalUser = {
      _id: callerId,
      authVersion: caller.authVersion,
      defaultAccount: { _id: accountId }
    };
    expect(await authSessions.validateAccess({
      _id: String(callerId),
      account: String(accountId),
      sid: initialSession.sid,
      authVersion: caller.authVersion
    }, originalUser)).toBe(true);
    await expect(authSessions.rotateRefresh({
      type: 'refresh',
      _id: String(callerId),
      account: String(accountId),
      sid: initialSession.sid,
      jti: initialSession.jti,
      authVersion: caller.authVersion
    }, originalUser)).resolves.toMatchObject({ sid: initialSession.sid });

    // Any partially created destination session must be revoked.
    const destRows = Sessions.rows.filter(row => String(row.account) === String(destAccountId));
    expect(destRows.every(row => row.revokedAt instanceof Date)).toBe(true);
  });

const createUserSwitchStore = (initialAccount, initialOrgId, accountsById) => {
  const state = {
    defaultAccount: initialAccount._id,
    defaultOrg: initialOrgId,
    accountSwitchMarker: undefined
  };
  const findOneAndUpdate = (filter, update) => {
    if (String(filter._id) !== String(callerId)) return query(null);
    if (
      filter.defaultAccount !== undefined &&
      String(filter.defaultAccount) !== String(state.defaultAccount)
    ) {
      return query(null);
    }
    if (
      filter.accountSwitchMarker !== undefined &&
      filter.accountSwitchMarker !== state.accountSwitchMarker
    ) {
      return query(null);
    }
    const set = update.$set || update;
    if (set.defaultAccount !== undefined) state.defaultAccount = set.defaultAccount;
    if (set.defaultOrg !== undefined) state.defaultOrg = set.defaultOrg;
    if (set.accountSwitchMarker !== undefined) {
      state.accountSwitchMarker = set.accountSwitchMarker;
    }
    if (update.$unset && 'accountSwitchMarker' in update.$unset) {
      state.accountSwitchMarker = undefined;
    }
    return query({
      _id: callerId,
      defaultAccount: accountsById[String(state.defaultAccount)] || initialAccount,
      defaultOrg: state.defaultOrg
    });
  };
  return { state, findOneAndUpdate };
};

test('accountsSelectPOST rolls back defaultAccount and keeps original session valid if old session retirement fails',
  async () => {
    const destAccountId = oid();
    const destOrgId = oid();
    const originalOrg = caller.defaultOrg;
    const initialSession = await authSessions.createSession(caller);
    caller.authSessionId = initialSession.sid;

    getUserAccounts.mockResolvedValue([
      { _id: String(accountId), name: 'Acct', forceMfa: false },
      { _id: String(destAccountId), name: 'DestAcct', forceMfa: false }
    ]);
    const destAccount = {
      _id: destAccountId,
      name: 'DestAcct',
      isSubscriptionValid: true,
      trial_end: null,
      forceMfa: false
    };
    Accounts.findOne.mockResolvedValue(destAccount);
    getUserOrganizations.mockResolvedValue({
      [String(destOrgId)]: { _id: destOrgId, name: 'DestOrg' }
    });

    const store = createUserSwitchStore(
      { _id: accountId, name: 'Acct' },
      originalOrg._id,
      { [String(destAccountId)]: destAccount }
    );
    Users.findOneAndUpdate.mockImplementation(store.findOneAndUpdate);

    // Fail specifically when retiring the source session; allow revoking the uncommitted dest session.
    const origUpdateOne = Sessions.updateOne.getMockImplementation();
    Sessions.updateOne.mockImplementation(async (filter, update) => {
      if (filter.sid === initialSession.sid) {
        throw new Error('Session store unavailable during retirement');
      }
      return origUpdateOne(filter, update);
    });

    const res = response();
    res.cookie = jest.fn();
    const req = { user: caller, secure: true, headers: {} };
    const result = await AccountsService.accountsSelectPOST(
      { account: String(destAccountId) }, req, res
    );

    expect(result.code).toBe(500);
    const commitMarker = Users.findOneAndUpdate.mock.calls[0][1].$set.accountSwitchMarker;
    expect(typeof commitMarker).toBe('string');
    expect(commitMarker.length).toBeGreaterThan(0);
    // Rollback update must be guarded on caller, attempted destination account, and switch marker.
    expect(Users.findOneAndUpdate).toHaveBeenLastCalledWith(
      { _id: callerId, defaultAccount: String(destAccountId), accountSwitchMarker: commitMarker },
      {
        $set: { defaultAccount: accountId, defaultOrg: originalOrg._id },
        $unset: { accountSwitchMarker: 1 }
      },
      { upsert: false, new: false }
    );
    // Compensating rollback restored the original account/org and cleared the switch marker.
    expect(String(store.state.defaultAccount)).toBe(String(accountId));
    expect(String(store.state.defaultOrg)).toBe(String(originalOrg._id));
    expect(store.state.accountSwitchMarker).toBeUndefined();
    expect(caller.defaultAccount._id).toBe(accountId);
    expect(caller.defaultOrg).toBe(originalOrg);
    expect(caller.authSessionId).toBe(initialSession.sid);
    expect(res.headers['Refresh-JWT']).toBeUndefined();
    expect(res.headers['Refresh-Token']).toBeUndefined();

    // Destination session was revoked, while original session remains valid.
    const destRows = Sessions.rows.filter(row => String(row.account) === String(destAccountId));
    expect(destRows).toHaveLength(1);
    expect(destRows[0].revokedAt).toBeInstanceOf(Date);

    const originalUser = {
      _id: callerId,
      authVersion: caller.authVersion,
      defaultAccount: { _id: accountId }
    };
    expect(await authSessions.validateAccess({
      _id: String(callerId),
      account: String(accountId),
      sid: initialSession.sid,
      authVersion: caller.authVersion
    }, originalUser)).toBe(true);
  });

test('accountsSelectPOST rollback does not overwrite a concurrent switch that succeeded',
  async () => {
    const accountAId = oid();
    const orgAId = oid();
    const accountBId = oid();
    const orgBId = oid();
    const originalOrg = caller.defaultOrg;

    const accountA = {
      _id: accountAId,
      name: 'AccountA',
      isSubscriptionValid: true,
      trial_end: null,
      forceMfa: false
    };
    const accountB = {
      _id: accountBId,
      name: 'AccountB',
      isSubscriptionValid: true,
      trial_end: null,
      forceMfa: false
    };

    const sessionAInitial = await authSessions.createSession(caller);
    caller.authSessionId = sessionAInitial.sid;

    const callerB = {
      ...caller,
      defaultAccount: { _id: accountId, name: 'Acct' },
      defaultOrg: originalOrg
    };
    const sessionBInitial = await authSessions.createSession(callerB);
    callerB.authSessionId = sessionBInitial.sid;

    getUserAccounts.mockResolvedValue([
      { _id: String(accountId), name: 'Acct', forceMfa: false },
      { _id: String(accountAId), name: 'AccountA', forceMfa: false },
      { _id: String(accountBId), name: 'AccountB', forceMfa: false }
    ]);
    Accounts.findOne.mockImplementation(async (filter) => {
      if (String(filter._id) === String(accountAId)) return accountA;
      if (String(filter._id) === String(accountBId)) return accountB;
      return null;
    });
    getUserOrganizations.mockImplementation(async (_user, _skip, _limit, targetId) => {
      if (String(targetId) === String(accountAId)) {
        return { [String(orgAId)]: { _id: orgAId, name: 'OrgA' } };
      }
      if (String(targetId) === String(accountBId)) {
        return { [String(orgBId)]: { _id: orgBId, name: 'OrgB' } };
      }
      return {};
    });

    const store = createUserSwitchStore(
      { _id: accountId, name: 'Acct' },
      originalOrg._id,
      {
        [String(accountAId)]: accountA,
        [String(accountBId)]: accountB
      }
    );
    Users.findOneAndUpdate.mockImplementation(store.findOneAndUpdate);

    let switchBResult;
    const resB = response();
    resB.cookie = jest.fn();
    const origUpdateOne = Sessions.updateOne.getMockImplementation();
    Sessions.updateOne.mockImplementation(async (filter, update) => {
      if (filter.sid === sessionAInitial.sid) {
        // Concurrent switch B completes and updates stored defaultAccount to B
        // before switch A fails and runs its compensating rollback.
        switchBResult = await AccountsService.accountsSelectPOST(
          { account: String(accountBId) },
          { user: callerB, secure: true, headers: {} },
          resB
        );
        throw new Error('Switch A session retirement failed');
      }
      return origUpdateOne(filter, update);
    });

    const resA = response();
    resA.cookie = jest.fn();
    const switchAResult = await AccountsService.accountsSelectPOST(
      { account: String(accountAId) },
      { user: caller, secure: true, headers: {} },
      resA
    );

    expect(switchBResult.code).toBe(201);
    expect(switchAResult.code).toBe(500);
    const markerA = Users.findOneAndUpdate.mock.calls[0][1].$set.accountSwitchMarker;
    // Guarded rollback matched on account A and marker A, so it did not clobber switch B.
    expect(Users.findOneAndUpdate).toHaveBeenLastCalledWith(
      { _id: callerId, defaultAccount: String(accountAId), accountSwitchMarker: markerA },
      {
        $set: { defaultAccount: accountId, defaultOrg: originalOrg._id },
        $unset: { accountSwitchMarker: 1 }
      },
      { upsert: false, new: false }
    );
    expect(String(store.state.defaultAccount)).toBe(String(accountBId));
    expect(String(store.state.defaultOrg)).toBe(String(orgBId));
    expect(store.state.accountSwitchMarker).toBeUndefined();

    // Switch A's uncommitted session was still revoked; switch B's session remains active.
    const accountARows = Sessions.rows.filter(row => String(row.account) === String(accountAId));
    expect(accountARows).toHaveLength(1);
    expect(accountARows[0].revokedAt).toBeInstanceOf(Date);
    const accountBRows = Sessions.rows.filter(row => String(row.account) === String(accountBId));
    expect(accountBRows).toHaveLength(1);
    expect(accountBRows[0].revokedAt).toBeNull();
  });

test('accountsSelectPOST rollback does not overwrite a concurrent same-source same-dest switch',
  async () => {
    const destAccountId = oid();
    const destOrgId = oid();
    const originalOrg = caller.defaultOrg;

    const destAccount = {
      _id: destAccountId,
      name: 'DestAcct',
      isSubscriptionValid: true,
      trial_end: null,
      forceMfa: false
    };

    const session1Initial = await authSessions.createSession(caller);
    caller.authSessionId = session1Initial.sid;

    const caller2 = {
      ...caller,
      defaultAccount: { _id: accountId, name: 'Acct' },
      defaultOrg: originalOrg
    };
    const session2Initial = await authSessions.createSession(caller2);
    caller2.authSessionId = session2Initial.sid;

    getUserAccounts.mockResolvedValue([
      { _id: String(accountId), name: 'Acct', forceMfa: false },
      { _id: String(destAccountId), name: 'DestAcct', forceMfa: false }
    ]);
    Accounts.findOne.mockResolvedValue(destAccount);
    getUserOrganizations.mockResolvedValue({
      [String(destOrgId)]: { _id: destOrgId, name: 'DestOrg' }
    });

    const store = createUserSwitchStore(
      { _id: accountId, name: 'Acct' },
      originalOrg._id,
      { [String(destAccountId)]: destAccount }
    );
    Users.findOneAndUpdate.mockImplementation(store.findOneAndUpdate);

    let switch2Result;
    const res2 = response();
    res2.cookie = jest.fn();
    const origUpdateOne = Sessions.updateOne.getMockImplementation();
    Sessions.updateOne.mockImplementation(async (filter, update) => {
      if (filter.sid === session1Initial.sid) {
        // Concurrent second switch from the SAME source to the SAME destination succeeds
        // before the first switch fails and executes its compensating rollback.
        switch2Result = await AccountsService.accountsSelectPOST(
          { account: String(destAccountId) },
          { user: caller2, secure: true, headers: {} },
          res2
        );
        throw new Error('First switch session retirement failed');
      }
      return origUpdateOne(filter, update);
    });

    const res1 = response();
    res1.cookie = jest.fn();
    const switch1Result = await AccountsService.accountsSelectPOST(
      { account: String(destAccountId) },
      { user: caller, secure: true, headers: {} },
      res1
    );

    expect(switch2Result.code).toBe(201);
    expect(switch2Result.body).not.toHaveProperty('accountSwitchMarker');
    expect(switch1Result.code).toBe(500);

    const marker1 = Users.findOneAndUpdate.mock.calls[0][1].$set.accountSwitchMarker;
    const marker2 = Users.findOneAndUpdate.mock.calls[1][1].$set.accountSwitchMarker;
    expect(typeof marker1).toBe('string');
    expect(typeof marker2).toBe('string');
    expect(marker1).not.toBe(marker2);

    // Switch 1's rollback required both destination account and marker1, so it missed.
    expect(Users.findOneAndUpdate).toHaveBeenLastCalledWith(
      { _id: callerId, defaultAccount: String(destAccountId), accountSwitchMarker: marker1 },
      {
        $set: { defaultAccount: accountId, defaultOrg: originalOrg._id },
        $unset: { accountSwitchMarker: 1 }
      },
      { upsert: false, new: false }
    );

    // Second switch's destination account/org remain committed and marker is cleared.
    expect(String(store.state.defaultAccount)).toBe(String(destAccountId));
    expect(String(store.state.defaultOrg)).toBe(String(destOrgId));
    expect(store.state.accountSwitchMarker).toBeUndefined();

    // First switch's uncommitted dest session was revoked; second switch's session stays live.
    const destRows = Sessions.rows.filter(row => String(row.account) === String(destAccountId));
    expect(destRows).toHaveLength(2);
    const activeDestRows = destRows.filter(row => row.revokedAt === null);
    const revokedDestRows = destRows.filter(row => row.revokedAt instanceof Date);
    expect(activeDestRows).toHaveLength(1);
    expect(revokedDestRows).toHaveLength(1);

    const switch2Access = jwt.verify(res2.headers['Refresh-JWT'], 'synthetic-key');
    expect(activeDestRows[0].sid).toBe(switch2Access.sid);
    expect(await authSessions.validateAccess(switch2Access, {
      _id: callerId,
      authVersion: caller2.authVersion,
      defaultAccount: { _id: destAccountId }
    })).toBe(true);
  });

test('accountsSelectPOST rolls back and clears marker if populate fails after commit',
  async () => {
    const destAccountId = oid();
    const destOrgId = oid();
    const originalOrg = caller.defaultOrg;
    const initialSession = await authSessions.createSession(caller);
    caller.authSessionId = initialSession.sid;

    const destAccount = {
      _id: destAccountId,
      name: 'DestAcct',
      isSubscriptionValid: true,
      trial_end: null,
      forceMfa: false
    };
    getUserAccounts.mockResolvedValue([
      { _id: String(accountId), name: 'Acct', forceMfa: false },
      { _id: String(destAccountId), name: 'DestAcct', forceMfa: false }
    ]);
    Accounts.findOne.mockResolvedValue(destAccount);
    getUserOrganizations.mockResolvedValue({
      [String(destOrgId)]: { _id: destOrgId, name: 'DestOrg' }
    });

    const store = createUserSwitchStore(
      { _id: accountId, name: 'Acct' },
      originalOrg._id,
      { [String(destAccountId)]: destAccount }
    );
    const populateMock = jest.fn().mockRejectedValue(new Error('Populate failed after commit'));
    Users.findOneAndUpdate.mockImplementation((filter, update) => {
      if (update.$set && update.$set.accountSwitchMarker) {
        store.findOneAndUpdate(filter, update);
        return Promise.resolve({
          _id: callerId,
          defaultAccount: destAccountId,
          defaultOrg: destOrgId,
          populate: populateMock
        });
      }
      return store.findOneAndUpdate(filter, update);
    });

    const res = response();
    res.cookie = jest.fn();
    const result = await AccountsService.accountsSelectPOST(
      { account: String(destAccountId) },
      { user: caller, secure: true, headers: {} },
      res
    );

    expect(result.code).toBe(500);
    expect(result.error).toBe('Populate failed after commit');
    expect(populateMock).toHaveBeenCalledWith('defaultAccount');

    const commitMarker = Users.findOneAndUpdate.mock.calls[0][1].$set.accountSwitchMarker;
    expect(typeof commitMarker).toBe('string');
    expect(Users.findOneAndUpdate).toHaveBeenLastCalledWith(
      { _id: callerId, defaultAccount: String(destAccountId), accountSwitchMarker: commitMarker },
      {
        $set: { defaultAccount: accountId, defaultOrg: originalOrg._id },
        $unset: { accountSwitchMarker: 1 }
      },
      { upsert: false, new: false }
    );
    expect(String(store.state.defaultAccount)).toBe(String(accountId));
    expect(String(store.state.defaultOrg)).toBe(String(originalOrg._id));
    expect(store.state.accountSwitchMarker).toBeUndefined();

    // Uncommitted destination session was revoked while original session remains valid.
    const destRows = Sessions.rows.filter(row => String(row.account) === String(destAccountId));
    expect(destRows).toHaveLength(1);
    expect(destRows[0].revokedAt).toBeInstanceOf(Date);
    expect(await authSessions.validateAccess({
      _id: String(callerId),
      account: String(accountId),
      sid: initialSession.sid,
      authVersion: caller.authVersion
    }, {
      _id: callerId,
      authVersion: caller.authVersion,
      defaultAccount: { _id: accountId }
    })).toBe(true);
  });

test('accountsSelectPOST retries transient cleanup write failure and succeeds on retry',
  async () => {
    const destAccountId = oid();
    const destOrgId = oid();
    const originalOrg = caller.defaultOrg;
    const initialSession = await authSessions.createSession(caller);
    caller.authSessionId = initialSession.sid;

    const destAccount = {
      _id: destAccountId,
      name: 'DestAcct',
      isSubscriptionValid: true,
      trial_end: null,
      forceMfa: false
    };
    getUserAccounts.mockResolvedValue([
      { _id: String(accountId), name: 'Acct', forceMfa: false },
      { _id: String(destAccountId), name: 'DestAcct', forceMfa: false }
    ]);
    Accounts.findOne.mockResolvedValue(destAccount);
    getUserOrganizations.mockResolvedValue({
      [String(destOrgId)]: { _id: destOrgId, name: 'DestOrg' }
    });

    const store = createUserSwitchStore(
      { _id: accountId, name: 'Acct' },
      originalOrg._id,
      { [String(destAccountId)]: destAccount }
    );
    let cleanupAttempts = 0;
    Users.findOneAndUpdate.mockImplementation((filter, update) => {
      if (update.$unset && !update.$set) {
        cleanupAttempts += 1;
        if (cleanupAttempts === 1) {
          return Promise.reject(new Error('Transient cleanup write error'));
        }
      }
      return store.findOneAndUpdate(filter, update);
    });

    const res = response();
    res.cookie = jest.fn();
    const result = await AccountsService.accountsSelectPOST(
      { account: String(destAccountId) },
      { user: caller, secure: true, headers: {} },
      res
    );

    expect(result.code).toBe(201);
    expect(result.body).not.toHaveProperty('accountSwitchMarker');
    expect(cleanupAttempts).toBe(2);
    expect(store.state.accountSwitchMarker).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

test('accountsSelectPOST logs and surfaces persistent cleanup write failure after retry',
  async () => {
    const destAccountId = oid();
    const destOrgId = oid();
    const originalOrg = caller.defaultOrg;
    const initialSession = await authSessions.createSession(caller);
    caller.authSessionId = initialSession.sid;

    const destAccount = {
      _id: destAccountId,
      name: 'DestAcct',
      isSubscriptionValid: true,
      trial_end: null,
      forceMfa: false
    };
    getUserAccounts.mockResolvedValue([
      { _id: String(accountId), name: 'Acct', forceMfa: false },
      { _id: String(destAccountId), name: 'DestAcct', forceMfa: false }
    ]);
    Accounts.findOne.mockResolvedValue(destAccount);
    getUserOrganizations.mockResolvedValue({
      [String(destOrgId)]: { _id: destOrgId, name: 'DestOrg' }
    });

    const store = createUserSwitchStore(
      { _id: accountId, name: 'Acct' },
      originalOrg._id,
      { [String(destAccountId)]: destAccount }
    );
    let cleanupAttempts = 0;
    Users.findOneAndUpdate.mockImplementation((filter, update) => {
      if (update.$unset && !update.$set) {
        cleanupAttempts += 1;
        return Promise.reject(new Error('Persistent cleanup write error'));
      }
      return store.findOneAndUpdate(filter, update);
    });

    const res = response();
    res.cookie = jest.fn();
    const result = await AccountsService.accountsSelectPOST(
      { account: String(destAccountId) },
      { user: caller, secure: true, headers: {} },
      res
    );

    expect(result.code).toBe(500);
    expect(result.error).toBe('Persistent cleanup write error');
    expect(cleanupAttempts).toBe(2);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('cleanup'),
      expect.objectContaining({
        params: expect.objectContaining({
          userId: String(callerId),
          accountId: String(destAccountId),
          reason: 'Persistent cleanup write error'
        })
      })
    );
  });

test('accountsSelectPOST retries rollback write failure and surfaces persistent rollback error',
  async () => {
    const destAccountId = oid();
    const destOrgId = oid();
    const originalOrg = caller.defaultOrg;
    const initialSession = await authSessions.createSession(caller);
    caller.authSessionId = initialSession.sid;

    const destAccount = {
      _id: destAccountId,
      name: 'DestAcct',
      isSubscriptionValid: true,
      trial_end: null,
      forceMfa: false
    };
    getUserAccounts.mockResolvedValue([
      { _id: String(accountId), name: 'Acct', forceMfa: false },
      { _id: String(destAccountId), name: 'DestAcct', forceMfa: false }
    ]);
    Accounts.findOne.mockResolvedValue(destAccount);
    getUserOrganizations.mockResolvedValue({
      [String(destOrgId)]: { _id: destOrgId, name: 'DestOrg' }
    });

    const store = createUserSwitchStore(
      { _id: accountId, name: 'Acct' },
      originalOrg._id,
      { [String(destAccountId)]: destAccount }
    );
    let rollbackAttempts = 0;
    Users.findOneAndUpdate.mockImplementation((filter, update) => {
      if (update.$unset && update.$set) {
        rollbackAttempts += 1;
        return Promise.reject(new Error('Persistent rollback write error'));
      }
      return store.findOneAndUpdate(filter, update);
    });

    const origUpdateOne = Sessions.updateOne.getMockImplementation();
    Sessions.updateOne.mockImplementation(async (filter, update) => {
      if (filter.sid === initialSession.sid) {
        throw new Error('Session store unavailable during retirement');
      }
      return origUpdateOne(filter, update);
    });

    const res = response();
    res.cookie = jest.fn();
    const result = await AccountsService.accountsSelectPOST(
      { account: String(destAccountId) },
      { user: caller, secure: true, headers: {} },
      res
    );

    expect(result.code).toBe(500);
    expect(result.error).toContain('Session store unavailable during retirement');
    expect(result.error).toContain('Persistent rollback write error');
    expect(rollbackAttempts).toBe(2);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('rollback'),
      expect.objectContaining({
        params: expect.objectContaining({
          userId: String(callerId),
          accountId: String(destAccountId),
          reason: 'Persistent rollback write error'
        })
      })
    );

    // Uncommitted destination session is still revoked and caller object restored.
    const destRows = Sessions.rows.filter(row => String(row.account) === String(destAccountId));
    expect(destRows).toHaveLength(1);
    expect(destRows[0].revokedAt).toBeInstanceOf(Date);
    expect(caller.defaultAccount._id).toBe(accountId);
    expect(caller.defaultOrg).toBe(originalOrg);
    expect(caller.authSessionId).toBe(initialSession.sid);
  });

test('accountsSelectPOST retries transient rollback write failure and clears marker on retry',
  async () => {
    const destAccountId = oid();
    const destOrgId = oid();
    const originalOrg = caller.defaultOrg;
    const initialSession = await authSessions.createSession(caller);
    caller.authSessionId = initialSession.sid;

    const destAccount = {
      _id: destAccountId,
      name: 'DestAcct',
      isSubscriptionValid: true,
      trial_end: null,
      forceMfa: false
    };
    getUserAccounts.mockResolvedValue([
      { _id: String(accountId), name: 'Acct', forceMfa: false },
      { _id: String(destAccountId), name: 'DestAcct', forceMfa: false }
    ]);
    Accounts.findOne.mockResolvedValue(destAccount);
    getUserOrganizations.mockResolvedValue({
      [String(destOrgId)]: { _id: destOrgId, name: 'DestOrg' }
    });

    const store = createUserSwitchStore(
      { _id: accountId, name: 'Acct' },
      originalOrg._id,
      { [String(destAccountId)]: destAccount }
    );
    let rollbackAttempts = 0;
    Users.findOneAndUpdate.mockImplementation((filter, update) => {
      if (update.$unset && update.$set) {
        rollbackAttempts += 1;
        if (rollbackAttempts === 1) {
          return Promise.reject(new Error('Transient rollback write error'));
        }
      }
      return store.findOneAndUpdate(filter, update);
    });

    const origUpdateOne = Sessions.updateOne.getMockImplementation();
    Sessions.updateOne.mockImplementation(async (filter, update) => {
      if (filter.sid === initialSession.sid) {
        throw new Error('Session store unavailable during retirement');
      }
      return origUpdateOne(filter, update);
    });

    const res = response();
    res.cookie = jest.fn();
    const result = await AccountsService.accountsSelectPOST(
      { account: String(destAccountId) },
      { user: caller, secure: true, headers: {} },
      res
    );

    expect(result.code).toBe(500);
    expect(result.error).toBe('Session store unavailable during retirement');
    expect(rollbackAttempts).toBe(2);
    expect(String(store.state.defaultAccount)).toBe(String(accountId));
    expect(String(store.state.defaultOrg)).toBe(String(originalOrg._id));
    expect(store.state.accountSwitchMarker).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });
