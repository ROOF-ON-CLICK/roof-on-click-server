const express = require('express');
const { body } = require('express-validator');

const {
  getListings,
  getListing,
  createListing,
  updateListing,
  deleteListing,
  getWhatsAppLink,
  uploadPhotos,
  deletePhoto,
} = require('../controllers/listing.controller');

const { verifyToken, optionalAuth, requireRole, isOwnerOf } = require('../middleware/auth.middleware');
const { uploadToS3 } = require('../middleware/upload.middleware');
const Listing = require('../models/Listing.model');

const router = express.Router();

// ─── Validation ───────────────────────────────────────────────────────────────
const listingValidation = [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('type')
    .isIn(['hostel', 'pg', 'shared-room', 'private-room'])
    .withMessage('Invalid listing type'),
  body('gender').isIn(['boys', 'girls', 'co-ed']).withMessage('Invalid gender option'),
  body('rent.monthly').isNumeric().withMessage('Monthly rent must be a number'),
  body('address.area').trim().notEmpty().withMessage('Area is required'),
];

// ─── Public Routes ────────────────────────────────────────────────────────────
router.get('/', optionalAuth, getListings);
router.get('/:id', optionalAuth, getListing);
router.get('/:id/whatsapp-link', getWhatsAppLink);

// ─── Protected Routes — Owner or Admin ───────────────────────────────────────
router.post('/', verifyToken, listingValidation, createListing);

router.put(
  '/:id',
  verifyToken,
  isOwnerOf(Listing),
  updateListing
);

router.delete(
  '/:id',
  verifyToken,
  deleteListing // ownership check is inside controller (admin bypass)
);

// ─── Photo Routes — Owner only ────────────────────────────────────────────────
router.post(
  '/:id/photos',
  verifyToken,
  isOwnerOf(Listing),
  uploadToS3,        // multer + S3 upload middleware → sets req.uploadedPhotos
  uploadPhotos
);

router.delete(
  '/:id/photos/:photoKey',
  verifyToken,
  isOwnerOf(Listing),
  deletePhoto
);

module.exports = router;
