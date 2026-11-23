const crypto = require('crypto');
const Sessions = require('./models/authSessions');
const Users = require('./models/users');
const configs = require('./configs')();

const hashJti = jti => crypto.createHash('sha256').update(jti).digest('hex');
const randomId = () => crypto.randomBytes(32).toString('hex');

// One grace retry of a just-rotated token (client crash). A second presentation
// of that same hash is not a new grace window.
const GRACE_WINDOW_MS = 15000;
const MAX_GRACE_ROTATIONS = 1;

const createSession = async user => {
  const sid = randomId();
  const jti = randomId();
  const authVersion = user.authVersion ?? 0;
  const expiresAt = new Date(Date.now() +
    configs.get('userRefreshTokenExpiration', 'number') * 1000);
  await Sessions.create({
    sid,
    user: user._id,
    account: user.defaultAccount._id,
    authVersion,
    refreshHash: hashJti(jti),
    expiresAt,
    revokedAt: null,
    graceHash: null,
    graceUntil: 0,
    graceRotationCount: 0
  });
  return { sid, jti, authVersion, expiresAt };
};

const validateAccess = async (payload, user) => {
  if (!payload?.sid || !Number.isInteger(payload.authVersion) ||
      payload.authVersion !== (user.authVersion ?? 0) ||
      String(payload._id) !== String(user._id) ||
      String(payload.account) !== String(user.defaultAccount?._id)) return false;
  return Boolean(await Sessions.exists({
    sid: payload.sid,
    user: user._id,
    account: user.defaultAccount._id,
    authVersion: payload.authVersion,
    revokedAt: null,
    expiresAt: { $gt: new Date() }
  }));
};

const rotateRefresh = async (payload, user) => {
  if (payload?.type !== 'refresh' || !payload.sid || !payload.jti ||
      !Number.isInteger(payload.authVersion) ||
      payload.authVersion !== (user.authVersion ?? 0) ||
      String(payload._id) !== String(user._id) ||
      String(payload.account) !== String(user.defaultAccount?._id)) {
    throw new Error('Invalid refresh session');
  }
  const jti = randomId();
  const presented = hashJti(payload.jti);
  const now = Date.now();
  // expiresAt is the absolute session deadline from createSession. Rotation must
  // not push it forward, so a stolen refresh cannot extend the session forever.
  const base = {
    sid: payload.sid,
    user: user._id,
    account: user.defaultAccount._id,
    authVersion: payload.authVersion,
    revokedAt: null,
    expiresAt: { $gt: new Date(now) }
  };
  const rotatedHash = hashJti(jti);
  let updated = await Sessions.findOneAndUpdate(
    { ...base, refreshHash: presented },
    {
      $set: {
        refreshHash: rotatedHash,
        graceHash: presented,
        graceUntil: now + GRACE_WINDOW_MS
      }
    },
    { new: true });
  if (!updated) {
    // One-shot: consume the presented grace hash. Do not re-arm graceUntil.
    updated = await Sessions.findOneAndUpdate({
      ...base,
      graceHash: presented,
      graceUntil: { $gt: now },
      graceRotationCount: { $not: { $gte: MAX_GRACE_ROTATIONS } }
    }, {
      $set: {
        refreshHash: rotatedHash,
        graceHash: null,
        graceUntil: 0
      },
      $inc: { graceRotationCount: 1 }
    }, { new: true });
  }
  if (!updated) {
    await Sessions.updateOne({ sid: payload.sid, user: user._id, revokedAt: null },
      { $set: { revokedAt: new Date() } });
    throw new Error('Invalid refresh session');
  }
  return {
    sid: payload.sid,
    jti,
    authVersion: payload.authVersion,
    expiresAt: updated.expiresAt
  };
};

const revokeCurrent = async (userId, sid) => {
  if (!sid) return;
  await Sessions.updateOne({ sid, user: userId, revokedAt: null },
    { $set: { revokedAt: new Date() } });
};

const authVersionFilter = (userId, expectedAuthVersion) => {
  if (expectedAuthVersion === undefined) return { _id: userId };
  if (expectedAuthVersion === 0) {
    return {
      _id: userId,
      $or: [{ authVersion: 0 }, { authVersion: { $exists: false } }]
    };
  }
  return { _id: userId, authVersion: expectedAuthVersion };
};

const revokeAll = async (userId, { incrementAuthVersion = true, expectedAuthVersion } = {}) => {
  let authVersion;
  if (incrementAuthVersion) {
    const updated = await Users.findOneAndUpdate(
      authVersionFilter(userId, expectedAuthVersion),
      { $inc: { authVersion: 1 } },
      { new: true });
    if (!updated) {
      if (expectedAuthVersion !== undefined) {
        const err = new Error('Auth version mismatch');
        err.code = 'AUTH_VERSION_MISMATCH';
        throw err;
      }
      throw new Error('User not found');
    }
    authVersion = updated.authVersion;
  } else if (expectedAuthVersion !== undefined) {
    authVersion = expectedAuthVersion;
  }
  const sessionFilter = { user: userId, revokedAt: null };
  if (!incrementAuthVersion && expectedAuthVersion !== undefined) {
    sessionFilter.$or = [
      { authVersion: { $lt: expectedAuthVersion } },
      { authVersion: { $exists: false } }
    ];
  }
  await Sessions.updateMany(sessionFilter,
    { $set: { revokedAt: new Date() } });
  return authVersion;
};

module.exports = { createSession, validateAccess, rotateRefresh, revokeCurrent, revokeAll };
