const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from backend .env
dotenv.config({ path: path.join(__dirname, '../../.env') });

const connectDB = require('../config/db');
const Listing = require('../models/Listing.model');

/**
 * Migration Script: Unpublish All Property Listings
 * Sets all listings to status="pending", isVerified=false, verifiedAt=null, verifiedBy=null.
 */
const migrateAllListingsToPending = async () => {
  try {
    console.log('🔄 Connecting to MongoDB database...');
    await connectDB();

    console.log('🔄 Running migration: Making all property listings unverified & pending admin approval...');

    const result = await Listing.updateMany(
      {},
      {
        $set: {
          status: 'pending',
          isVerified: false,
          verifiedAt: null,
          verifiedBy: null,
        },
      }
    );

    console.log(`✅ Migration complete! Updated ${result.modifiedCount} listing(s) out of ${result.matchedCount} matched listing(s).`);
    console.log('📋 All property listings are now set to status="pending" and isVerified=false.');

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed with error:', error);
    process.exit(1);
  }
};

migrateAllListingsToPending();
