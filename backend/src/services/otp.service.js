'use strict';

/**
 * otp.service.js — Phase 1 (ROO-47)
 * Channel-agnostic OTP foundation for email verification (SMS-ready).
 *
 * Design:
 * 1. OTPs are generated with crypto.randomInt (CSPRNG) and stored in Redis
 *    ONLY as SHA-256 hashes — the plain code never touches Redis.
 * 2. Reuses the existing shared ioredis client (src/config/redis.js) —
 *    no new connection, no new dependency.
 * 3. Key layout (channel-agnostic so phone/SMS reuses the same code):
 *      otp:<channel>:<userId>           → hashed OTP, TTL OTP_EXPIRES_IN
 *      otp:<channel>:cooldown:<userId>  → resend cooldown flag, TTL OTP_RESEND_COOLDOWN
 *      otp:<channel>:attempt:<userId>   → wrong-attempt counter, TTL OTP_EXPIRES_IN
 * 4. Comparison uses crypto.timingSafeEqual to avoid timing side-channels.
 * 5. All functions throw on Redis failure — callers decide fallback policy.
 *    (Registration treats OTP issuance as non-fatal: welcome mail still goes out.)
 *
 * Phase 1 uses: generateOtp, issueEmailOtp (via issueOtp).
 * verifyOtp / getCooldownTtl / clearOtp are provided for Phase 2 endpoints.
 */

const { randomInt, createHash, timingSafeEqual } = require('crypto');
const redis = require('../config/redis');

const OTP_LENGTH = parseInt(process.env.OTP_LENGTH || '6', 10);
const OTP_EXPIRES_IN = parseInt(process.env.OTP_EXPIRES_IN || '600', 10); // 10 min
const OTP_RESEND_COOLDOWN = parseInt(process.env.OTP_RESEND_COOLDOWN || '60', 10); // 60s
const OTP_MAX_ATTEMPTS = parseInt(process.env.OTP_MAX_ATTEMPTS || '5', 10);

// ─── Key builders ─────────────────────────────────────────────────────────────
const otpKey = (userId, channel = 'email') => `otp:${channel}:${userId}`;
const cooldownKey = (userId, channel = 'email') => `otp:${channel}:cooldown:${userId}`;
const attemptKey = (userId, channel = 'email') => `otp:${channel}:attempt:${userId}`;

// ─── Pure helpers (no I/O — trivially testable) ───────────────────────────────

/**
 * Generates a numeric OTP of the configured length (no leading zero,
 * so the code is always exactly OTP_LENGTH digits).
 */
function generateOtp(length = OTP_LENGTH) {
  const min = 10 ** (length - 1);
  const max = 10 ** length;
  return String(randomInt(min, max));
}

/** SHA-256 hex digest of an OTP — this is what gets stored in Redis. */
function hashOtp(otp) {
  return createHash('sha256').update(String(otp)).digest('hex');
}

/**
 * Constant-time comparison of a candidate OTP against a stored hash.
 * Returns false (never throws) on any mismatch / malformed input.
 */
function matchesHash(candidateOtp, storedHash) {
  try {
    if (!candidateOtp || !storedHash) return false;
    const a = Buffer.from(hashOtp(candidateOtp));
    const b = Buffer.from(String(storedHash));
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ─── Redis operations ─────────────────────────────────────────────────────────

/**
 * Issues (generates + stores) a fresh OTP for a user/channel.
 * Overwrites any previous OTP, resets the attempt counter, and arms the
 * resend cooldown. Returns the PLAIN otp — callers must only send it
 * via the delivery channel (email/SMS), never persist or log it.
 */
async function issueOtp(userId, channel = 'email') {
  const otp = generateOtp();
  const pipe = redis.pipeline();
  pipe.setex(otpKey(userId, channel), OTP_EXPIRES_IN, hashOtp(otp));
  pipe.del(attemptKey(userId, channel));
  pipe.setex(cooldownKey(userId, channel), OTP_RESEND_COOLDOWN, '1');
  await pipe.exec();
  return otp;
}

/** Convenience wrapper for the Phase 1 email flow. */
async function issueEmailOtp(userId) {
  return issueOtp(userId, 'email');
}

/**
 * Verifies a candidate OTP (Phase 2 consumer).
 * Returns { ok:true } on success (OTP consumed single-use),
 * otherwise { ok:false, reason } where reason is one of:
 * 'expired' | 'locked' | 'invalid', plus remaining attempts for 'invalid'.
 */
async function verifyOtp(userId, candidateOtp, channel = 'email') {
  const storedHash = await redis.get(otpKey(userId, channel));
  if (!storedHash) {
    return { ok: false, reason: 'expired' };
  }

  const attempts = await redis.incr(attemptKey(userId, channel));
  if (attempts === 1) {
    // First failed-attempt window starts now; keep counter aligned with OTP TTL.
    await redis.expire(attemptKey(userId, channel), OTP_EXPIRES_IN);
  }
  if (attempts > OTP_MAX_ATTEMPTS) {
    await clearOtp(userId, channel); // force resend after lockout
    return { ok: false, reason: 'locked' };
  }

  if (matchesHash(candidateOtp, storedHash)) {
    await clearOtp(userId, channel);
    return { ok: true };
  }
  return { ok: false, reason: 'invalid', remaining: OTP_MAX_ATTEMPTS - attempts };
}

/**
 * Remaining resend-cooldown seconds for a user/channel (0 = free to resend).
 * Phase 2 consumer for POST /resend-verification.
 */
async function getCooldownTtl(userId, channel = 'email') {
  const ttl = await redis.ttl(cooldownKey(userId, channel));
  return ttl > 0 ? ttl : 0;
}

/** Removes all OTP state for a user/channel (consume / invalidate / reset). */
async function clearOtp(userId, channel = 'email') {
  await redis.del(otpKey(userId, channel), attemptKey(userId, channel));
}

module.exports = {
  // Config (exposed for tests / Phase 2 rate-limit messages)
  OTP_LENGTH,
  OTP_EXPIRES_IN,
  OTP_RESEND_COOLDOWN,
  OTP_MAX_ATTEMPTS,
  // Pure helpers
  generateOtp,
  hashOtp,
  matchesHash,
  // Redis operations
  issueOtp,
  issueEmailOtp,
  verifyOtp,
  getCooldownTtl,
  clearOtp,
};
