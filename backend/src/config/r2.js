const { S3Client } = require('@aws-sdk/client-s3');

// Cloudflare R2 is S3-compatible.
// Endpoint format: https://<ACCOUNT_ID>.r2.cloudflarestorage.com
const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

module.exports = r2Client;
