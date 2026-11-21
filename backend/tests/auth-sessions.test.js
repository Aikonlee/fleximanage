/** @jest-environment node */
jest.mock('../models/authSessions', () => ({
  create: jest.fn(),
  exists: jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn(),
  updateMany: jest.fn()
}), { virtual: true });
jest.mock('../configs', () => () => ({ get: () => 86400 }));
jest.mock('../models/users', () => ({ findOneAndUpdate: jest.fn() }));
const Users = require('../models/users');
const crypto = require('crypto');
const Sessions = require('../models/authSessions');
const authSessions = require('../authSessions');
const user = {
  _id: '507f1f77bcf86cd799439011',
  authVersion: 0,
  defaultAccount: { _id: '507f1f77bcf86cd799439012' }
};

beforeEach(() => jest.clearAllMocks());

test('new session persists only a hash of the refresh identifier', async () => {
  const session = await authSessions.createSession(user);
  expect(session.sid).toMatch(/^[a-f0-9]{64}$/);
  expect(session.jti).toMatch(/^[a-f0-9]{64}$/);
  expect(session.authVersion).toBe(0);
  const saved = Sessions.create.mock.calls[0][0];
  expect(saved.refreshHash).toBe(crypto.createHash('sha256').update(session.jti).digest('hex'));
  expect(saved.refreshHash).not.toBe(session.jti);
  expect(saved.user.toString()).toBe(user._id);
  expect(saved.account.toString()).toBe(user.defaultAccount._id);
  expect(saved.expiresAt).toBeInstanceOf(Date);
});

test('access validation rejects legacy and revoked sessions', async () => {
  const payload = {
    _id: user._id,
    account: user.defaultAccount._id,
    sid: 'session-id',
    authVersion: 0
  };
  Sessions.exists.mockResolvedValueOnce({ _id: 'found' }).mockResolvedValueOnce(null);
  expect(await authSessions.validateAccess({ ...payload, authVersion: undefined }, user))
    .toBe(false);
  expect(await authSessions.validateAccess(payload, user)).toBe(true);
  expect(await authSessions.validateAccess(payload, user)).toBe(false);
  expect(Sessions.exists).toHaveBeenCalledTimes(2);
  expect(Sessions.exists.mock.calls[0][0]).toMatchObject({
    sid: 'session-id',
    user: user._id,
    account: user.defaultAccount._id,
    authVersion: 0,
    revokedAt: null
  });
});

test('refresh rotation is atomic and replay revokes the session', async () => {
  const payload = {
    type: 'refresh',
    _id: user._id,
    account: user.defaultAccount._id,
    authVersion: 0,
    sid: 'session-id',
    jti: 'old-id'
  };
  Sessions.findOneAndUpdate.mockResolvedValueOnce({ sid: payload.sid }).mockResolvedValueOnce(null);
  const next = await authSessions.rotateRefresh(payload, user);
  expect(next.jti).toMatch(/^[a-f0-9]{64}$/);
  expect(Sessions.findOneAndUpdate.mock.calls[0][0]).toMatchObject({
    sid: payload.sid,
    user: user._id,
    account: user.defaultAccount._id,
    refreshHash: crypto.createHash('sha256').update('old-id').digest('hex'),
    revokedAt: null
  });
  expect(Sessions.findOneAndUpdate.mock.calls[0][1].$set.refreshHash)
    .toBe(crypto.createHash('sha256').update(next.jti).digest('hex'));
  await expect(authSessions.rotateRefresh(payload, user))
    .rejects.toThrow('Invalid refresh session');
  expect(Sessions.updateOne).toHaveBeenCalledWith(
    { sid: payload.sid, user: user._id, revokedAt: null },
    { $set: { revokedAt: expect.any(Date) } }
  );
});

test('logout revokes only the current session', async () => {
  await authSessions.revokeCurrent(user._id, 'current-session');
  expect(Sessions.updateOne).toHaveBeenCalledWith(
    { sid: 'current-session', user: user._id, revokedAt: null },
    { $set: { revokedAt: expect.any(Date) } }
  );
});

test('credential changes invalidate access version before revoking every session', async () => {
  Users.findOneAndUpdate.mockResolvedValue({ authVersion: 1 });
  const version = await authSessions.revokeAll(user._id);
  expect(Users.findOneAndUpdate).toHaveBeenCalledWith(
    { _id: user._id }, { $inc: { authVersion: 1 } }, { new: true }
  );
  expect(version).toBe(1);
  expect(Sessions.updateMany).toHaveBeenCalledWith(
    { user: user._id, revokedAt: null },
    { $set: { revokedAt: expect.any(Date) } }
  );
});
