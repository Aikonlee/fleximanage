const crypto = require('crypto');
const Sessions = require('./models/authSessions');
const Users = require('./models/users');
const configs = require('./configs')();

const hashJti = jti => crypto.createHash('sha256').update(jti).digest('hex');
const randomId = () => crypto.randomBytes(32).toString('hex');

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
    revokedAt: null
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
  const expiresAt = new Date(Date.now() +
    configs.get('userRefreshTokenExpiration', 'number') * 1000);
  const base = {
    sid: payload.sid,
    user: user._id,
    account: user.defaultAccount._id,
    authVersion: payload.authVersion,
    revokedAt: null,
    expiresAt: { $gt: new Date() }
  };
  const rotation = {
    $set: {
      refreshHash: hashJti(jti),
      expiresAt,
      graceHash: presented,
      graceUntil: Date.now() + 15000
    }
  };
  let updated = await Sessions.findOneAndUpdate(
    { ...base, refreshHash: presented }, rotation, { new: true });
  if (!updated) {
    updated = await Sessions.findOneAndUpdate({
      ...base,
      graceHash: presented,
      graceUntil: { $gt: Date.now() }
    }, rotation, { new: true });
  }
  if (!updated) {
    await Sessions.updateOne({ sid: payload.sid, user: user._id, revokedAt: null },
      { $set: { revokedAt: new Date() } });
    throw new Error('Invalid refresh session');
  }
  return { sid: payload.sid, jti, authVersion: payload.authVersion, expiresAt };
};

const revokeCurrent = async (userId, sid) => {
  if (!sid) return;
  await Sessions.updateOne({ sid, user: userId, revokedAt: null },
    { $set: { revokedAt: new Date() } });
};

const revokeAll = async userId => {
  const updated = await Users.findOneAndUpdate(
    { _id: userId }, { $inc: { authVersion: 1 } }, { new: true });
  if (!updated) throw new Error('User not found');
  await Sessions.updateMany({ user: userId, revokedAt: null },
    { $set: { revokedAt: new Date() } });
  return updated.authVersion;
};

module.exports = { createSession, validateAccess, rotateRefresh, revokeCurrent, revokeAll };
