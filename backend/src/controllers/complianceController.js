const express = require('express');
const ComplianceService = require('../services/complianceService');
const KRNLService = require('../services/krnlService');
const { logger } = require('../utils/logger');

const router = express.Router();
const complianceService = new ComplianceService();
const krnlService = new KRNLService();

/**
 * POST /api/compliance
 * Triggers compliance check for a document
 * Body: { recordId, fileId, docHash, callbackUrl? }
 */
router.post('/', async (req, res) => {
  try {
    const { recordId, fileId, docHash, callbackUrl } = req.body;

    logger.debug('Incoming compliance request', {
      recordId,
      fileId,
      hasDocHash: !!docHash,
      hasCallbackUrl: !!callbackUrl
    });

    // Validate required fields
    if (!recordId || !fileId || !docHash) {
      return res.status(400).json({
        error: 'Missing required fields: recordId, fileId, docHash'
      });
    }

    logger.info('Starting compliance check', { recordId, fileId });

    // Start KRNL compliance workflow
    const workflowResult = await krnlService.startComplianceWorkflow({
      recordId,
      fileId,
      docHash,
      callbackUrl
    });

    // Store workflow session
    const sessionId = workflowResult.sessionId;

    // Option 2: block and wait for KRNL workflow completion before responding
    logger.info('Waiting for compliance workflow to complete', { sessionId });
    const status = await krnlService.getWorkflowStatus(sessionId);

    logger.info('Compliance workflow completed', {
      sessionId,
      state: status.state
    });

    res.status(200).json({
      sessionId,
      status: status.state,
      result: status.result,
      txHash: status.txHash,
      timestamp: status.timestamp,
      debug: status.debug
    });

  } catch (error) {
    logger.error('Compliance check error:', error);
    res.status(500).json({
      error: 'Failed to initiate compliance check',
      details: error.message
    });
  }
});

/**
 * GET /api/compliance/status/:sessionId
 * Check status of compliance workflow
 */
router.get('/status/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    logger.info('Compliance status requested', { sessionId });

    const status = await krnlService.getWorkflowStatus(sessionId);

    logger.info('Compliance status result', {
      sessionId,
      state: status.state
    });

    res.json({
      sessionId,
      status: status.state,
      result: status.result,
      txHash: status.txHash,
      timestamp: status.timestamp,
      debug: status.debug
    });

  } catch (error) {
    logger.error('Status check error:', error);
    res.status(500).json({
      error: 'Failed to get compliance status',
      details: error.message
    });
  }
});

module.exports = router;