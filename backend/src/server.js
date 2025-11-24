require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { logger } = require('./utils/logger');
const complianceRouter = require('./controllers/complianceController');
const accessRouter = require('./controllers/accessController');
const { initSmartAccountFromEnv } = require('./services/eip4337AccountService');
const { storeFileAndHash, createSignedFileUrl } = require('./services/fileStorageService_s3');
const { validateSalesforceToken } = require('./middleware/auth');
const { registerDocumentDirect } = require('./services/directContractService');

const app = express();
const PORT = process.env.PORT || 3000;

// Raw body parser for binary file uploads (Apex + LWC)
// Use a broad type matcher so non-octet-stream content types (e.g. application/pdf)
// are still treated as raw binary for these specific routes.
const rawFileBody = express.raw({
  type: () => true,
  limit: process.env.MAX_FILE_UPLOAD_BYTES || '10485760' // 10 MB default
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging middleware
app.use((req, res, next) => {
  logger.info('Incoming HTTP request', {
    method: req.method,
    path: req.path,
    ip: req.ip
  });
  next();
});

// KRNL API routers (Salesforce integrations)
app.use('/api/compliance', complianceRouter);
app.use('/api/access', accessRouter);

// ---------------------------------------------------------------------------
// Direct upload session endpoints for LWC -> backend file uploads
// ---------------------------------------------------------------------------

// Initialize a direct upload session from Salesforce (Apex)
// Body: { recordId, userId? }
// Returns an uploadId and a short-lived uploadUrl that the LWC can call directly.
app.post('/api/uploads/init', validateSalesforceToken, (req, res) => {
  try {
    const { recordId, userId } = req.body || {};

    if (!recordId) {
      return res.status(400).json({
        success: false,
        error: 'recordId is required to initialize upload session'
      });
    }

    const effectiveUserId = userId
      || (req.user && (req.user.salesforceId || req.user.id))
      || null;

    const orgId = (req.tenant && req.tenant.orgId)
      || (req.user && req.user.orgId)
      || null;

    const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const secret = process.env.JWT_SECRET || 'test_secret_for_development';
    const expiresInSeconds = Number.parseInt(process.env.UPLOAD_TOKEN_TTL_SECONDS || '900', 10); // 15 minutes default

    const tokenPayload = {
      uploadId,
      recordId,
      userId: effectiveUserId,
      orgId
    };

    const token = jwt.sign(tokenPayload, secret, { expiresIn: expiresInSeconds });

    const baseUrl = process.env.PUBLIC_BASE_URL || '';
    const uploadPath = `/api/uploads/${uploadId}/file?token=${encodeURIComponent(token)}`;
    const uploadUrl = baseUrl ? `${baseUrl}${uploadPath}` : uploadPath;

    logger.info('Initialized direct upload session', {
      uploadId,
      recordId,
      userId: effectiveUserId,
      orgId,
      expiresInSeconds,
      baseUrlConfigured: !!baseUrl
    });

    res.json({
      success: true,
      uploadId,
      uploadUrl,
      uploadPath,
      expiresInSeconds
    });

  } catch (error) {
    logger.error('Failed to initialize upload session', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to initialize upload session'
    });
  }
});

// Direct binary upload endpoint for LWC
// Uses the signed token from /api/uploads/init to authorize the upload
app.put('/api/uploads/:uploadId/file', rawFileBody, async (req, res) => {
  try {
    const { uploadId } = req.params;
    const token = req.query.token;

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Missing upload token'
      });
    }

    const secret = process.env.JWT_SECRET || 'test_secret_for_development';
    let decoded;
    try {
      decoded = jwt.verify(token, secret);
    } catch (err) {
      logger.warn('Invalid or expired upload token', { error: err.message });
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired upload token'
      });
    }

    if (!decoded || decoded.uploadId !== uploadId) {
      return res.status(400).json({
        success: false,
        error: 'Upload token does not match uploadId'
      });
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'File body is required as application/octet-stream'
      });
    }

    const fileNameHeader = req.header('X-File-Name') || req.header('x-file-name');
    const fileName = fileNameHeader && fileNameHeader.trim().length > 0
      ? fileNameHeader
      : `upload-${uploadId}.bin`;

    const contentType = req.header('Content-Type') || req.header('content-type') || 'application/octet-stream';

    const recordId = decoded.recordId;
    const userId = decoded.userId;
    const orgId = decoded.orgId || null;

    const { hash, storage } = await storeFileAndHash({
      buffer: req.body,
      contentDocumentId: recordId,
      fileName,
      contentType
    });

    logger.info('Direct upload completed', {
      uploadId,
      recordId,
      userId,
      orgId,
      hash,
      storage
    });

    res.json({
      success: true,
      uploadId,
      recordId,
      userId,
      orgId,
      hash,
      storage
    });

  } catch (error) {
    logger.error('Direct upload failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to upload file'
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    service: 'KRNL Compliance Server'
  });
});

// Document compliance check endpoint
app.post('/api/compliance/check', (req, res) => {
  try {
    const { documentHash, documentMetadata, complianceRules } = req.body;

    if (!documentHash) {
      return res.status(400).json({
        success: false,
        error: 'Document hash is required'
      });
    }

    console.log('Processing compliance check for:', documentHash);

    // Simulate compliance checks
    const checks = [
      {
        name: 'File Type Validation',
        status: documentMetadata?.fileType ? 'PASSED' : 'FAILED',
        details: `File type: ${documentMetadata?.fileType || 'Unknown'}`
      },
      {
        name: 'File Size Check',
        status: (documentMetadata?.contentSize || 0) < 50000000 ? 'PASSED' : 'FAILED',
        details: `Size: ${documentMetadata?.contentSize || 0} bytes`
      },
      {
        name: 'Content Validation',
        status: Math.random() > 0.1 ? 'PASSED' : 'FAILED',
        details: 'Content scanned for compliance violations'
      }
    ];

    const failedChecks = checks.filter(check => check.status === 'FAILED');
    const complianceStatus = failedChecks.length === 0 ? 'COMPLIANT' : 'NON_COMPLIANT';
    const riskScore = failedChecks.length * 25 + Math.floor(Math.random() * 20);

    const result = {
      documentHash,
      complianceStatus,
      riskScore,
      timestamp: new Date().toISOString(),
      checks,
      summary: {
        totalChecks: checks.length,
        passed: checks.length - failedChecks.length,
        failed: failedChecks.length
      }
    };

    console.log('Compliance check result:', { documentHash, status: complianceStatus, riskScore });

    res.json({
      success: true,
      result
    });

  } catch (error) {
    console.error('Compliance check error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error during compliance check'
    });
  }
});

// File upload endpoint for Salesforce (Apex Blob)
// Accepts raw octet-stream body, stores it in Supabase (when configured), and returns a deterministic hash
app.post('/api/files/upload', rawFileBody, async (req, res) => {
  try {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'File body is required as application/octet-stream'
      });
    }

    const contentDocumentId = req.header('X-Content-Document-Id') || req.header('x-content-document-id') || null;
    const fileName = req.header('X-File-Name') || req.header('x-file-name') || null;
    const contentType = req.header('Content-Type') || req.header('content-type') || 'application/octet-stream';

    const { hash, storage } = await storeFileAndHash({
      buffer: req.body,
      contentDocumentId,
      fileName,
      contentType
    });

    logger.info('File uploaded and hashed successfully', {
      contentDocumentId,
      hash,
      storage
    });

    res.json({
      success: true,
      hash,
      storage
    });

  } catch (error) {
    logger.error('File upload + hash failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to upload and hash file'
    });
  }
});

// Viewer URL endpoint for Supabase-backed files
// Accepts a file path (and optional recordId for logging) and returns a short-lived signed URL
app.post('/api/files/viewer-url', validateSalesforceToken, async (req, res) => {
  try {
    const { path, recordId } = req.body || {};

    if (!path || typeof path !== 'string' || !path.trim()) {
      return res.status(400).json({
        success: false,
        error: 'path is required to create a viewer URL'
      });
    }

    const expiresIn = Number.parseInt(process.env.VIEWER_URL_TTL_SECONDS || '3600', 10); // 1 hour default

    const { url } = await createSignedFileUrl({
      path: path.trim(),
      expiresIn
    });

    logger.info('Generated viewer URL for Supabase file', {
      recordId: recordId || null,
      path: path.trim(),
      expiresIn
    });

    res.json({
      success: true,
      url,
      expiresIn
    });
  } catch (error) {
    logger.error('Failed to create viewer URL', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to create viewer URL'
    });
  }
});

// Direct document registration endpoint (bypasses KRNL workflow)
app.post('/api/documents/register-direct', validateSalesforceToken, async (req, res) => {
  try {
    const { documentHash, salesforceRecordId, metadata } = req.body || {};

    if (!documentHash || typeof documentHash !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'documentHash is required'
      });
    }

    if (!salesforceRecordId || typeof salesforceRecordId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'salesforceRecordId is required'
      });
    }

    logger.info('Direct document registration requested', {
      documentHash,
      salesforceRecordId,
      orgId: req.tenant?.orgId,
      userId: req.user?.userId
    });

    // Call contract directly
    const result = await registerDocumentDirect({
      documentHash,
      salesforceRecordId,
      metadata: metadata || '{}'
    });

    logger.info('Direct document registration successful', {
      documentHash,
      salesforceRecordId,
      txHash: result.txHash,
      blockNumber: result.blockNumber
    });

    res.json({
      success: true,
      txHash: result.txHash,
      blockNumber: result.blockNumber,
      gasUsed: result.gasUsed,
      documentHash,
      salesforceRecordId
    });

  } catch (error) {
    logger.error('Direct document registration failed', {
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      error: 'Failed to register document on blockchain',
      details: error.message
    });
  }
});

// Document hash generation endpoint
app.post('/api/document/hash', (req, res) => {
  try {
    const { content, metadata } = req.body;

    if (!content) {
      return res.status(400).json({
        success: false,
        error: 'Document content is required'
      });
    }

    // Generate SHA-256 hash
    const hash = crypto.createHash('sha256');

    // If content is base64, decode it first
    let documentContent;
    try {
      documentContent = Buffer.from(content, 'base64');
    } catch (e) {
      documentContent = Buffer.from(content, 'utf8');
    }

    hash.update(documentContent);

    // Include metadata in hash if provided
    if (metadata) {
      hash.update(JSON.stringify(metadata));
    }

    const documentHash = hash.digest('hex');

    console.log('Generated document hash:', documentHash);

    res.json({
      success: true,
      documentHash: `0x${documentHash}`,
      algorithm: 'SHA-256',
      includedMetadata: !!metadata,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Hash generation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate document hash'
    });
  }
});

// Access validation endpoint
app.post('/api/access/validate', (req, res) => {
  try {
    const { documentHash, userId, accessType, context } = req.body;

    if (!documentHash || !userId || !accessType) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: documentHash, userId, accessType'
      });
    }

    // Simulate access validation
    const validAccessTypes = ['view', 'download', 'modify'];
    const isValidAccessType = validAccessTypes.includes(accessType);
    const hasPermission = Math.random() > 0.05; // 95% success rate

    const validation = {
      documentHash,
      userId,
      accessType,
      hasPermission: isValidAccessType && hasPermission,
      permissionLevel: hasPermission ? ['READ', 'WRITE', 'FULL'][Math.floor(Math.random() * 3)] : 'NONE',
      validationTimestamp: new Date().toISOString(),
      context: context || {},
      restrictions: isValidAccessType && hasPermission ? [] : ['Invalid access type or insufficient permissions']
    };

    console.log('Access validation:', { documentHash, userId, accessType, hasPermission: validation.hasPermission });

    res.json({
      success: true,
      validation
    });

  } catch (error) {
    console.error('Access validation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to validate access'
    });
  }
});

// Integrity validation endpoint
app.post('/api/integrity/validate', (req, res) => {
  try {
    const { currentHash, storedHash, documentId } = req.body;

    if (!currentHash || !storedHash) {
      return res.status(400).json({
        success: false,
        error: 'Both current and stored hashes are required'
      });
    }

    const hashesMatch = currentHash.toLowerCase() === storedHash.toLowerCase();
    const integrityStatus = hashesMatch ? 'VALID' : 'COMPROMISED';
    const confidenceScore = hashesMatch ? 100 : 0;

    const validation = {
      documentId,
      currentHash,
      storedHash,
      hashesMatch,
      integrityStatus,
      confidenceScore,
      validationTimestamp: new Date().toISOString(),
      anomalies: hashesMatch ? [] : ['Hash mismatch detected'],
      recommendation: hashesMatch ? 'Document integrity verified' : 'Document may have been tampered with'
    };

    console.log('Integrity validation:', { documentId, hashesMatch, integrityStatus });

    res.json({
      success: true,
      validation
    });

  } catch (error) {
    console.error('Integrity validation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to validate document integrity'
    });
  }
});

// KRNL webhook endpoint for workflow results
app.post('/webhook/krnl', (req, res) => {
  try {
    console.log('KRNL webhook received:', JSON.stringify(req.body, null, 2));

    // Process webhook data
    const { workflowId, status, result, txHash } = req.body;

    // In a real implementation, you'd store this in a database
    // and potentially notify Salesforce of the completion

    res.json({
      success: true,
      message: 'Webhook processed successfully',
      workflowId,
      receivedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process webhook'
    });
  }
});

// Salesforce callback endpoint
app.post('/callback/salesforce', (req, res) => {
  try {
    console.log('Salesforce callback received:', JSON.stringify(req.body, null, 2));

    res.json({
      success: true,
      message: 'Salesforce callback processed',
      receivedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Salesforce callback error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process Salesforce callback'
    });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.originalUrl
  });
});

// Start server
async function startServer() {
  try {
    if (process.env.ENABLE_EIP4337_INIT === 'true') {
      await initSmartAccountFromEnv();
    }

    app.listen(PORT, () => {
      console.log(`🚀 KRNL Compliance Server running on port ${PORT}`);
      console.log(`🏥 Health check: http://localhost:${PORT}/health`);
      console.log(`📋 Compliance API: http://localhost:${PORT}/api/compliance/check`);
      console.log(`🔐 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log('');
      console.log('Ready for ngrok! Run: ngrok http 3000');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

module.exports = app;