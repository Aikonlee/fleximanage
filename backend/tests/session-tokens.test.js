/** @jest-environment node */
jest.mock('../models/membership', () => ({
  getUserPermissions: jest.fn(async () => ({ devices: 1 })),
  preDefinedPermissions: { none: {} }
}));
jest.mock('../configs', () => () => ({
  get: key => key === 'userTokenSecretKey' ? 'synthetic-signing-key' : 3600
}));
jest.mock('../logging/logging', () => () => ({ error: jest.fn() }));
const jwt = require('jsonwebtoken');
const tokens = require('../tokens');
const user = {
  _id: '507f1f77bcf86cd799439011',
  username: 'synthetic@example.invalid',
  defaultAccount: { _id: '507f1f77bcf86cd799439012' },
  authVersion: 0,
  authSessionId: 'session-id'
};

test('ordinary access tokens carry the active session and auth version', async () => {
  const token = await tokens.getToken({ user }, { mfaVerified: true });
  const payload = jwt.verify(token, 'synthetic-signing-key');
  expect(payload.sid).toBe('session-id');
  expect(payload.authVersion).toBe(0);
  expect(payload.account).toBe(user.defaultAccount._id);
});

test('refresh JWTs are typed and bound to one account, session, and identifier', async () => {
  const token = await tokens.getRefreshToken({ user }, { sid: 'session-id', jti: 'refresh-id' });
  const payload = jwt.verify(token, 'synthetic-signing-key');
  expect(payload).toMatchObject({
    type: 'refresh',
    _id: user._id,
    account: user.defaultAccount._id,
    sid: 'session-id',
    jti: 'refresh-id',
    authVersion: 0
  });
});

test('refresh token issuance fails closed without a session and identifier', async () => {
  await expect(tokens.getRefreshToken({ user })).rejects.toThrow('Active session required');
});

test('unfinished MFA login tokens carry a revocable version marker', async () => {
  const token = await tokens.getLoginProcessToken(user);
  expect(jwt.verify(token, 'synthetic-signing-key').authVersion).toBe(0);
});
