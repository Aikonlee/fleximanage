const sessions = require('./authSessions');
const { getToken, getRefreshToken } = require('./tokens');

module.exports = async (user, mfaVerified) => {
  const { sid, jti } = await sessions.createSession(user);
  user.authSessionId = sid;
  try {
    const token = await getToken({ user }, { mfaVerified });
    const refreshToken = await getRefreshToken({ user }, { sid, jti, mfaVerified });
    return { token, refreshToken };
  } catch (error) {
    await sessions.revokeCurrent(user._id, sid);
    throw error;
  }
};
