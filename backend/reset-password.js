#!/usr/bin/env node

const mongoose = require('mongoose');
const User = require('./models/users');

async function resetPassword() {
  try {
    // Connect to MongoDB
    await mongoose.connect('mongodb://127.0.0.1:27017,127.0.0.1:27018,127.0.0.1:27019/flexiwan?replicaSet=rs');
    
    // Find admin user
    const user = await User.findOne({ email: 'admin@flexiwan.com' });
    if (!user) {
      console.error('User not found');
      process.exit(1);
    }
    
    console.log('Found user:', user.email);
    
    // Set password to 'password123'
    await user.setPassword('password123');
    await user.save();
    
    console.log('Password reset successfully to: password123');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

resetPassword();
