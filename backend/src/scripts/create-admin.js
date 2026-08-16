const dotenv = require('dotenv');
const path = require('path');
const bcrypt = require('bcryptjs');

// Load environment variables from backend .env
dotenv.config({ path: path.join(__dirname, '../../.env') });

const connectDB = require('../config/db');
const User = require('../models/User.model');

/**
 * CLI Script: Create or Promote Admin Account
 * Usage: node src/scripts/create-admin.js <email> <password> [name]
 * Example: npm run create-admin admin@roofonclick.com MySecurePassword123 "Admin User"
 */
const createAdminAccount = async () => {
  try {
    const args = process.argv.slice(2);
    let emailArg, passwordArg, nameArg;

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--email' || args[i] === '-e') {
        emailArg = args[i + 1];
        i++;
      } else if (args[i] === '--password' || args[i] === '-p') {
        passwordArg = args[i + 1];
        i++;
      } else if (args[i] === '--name' || args[i] === '-n') {
        nameArg = args[i + 1];
        i++;
      } else if (!emailArg) {
        emailArg = args[i];
      } else if (!passwordArg) {
        passwordArg = args[i];
      } else if (!nameArg) {
        nameArg = args[i];
      }
    }

    if (!emailArg || !passwordArg) {
      console.error('\n❌ Error: Email and password are required to create or promote an admin account.\n');
      console.error('Usage:');
      console.error('  npm run create-admin -- <email> <password> [name]');
      console.error('  npm run create-admin -- --email <email> --password <password> --name [name]\n');
      console.error('Example:');
      console.error('  npm run create-admin -- admin@domain.com StrongPass123! "Super Admin"\n');
      process.exit(1);
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailArg.trim())) {
      console.error(`\n❌ Error: Invalid email format "${emailArg}". Please provide a valid email address.\n`);
      process.exit(1);
    }

    if (passwordArg.length < 6) {
      console.error('\n❌ Error: Password must be at least 6 characters long.\n');
      process.exit(1);
    }

    const adminName = nameArg || 'Platform Admin';

    console.log('🔄 Connecting to MongoDB database...');
    await connectDB();

    const normalizedEmail = emailArg.trim().toLowerCase();
    let user = await User.findOne({ email: normalizedEmail });

    if (user) {
      console.log(`ℹ️  Found existing user account for ${normalizedEmail}. Promoting role to 'admin'...`);
      user.role = 'admin';
      user.isVerified = true;
      user.isEmailVerified = true;
      if (passwordArg) {
        user.password = await bcrypt.hash(passwordArg, 12);
      }
      await user.save();
      console.log(`✅ Success! Account ${normalizedEmail} has been promoted to Admin.`);
    } else {
      console.log(`✨ Creating new Admin account for ${normalizedEmail}...`);
      const hashedPassword = await bcrypt.hash(passwordArg, 12);
      user = await User.create({
        name: adminName,
        email: normalizedEmail,
        password: hashedPassword,
        role: 'admin',
        isVerified: true,
        isEmailVerified: true,
      });
      console.log(`✅ Success! Created new Admin account: ${normalizedEmail}`);
    }

    console.log('\n🔐 Admin Login Credentials:');
    console.log(`   Email:    ${normalizedEmail}`);
    console.log(`   Password: ${passwordArg}`);
    console.log(`   Role:     admin\n`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Failed to create admin account:', error);
    process.exit(1);
  }
};

createAdminAccount();
