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
      userAgent,
      documentId
    } = req.body;

    logger.debug('Incoming access log request', {
      documentHash,
      recordId,
      userId,
      accessType,
      clientIP: clientIP || req.ip,
      userAgent: userAgent || req.get('User-Agent'),
      documentId
    });

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

    logger.info('Logging document access', {
      documentHash,
      recordId,
      userId,
      accessType,
      sessionId
    });

    // Start KRNL access logging workflow
    // Use documentId from request if provided (file path), otherwise fall back to recordId
    const finalDocumentId = documentId || recordId;
    
    logger.debug('Starting workflow with documentId', {
      documentIdFromRequest: documentId,
      recordId,
      finalDocumentId
    });
    
    const workflowStart = await krnlService.startAccessWorkflow({
      documentHash,
      recordId,
      userId,
      accessType,
      sessionId,
      clientIP: clientIP || req.ip,
      userAgent: userAgent || req.get('User-Agent'),
      documentId: finalDocumentId
    });

    logger.info('KRNL access workflow started', {
      sessionId,
      workflowId: workflowStart.workflowId,
      status: workflowStart.status
    });

    // Wait for KRNL workflow completion and on-chain settlement (logDocumentAccessKRNL)
    let workflowStatus;
    try {
      workflowStatus = await krnlService.getWorkflowStatus(sessionId);
    } catch (pollError) {
      logger.error('KRNL access workflow polling failed', {
        sessionId,
        error: pollError.message
      });
      return res.status(500).json({
        success: false,
        error: 'Failed to complete access logging workflow',
        details: pollError.message
      });
    }

    logger.info('KRNL access workflow completed', {
      sessionId,
      state: workflowStatus.state,
      txHash: workflowStatus.txHash
    });

    const okStates = ['COMPLETED', 'COMPLETED_WITH_EVENT'];

    if (!okStates.includes(workflowStatus.state) || !workflowStatus.txHash) {
      return res.status(500).json({
        success: false,
        error: 'Access logging workflow did not complete successfully',
        state: workflowStatus.state,
        txHash: workflowStatus.txHash || null
      });
    }

    // Generate time-limited access token for document viewer
    const accessToken = krnlService.generateAccessToken({
      documentHash,
      userId,
      sessionId,
      accessType
    });

    // Build full viewer URL with backend base URL
    const baseUrl = process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const viewerUrl = `${baseUrl}/api/view?token=${accessToken}`;

    // Return access token and workflow info after on-chain settlement
    res.status(200).json({
      success: true,
      accessHash: workflowStatus.accessHash,
      accessToken,
      documentId: workflowStatus.documentId,
      expiresIn: '15 minutes',
      message: 'Document access logged on-chain',
      result: workflowStatus.result,
      sessionId,
      txHash: workflowStatus.txHash,
      viewerUrl,
      workflowStatus: workflowStatus.state
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

    logger.info('Access history requested', {
      documentHash,
      limit,
      offset
    });

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

    logger.info('Access session status requested', { sessionId });

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