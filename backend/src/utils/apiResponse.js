/**
 * Standard API response helpers.
 * All endpoints use these to ensure consistent response shape:
 * { success, message, data, pagination? }
 */

const success = (res, { message = 'Success', data = null, statusCode = 200, pagination = null } = {}) => {
  const body = { success: true, message, data };
  if (pagination) body.pagination = pagination;
  return res.status(statusCode).json(body);
};

const error = (res, { message = 'Something went wrong', statusCode = 500, errors = [] } = {}) => {
  return res.status(statusCode).json({ success: false, message, errors });
};

module.exports = { success, error };
