const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { logger } = require('../utils/logger');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const supabaseBucket = process.env.SUPABASE_BUCKET || 'documents';

let supabase = null;

if (!supabaseUrl || !supabaseKey) {
  logger.warn('Supabase configuration missing (SUPABASE_URL / SUPABASE_SERVICE_KEY), file storage uploads will be skipped');
} else {
  supabase = createClient(supabaseUrl, supabaseKey);
}

/**
 * Store a file buffer in Supabase Storage and compute a deterministic SHA-256 hash.
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

  if (!supabase) {
    logger.warn('Supabase client not initialized, skipping upload but returning hash', {
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

  logger.info('Uploading file to Supabase Storage', {
    bucket: supabaseBucket,
    path,
    contentDocumentId: safeDocId
  });

  const { error } = await supabase
    .storage
    .from(supabaseBucket)
    .upload(path, buffer, {
      contentType: contentType || 'application/octet-stream',
      upsert: true
    });

  if (error) {
    logger.error('Supabase upload failed', {
      error: error.message,
      bucket: supabaseBucket,
      path
    });
    throw new Error(`Supabase upload failed: ${error.message}`);
  }

  return {
    hash,
    storage: {
      bucket: supabaseBucket,
      path
    }
  };
}

/**
 * Create a short-lived signed URL for a file stored in Supabase Storage.
 *
 * @param {Object} params
 * @param {string} params.path - Path of the file within the bucket
 * @param {number} [params.expiresIn] - Expiration in seconds (default: 3600)
 * @returns {Promise<{ url: string }>} Signed URL payload
 */
async function createSignedFileUrl({ path, expiresIn = 3600 }) {
  if (!supabase) {
    throw new Error('Supabase client not initialized, cannot create signed URL');
  }

  if (!path || typeof path !== 'string' || !path.trim()) {
    throw new Error('Path is required to create a signed URL');
  }

  const cleanedPath = path.trim();

  const { data, error } = await supabase
    .storage
    .from(supabaseBucket)
    .createSignedUrl(cleanedPath, expiresIn);

  if (error) {
    logger.error('Supabase createSignedUrl failed', {
      error: error.message,
      bucket: supabaseBucket,
      path: cleanedPath
    });
    throw new Error(`Supabase signed URL creation failed: ${error.message}`);
  }

  if (!data || !data.signedUrl) {
    throw new Error('Supabase did not return a signedUrl');
  }

  return { url: data.signedUrl };
}

module.exports = {
  storeFileAndHash,
  createSignedFileUrl
};
