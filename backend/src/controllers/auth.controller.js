const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomUUID, createHash, randomBytes } = require('crypto');
const { sendPasswordResetEmail, sendOAuthAccountEmail, sendWelcomeEmail } = require('../services/email.service');
const { createNotification } = require('../services/notification.service');
const { validationResult } = require('express-validator');

const User = require('../models/User.model');
const redis = require('../config/redis');
const { success, error } = require('../utils/apiResponse');

// ─── Constants ────────────────────────────────────────────────────────────────
// Parse "1h" → 3600, "7d" → 604800 for Redis TTL (seconds)
const parseExpiryToSeconds = (str) => {
  const n = parseInt(str);
  if (str.endsWith('h')) return n * 3600;
  if (str.endsWith('d')) return n * 86400;
  if (str.endsWith('m')) return n * 60;
  return n;
};

const ACCESS_TOKEN_EXPIRES_IN = process.env.ACCESS_TOKEN_EXPIRES_IN || '1h';
const REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || '7d';
const ACCESS_TTL_SECONDS = parseExpiryToSeconds(ACCESS_TOKEN_EXPIRES_IN);
const REFRESH_TTL_SECONDS = parseExpiryToSeconds(REFRESH_TOKEN_EXPIRES_IN);

// ─── Token Helpers ────────────────────────────────────────────────────────────

/**
 * Signs a short-lived Access Token.
 * Embeds a unique jti (JWT ID) for per-token revocation via Redis blocklist.
 */
const signAccessToken = (user) => {
  const jti = randomUUID();
  const token = jwt.sign(
    { userId: user._id, role: user.role, email: user.email, jti },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRES_IN }
  );
  return { token, jti };
};

/**
 * Signs a long-lived Refresh Token.
 * Contains userId + familyId (one per login/device session).
 * Uses a separate secret from the Access Token.
 */
const signRefreshToken = (userId, familyId) => {
  return jwt.sign(
    { userId, familyId },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRES_IN }
  );
};

/** SHA-256 hash of a token string — stored in Redis instead of raw token */
const hashToken = (token) => createHash('sha256').update(token).digest('hex');

/**
 * Stores the hashed refresh token in Redis.
 * Key: refresh:<userId>:<familyId>
 * TTL: REFRESH_TTL_SECONDS (e.g. 7 days = 604800s)
 */
const storeRefreshToken = async (userId, familyId, refreshToken) => {
  await redis.setex(
    `refresh:${userId}:${familyId}`,
    REFRESH_TTL_SECONDS,
    hashToken(refreshToken)
  );
};

/**
 * Builds the public token response payload.
 */
const buildTokenResponse = (accessToken, refreshToken, user) => ({
  accessToken,
  refreshToken,
  expiresIn: ACCESS_TTL_SECONDS,
  user,
});

// ═══════════════════════════════════════════════════════════════════════════════
// CONTROLLERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/auth/register
 * Public — Email + password signup
 */
const register = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return error(res, { message: 'Validation failed', statusCode: 422, errors: errors.array() });
    }

    const { name, email, password, role } = req.body;

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return error(res, { message: 'An account with this email already exists. Please log in.', statusCode: 409 });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const allowedRole = ['seeker', 'owner'].includes(role) ? role : 'seeker';

    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      role: allowedRole,
    });

    // ── Welcome Email & In-App Notification ──
    (async () => {
      try {
        await sendWelcomeEmail(user.email, user.name, user.role);
        await createNotification({
          recipient: user._id,
          category: 'System',
          type: 'system.welcome',
          title: 'Welcome to RoofOnClick! 🏠',
          message: user.role === 'owner'
            ? 'Welcome to the RoofOnClick partner network! You can now list verified student accommodations with zero brokerage.'
            : 'Welcome to RoofOnClick! Start exploring verified student hostels, PGs, and apartments across Indore.',
          actionUrl: user.role === 'owner' ? '/owner/properties' : '/properties',
        });
      } catch (welcomeErr) {
        console.error('[auth.controller] Failed to dispatch welcome email/notification:', welcomeErr.message);
      }
    })();

    const { token: accessToken } = signAccessToken(user);
    const familyId = randomUUID();
    const refreshToken = signRefreshToken(user._id.toString(), familyId);
    await storeRefreshToken(user._id.toString(), familyId, refreshToken);

    const userObj = user.toObject();
    delete userObj.password;

    return success(res, {
      message: 'Account created successfully.',
      data: buildTokenResponse(accessToken, refreshToken, userObj),
      statusCode: 201,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/login
 * Public — Email + password login
 */
const login = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return error(res, { message: 'Validation failed', statusCode: 422, errors: errors.array() });
    }

    const { email, password } = req.body;

    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user || !user.password) {
      return error(res, { message: 'Invalid email or password.', statusCode: 401 });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return error(res, { message: 'Invalid email or password.', statusCode: 401 });
    }

    const { token: accessToken } = signAccessToken(user);
    const familyId = randomUUID();
    const refreshToken = signRefreshToken(user._id.toString(), familyId);
    await storeRefreshToken(user._id.toString(), familyId, refreshToken);

    const userObj = user.toObject();
    delete userObj.password;

    return success(res, {
      message: 'Login successful.',
      data: buildTokenResponse(accessToken, refreshToken, userObj),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/refresh
 * Public — Exchange a valid Refresh Token for a new Access Token.
 * Refresh Token is NOT rotated (non-rotating per-device session).
 * The RT session TTL is slid (reset) on every successful refresh.
 */
const refresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return error(res, { message: 'Refresh token is required.', statusCode: 400 });
    }

    // Verify RT signature & expiry
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
    } catch {
      return error(res, { message: 'Invalid or expired refresh token. Please log in again.', statusCode: 401 });
    }

    const { userId, familyId } = decoded;

    // Look up stored hash in Redis
    const storedHash = await redis.get(`refresh:${userId}:${familyId}`);
    if (!storedHash) {
      return error(res, { message: 'Session not found or expired. Please log in again.', statusCode: 401 });
    }

    // Validate that the provided RT matches what we stored
    if (hashToken(refreshToken) !== storedHash) {
      // Possible tampering — delete this session as a precaution
      await redis.del(`refresh:${userId}:${familyId}`);
      return error(res, { message: 'Invalid refresh token. Please log in again.', statusCode: 401 });
    }

    // Fetch fresh user (catches role changes, deletions)
    const user = await User.findById(userId).select('-password');
    if (!user) {
      return error(res, { message: 'User not found.', statusCode: 401 });
    }

    // Issue new Access Token only (RT stays the same — non-rotating)
    const { token: accessToken } = signAccessToken(user);

    // Slide the RT session TTL — activity resets the 7-day window
    await redis.expire(`refresh:${userId}:${familyId}`, REFRESH_TTL_SECONDS);

    return success(res, {
      message: 'Token refreshed successfully.',
      data: { accessToken, expiresIn: ACCESS_TTL_SECONDS },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/logout
 * Auth — Revokes current Access Token (jti blocklist) + destroys this device's RT session.
 */
const logout = async (req, res, next) => {
  try {
    // Blocklist the current AT's jti so it can't be reused within its remaining lifetime
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const token = authHeader.split(' ')[1];
        const decoded = jwt.decode(token);
        if (decoded?.jti) {
          const remainingTTL = Math.max(1, decoded.exp - Math.floor(Date.now() / 1000));
          await redis.setex(`blocklist:jti:${decoded.jti}`, remainingTTL, '1');
        }
      } catch {
        // Non-fatal — AT may already be expired
      }
    }

    // Destroy the RT session from Redis
    const { refreshToken } = req.body;
    if (refreshToken) {
      try {
        const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
        await redis.del(`refresh:${decoded.userId}:${decoded.familyId}`);
      } catch {
        // RT may be expired or invalid — still complete logout
      }
    }

    return success(res, { message: 'Logged out successfully.' });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/logout-all
 * Auth — Invalidates ALL active sessions across all devices for this user.
 * Uses user_revoked:<userId> timestamp so existing ATs are also blocked.
 */
const logoutAll = async (req, res, next) => {
  try {
    const userId = req.user._id.toString();
    const now = Math.floor(Date.now() / 1000);

    // Set global revocation timestamp — verifyToken checks iat < this value
    await redis.setex(`user_revoked:${userId}`, REFRESH_TTL_SECONDS, now.toString());

    // Delete all RT sessions for this user via SCAN (no wildcard DEL in Redis)
    let cursor = '0';
    do {
      const [nextCursor, keys] = await redis.scan(
        cursor, 'MATCH', `refresh:${userId}:*`, 'COUNT', 100
      );
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== '0');

    return success(res, { message: 'Logged out from all devices successfully.' });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/logout — stateless acknowledgement (kept for compatibility)
 * GET /api/auth/me — Return current user profile
 */
const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id)
      .select('-password')
      .populate('savedListings', 'title address.area rent.monthly photos status');

    return success(res, { message: 'User profile fetched.', data: { user } });
  } catch (err) {
    next(err);
  }
};

/**
 * Google OAuth callback — issues AT + RT pair after OAuth success.
 */
const googleCallback = async (req, res) => {
  try {
    const { token: accessToken } = signAccessToken(req.user);
    const familyId = randomUUID();
    const refreshToken = signRefreshToken(req.user._id.toString(), familyId);
    await storeRefreshToken(req.user._id.toString(), familyId, refreshToken);

    return res.redirect(
      `${process.env.FRONTEND_URL}/auth/callback?accessToken=${accessToken}&refreshToken=${refreshToken}`
    );
  } catch {
    return res.redirect(`${process.env.FRONTEND_URL}/auth/callback?error=oauth_failed`);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/forgot-password
// Always returns 200 to prevent account enumeration.
// ─────────────────────────────────────────────────────────────────────────────
const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return error(res, { message: 'Email is required.', statusCode: 400 });
    }

    const GENERIC_MSG = 'If an account exists with that email, a password reset link has been sent.';

    const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');
    if (!user) {
      // Do NOT reveal that the account doesn't exist
      return success(res, { message: GENERIC_MSG });
    }

    // Google OAuth-only accounts have googleId and no password — send a helpful redirect email instead
    if (user.googleId && !user.password) {
      try {
        await sendOAuthAccountEmail(user.email, user.name);
      } catch (emailErr) {
        console.error('[forgotPassword] Failed to send OAuth hint email:', emailErr);
      }
      return success(res, { message: GENERIC_MSG });
    }

    // Generate cryptographically secure raw token
    const rawToken = randomBytes(32).toString('hex');
    const hashedToken = createHash('sha256').update(rawToken).digest('hex');

    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 min
    await user.save();

    try {
      await sendPasswordResetEmail(user.email, user.name, rawToken);
    } catch (emailErr) {
      // Roll back token so user can retry
      user.resetPasswordToken = null;
      user.resetPasswordExpires = null;
      await user.save();
      console.error('[forgotPassword] Failed to send reset email:', emailErr);
      return error(res, { message: 'Failed to send reset email. Please try again.', statusCode: 500 });
    }

    return success(res, { message: GENERIC_MSG });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/auth/verify-reset-token?token=<rawToken>
// Lets the frontend validate the token before showing the reset form.
// ─────────────────────────────────────────────────────────────────────────────
const verifyResetToken = async (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token) {
      return error(res, { message: 'Token is required.', statusCode: 400 });
    }

    const hashedToken = createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: new Date() },
    }).select('+resetPasswordToken');

    if (!user) {
      return error(res, { message: 'Reset link is invalid or has expired.', statusCode: 400 });
    }

    return success(res, { message: 'Token is valid.' });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/reset-password
// Body: { token, password }
// On success: clears all Redis refresh-token sessions (logs out all devices)
// ─────────────────────────────────────────────────────────────────────────────
const resetPassword = async (req, res, next) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return error(res, { message: 'Token and new password are required.', statusCode: 400 });
    }

    if (password.length < 8) {
      return error(res, { message: 'Password must be at least 8 characters.', statusCode: 400 });
    }

    const hashedToken = createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: new Date() },
    }).select('+resetPasswordToken +password');

    if (!user) {
      return error(res, { message: 'Reset link is invalid or has expired.', statusCode: 400 });
    }

    // Update password
    const salt = await bcrypt.genSalt(12);
    user.password = await bcrypt.hash(password, salt);
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await user.save();

    // Invalidate ALL Redis refresh-token sessions for this user
    try {
      const pattern = `refresh:${user._id.toString()}:*`;
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (redisErr) {
      // Non-fatal — password is already changed
      console.error('[resetPassword] Redis session clear failed:', redisErr);
    }

    return success(res, { message: 'Password has been reset successfully. Please log in with your new password.' });
  } catch (err) {
    next(err);
  }
};

module.exports = { register, login, refresh, logout, logoutAll, getMe, googleCallback, forgotPassword, verifyResetToken, resetPassword };
