/** @jest-environment node */
jest.mock('../authSessions', () => ({
  createSession: jest.fn(), revokeCurrent: jest.fn()
}));
jest.mock('../tokens', () => ({ getToken: jest.fn(), getRefreshToken: jest.fn() }));
const sessions = require('../authSessions');
const tokens = require('../tokens');
const issueSessionTokens = require('../sessionTokens');
const user = { _id: 'user-id', defaultAccount: { _id: 'account-id' } };

beforeEach(() => {
  jest.clearAllMocks();
  sessions.createSession.mockResolvedValue({ sid: 'session-id', jti: 'refresh-id' });
  tokens.getToken.mockResolvedValue('access-jwt');
  tokens.getRefreshToken.mockResolvedValue('refresh-jwt');
});

test('login persists a session before issuing paired tokens', async () => {
  const issued = await issueSessionTokens(user, true);
  expect(issued).toEqual({ token: 'access-jwt', refreshToken: 'refresh-jwt' });
  expect(user.authSessionId).toBe('session-id');
  expect(tokens.getToken).toHaveBeenCalledWith({ user }, { mfaVerified: true });
  expect(tokens.getRefreshToken).toHaveBeenCalledWith({ user }, {
    sid: 'session-id', jti: 'refresh-id', mfaVerified: true
  });
});

test('failed token issuance revokes the just-created session', async () => {
  tokens.getRefreshToken.mockRejectedValue(new Error('signing failed'));
  await expect(issueSessionTokens(user, false)).rejects.toThrow('signing failed');
  expect(sessions.revokeCurrent).toHaveBeenCalledWith(user._id, 'session-id');
});
