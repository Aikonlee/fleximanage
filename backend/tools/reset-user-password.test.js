const { resetUserPassword } = require('./reset-user-password');

test('rejects an unknown account without changing credentials', async () => {
  const User = { findOne: jest.fn(() => ({ select: jest.fn().mockResolvedValue(null) })) };
  await expect(resetUserPassword('missing@example.com', 'strong-recovery-passphrase', { User }))
    .rejects.toThrow('Account is not eligible for recovery');
  expect(User.findOne).toHaveBeenCalledWith({ email: 'missing@example.com', state: 'verified' });
  expect(User.findOne.mock.results[0].value.select).toHaveBeenCalledWith('+hash +salt');
});

test('rejects a short password before looking up a user', async () => {
  const User = { findOne: jest.fn() };
  await expect(resetUserPassword('owner@example.com', 'short', { User }))
    .rejects.toThrow('Password must be at least 12 characters');
  expect(User.findOne).not.toHaveBeenCalled();
});

test('refuses to overwrite an already active password', async () => {
  const user = { hash: 'existing-hash', setPassword: jest.fn(), save: jest.fn() };
  const User = { findOne: jest.fn(() => ({ select: jest.fn().mockResolvedValue(user) })) };
  await expect(resetUserPassword('owner@example.com', 'strong-recovery-passphrase', { User }))
    .rejects.toThrow('Account is not locked for recovery');
  expect(user.setPassword).not.toHaveBeenCalled();
});

test('sets a new password and clears the recovery marker for a locked user', async () => {
  const user = { _id: 'user-id', setPassword: jest.fn().mockResolvedValue(), save: jest.fn().mockResolvedValue() };
  const User = {
    findOne: jest.fn(() => ({ select: jest.fn().mockResolvedValue(user) })),
    findById: jest.fn(() => ({ select: jest.fn().mockResolvedValue({ hash: 'new-hash', salt: 'new-salt' }) })),
    collection: { updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }) }
  };
  await expect(resetUserPassword('owner@example.com', 'strong-recovery-passphrase', { User }))
    .resolves.toBe('owner@example.com');
  expect(user.setPassword).toHaveBeenCalledWith('strong-recovery-passphrase');
  expect(user.save).toHaveBeenCalledTimes(1);
  expect(User.findById.mock.results[0].value.select).toHaveBeenCalledWith('+hash +salt');
  expect(User.collection.updateOne).toHaveBeenCalledWith(
    { _id: 'user-id' }, { $unset: { passwordResetRequired: '', emailTokens: '' } }
  );
});

test('command-line recovery refuses a short stdin password', () => {
  const { spawnSync } = require('child_process');
  const result = spawnSync(process.execPath, [require.resolve('./reset-user-password'), 'owner@example.com'], {
    input: 'short\n', encoding: 'utf8', timeout: 5000
  });
  expect(result.status).not.toBe(0);
  expect(result.stdout).not.toContain('short');
});
