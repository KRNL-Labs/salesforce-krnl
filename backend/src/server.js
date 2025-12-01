require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const path = require('path');
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
// Configure helmet with relaxed CSP for secure viewer
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // Allow same-origin and inline scripts for secure viewer
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"], // Allow data URLs and blobs for PDF rendering
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false // Required for PDF.js worker
}));
// CORS is handled by Caddy reverse proxy, not by Express
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

// Static assets for secure viewer: serve pdf.js (once installed) and viewer JS/CSS from this app
// These paths are compatible with a strict Content-Security-Policy of script-src 'self'.
// __dirname is /src, so public assets live in ../public at the project root.
app.use('/pdfjs', express.static(path.join(__dirname, '../node_modules/pdfjs-dist/build')));
app.use(express.static(path.join(__dirname, '../public')));

// Secure HTML viewer that wraps /api/view. This page only references same-origin scripts
// (no inline JS, no external CDNs) so it respects script-src 'self'.
app.get('/secure-viewer', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Secure Document Viewer</title>
  <link rel="stylesheet" href="/secure-viewer.css" />
</head>
<body>
  <div id="root">
    <div id="toolbar">
      <div id="title">Secure Document Viewer</div>
      <div>
        <span id="expiry" style="margin-right: 8px; font-size: 12px; opacity: 0.8;"></span>
        <button id="themeToggle" type="button">Dark mode</button>
      </div>
    </div>
    <div id="content">
      <div id="loadingState">
        <div class="spinner"></div>
        <div id="loadingLabel" class="loading-label">Loading document...</div>
      </div>
      <div id="message"></div>
      <div id="canvas-container">
        <canvas id="pdfCanvas"></canvas>
      </div>

      <div id="passwordOverlay">
        <div class="password-dialog">
          <div class="password-title">Password required</div>
          <div class="password-subtitle">This document is protected. Enter the password to continue.</div>
          <div class="password-input-row">
            <input id="passwordInput" type="password" autocomplete="off" placeholder="Enter password" />
            <button id="passwordToggle" type="button" aria-label="Show password">Show</button>
          </div>
          <div id="passwordError" class="password-error"></div>
          <div class="password-actions">
            <button id="passwordSubmit" type="button">Unlock</button>
          </div>
        </div>
      </div>
      <div id="screenshotShield">
        <div class="shield-noise"></div>
        <div class="shield-message">Protected document screenshots are not allowed</div>
      </div>
    </div>
  </div>

  <script type="module" src="/secure-viewer.js"></script>
</body>
</html>`);
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

// Document viewer endpoint with JWT token authentication
// Accepts a time-limited JWT token from /api/access, retrieves file from Supabase,
// watermarks PDFs with the on-chain accessHash, and streams the content
app.get('/api/view', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Access token is required'
      });
    }

    // Verify and decode JWT token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-super-secret-jwt-key-for-development');
    } catch (err) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired access token'
      });
    }

    const {
      documentHash,
      sessionId,
      documentId: tokenDocumentId,
      documentPath: tokenDocumentPath,
      recordId: tokenRecordId,
      accessHash: tokenAccessHash
    } = decoded;

    if (!documentHash || !sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Invalid token payload'
      });
    }

    // Start by trusting the file path and accessHash embedded in the token.
    let filePath = tokenDocumentPath || tokenDocumentId || tokenRecordId || null;
    let accessHash = tokenAccessHash || null;

    // For older tokens (or if claims are missing), fall back to KRNL
    // in-memory sessions to resolve filePath/accessHash.
    if (!filePath || !accessHash) {
      const KRNLService = require('./services/krnlService');
      const krnlService = new KRNLService();

      let session;
      try {
        const statusResult = await krnlService.getWorkflowStatus(sessionId);
        session = krnlService.sessions.get(sessionId);

        const sessionFilePath = session && (session.documentPath || session.documentId || session.recordId);
        const sessionAccessHash = (session && session.accessHash) || (statusResult && statusResult.accessHash) || null;

        if (!sessionFilePath || !sessionAccessHash) {
          return res.status(404).json({
            success: false,
            error: 'Session not found or missing file path/accessHash'
          });
        }

        filePath = filePath || sessionFilePath;
        accessHash = accessHash || sessionAccessHash;
      } catch (err) {
        logger.warn('Failed to retrieve session for viewer', { sessionId, error: err.message });

        // If we still don't have enough information to serve the file, treat
        // this as an expired session. Otherwise, fall through and use the
        // token-derived values we already have.
        if (!filePath || !accessHash) {
          return res.status(404).json({
            success: false,
            error: 'Session not found or expired'
          });
        }
      }
    }

    // At this point we must have a filePath and accessHash to proceed.
    if (!filePath || !accessHash) {
      return res.status(404).json({
        success: false,
        error: 'Session not found or missing file path/accessHash'
      });
    }

    logger.info('Document viewer accessed', {
      documentHash,
      sessionId,
      filePath,
      accessHash: accessHash.substring(0, 10) + '...'
    });

    // Retrieve file from Supabase
    const { getSupabaseFileBuffer } = require('./services/fileStorageService_s3');
    const { buffer, contentType, fileName } = await getSupabaseFileBuffer(filePath);

    // If PDF, try to watermark it with the accessHash. If anything fails
    // (including encrypted PDFs), fall back to streaming the original file.
    if (contentType === 'application/pdf' || fileName?.endsWith('.pdf')) {
      try {
        const { PDFDocument, rgb, degrees, StandardFonts } = require('pdf-lib');

        // Use ignoreEncryption so encrypted PDFs can still be loaded. If
        // this or any later step fails, we will just stream the original.
        const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
        const pages = pdfDoc.getPages();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

        // Watermark text: full hash only
        const watermarkText = accessHash;
        const forensicText = `KRNL:${accessHash}:${documentHash || ''}:${sessionId || ''}`;

        for (const page of pages) {
          const { width, height } = page.getSize();

          // Calculate diagonal and font size to span corner to corner
          const diagonal = Math.sqrt(width * width + height * height);
          const margin = 100;
          const targetLength = Math.max(0, diagonal - 2 * margin);

          // Calculate font size based on text length
          const baseWidth = font.widthOfTextAtSize(watermarkText, 1);
          let fontSize = baseWidth > 0 ? targetLength / baseWidth : 20;
          fontSize = Math.max(14, Math.min(28, fontSize * 0.95));

          // Measure actual text dimensions
          const textWidth = font.widthOfTextAtSize(watermarkText, fontSize);
          const textHeight = font.heightAtSize(fontSize);

          // For 45-degree rotation, calculate position so text center aligns with page center
          // When rotated, we need to account for both x and y offsets
          const angleRad = Math.PI / 4; // 45 degrees
          const cos45 = Math.cos(angleRad);
          const sin45 = Math.sin(angleRad);

          // Calculate the center of the page
          const pageCenterX = width / 2;
          const pageCenterY = height / 2;

          // Calculate text center point (before rotation)
          const textCenterX = textWidth / 2;
          const textCenterY = textHeight / 2;

          // Apply rotation transformation to text center
          // Then calculate starting position so rotated text center aligns with page center
          const rotatedCenterX = textCenterX * cos45 - textCenterY * sin45;
          const rotatedCenterY = textCenterX * sin45 + textCenterY * cos45;

          const x = pageCenterX - rotatedCenterX;
          const y = pageCenterY - rotatedCenterY;

          page.drawText(watermarkText, {
            x,
            y,
            size: fontSize,
            font,
            color: rgb(0.5, 0.5, 0.5),
            opacity: 0.3,
            rotate: degrees(45)
          });

          page.drawText(forensicText, {
            x: 16,
            y: 16,
            size: 6,
            font,
            color: rgb(1, 1, 1),
            opacity: 0.02,
            rotate: degrees(0)
          });
        }

        const watermarkedPdfBytes = await pdfDoc.save();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${fileName || 'document.pdf'}"`);
        return res.send(Buffer.from(watermarkedPdfBytes));
      } catch (err) {
        // Watermarking is mandatory. If we cannot safely watermark the PDF
        // (for example, because it is encrypted or malformed), do NOT stream
        // the original document. Instead, return a clear error so the caller
        // knows this document cannot be viewed.
        logger.warn('Failed to watermark PDF; blocking viewer', { error: err.message });
        return res.status(422).json({
          success: false,
          error: 'Unable to watermark PDF document',
          details: err.message || 'The PDF may be encrypted or unsupported. Upload an unencrypted copy to view it.'
        });
      }
    }

    // For non-PDF files, stream as-is
    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${fileName || 'document'}"`);
    res.send(buffer);

  } catch (error) {
    logger.error('Document viewer error', { error: error.message, stack: error.stack });
    res.status(500).json({
      success: false,
      error: 'Failed to process viewer request',
      details: error.message
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