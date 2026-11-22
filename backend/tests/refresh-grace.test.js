/** @jest-environment node */
jest.mock('../models/authSessions', () => ({
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn()
}), { virtual: true });
jest.mock('../configs', () => () => ({ get: () => 86400 }));
jest.mock('../models/users', () => ({ findOneAndUpdate: jest.fn() }));

const crypto = require('crypto');
const Sessions = require('../models/authSessions');
const authSessions = require('../authSessions');

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const user = {
  _id: '507f1f77bcf86cd799439011',
  authVersion: 0,
  defaultAccount: { _id: '507f1f77bcf86cd799439012' }
};

const matches = (doc, filter) => Object.entries(filter).every(([key, expected]) => {
  if (expected && typeof expected === 'object') {
    if ('$gt' in expected) return doc[key] > expected.$gt;
    if ('$not' in expected && expected.$not && '$gte' in expected.$not) {
      return !(typeof doc[key] === 'number' && doc[key] >= expected.$not.$gte);
    }
  }
  return doc[key] === expected;
});

const applyUpdate = (target, update) => {
  if (update.$set) Object.assign(target, update.$set);
  if (update.$inc) {
    for (const [key, value] of Object.entries(update.$inc)) {
      target[key] = (target[key] || 0) + value;
    }
  }
};

describe('refresh grace window', () => {
  let now;
  let doc;

  beforeEach(() => {
    now = 1_700_000_000_000;
    jest.useFakeTimers({ now });
    doc = {
      sid: 'session-id',
      user: user._id,
      account: user.defaultAccount._id,
      authVersion: 0,
      refreshHash: hash('current'),
      expiresAt: new Date(now + 86400 * 1000),
      revokedAt: null,
      graceHash: null,
      graceUntil: 0,
      graceRotationCount: 0
    };
    Sessions.findOneAndUpdate.mockImplementation(async (filter, update) => {
      if (!matches(doc, filter)) return null;
      applyUpdate(doc, update);
      return { ...doc };
    });
    Sessions.updateOne.mockImplementation(async (filter, update) => {
      if (matches(doc, filter)) Object.assign(doc, update.$set);
      return { modifiedCount: doc.revokedAt ? 1 : 0 };
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('rotates once, consumes grace, and revokes a second replay', async () => {
    const payload = {
      type: 'refresh',
      _id: user._id,
      account: user.defaultAccount._id,
      authVersion: 0,
      sid: 'session-id',
      jti: 'current'
    };
    const absoluteExpiry = doc.expiresAt;

    const first = await authSessions.rotateRefresh(payload, user);
    expect(doc.refreshHash).toBe(hash(first.jti));
    expect(doc.graceHash).toBe(hash('current'));
    expect(doc.graceUntil).toBe(now + 15000);
    expect(doc.graceRotationCount).toBe(0);
    expect(doc.expiresAt).toEqual(absoluteExpiry);
    expect(first.expiresAt).toEqual(absoluteExpiry);
    expect(doc.revokedAt).toBeNull();

    now += 14000;
    jest.setSystemTime(now);
    const replay = await authSessions.rotateRefresh(payload, user);
    expect(replay.jti).not.toBe(first.jti);
    expect(doc.refreshHash).toBe(hash(replay.jti));
    expect(doc.graceHash).toBeNull();
    expect(doc.graceUntil).toBe(0);
    expect(doc.graceRotationCount).toBe(1);
    expect(doc.expiresAt).toEqual(absoluteExpiry);
    expect(doc.revokedAt).toBeNull();
    expect(Sessions.updateOne).not.toHaveBeenCalled();

    await expect(authSessions.rotateRefresh(payload, user))
      .rejects.toThrow('Invalid refresh session');
    expect(doc.revokedAt).toEqual(expect.any(Date));
    expect(doc.expiresAt).toEqual(absoluteExpiry);
    expect(Sessions.updateOne).toHaveBeenCalledWith(
      { sid: 'session-id', user: user._id, revokedAt: null },
      { $set: { revokedAt: expect.any(Date) } }
    );
  });

  test('rejects a grace replay after the window and does not move expiresAt', async () => {
    const payload = {
      type: 'refresh',
      _id: user._id,
      account: user.defaultAccount._id,
      authVersion: 0,
      sid: 'session-id',
      jti: 'current'
    };
    const absoluteExpiry = doc.expiresAt;
    await authSessions.rotateRefresh(payload, user);
    now = doc.graceUntil + 1;
    jest.setSystemTime(now);
    await expect(authSessions.rotateRefresh(payload, user))
      .rejects.toThrow('Invalid refresh session');
    expect(doc.revokedAt).toEqual(expect.any(Date));
    expect(doc.expiresAt).toEqual(absoluteExpiry);
  });

  test('rejects rotation after the absolute session deadline', async () => {
    doc.expiresAt = new Date(now - 1);
    const payload = {
      type: 'refresh',
      _id: user._id,
      account: user.defaultAccount._id,
      authVersion: 0,
      sid: 'session-id',
      jti: 'current'
    };
    await expect(authSessions.rotateRefresh(payload, user))
      .rejects.toThrow('Invalid refresh session');
    expect(doc.refreshHash).toBe(hash('current'));
    expect(doc.revokedAt).toEqual(expect.any(Date));
  });
});
