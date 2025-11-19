const express = require('express');
const { ViewerService } = require('../services/viewerService');
const { TokenService } = require('../services/tokenService');
const { SalesforceService } = require('../services/salesforceService');
const { logger } = require('../utils/logger');

const router = express.Router();
const viewerService = new ViewerService();
const tokenService = new TokenService();
const salesforceService = new SalesforceService();

/**
 * GET /view?token=...
 * Serve watermarked document with time-limited access
 */
router.get('/', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({
        error: 'Access token required'
      });
    }

    // Verify and decode token
    const tokenData = tokenService.verifyAccessToken(token);

    if (!tokenData) {
      return res.status(401).json({
        error: 'Invalid or expired token'
      });
    }

    logger.info(`Serving document for session ${tokenData.sessionId}`);

    // Fetch document from Salesforce
    const documentBuffer = await salesforceService.getDocumentContent(tokenData.fileId);

    if (!documentBuffer) {
      return res.status(404).json({
        error: 'Document not found'
      });
    }

    // Apply watermark
    const watermarkedDocument = await viewerService.applyWatermark(
      documentBuffer,
      {
        sessionId: tokenData.sessionId,
        accessorId: tokenData.accessorId,
        timestamp: new Date().toISOString(),
        docHash: tokenData.docHash
      }
    );

    // Set appropriate headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="document.pdf"');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // Stream watermarked document
    res.send(watermarkedDocument);

  } catch (error) {
    logger.error('Document viewing error:', error);

    if (error.message.includes('token')) {
      return res.status(401).json({
        error: 'Token verification failed',
        details: error.message
      });
    }

    res.status(500).json({
      error: 'Failed to serve document',
      details: error.message
    });
  }
});

/**
 * GET /view/preview?token=...
 * Serve document preview/thumbnail (future enhancement)
 */
router.get('/preview', async (req, res) => {
  try {
    const { token } = req.query;

    const tokenData = tokenService.verifyAccessToken(token);
    if (!tokenData) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Generate preview
    const preview = await viewerService.generatePreview(tokenData.fileId);

    res.setHeader('Content-Type', 'image/png');
    res.send(preview);

  } catch (error) {
    logger.error('Preview generation error:', error);
    res.status(500).json({
      error: 'Failed to generate preview',
      details: error.message
    });
  }
});

module.exports = router;