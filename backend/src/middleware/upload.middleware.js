const multer = require('multer');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const s3Client = require('../config/s3');
const { error } = require('../utils/apiResponse');

// ─── Multer Configuration ─────────────────────────────────────────────────────
// Use memoryStorage — files are held in Buffer, then piped to S3
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

// ─── S3 Upload Helper ─────────────────────────────────────────────────────────
const uploadFileToS3 = async (file, listingId) => {
  const timestamp = Date.now();
  const sanitizedName = file.originalname.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '');
  const key = `listings/${listingId}/${timestamp}-${sanitizedName}`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    })
  );

  const url = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;

  return { url, key };
};

// ─── Composed Middleware ───────────────────────────────────────────────────────
/**
 * uploadToS3 — multer processes multipart/form-data, then uploads each file to S3.
 * Sets req.uploadedPhotos = [{ url, key }, ...]
 */
const uploadToS3 = [
  multerUpload.array('photos', 10),

  async (req, res, next) => {
    if (!req.files || req.files.length === 0) {
      return error(res, { message: 'No photos provided.', statusCode: 400 });
    }

    const listingId = req.params.id;

    try {
      const uploadResults = await Promise.all(
        req.files.map((file) => uploadFileToS3(file, listingId))
      );
      req.uploadedPhotos = uploadResults;
      next();
    } catch (err) {
      next(err);
    }
  },
];

module.exports = { uploadToS3 };
