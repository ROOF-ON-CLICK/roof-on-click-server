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

// ─── Single File R2 Upload Middleware ─────────────────────────────────────────
const singleMulterUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
}).single('image');

/**
 * uploadSingleToR2 — handles single 'image' field upload with file size & format validation.
 * Sets req.uploadedImage = { url, key, name, size }
 */
const uploadSingleToR2 = (req, res, next) => {
  singleMulterUpload(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return error(res, { message: 'File size exceeds 5MB limit.', statusCode: 400 });
      }
      return error(res, { message: err.message, statusCode: 400 });
    } else if (err) {
      return error(res, { message: err.message || 'Invalid image file.', statusCode: 400 });
    }

    if (!req.file) {
      return error(res, { message: 'No image file provided.', statusCode: 400 });
    }

    try {
      const folder = req.query.folder || 'listings';
      const userId = req.user ? req.user._id : 'public';
      const timestamp = Date.now();
      const sanitizedName = req.file.originalname.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '') || 'image.jpg';
      const key = `uploads/${folder}/${userId}/${timestamp}-${sanitizedName}`;

      await r2Client.send(
        new PutObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: key,
          Body: req.file.buffer,
          ContentType: req.file.mimetype,
        })
      );

      const baseUrl = process.env.R2_PUBLIC_URL || 'https://pub-7dc0dca4b7ab458d8e817e31f5d6b1e1.r2.dev';
      const url = `${baseUrl}/${key}`;

      req.uploadedImage = {
        url,
        key,
        name: req.file.originalname,
        size: req.file.size,
      };
      next();
    } catch (r2Err) {
      next(r2Err);
    }
  });
};

module.exports = { uploadToR2, uploadSingleToR2 };
