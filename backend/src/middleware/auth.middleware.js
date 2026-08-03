const jwt = require('jsonwebtoken');
const User = require('../models/User.model');
const { error } = require('../utils/apiResponse');

/**
 * verifyToken — Extract and validate JWT from Authorization header.
 * Attaches decoded user to req.user.
 */
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return error(res, { message: 'Access denied. No token provided.', statusCode: 401 });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Fetch fresh user to catch role changes or deletions
    const user = await User.findById(decoded.userId).select('-password');
    if (!user) {
      return error(res, { message: 'User no longer exists.', statusCode: 401 });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return error(res, { message: 'Token has expired. Please log in again.', statusCode: 401 });
    }
    return error(res, { message: 'Invalid token.', statusCode: 401 });
  }
};

/**
 * optionalAuth — Like verifyToken but doesn't block if no token provided.
 * Sets req.user = null if unauthenticated.
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
    const user = await User.findById(decoded.userId).select('-password');
    req.user = user || null;
    next();
  } catch {
    req.user = null;
    next();
  }
};

/**
 * requireRole(...roles) — Check that authenticated user has one of the allowed roles.
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

/**
 * isOwnerOf(Model, paramKey) — Verify the authenticated user owns the resource.
 * Fetches the document by req.params[paramKey] and checks doc.owner === req.user._id.
 * Admins bypass this check.
 */
const isOwnerOf = (Model, paramKey = 'id') => {
  return async (req, res, next) => {
    try {
      const doc = await Model.findById(req.params[paramKey]);
      if (!doc) {
        return error(res, { message: 'Resource not found.', statusCode: 404 });
      }

      // Admins can bypass ownership check
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
