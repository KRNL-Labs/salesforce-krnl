require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - ${req.ip}`);
  next();
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
app.listen(PORT, () => {
  console.log(`🚀 KRNL Compliance Server running on port ${PORT}`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  console.log(`📋 Compliance API: http://localhost:${PORT}/api/compliance/check`);
  console.log(`🔐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('');
  console.log('Ready for ngrok! Run: ngrok http 3000');
});

module.exports = app;