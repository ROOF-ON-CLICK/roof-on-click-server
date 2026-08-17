const jwt = require('jsonwebtoken');
const User = require('../models/User.model');
const redis = require('../config/redis');
const { error } = require('../utils/apiResponse');

// ─── verifyToken ──────────────────────────────────────────────────────────────
/**
 * Validates the Bearer Access Token.
 * Checks two Redis keys for revocation:
 *   1. blocklist:jti:<jti>     — set on explicit logout (single session)
 *   2. user_revoked:<userId>   — set on logout-all / password change
 *
 * Redis failures are fail-open (logged but not blocking) to preserve availability.
 * The short AT lifetime (1h) limits the damage window in the unlikely event Redis is down.
 */
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.query && req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      return error(res, { message: 'Access denied. No token provided.', statusCode: 401 });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // ── Check 1: Per-token blocklist (explicit logout) ────────────────────────
    try {
      const isBlocklisted = await redis.get(`blocklist:jti:${decoded.jti}`);
      if (isBlocklisted) {
        return error(res, { message: 'Token has been revoked. Please log in again.', statusCode: 401 });
      }
    } catch (redisErr) {
      console.error('[Redis] Blocklist check failed (fail-open):', redisErr.message);
    }

    // ── Check 2: Global user revocation (logout-all / password change) ────────
    try {
      const revokedAt = await redis.get(`user_revoked:${decoded.userId}`);
      if (revokedAt && decoded.iat < parseInt(revokedAt, 10)) {
        return error(res, { message: 'Session expired. Please log in again.', statusCode: 401 });
      }
    } catch (redisErr) {
      console.error('[Redis] Revocation check failed (fail-open):', redisErr.message);
    }

    // ── Fetch fresh user ──────────────────────────────────────────────────────
    const user = await User.findById(decoded.userId).select('-password');
    if (!user) {
      return error(res, { message: 'User no longer exists.', statusCode: 401 });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return error(res, {
        message: 'Access token expired. Use your refresh token to get a new one.',
        statusCode: 401,
      });
    }
    return error(res, { message: 'Invalid token.', statusCode: 401 });
  }
};

// ─── optionalAuth ─────────────────────────────────────────────────────────────
/**
 * Like verifyToken but doesn't block unauthenticated requests.
 * Sets req.user = null if no/invalid token.
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.user = null;
      return next();
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Quick blocklist check (non-blocking on Redis error)
    try {
      const isBlocklisted = await redis.get(`blocklist:jti:${decoded.jti}`);
      if (isBlocklisted) {
        req.user = null;
        return next();
      }
    } catch { /* fail-open */ }

    const user = await User.findById(decoded.userId).select('-password');
    req.user = user || null;
    next();
  } catch {
    req.user = null;
    next();
  }
};

// ─── requireRole ──────────────────────────────────────────────────────────────
/**
 * RBAC guard — check that authenticated user has one of the allowed roles.
 * Must be used AFTER verifyToken.
 */
const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return error(res, { message: 'Authentication required.', statusCode: 401 });
    }
    if (!roles.includes(req.user.role)) {
      return error(res, {
        message: `Access denied. Requires role: ${roles.join(' or ')}.`,
        statusCode: 403,
      });
    }
    next();
  };
};

// ─── isOwnerOf ────────────────────────────────────────────────────────────────
/**
 * Resource ownership guard — verify authenticated user owns the resource.
 * Admins bypass this check.
 */
const isOwnerOf = (Model, paramKey = 'id') => {
  return async (req, res, next) => {
    try {
      const doc = await Model.findById(req.params[paramKey]);
      if (!doc) {
        return error(res, { message: 'Resource not found.', statusCode: 404 });
      }
      if (req.user.role === 'admin') {
        req.resource = doc;
        return next();
      }
      if (doc.owner.toString() !== req.user._id.toString()) {
        return error(res, { message: 'Access denied. You do not own this resource.', statusCode: 403 });
      }
      req.resource = doc;
      next();
    } catch (err) {
      next(err);
    }
  };
};

module.exports = { verifyToken, optionalAuth, requireRole, isOwnerOf };
