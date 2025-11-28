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

    const salesforceInstanceUrl = req.header('X-Salesforce-Instance-Url') || (req.user && req.user.instanceUrl) || null;
    const salesforceAccessToken = req.header('X-Salesforce-Token') || null;

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
      documentId: finalDocumentId,
      salesforceInstanceUrl,
      salesforceAccessToken
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

    // Generate time-limited access token for document viewer. Include
    // document identifiers and accessHash so /api/view can resolve the
    // file even if in-memory KRNL sessions are no longer available.
    const accessToken = krnlService.generateAccessToken({
      documentHash,
      userId,
      sessionId,
      accessType,
      documentId: workflowStatus.documentId,
      documentPath: finalDocumentId,
      recordId,
      accessHash: workflowStatus.accessHash
    });

    // Build full viewer URL with backend base URL, pointing to the secure HTML viewer
    const baseUrl = process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const viewerUrl = `${baseUrl}/secure-viewer?token=${accessToken}`;

    // Return access token and workflow info after on-chain settlement
    res.status(200).json({
      success: true,
      accessHash: workflowStatus.accessHash,
      accessToken,
      documentId: workflowStatus.documentId,
      expiresIn: '60 minutes',
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
 * POST /api/access/init
 * Starts the access logging workflow and returns a sessionId and viewerSessionUrl
 * without waiting for on-chain completion. Intended for UIs (like the secure
 * viewer) that will poll session status and request a token separately.
 */
router.post('/init', validateSalesforceToken, async (req, res) => {
  try {
    const {
      documentHash,
      recordId,
      userId,
      accessType,
      clientIP,
      userAgent,
      documentId,
      accessLogId
    } = req.body || {};

    const salesforceInstanceUrl = req.header('X-Salesforce-Instance-Url') || (req.user && req.user.instanceUrl) || null;
    const salesforceAccessToken = req.header('X-Salesforce-Token') || null;

    logger.debug('Incoming access init request', {
      documentHash,
      recordId,
      userId,
      accessType,
      clientIP: clientIP || req.ip,
      userAgent: userAgent || req.get('User-Agent'),
      documentId,
      accessLogId
    });

    if (!documentHash || !recordId || !userId || !accessType) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: documentHash, recordId, userId, accessType'
      });
    }

    const validAccessTypes = ['view', 'download', 'modify'];
    if (!validAccessTypes.includes(accessType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid access type. Must be one of: ${validAccessTypes.join(', ')}`
      });
    }

    const sessionId = `access_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    logger.info('Initializing document access workflow', {
      documentHash,
      recordId,
      userId,
      accessType,
      sessionId
    });

    const finalDocumentId = documentId || recordId;

    const workflowStart = await krnlService.startAccessWorkflow({
      documentHash,
      recordId,
      userId,
      accessType,
      sessionId,
      clientIP: clientIP || req.ip,
      userAgent: userAgent || req.get('User-Agent'),
      documentId: finalDocumentId,
      accessLogId,
      salesforceInstanceUrl,
      salesforceAccessToken
    });

    logger.info('KRNL access workflow started (init)', {
      sessionId,
      workflowId: workflowStart.workflowId,
      status: workflowStart.status
    });

    const baseUrl = process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const viewerSessionUrl = `${baseUrl}/secure-viewer?sessionId=${encodeURIComponent(sessionId)}`;

    res.status(200).json({
      success: true,
      sessionId,
      documentHash,
      recordId,
      accessType,
      workflowId: workflowStart.workflowId,
      state: workflowStart.status || 'RUNNING',
      viewerSessionUrl
    });

  } catch (error) {
    logger.error('Document access init error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to initialize access logging workflow',
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
      documentId: sessionStatus.documentId,
      accessHash: sessionStatus.accessHash,
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

/**
 * GET /api/access/public-session/:sessionId
 * Public access session status for secure viewer polling (no Salesforce auth).
 */
router.get('/public-session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    logger.info('Public access session status requested', { sessionId });

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
    logger.error('Public session status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get session status',
      details: error.message
    });
  }
});

/**
 * POST /api/access/token
 * Generate a viewer access token for a completed access logging session.
 */
router.post('/token', async (req, res) => {
  try {
    const { sessionId } = req.body || {};

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'sessionId is required'
      });
    }

    const session = krnlService.sessions && krnlService.sessions.get
      ? krnlService.sessions.get(sessionId)
      : null;

    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }

    const okStates = ['COMPLETED', 'COMPLETED_WITH_EVENT'];
    if (!okStates.includes(session.status) || !session.accessHash || !session.documentId) {
      return res.status(202).json({
        success: false,
        ready: false,
        status: session.status || 'PENDING'
      });
    }

    const accessToken = krnlService.generateAccessToken({
      documentHash: session.documentHash,
      userId: session.userId,
      sessionId,
      accessType: session.accessType,
      documentId: session.documentId,
      documentPath: session.documentPath || session.documentId || session.recordId,
      recordId: session.recordId,
      accessHash: session.accessHash
    });

    const baseUrl = process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

    res.json({
      success: true,
      ready: true,
      sessionId,
      status: session.status,
      accessToken,
      viewerUrl: `${baseUrl}/secure-viewer?token=${accessToken}`,
      txHash: session.txHash || null
    });

  } catch (error) {
    logger.error('Access token generation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate access token',
      details: error.message
    });
  }
});

module.exports = router;