const { validationResult } = require('express-validator');

const User = require('../models/User.model');
const { verifyOtp, issueEmailOtp, getCooldownTtl } = require('../services/otp.service');
const { sendVerificationOtpEmail, sendEmailVerifiedSuccessEmail } = require('../services/email.service');
const { createNotification } = require('../services/notification.service');
const { success, error } = require('../utils/apiResponse');

// ═══════════════════════════════════════════════════════════════════════════════
// Email verification controllers — ROO-47 Phase 2
// All routes require Auth (verifyToken) so userId always comes from the JWT.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/auth/verify-email
 * Auth — Body: { otp }
 * Consumes the OTP single-use; flips isEmailVerified on success.
 * Idempotent: already-verified users get 200 without touching Redis.
 */
const verifyEmail = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return error(res, { message: 'Validation failed', statusCode: 422, errors: errors.array() });
    }

    const userId = req.user._id.toString();

    // Fresh read — the JWT payload may be stale if the user verified elsewhere.
    const user = await User.findById(req.user._id).select('name email role isEmailVerified');
    if (!user) {
      return error(res, { message: 'User not found.', statusCode: 404 });
    }
    if (user.isEmailVerified) {
      return success(res, { message: 'Email is already verified.', data: { emailVerified: true } });
    }

    const { otp } = req.body;
    const result = await verifyOtp(userId, String(otp).trim(), 'email');

    if (!result.ok) {
      if (result.reason === 'expired') {
        return error(res, {
          message: 'Verification code has expired. Please request a new one.',
          statusCode: 410,
        });
      }
      if (result.reason === 'locked') {
        return error(res, {
          message: 'Too many incorrect attempts. Please request a new code.',
          statusCode: 429,
        });
      }
      return error(res, {
        message: `Incorrect code. ${result.remaining} attempt(s) remaining.`,
        statusCode: 400,
      });
    }

    user.isEmailVerified = true;
    user.emailVerifiedAt = new Date();
    await user.save();

    // Mail 2 — congratulations via Resend (fire-and-forget, never blocks the
    // verification response; a mail failure must not fail verification).
    sendEmailVerifiedSuccessEmail(user.email, user.name, user.role)
      .then((mailResult) => {
        console.log(
          `[verification.controller] Congratulations mail user=${user._id} mailSent=${mailResult && mailResult.ok === true}`
        );
      })
      .catch((mailErr) => {
        console.error('[verification.controller] Failed to send congratulations email (non-fatal):', mailErr.message);
      });

    // Confirmation in-app notification (fire-and-forget — never blocks the response)
    createNotification({
      recipient: user._id,
      category: 'System',
      type: 'auth.email_verified',
      title: 'Email Verified ✓',
      message: 'Your email address has been verified successfully. You now have full access to RoofOnClick.',
      actionUrl: '/profile',
    }).catch(() => {});

    return success(res, {
      message: 'Email verified successfully.',
      data: { emailVerified: true },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/resend-verification
 * Auth — Issues a fresh OTP (overwrites the previous one) and re-mails it.
 * Guards: already-verified short-circuit + 60s Redis cooldown (429 with wait time).
 */
const resendVerification = async (req, res, next) => {
  try {
    const userId = req.user._id.toString();

    const user = await User.findById(req.user._id).select('name email isEmailVerified');
    if (!user) {
      return error(res, { message: 'User not found.', statusCode: 404 });
    }
    if (user.isEmailVerified) {
      return success(res, { message: 'Email is already verified.', data: { emailVerified: true } });
    }

    const cooldown = await getCooldownTtl(userId, 'email');
    if (cooldown > 0) {
      return error(res, {
        message: `Please wait ${cooldown} second(s) before requesting a new code.`,
        statusCode: 429,
      });
    }

    const otp = await issueEmailOtp(userId);

    try {
      const mailResult = await sendVerificationOtpEmail(user.email, user.name, otp);
      if (!mailResult || mailResult.ok !== true) {
        console.error(
          '[verification.controller] Verification email rejected:',
          (mailResult && mailResult.error) || 'unknown'
        );
        // DEV-ONLY fallback (ROO-47): same rationale as register — strictly non-production.
        if (process.env.NODE_ENV !== 'production') {
          console.log(`[verification.controller] [DEV ONLY] OTP for ${user.email}: ${otp}`);
        }
        return error(res, { message: 'Failed to send verification email. Please try again.', statusCode: 500 });
      }
    } catch (mailErr) {
      console.error('[verification.controller] Failed to send verification email:', mailErr.message);
      return error(res, { message: 'Failed to send verification email. Please try again.', statusCode: 500 });
    }

    return success(res, { message: 'A new verification code has been sent to your email.' });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/auth/verification-status
 * Auth — Lets the frontend gate UI (List Property / Book Now) without guessing.
 */
const getVerificationStatus = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('isEmailVerified isPhoneVerified');
    if (!user) {
      return error(res, { message: 'User not found.', statusCode: 404 });
    }

    return success(res, {
      message: 'Verification status fetched.',
      data: {
        emailVerified: user.isEmailVerified === true,
        phoneVerified: user.isPhoneVerified === true,
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  verifyEmail,
  resendVerification,
  getVerificationStatus,
};
