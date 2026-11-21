async function resetUserPassword (email, password, { User }) {
  if (typeof password !== 'string' || password.length < 12) {
    throw new Error('Password must be at least 12 characters');
  }
  const user = await User.findOne({ email, state: 'verified' }).select('+hash +salt');
  if (!user) throw new Error('Account is not eligible for recovery');
  if (user.hash || user.salt) throw new Error('Account is not locked for recovery');
  await user.setPassword(password);
  await user.save();
  const persisted = await User.findById(user._id).select('+hash +salt');
  if (!persisted?.hash || !persisted?.salt) throw new Error('Password was not persisted');
  const result = await User.collection.updateOne(
    { _id: user._id }, { $unset: { passwordResetRequired: '', emailTokens: '' } }
  );
  if (result.matchedCount !== 1) throw new Error('Recovery marker was not cleared');
  return email;
}

module.exports = { resetUserPassword };

if (require.main === module) {
  (async () => {
    const email = process.argv[2];
    let password = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) password += chunk;
    password = password.replace(/\r?\n$/, '');
    if (!email || !email.includes('@') || password.length < 12) {
      throw new Error('Invalid email or password length');
    }
    require('dotenv').config({ path: '/etc/fleximanage/backend.env', quiet: true });
    const User = require('../models/users');
    await User.db.asPromise();
    await resetUserPassword(email, password, { User });
    process.stdout.write('Password recovery completed for ' + email + '\n');
    process.exit(0);
  })().catch(error => {
    // Never print database error messages: they can contain connection credentials.
    const fields = error.name === 'ValidationError' ? Object.keys(error.errors).join(',') : '';
    const safeMessages = new Set([
      'Account is not eligible for recovery', 'Account is not locked for recovery',
      'Password was not persisted', 'Recovery marker was not cleared'
    ]);
    const detail = safeMessages.has(error.message) ? error.message : (error.name + (fields ? ': ' + fields : ''));
    process.stderr.write('Password recovery failed (' + detail + ').\n');
    process.exit(1);
  });
}
