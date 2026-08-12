const express = require('express');
const { verifyToken } = require('../middleware/auth.middleware');
const { uploadSingleToR2 } = require('../middleware/upload.middleware');
const { success } = require('../utils/apiResponse');

const router = express.Router();

/**
 * POST /api/upload/image
 * Uploads a single image file (field name: 'image') to Cloudflare R2 bucket.
 * Returns public R2 URL, storage key, name, and size.
 */
router.post('/image', verifyToken, uploadSingleToR2, (req, res) => {
  return success(res, {
    message: 'Image uploaded successfully to Cloudflare R2.',
    data: req.uploadedImage,
  });
});

module.exports = router;
