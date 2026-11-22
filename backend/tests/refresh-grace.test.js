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
  if (expected && typeof expected === 'object' && '$gt' in expected) {
    return doc[key] > expected.$gt;
  }
  return doc[key] === expected;
});

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
      graceUntil: 0
    };
    Sessions.findOneAndUpdate.mockImplementation(async (filter, update) => {
      if (!matches(doc, filter)) return null;
      Object.assign(doc, update.$set);
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

  test('rotates the current hash, accepts it during grace, and revokes it after', async () => {
    const payload = {
      type: 'refresh',
      _id: user._id,
      account: user.defaultAccount._id,
      authVersion: 0,
      sid: 'session-id',
      jti: 'current'
    };

    const first = await authSessions.rotateRefresh(payload, user);
    expect(doc.refreshHash).toBe(hash(first.jti));
    expect(doc.graceHash).toBe(hash('current'));
    expect(doc.graceUntil).toBe(now + 15000);
    expect(doc.revokedAt).toBeNull();

    now += 14000;
    jest.setSystemTime(now);
    const replay = await authSessions.rotateRefresh(payload, user);
    expect(replay.jti).not.toBe(first.jti);
    expect(doc.refreshHash).toBe(hash(replay.jti));
    expect(doc.graceHash).toBe(hash('current'));
    expect(doc.revokedAt).toBeNull();
    expect(Sessions.updateOne).not.toHaveBeenCalled();

    now = doc.graceUntil + 1;
    jest.setSystemTime(now);
    await expect(authSessions.rotateRefresh(payload, user))
      .rejects.toThrow('Invalid refresh session');
    expect(doc.revokedAt).toEqual(expect.any(Date));
    expect(Sessions.updateOne).toHaveBeenCalledWith(
      { sid: 'session-id', user: user._id, revokedAt: null },
      { $set: { revokedAt: expect.any(Date) } }
    );
  });
});
