// Script to reset admin user password
const mongoose = require('mongoose');
const User = require('../backend/models/users');
const configs = require('../backend/configs')();

async function resetAdminPassword () {
  try {
    // Connect to MongoDB
    const mongoUrl = configs.get('mongoUrl');
    await mongoose.connect(mongoUrl);

    console.log('Connected to MongoDB');

    // Find admin user
    const admin = await User.findOne({ email: 'admin@flexiwan.com' });
    if (!admin) {
      console.log('Admin user not found!');
      process.exit(1);
    }

    // Change password
    await admin.setPassword('admin');
    await admin.save();
    console.log('Admin password reset to: admin');
    
    process.exit(0);
  } catch (error) {
    console.error('Error resetting password:', error.message);
    process.exit(1);
  }
}

resetAdminPassword();
