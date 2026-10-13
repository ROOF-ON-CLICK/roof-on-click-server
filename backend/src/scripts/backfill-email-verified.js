/**
 * backfill-email-verified.js — ROO-47 one-off migration helper.
 *
 * Existing users registered before email verification existed have
 * isEmailVerified=false and would be blocked by requireEmailVerified
 * on listings/bookings/enquiries. This script flips them in bulk.
 *
 * SAFETY: dry-run by default (counts only, writes nothing).
 *   node src/scripts/backfill-email-verified.js            → dry-run
 *   node src/scripts/backfill-email-verified.js --apply    → performs the update
 *
 * Run BEFORE deploying the Phase 3 enforcement to production (or accept
 * that legacy users will be asked to verify on next login instead).
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User.model');

const APPLY = process.argv.includes('--apply');

const run = async () => {
  if (!process.env.MONGO_URI) {
    console.error('[backfill] MONGO_URI is not set. Aborting.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log(`[backfill] Connected: ${mongoose.connection.name} | mode: ${APPLY ? 'APPLY' : 'dry-run'}`);

  const filter = { isEmailVerified: { $ne: true } };
  const pending = await User.countDocuments(filter);
  console.log(`[backfill] Users with isEmailVerified != true: ${pending}`);

  if (APPLY && pending > 0) {
    const now = new Date();
    const result = await User.updateMany(filter, {
      $set: { isEmailVerified: true, emailVerifiedAt: now },
    });
    console.log(`[backfill] Matched: ${result.matchedCount}, updated: ${result.modifiedCount}`);
  } else if (!APPLY) {
    console.log('[backfill] Dry-run complete — no writes. Re-run with --apply to perform the update.');
  } else {
    console.log('[backfill] Nothing to update.');
  }

  await mongoose.disconnect();
  console.log('[backfill] Done.');
  process.exit(0);
};

run().catch(async (err) => {
  console.error('[backfill] Failed:', err.message);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
