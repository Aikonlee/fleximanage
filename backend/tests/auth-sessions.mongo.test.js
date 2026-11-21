/** @jest-environment node */
const testUrl = process.env.MONGO_SESSION_TEST_URL;
if (testUrl && testUrl !== 'mongodb://127.0.0.1:27099/flexi_session_test') {
  throw new Error('Session integration test may only use the isolated loopback test database');
}

// jest.mock is hoisted, so it would leak into later runInBand files even when
// this suite is skipped. jest.doMock is not hoisted and runs only when the URL is set.
let mongoose;
let connection;
let Sessions;
let Users;
let sessions;
if (testUrl) {
  jest.doMock('../mongoConns', () => {
    const mongooseLib = require('mongoose');
    const isolated = mongooseLib.createConnection();
    return () => ({ getMainDB: () => isolated });
  });
  mongoose = require('mongoose');
  connection = require('../mongoConns')().getMainDB();
  Sessions = require('../models/authSessions');
  Users = require('../models/users');
  sessions = require('../authSessions');
}

const suite = testUrl ? describe : describe.skip;
suite('isolated MongoDB session lifecycle', () => {
  let user;
  beforeAll(async () => {
    await connection.openUri(testUrl, { serverSelectionTimeoutMS: 5000 });
    await connection.dropDatabase();
    await Sessions.syncIndexes();
    user = {
      _id: new mongoose.Types.ObjectId(),
      authVersion: 0,
      defaultAccount: { _id: new mongoose.Types.ObjectId() }
    };
    await Users.collection.insertOne({
      _id: user._id,
      authVersion: 0,
      defaultAccount: user.defaultAccount._id
    });
  });
  afterAll(async () => {
    if (connection.readyState === 1) await connection.dropDatabase();
    await connection.close();
  });
  test('rotation rejects replay and revocation invalidates every access JWT immediately',
    async () => {
      const created = await sessions.createSession(user);
      const access = {
        _id: user._id,
        account: user.defaultAccount._id,
        sid: created.sid,
        authVersion: 0
      };
      const refresh = { ...access, type: 'refresh', jti: created.jti };
      expect(await sessions.validateAccess(access, user)).toBe(true);
      const rotated = await sessions.rotateRefresh(refresh, user);
      expect(rotated.jti).not.toBe(created.jti);
      await expect(sessions.rotateRefresh(refresh, user))
        .rejects.toThrow('Invalid refresh session');
      expect(await sessions.validateAccess(access, user)).toBe(false);
      const next = await sessions.createSession(user);
      expect(await sessions.validateAccess({ ...access, sid: next.sid }, user)).toBe(true);
      expect(await sessions.revokeAll(user._id)).toBe(1);
      expect(await sessions.validateAccess({ ...access, sid: next.sid },
        { ...user, authVersion: 1 })).toBe(false);
      expect(await Sessions.countDocuments({ user: user._id, revokedAt: null })).toBe(0);
    });
});
