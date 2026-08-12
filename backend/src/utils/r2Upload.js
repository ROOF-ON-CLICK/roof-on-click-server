const { PutObjectCommand } = require('@aws-sdk/client-s3');
const r2Client = require('../config/r2');

/**
 * Uploads a base64 data URL to Cloudflare R2 if applicable.
 * Returns the public R2 URL (or the original URL if already a remote link).
 *
 * @param {string} dataUrl - Image URL or base64 data string (e.g. data:image/png;base64,...)
 * @param {string} folder - Storage folder prefix (e.g. 'avatars', 'reviews', 'listings')
 * @returns {Promise<string>} Public Cloudflare R2 URL or original string
 */
async function uploadBase64ToR2(dataUrl, folder = 'uploads') {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    return dataUrl;
  }

  try {
    const matches = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!matches) return dataUrl;

    const mimeType = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');

    const extMap = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
    };
    const ext = extMap[mimeType] || 'jpg';
    const key = `${folder}/${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;

    await r2Client.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      })
    );

    const baseUrl = process.env.R2_PUBLIC_URL || 'https://pub-r2.roofonclick.com';
    return `${baseUrl}/${key}`;
  } catch (err) {
    console.error('[R2Upload] Base64 upload failed:', err.message);
    return dataUrl;
  }
}

module.exports = { uploadBase64ToR2 };
