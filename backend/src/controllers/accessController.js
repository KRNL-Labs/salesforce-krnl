const express = require('express');
const KRNLService = require('../services/krnlService');
const { validateSalesforceToken } = require('../middleware/auth');
const { logger } = require('../utils/logger');

const router = express.Router();
const krnlService = new KRNLService();

/**
 * POST /api/access
 * Logs document access and returns time-limited viewer URL
 * Body: { documentHash, recordId, userId, accessType, clientIP?, userAgent? }
 */
router.post('/', validateSalesforceToken, async (req, res) => {
  try {
    const {
      documentHash,
      recordId,
      userId,
      accessType,
      clientIP,
      userAgent
    } = req.body;

    // Validate required fields
    if (!documentHash || !recordId || !userId || !accessType) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: documentHash, recordId, userId, accessType'
      });
    }

    // Validate access type
    const validAccessTypes = ['view', 'download', 'modify'];
    if (!validAccessTypes.includes(accessType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid access type. Must be one of: ${validAccessTypes.join(', ')}`
      });
    }

    const sessionId = `access_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    logger.info(`Logging document access: ${documentHash} by ${userId}, type: ${accessType}`);

    // Start KRNL access logging workflow
    const workflowResult = await krnlService.startAccessWorkflow({
      documentHash,
      userId,
      accessType,
      sessionId,
      clientIP: clientIP || req.ip,
      userAgent: userAgent || req.get('User-Agent')
    });

    // Generate time-limited access token for document viewer
    const accessToken = krnlService.generateAccessToken({
      documentHash,
      userId,
      sessionId,
      accessType
    });

    // Return access token and workflow info
    res.status(201).json({
      success: true,
      sessionId,
      accessToken,
      viewerUrl: `/api/view?token=${accessToken}`,
      workflowStatus: workflowResult.status,
      expiresIn: '15 minutes',
      message: 'Document access logged successfully'
    });

  } catch (error) {
    logger.error('Document access logging error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to log document access',
      details: error.message
    });
  }
});

/**
 * GET /api/access/history/:documentHash
 * Get access history for a document
 */
router.get('/history/:documentHash', validateSalesforceToken, async (req, res) => {
  try {
    const { documentHash } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    // Mock access history (in production, query from database/blockchain)
    const accessHistory = [
      {
        id: 'access_001',
        documentHash,
        userId: 'user_001',
        userName: 'John Doe',
        accessType: 'view',
        timestamp: new Date(Date.now() - 3600000).toISOString(),
        sessionId: 'session_001',
        clientIP: '192.168.1.100',
        txHash: '0x1234567890abcdef',
        complianceStatus: 'COMPLIANT'
      },
      {
        id: 'access_002',
        documentHash,
        userId: 'user_002',
        userName: 'Jane Smith',
        accessType: 'download',
        timestamp: new Date(Date.now() - 7200000).toISOString(),
        sessionId: 'session_002',
        clientIP: '192.168.1.101',
        txHash: '0x2345678901bcdef1',
        complianceStatus: 'COMPLIANT'
      }
    ];

    res.json({
      success: true,
      data: {
        documentHash,
        accessHistory: accessHistory.slice(offset, offset + parseInt(limit)),
        total: accessHistory.length,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });

  } catch (error) {
    logger.error('Access history retrieval error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve access history',
      details: error.message
    });
  }
});

/**
 * GET /api/access/session/:sessionId
 * Get access session details and status
 */
router.get('/session/:sessionId', validateSalesforceToken, async (req, res) => {
  try {
    const { sessionId } = req.params;

    const sessionStatus = await krnlService.getWorkflowStatus(sessionId);

    res.json({
      success: true,
      sessionId,
      status: sessionStatus.state,
      result: sessionStatus.result,
      txHash: sessionStatus.txHash,
      timestamp: sessionStatus.timestamp,
      progress: sessionStatus.progress
    });

  } catch (error) {
    logger.error('Session status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get session status',
      details: error.message
    });
  }
});

module.exports = router;