const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');
const { logger } = require('../utils/logger');

// S3-compatible configuration for Supabase Storage
const s3Endpoint = process.env.SUPABASE_S3_ENDPOINT;
const s3Region = process.env.SUPABASE_S3_REGION || 'us-east-1';
const s3AccessKeyId = process.env.SUPABASE_S3_ACCESS_KEY_ID;
const s3SecretAccessKey = process.env.SUPABASE_S3_SECRET_ACCESS_KEY;
const supabaseBucket = process.env.SUPABASE_BUCKET || 'documents';

let s3Client = null;

if (!s3Endpoint || !s3AccessKeyId || !s3SecretAccessKey) {
  logger.warn('Supabase S3 configuration missing, file storage uploads will be skipped');
} else {
  s3Client = new S3Client({
    endpoint: s3Endpoint,
    region: s3Region,
    credentials: {
      accessKeyId: s3AccessKeyId,
      secretAccessKey: s3SecretAccessKey
    },
    forcePathStyle: true // Required for Supabase S3 compatibility
  });
  logger.info('S3 client initialized for Supabase Storage', {
    endpoint: s3Endpoint,
    region: s3Region,
    bucket: supabaseBucket
  });
}

/**
 * Store a file buffer in Supabase Storage (via S3 API) and compute a deterministic SHA-256 hash.
 *
 * @param {Object} params
 * @param {Buffer} params.buffer - Raw file bytes
 * @param {string} [params.contentDocumentId] - Salesforce ContentDocument Id
 * @param {string} [params.fileName] - Original file name
 * @param {string} [params.contentType] - MIME type
 * @returns {Promise<{ hash: string, storage: { bucket: string, path: string } | null }>}
 */
async function storeFileAndHash({ buffer, contentDocumentId, fileName, contentType }) {
  if (!buffer || !buffer.length) {
    throw new Error('File buffer is required for storage and hashing');
  }

  // Deterministic SHA-256 hash over raw bytes
  const hashHex = crypto.createHash('sha256').update(buffer).digest('hex');
  const hash = `0x${hashHex}`;

  if (!s3Client) {
    logger.warn('S3 client not initialized, skipping upload but returning hash', {
      contentDocumentId
    });
    return {
      hash,
      storage: null
    };
  }

  const safeDocId = contentDocumentId || 'unknown';
  const safeFileName = fileName && fileName.trim().length > 0
    ? fileName.replace(/[^A-Za-z0-9._-]/g, '_')
    : `${safeDocId}.bin`;

  const path = `${safeDocId}/${safeFileName}`;

  logger.info('Uploading file to Supabase Storage via S3 API', {
    bucket: supabaseBucket,
    path,
    contentDocumentId: safeDocId
  });

  try {
    const command = new PutObjectCommand({
      Bucket: supabaseBucket,
      Key: path,
      Body: buffer,
      ContentType: contentType || 'application/octet-stream'
    });

    await s3Client.send(command);

    logger.info('S3 upload successful', {
      bucket: supabaseBucket,
      path
    });

    return {
      hash,
      storage: {
        bucket: supabaseBucket,
        path
      }
    };
  } catch (error) {
    logger.error('S3 upload failed', {
      error: error.message,
      errorCode: error.Code || error.name,
      bucket: supabaseBucket,
      path
    });
    throw new Error(`S3 upload failed: ${error.message}`);
  }
}

/**
 * Create a short-lived signed URL for a file stored in Supabase Storage (via S3 API).
 *
 * @param {Object} params
 * @param {string} params.path - Path of the file within the bucket
 * @param {number} [params.expiresIn] - Expiration in seconds (default: 3600)
 * @returns {Promise<{ url: string }>} Signed URL payload
 */
async function createSignedFileUrl({ path, expiresIn = 3600 }) {
  if (!s3Client) {
    throw new Error('S3 client not initialized, cannot create signed URL');
  }

  if (!path || typeof path !== 'string' || !path.trim()) {
    throw new Error('Path is required to create a signed URL');
  }

  const cleanedPath = path.trim();

  logger.info('Creating signed URL via S3 API', {
    bucket: supabaseBucket,
    path: cleanedPath,
    expiresIn
  });

  try {
    const command = new GetObjectCommand({
      Bucket: supabaseBucket,
      Key: cleanedPath
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn });

    logger.info('S3 signed URL created', {
      bucket: supabaseBucket,
      path: cleanedPath
    });

    return { url };
  } catch (error) {
    logger.error('S3 signed URL creation failed', {
      error: error.message,
      errorCode: error.Code || error.name,
      bucket: supabaseBucket,
      path: cleanedPath
    });
    throw new Error(`S3 signed URL creation failed: ${error.message}`);
  }
}

/**
 * Retrieve a file buffer from Supabase Storage (via S3 API)
 *
 * @param {string} path - File path in Supabase bucket (e.g., "recordId/filename.pdf")
 * @returns {Promise<{ buffer: Buffer, contentType: string, fileName: string }>}
 */
async function getSupabaseFileBuffer(path) {
  if (!s3Client) {
    throw new Error('S3 client not initialized, cannot retrieve file');
  }

  if (!path || typeof path !== 'string') {
    throw new Error('File path is required');
  }

  logger.info('Retrieving file from Supabase Storage via S3 API', {
    bucket: supabaseBucket,
    path
  });

  try {
    const command = new GetObjectCommand({
      Bucket: supabaseBucket,
      Key: path
    });

    const response = await s3Client.send(command);

    // Convert stream to buffer
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    const fileName = path.split('/').pop() || 'document';
    const contentType = response.ContentType || 'application/octet-stream';

    logger.info('File retrieved successfully from Supabase', {
      path,
      size: buffer.length,
      contentType
    });

    return {
      buffer,
      contentType,
      fileName
    };
  } catch (error) {
    logger.error('Failed to retrieve file from Supabase', {
      error: error.message,
      path
    });
    throw new Error(`Failed to retrieve file from storage: ${error.message}`);
  }
}

module.exports = {
  storeFileAndHash,
  createSignedFileUrl,
  getSupabaseFileBuffer
};
