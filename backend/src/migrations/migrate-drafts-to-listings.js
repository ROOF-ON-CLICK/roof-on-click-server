const dotenv = require('dotenv');
const path = require('path');
const mongoose = require('mongoose');

// Load environment variables if not already loaded
dotenv.config({ path: path.join(__dirname, '../../.env') });

const connectDB = require('../config/db');
const Listing = require('../models/Listing.model');
const ListingDraft = require('../models/ListingDraft.model');

/**
 * Migration Script: Migrate all drafts from ListingDraft collection to Listing collection
 * Saves each existing draft as a document in the listings collection with status="draft".
 */
const migrateDraftsToListings = async () => {
  try {
    if (mongoose.connection.readyState !== 1) {
      console.log('[Migration] Connecting to MongoDB database...');
      await connectDB();
    }

    const legacyDrafts = await ListingDraft.find({}).lean();

    if (legacyDrafts.length === 0) {
      console.log('[Migration] No legacy drafts found in ListingDraft collection. Everything is up to date.');
      return { migratedCount: 0, skippedCount: 0, total: 0 };
    }

    console.log(`[Migration] Found ${legacyDrafts.length} legacy draft(s) to process.`);

    let migratedCount = 0;
    let skippedCount = 0;

    for (const draft of legacyDrafts) {
      const formValues = draft.formValues || {};

      // Check if a draft listing for this owner with similar data already exists
      const existingListingDraft = await Listing.findOne({
        owner: draft.owner,
        status: 'draft',
        'wizardState.currentStep': draft.currentStep || 1,
      });

      if (existingListingDraft) {
        skippedCount++;
        continue;
      }

      const rawType = (formValues.propertyType || 'pg').toString().toLowerCase().replace(/\s+/g, '-');
      const validTypes = [
        'hostel',
        'pg',
        'shared-room',
        'private-room',
        'apartment',
        'studio',
        'studio-apartment',
        '1-bhk',
        '2-bhk',
        '3-bhk',
        '4-bhk',
        '4+-bhk',
        'rk',
      ];
      const type = validTypes.includes(rawType) ? rawType : 'pg';

      const rawGender = (formValues.gender || 'unisex').toString().toLowerCase();
      const validGenders = ['boys', 'girls', 'co-ed', 'unisex', 'any', 'co-living'];
      const gender = validGenders.includes(rawGender) ? rawGender : 'unisex';

      const monthlyRent = Number(
        formValues.rooms?.[0]?.monthlyRent ||
        formValues.rooms?.[0]?.rent ||
        formValues.apartmentPricing?.monthlyRent ||
        0
      );

      const newListingDraft = await Listing.create({
        owner: draft.owner,
        title: formValues.propertyName || 'Untitled Property Draft',
        type,
        gender,
        description: formValues.description || '',
        address: {
          area: formValues.area || '',
          city: formValues.city || 'Indore',
          full: formValues.address || '',
          landmark: formValues.landmark || '',
        },
        rent: {
          monthly: monthlyRent,
          deposit: Number(formValues.rooms?.[0]?.securityDeposit || formValues.apartmentPricing?.securityDeposit || 0),
          maintenance: Number(formValues.apartmentPricing?.maintenance || 0),
        },
        rooms: Array.isArray(formValues.rooms) ? formValues.rooms : [],
        amenities: Array.isArray(formValues.amenities) ? formValues.amenities : [],
        rules: formValues.rules || {},
        apartmentDetails: formValues.apartmentDetails || {},
        status: 'draft',
        wizardState: {
          currentStep: Number(draft.currentStep) || 1,
          formValues,
        },
        createdAt: draft.createdAt || new Date(),
        updatedAt: draft.updatedAt || new Date(),
      });

      console.log(`[Migration] Migrated draft for owner ${draft.owner} -> Listing ID: ${newListingDraft._id}`);
      migratedCount++;
    }

    if (migratedCount > 0) {
      console.log(`[Migration] Drafts migration complete. Migrated: ${migratedCount}, Skipped: ${skippedCount}, Total: ${legacyDrafts.length}.`);
    }

    return { migratedCount, skippedCount, total: legacyDrafts.length };
  } catch (error) {
    console.error('[Migration] Drafts migration error (non-fatal):', error.message);
    return { error };
  }
};

// If run directly from command line
if (require.main === module) {
  migrateDraftsToListings().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = migrateDraftsToListings;
