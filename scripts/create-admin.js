/**
 * Script to create a default admin user for testing
 * 
 * This script:
 * - Creates a new admin account if none exists
 * - Sets up the admin user with default credentials
 * - Creates necessary user permissions and memberships
 * 
 * IMPORTANT: This script does NOT reset passwords for existing admin accounts.
 * If an admin user already exists, it only updates their admin flag and verification status.
 * 
 * Usage: node scripts/create-admin.js (run from project root)
 */

const mongoose = require('../backend/node_modules/mongoose');
const User = require('../backend/models/users');
const Account = require('../backend/models/accounts');
const { membership, preDefinedPermissions } = require('../backend/models/membership');
const configs = require('../backend/configs')();

async function createDefaultAdmin () {
  let connection = null;
  
  try {
    // Connect to MongoDB
    const mongoUrl = configs.get('mongoUrl');
    connection = await mongoose.connect(mongoUrl);
    console.log('✓ Connected to MongoDB');

    // Check if admin user already exists
    const existingUser = await User.findOne({ email: 'admin@flexiwan.com' });
    if (existingUser) {
      console.log('ℹ Admin user already exists. Verifying admin status...');
      
      let changed = false;
      
      // Ensure admin flag is set
      if (!existingUser.admin) {
        existingUser.admin = true;
        changed = true;
        console.log('  - Setting admin flag to true');
      }
      
      // Ensure account is verified
      if (existingUser.state !== 'verified') {
        existingUser.state = 'verified';
        changed = true;
        console.log('  - Setting state to verified');
      }
      
      // Clear verification token if any
      if (existingUser.emailTokens && existingUser.emailTokens.verify) {
        existingUser.emailTokens.verify = '';
        changed = true;
        console.log('  - Clearing verification token');
      }
      
      if (changed) {
        await existingUser.save();
        console.log('✓ Existing admin user updated (admin=true, verified)');
        console.log('  NOTE: Password was NOT changed. Existing password remains active.');
      } else {
        console.log('✓ Admin user already properly configured');
      }
      
      // Ensure membership exists
      const mem = await membership.findOne({
        user: existingUser._id,
        account: existingUser.defaultAccount,
        to: 'account'
      });
      
      if (!mem) {
        await membership.create({
          user: existingUser._id,
          account: existingUser.defaultAccount,
          group: '',
          organization: null,
          to: 'account',
          role: 'owner',
          perms: preDefinedPermissions.account_owner
        });
        console.log('✓ Owner membership created for existing admin');
      } else {
        console.log('✓ Owner membership already exists');
      }
      
      return; // Done - existing admin, no password reset
    }

    // Create default account
    console.log('\nCreating new admin account...');
    const account = new Account({
      name: 'Default Account',
      accountName: 'default',
      forceMfa: false,
      numSites: 1,
      serviceType: 'testing',
      companySize: '1-10',
      country: 'US'
    });
    await account.save();
    console.log('✓ Created default account');

    // Create admin user
    const user = new User({
      email: 'admin@flexiwan.com',
      username: 'admin@flexiwan.com',
      name: 'Admin',
      lastName: 'User',
      jobTitle: 'Administrator',
      defaultAccount: account._id,
      admin: true,
      state: 'verified',
      emailTokens: { verify: '', invite: '', resetPassword: '' },
      mfa: { enabled: false }
    });

    // Register user with password using passport-local-mongoose
    await User.register(user, 'admin');
    console.log('✓ Created admin user');
    console.log('  Email: admin@flexiwan.com');
    console.log('  Password: admin');
    
    // Create owner membership for admin
    try {
      await membership.create({
        user: user._id,
        account: account._id,
        group: '',
        organization: null,
        to: 'account',
        role: 'owner',
        perms: preDefinedPermissions.account_owner
      });
      console.log('✓ Owner membership created for admin');
    } catch (e) {
      console.warn('⚠ Failed creating owner membership (may already exist):', e.message);
    }
    
    console.log('\n✓ Admin setup completed successfully');
    
  } catch (error) {
    console.error('✗ Error creating admin user:', error.message);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
    process.exit(1);
  } finally {
    if (connection) {
      await mongoose.disconnect();
      console.log('✓ Disconnected from MongoDB');
    }
  }
}

// Run the script
createDefaultAdmin().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
