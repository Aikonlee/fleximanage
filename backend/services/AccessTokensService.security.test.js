/** @jest-environment node */
jest.mock('../models/accesstokens', () => ({ find: jest.fn() }));
jest.mock('../models/organizations', () => ({}));
jest.mock('../models/membership', () => ({ preDefinedPermissions: {}, validatePermissionCombination: jest.fn() }));
jest.mock('../tokens', () => ({ getAccessKey: jest.fn() }));
const AccessTokens = require('../models/accesstokens');
const Service = require('./AccessTokensService');

test('listing access keys returns metadata without reusable bearer credentials', async () => {
  AccessTokens.find.mockReturnValue({
    skip: () => ({ limit: () => ({ populate: async () => [{
      id: 'key-id', name: 'a key', token: 'secret-jwt', isValid: true,
      group: '', organization: null, to: 'account', role: 'viewer'
    }] }) })
  });
  const result = await Service.accesstokensGET({}, { user: { defaultAccount: { _id: 'account-id' } } });
  expect(result.code).toBe(200);
  expect(result.payload).toHaveLength(1);
  expect(result.payload[0]).not.toHaveProperty('token');
  expect(result.payload[0].name).toBe('a key');
});
