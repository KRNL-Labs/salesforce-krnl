const { logger } = require('../utils/logger');
const axios = require('axios');

class KRNLService {
  constructor() {
    this.nodeUrl = process.env.KRNL_NODE_URL || 'https://node.krnl.xyz';
    this.sessions = new Map(); // In-memory storage for testing
    this.mockMode = process.env.NODE_ENV === 'development' || process.env.MOCK_KRNL === 'true';
  }

  /**
   * Start compliance workflow via KRNL
   */
  async startComplianceWorkflow(params) {
    const { recordId, fileId, docHash, callbackUrl } = params;
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    logger.info(`Starting compliance workflow for record: ${recordId}, session: ${sessionId}`);

    if (this.mockMode) {
      return this._mockComplianceWorkflow(sessionId, params);
    }

    try {
      // In production, this would call the actual KRNL node
      const workflowTemplate = require('../../workflows/document-registration-workflow.json');

      const workflowParams = {
        ENV: {
          SENDER_ADDRESS: process.env.SENDER_ADDRESS,
          DOCUMENT_REGISTRY_CONTRACT: process.env.DOCUMENT_REGISTRY_CONTRACT,
          ATTESTOR_ADDRESS: process.env.ATTESTOR_ADDRESS
        },
        DOCUMENT_ID: fileId,
        DOCUMENT_HASH: docHash,
        SALESFORCE_ACCESS_TOKEN: process.env.SALESFORCE_ACCESS_TOKEN,
        SALESFORCE_INSTANCE_URL: process.env.SALESFORCE_INSTANCE_URL,
        USER_SIGNATURE: 'mock_signature_for_testing'
      };

      // Mock KRNL API call
      const response = await this._callKRNLNode('executeWorkflow', {
        workflow: workflowTemplate,
        parameters: workflowParams,
        sessionId
      });

      // Store session
      this.sessions.set(sessionId, {
        sessionId,
        recordId,
        fileId,
        docHash,
        status: 'RUNNING',
        startedAt: new Date().toISOString(),
        workflowId: response.workflowId
      });

      return {
        sessionId,
        workflowId: response.workflowId,
        status: 'RUNNING',
        estimatedDuration: '2-5 minutes'
      };

    } catch (error) {
      logger.error('Failed to start compliance workflow:', error);
      throw new Error(`KRNL workflow failed: ${error.message}`);
    }
  }

  /**
   * Start access logging workflow via KRNL
   */
  async startAccessWorkflow(params) {
    const { documentHash, userId, accessType, sessionId, clientIP, userAgent } = params;

    logger.info(`Starting access workflow for document: ${documentHash}, user: ${userId}`);

    if (this.mockMode) {
      return this._mockAccessWorkflow(sessionId, params);
    }

    try {
      const workflowTemplate = require('../../workflows/document-access-logging-workflow.json');

      const workflowParams = {
        ENV: {
          SENDER_ADDRESS: process.env.SENDER_ADDRESS,
          DOCUMENT_REGISTRY_CONTRACT: process.env.DOCUMENT_REGISTRY_CONTRACT,
          ATTESTOR_ADDRESS: process.env.ATTESTOR_ADDRESS
        },
        DOCUMENT_ID: documentHash.replace('0x', ''), // Remove 0x prefix for Salesforce ID
        DOCUMENT_HASH: documentHash,
        ACCESS_TYPE: accessType,
        USER_ID: userId,
        CLIENT_IP: clientIP,
        USER_AGENT: userAgent,
        SALESFORCE_ACCESS_TOKEN: process.env.SALESFORCE_ACCESS_TOKEN,
        SALESFORCE_INSTANCE_URL: process.env.SALESFORCE_INSTANCE_URL,
        CURRENT_TIMESTAMP: new Date().toISOString()
      };

      const response = await this._callKRNLNode('executeWorkflow', {
        workflow: workflowTemplate,
        parameters: workflowParams,
        sessionId
      });

      return {
        sessionId,
        workflowId: response.workflowId,
        status: 'RUNNING',
        txHash: null // Will be updated when workflow completes
      };

    } catch (error) {
      logger.error('Failed to start access workflow:', error);
      throw new Error(`KRNL access workflow failed: ${error.message}`);
    }
  }

  /**
   * Start integrity validation workflow
   */
  async startIntegrityWorkflow(params) {
    const { documentHash, documentId } = params;
    const sessionId = `integrity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    logger.info(`Starting integrity validation for document: ${documentHash}`);

    if (this.mockMode) {
      return this._mockIntegrityWorkflow(sessionId, params);
    }

    try {
      const workflowTemplate = require('../../workflows/document-integrity-validation-workflow.json');

      const workflowParams = {
        ENV: {
          SENDER_ADDRESS: process.env.SENDER_ADDRESS,
          DOCUMENT_REGISTRY_CONTRACT: process.env.DOCUMENT_REGISTRY_CONTRACT,
          ATTESTOR_ADDRESS: process.env.ATTESTOR_ADDRESS
        },
        DOCUMENT_ID: documentId,
        DOCUMENT_HASH: documentHash,
        SALESFORCE_ACCESS_TOKEN: process.env.SALESFORCE_ACCESS_TOKEN,
        SALESFORCE_INSTANCE_URL: process.env.SALESFORCE_INSTANCE_URL,
        CURRENT_TIMESTAMP: new Date().toISOString()
      };

      const response = await this._callKRNLNode('executeWorkflow', {
        workflow: workflowTemplate,
        parameters: workflowParams,
        sessionId
      });

      return {
        sessionId,
        workflowId: response.workflowId,
        status: 'RUNNING'
      };

    } catch (error) {
      logger.error('Failed to start integrity workflow:', error);
      throw new Error(`KRNL integrity workflow failed: ${error.message}`);
    }
  }

  /**
   * Get workflow status
   */
  async getWorkflowStatus(sessionId) {
    logger.info(`Getting workflow status for session: ${sessionId}`);

    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (this.mockMode) {
      return this._getMockWorkflowStatus(sessionId, session);
    }

    try {
      // In production, query KRNL node for workflow status
      const response = await this._callKRNLNode('getWorkflowStatus', {
        sessionId,
        workflowId: session.workflowId
      });

      // Update session with latest status
      session.status = response.status;
      session.result = response.result;
      session.txHash = response.txHash;
      session.updatedAt = new Date().toISOString();

      return {
        sessionId,
        state: response.status,
        result: response.result,
        txHash: response.txHash,
        timestamp: session.updatedAt,
        progress: response.progress || {}
      };

    } catch (error) {
      logger.error('Failed to get workflow status:', error);
      throw new Error(`Failed to check workflow status: ${error.message}`);
    }
  }

  /**
   * Mock compliance workflow for testing
   */
  _mockComplianceWorkflow(sessionId, params) {
    logger.info(`Mock compliance workflow started: ${sessionId}`);

    // Simulate workflow execution
    this.sessions.set(sessionId, {
      sessionId,
      ...params,
      status: 'RUNNING',
      startedAt: new Date().toISOString(),
      workflowId: `mock_workflow_${sessionId}`
    });

    // Simulate completion after delay
    setTimeout(() => {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.status = 'COMPLETED';
        session.result = {
          complianceStatus: 'COMPLIANT',
          riskScore: Math.floor(Math.random() * 30) + 10,
          checks: [
            { name: 'File Type Check', status: 'PASSED' },
            { name: 'Content Scan', status: 'PASSED' },
            { name: 'Signature Verification', status: 'PASSED' }
          ]
        };
        session.txHash = `0x${Math.random().toString(16).substr(2, 64)}`;
        session.completedAt = new Date().toISOString();
        this.sessions.set(sessionId, session);
      }
    }, 3000); // Complete after 3 seconds

    return {
      sessionId,
      workflowId: `mock_workflow_${sessionId}`,
      status: 'RUNNING',
      estimatedDuration: '3 seconds (mock)'
    };
  }

  /**
   * Mock access workflow for testing
   */
  _mockAccessWorkflow(sessionId, params) {
    logger.info(`Mock access workflow started: ${sessionId}`);

    // Simulate immediate completion for access logging
    const txHash = `0x${Math.random().toString(16).substr(2, 64)}`;

    setTimeout(() => {
      const session = {
        sessionId,
        ...params,
        status: 'COMPLETED',
        result: {
          accessLogged: true,
          complianceStatus: 'COMPLIANT'
        },
        txHash,
        completedAt: new Date().toISOString()
      };
      this.sessions.set(sessionId, session);
    }, 1000); // Complete after 1 second

    return {
      sessionId,
      workflowId: `mock_access_${sessionId}`,
      status: 'RUNNING',
      txHash: null // Will be set when completed
    };
  }

  /**
   * Mock integrity workflow for testing
   */
  _mockIntegrityWorkflow(sessionId, params) {
    logger.info(`Mock integrity workflow started: ${sessionId}`);

    setTimeout(() => {
      const session = {
        sessionId,
        ...params,
        status: 'COMPLETED',
        result: {
          integrityStatus: Math.random() > 0.2 ? 'VALID' : 'TAMPERED',
          hashMatch: Math.random() > 0.2,
          confidenceScore: Math.floor(Math.random() * 20) + 80,
          anomalies: Math.random() > 0.8 ? ['Timestamp mismatch'] : []
        },
        completedAt: new Date().toISOString()
      };
      this.sessions.set(sessionId, session);
    }, 2000); // Complete after 2 seconds

    return {
      sessionId,
      workflowId: `mock_integrity_${sessionId}`,
      status: 'RUNNING'
    };
  }

  /**
   * Get mock workflow status
   */
  _getMockWorkflowStatus(sessionId, session) {
    const now = new Date();
    const started = new Date(session.startedAt);
    const elapsed = now - started;

    // If enough time has passed, mark as completed
    if (elapsed > 3000 && session.status === 'RUNNING') {
      session.status = 'COMPLETED';
      session.completedAt = new Date().toISOString();
    }

    return {
      sessionId,
      state: session.status,
      result: session.result || null,
      txHash: session.txHash || null,
      timestamp: session.completedAt || session.startedAt,
      progress: {
        currentStep: session.status === 'COMPLETED' ? 'completed' : 'processing',
        totalSteps: 5,
        completedSteps: session.status === 'COMPLETED' ? 5 : Math.floor(elapsed / 600)
      }
    };
  }

  /**
   * Call KRNL node (mocked for testing)
   */
  async _callKRNLNode(method, params) {
    if (this.mockMode) {
      logger.info(`Mock KRNL call: ${method}`, params);
      return {
        workflowId: `mock_${Date.now()}`,
        status: 'ACCEPTED',
        sessionId: params.sessionId
      };
    }

    try {
      const response = await axios.post(`${this.nodeUrl}/api/workflows/${method}`, params, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.KRNL_API_KEY}`
        },
        timeout: 30000
      });

      return response.data;

    } catch (error) {
      logger.error(`KRNL node call failed: ${method}`, error.message);
      throw error;
    }
  }

  /**
   * Generate time-limited access token for document viewing
   */
  generateAccessToken(params) {
    const { documentHash, userId, sessionId, accessType } = params;
    const jwt = require('jsonwebtoken');

    const payload = {
      documentHash,
      userId,
      sessionId,
      accessType,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (15 * 60) // 15 minutes expiry
    };

    const secret = process.env.JWT_SECRET || 'test_secret_for_development';
    return jwt.sign(payload, secret);
  }

  /**
   * Verify access token
   */
  verifyAccessToken(token) {
    const jwt = require('jsonwebtoken');
    const secret = process.env.JWT_SECRET || 'test_secret_for_development';

    try {
      return jwt.verify(token, secret);
    } catch (error) {
      logger.error('Token verification failed:', error);
      throw new Error('Invalid or expired access token');
    }
  }
}

module.exports = KRNLService;