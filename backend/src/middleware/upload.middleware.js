const multer = require('multer');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const r2Client = require('../config/r2');
const { error } = require('../utils/apiResponse');

// ─── Multer Configuration ─────────────────────────────────────────────────────
// Use memoryStorage — files are held in Buffer, then piped to R2
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPEG, PNG, and WebP images are allowed.'), false);
  }
};

const multerUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB per file
    files: 10,                  // max 10 files per request
  },
});

// ─── R2 Upload Helper ─────────────────────────────────────────────────────────
const uploadFileToR2 = async (file, listingId) => {
  const timestamp = Date.now();
  const sanitizedName = file.originalname.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '');
  const key = `listings/${listingId}/${timestamp}-${sanitizedName}`;

  await r2Client.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    })
  );

  // Use the R2 public URL if a custom domain is set, otherwise fall back to the dev URL
  const baseUrl = process.env.R2_PUBLIC_URL;
  const url = `${baseUrl}/${key}`;

  return { url, key };
};

// ─── Composed Middleware ───────────────────────────────────────────────────────
/**
 * uploadToR2 — multer processes multipart/form-data, then uploads each file to R2.
 * Sets req.uploadedPhotos = [{ url, key }, ...]
 */
const uploadToR2 = [
  multerUpload.array('photos', 10),

  async (req, res, next) => {
    if (!req.files || req.files.length === 0) {
      return error(res, { message: 'No photos provided.', statusCode: 400 });
    }

    const listingId = req.params.id;

    try {
      const uploadResults = await Promise.all(
        req.files.map((file) => uploadFileToR2(file, listingId))
      );
      req.uploadedPhotos = uploadResults;
      next();
    } catch (err) {
      next(err);
    }
  },
];

module.exports = { uploadToR2 };
