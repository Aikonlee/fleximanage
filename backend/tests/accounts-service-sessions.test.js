/** @jest-environment node */
// Changing forceMfa revokes each distinct member once. The replacement JWT must carry the
// post-revocation authVersion and a new live session, not the caller's stale in-memory one.
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

jest.mock('../services/Service', () => ({
  successResponse: (body, code = 200) => ({ body, code }),
  rejectResponse: (error, code = 500) => ({ error, code })
}));
jest.mock('../logging/logging', () => () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn()
}));
jest.mock('../configs', () => () => ({
  get: (key, type) => (type === 'number' ? 3600 : '')
}));
jest.mock('../utils/membershipUtils', () => ({
  getUserAccounts: jest.fn(),
  orgUpdateFromNull: jest.fn()
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
    updateMany: jest.fn(async (filter, update) => {
      for (const row of rows) {
        if (String(row.user) === String(filter.user) && row.revokedAt == null) {
          Object.assign(row, update.$set || {});
        }
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
jest.mock('../authSessions', () => {
  const actual = jest.requireActual('../authSessions');
  return { ...actual, revokeAll: jest.fn(actual.revokeAll) };
});

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
