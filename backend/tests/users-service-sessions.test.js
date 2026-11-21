/** @jest-environment node */
jest.mock('../services/Service', () => ({
  successResponse: (body, status) => ({ body, status }),
  rejectResponse: (message, status) => ({ message, status })
}));
jest.mock('../configs', () => () => ({ get: () => false }));
jest.mock('../authenticate', () => ({ validatePassword: jest.fn() }));
jest.mock('../utils/mailer', () => () => ({}));
jest.mock('../models/users', () => ({ findOneAndUpdate: jest.fn() }));
jest.mock('../authSessions', () => ({ revokeAll: jest.fn() }));
jest.mock('../logging/logging', () => () => ({ error: jest.fn() }));
jest.mock('../sessionTokens', () => jest.fn());
jest.mock('../tokens', () => ({ getToken: jest.fn(), getRefreshToken: jest.fn() }));
const issueSessionTokens = require('../sessionTokens');
const Users = require('../models/users');
const auth = require('../authenticate');
const sessions = require('../authSessions');
const service = require('../services/UsersService');

test('generated login service issues a persisted session before returning tokens', async () => {
  const user = { _id: 'user-id', name: 'Synthetic' };
  const response = { setHeader: jest.fn() };
  issueSessionTokens.mockResolvedValue({ token: 'access', refreshToken: 'refresh' });
  const result = await service.usersLoginPOST({ loginRequest: {} }, { user }, response);
  expect(issueSessionTokens).toHaveBeenCalledWith(user, false);
  expect(response.setHeader).toHaveBeenCalledWith('Refresh-JWT', 'access');
  expect(response.setHeader).toHaveBeenCalledWith('Refresh-Token', 'refresh');
  expect(result.status).toBe(201);
});

test('generated password-reset service invalidates all previous sessions', async () => {
  auth.validatePassword.mockReturnValue(true);
  Users.findOneAndUpdate.mockResolvedValue({
    _id: 'user-id', setPassword: jest.fn(), save: jest.fn()
  });
  const result = await service.usersUpdatePasswordPOST({
    updatePasswordRequest: {
      email: 'synthetic@example.invalid', token: 'reset-key', password: 'new-value'
    }
  }, { user: null });
  expect(sessions.revokeAll).toHaveBeenCalledWith('user-id');
  expect(result.status).toBe(201);
});
