/**
 * Standard API response helpers.
 * All endpoints use these to ensure consistent response shape:
 * { success, message, data, pagination? } / { success, message, errors, code? }
 */

const success = (res, { message = 'Success', data = null, statusCode = 200, pagination = null } = {}) => {
  const body = { success: true, message, data };
  if (pagination) body.pagination = pagination;
  return res.status(statusCode).json(body);
};

const error = (res, { message = 'Something went wrong', statusCode = 500, errors = [], code = null } = {}) => {
  const body = { success: false, message, errors };
  // Optional machine-readable code (e.g. EMAIL_NOT_VERIFIED) for client-side branching
  if (code) body.code = code;
  return res.status(statusCode).json(body);
};

module.exports = { success, error };
