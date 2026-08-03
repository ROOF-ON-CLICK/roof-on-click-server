const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const User = require('../models/User.model');
const { success, error } = require('../utils/apiResponse');

// ─── Helper ──────────────────────────────────────────────────────────────────
const signToken = (user) =>
  jwt.sign(
    { userId: user._id, role: user.role, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

// ─── Controllers ─────────────────────────────────────────────────────────────

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

    // Check email uniqueness
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return error(res, { message: 'An account with this email already exists.', statusCode: 409 });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Allow 'owner' or 'seeker' on register; admin must be set manually
    const allowedRole = ['seeker', 'owner'].includes(role) ? role : 'seeker';

    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      role: allowedRole,
    });

    const token = signToken(user);

    // Strip password from response
    const userObj = user.toObject();
    delete userObj.password;

    return success(res, {
      message: 'Account created successfully.',
      data: { token, user: userObj },
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

    // Fetch user with password field (normally excluded)
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user || !user.password) {
      return error(res, { message: 'Invalid email or password.', statusCode: 401 });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return error(res, { message: 'Invalid email or password.', statusCode: 401 });
    }

    const token = signToken(user);

    const userObj = user.toObject();
    delete userObj.password;

    return success(res, {
      message: 'Login successful.',
      data: { token, user: userObj },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/logout
 * Auth — Stateless JWT; client clears the token.
 */
const logout = (req, res) => {
  return success(res, { message: 'Logged out successfully. Please clear your token on the client.' });
};

/**
 * GET /api/auth/me
 * Auth — Return current user profile
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
 * GET /api/auth/google/callback (handled by passport, then redirects here)
 * After Google OAuth, passport calls this to finalize and issue JWT.
 */
const googleCallback = (req, res) => {
  try {
    const token = signToken(req.user);
    // Redirect to frontend with token as query param
    return res.redirect(`${process.env.FRONTEND_URL}/auth/callback?token=${token}`);
  } catch (err) {
    return res.redirect(`${process.env.FRONTEND_URL}/auth/callback?error=oauth_failed`);
  }
};

module.exports = { register, login, logout, getMe, googleCallback };
