const { logger } = require('../utils/logger');
const axios = require('axios');
const { ethers } = require('ethers');
const { buildTransactionIntent } = require('./intentBuilder');
const { buildTransactionIntent4337 } = require('./eip4337IntentBuilder');

// Shared sessions map across all KRNLService instances
const SHARED_SESSIONS = new Map();

class KRNLService {
  constructor() {
    this.nodeUrl = process.env.KRNL_NODE_URL || 'https://node.krnl.xyz';
    this.mockMode = process.env.MOCK_KRNL === 'true';
    this.sessions = SHARED_SESSIONS; // Use shared session storage

    logger.info('KRNLService initialized', {
      nodeUrl: this.nodeUrl,
      mockMode: this.mockMode
    });
  }

  /**
   * Apply simple string replacements recursively to a workflow template node.
   * Mirrors the applyReplacements helper in backend/scripts/testAccessWorkflow.js.
   */
  _applyReplacements(node, replacements) {
    if (node === null || typeof node === 'undefined') {
      return node;
    }

    if (typeof node === 'string') {
      let result = node;
      for (const [key, value] of Object.entries(replacements || {})) {
        if (result.includes(key)) {
          result = result.split(key).join(String(value));
        }
      }
      return result;
    }

    if (Array.isArray(node)) {
      return node.map((item) => this._applyReplacements(item, replacements));
    }

    if (typeof node === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(node)) {
        out[k] = this._applyReplacements(v, replacements);
      }
      return out;
    }

    return node;
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
      // In production, this calls the actual KRNL node using the workflow DSL
      const workflowTemplate = require('../../../workflows/document-registration-workflow.json');

      // Build transaction intent values for KRNL DSL placeholders using EIP-4337 pattern
      let intent;
      try {
        intent = await buildTransactionIntent4337({
          targetContract: process.env.DOCUMENT_REGISTRY_CONTRACT,
          functionSignature: 'registerDocumentKRNL((uint256,uint256,bytes32,(bytes32,bytes,bytes)[],bytes,bool,bytes))'
        });
      } catch (e) {
        logger.warn('Falling back to legacy intent builder for compliance workflow', { error: e.message });
        intent = buildTransactionIntent({
          delegate: process.env.TARGET_CONTRACT_OWNER || process.env.SENDER_ADDRESS
        });
      }

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
        CURRENT_TIMESTAMP: new Date().toISOString(),
        TRANSACTION_INTENT_DELEGATE: intent.delegate,
        TRANSACTION_INTENT_ID: intent.id,
        TRANSACTION_INTENT_DEADLINE: intent.deadline,
        USER_SIGNATURE: intent.signature
      };

      const { SALESFORCE_ACCESS_TOKEN, ...restParams } = workflowParams;
      const safeWorkflowParams = {
        ...restParams,
        SALESFORCE_ACCESS_TOKEN: SALESFORCE_ACCESS_TOKEN ? '[REDACTED]' : undefined
      };

      logger.debug('Prepared KRNL workflow DSL for compliance', {
        workflowName: 'document-registration-workflow.json',
        workflowParameters: safeWorkflowParams
      });

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
        workflowId: response.workflowId,
        debug: {
          workflowName: 'document-registration-workflow.json',
          workflowTemplate,
          workflowParameters: safeWorkflowParams,
          pollingHistory: []
        }
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
    const { documentHash, userId, accessType, sessionId, clientIP, userAgent, recordId, documentId } = params;

    logger.info(`Starting access workflow for document: ${documentHash}, user: ${userId}, record: ${recordId}`);

    if (this.mockMode) {
      return this._mockAccessWorkflow(sessionId, params);
    }

    try {
      const workflowTemplate = require('../../../workflows/document-access-logging-workflow.json');

      let intent;
      try {
        intent = await buildTransactionIntent4337({
          targetContract: process.env.DOCUMENT_REGISTRY_CONTRACT,
          functionSignature: 'logDocumentAccessKRNL((uint256,uint256,bytes32,(bytes32,bytes,bytes)[],bytes,bool,bytes))'
        });
      } catch (e) {
        logger.warn('Falling back to legacy intent builder for access workflow', { error: e.message });
        intent = buildTransactionIntent({
          delegate: process.env.TARGET_CONTRACT_OWNER || process.env.SENDER_ADDRESS
        });
      }

      const workflowParams = {
        ENV: {
          SENDER_ADDRESS: process.env.SENDER_ADDRESS,
          DOCUMENT_REGISTRY_CONTRACT: process.env.DOCUMENT_REGISTRY_CONTRACT,
          ATTESTOR_ADDRESS: process.env.ATTESTOR_ADDRESS
        },
        DOCUMENT_ID: recordId,
        RECORD_ID: recordId,
        DOCUMENT_HASH: documentHash,
        ACCESS_TYPE: accessType,
        USER_ID: userId,
        CLIENT_IP: clientIP,
        USER_AGENT: userAgent,
        SALESFORCE_ACCESS_TOKEN: process.env.SALESFORCE_ACCESS_TOKEN,
        SALESFORCE_INSTANCE_URL: process.env.SALESFORCE_INSTANCE_URL,
        CURRENT_TIMESTAMP: new Date().toISOString(),
        TRANSACTION_INTENT_DELEGATE: intent.delegate,
        TRANSACTION_INTENT_ID: intent.id,
        TRANSACTION_INTENT_DEADLINE: intent.deadline,
        USER_SIGNATURE: intent.signature
      };

      const { SALESFORCE_ACCESS_TOKEN, ...restParams } = workflowParams;
      const safeWorkflowParams = {
        ...restParams,
        SALESFORCE_ACCESS_TOKEN: SALESFORCE_ACCESS_TOKEN ? '[REDACTED]' : undefined
      };

      // Build a concrete DSL by applying replacements, matching testAccessWorkflow.js
      const replacements = {
        '{{ENV.SENDER_ADDRESS}}': process.env.SENDER_ADDRESS || '',
        '{{ENV.DOCUMENT_REGISTRY_CONTRACT}}': process.env.DOCUMENT_REGISTRY_CONTRACT || '',
        '{{ENV.ATTESTOR_ADDRESS}}': process.env.ATTESTOR_ADDRESS || '',
        '{{TRANSACTION_INTENT_DELEGATE}}': intent.delegate,
        '{{TRANSACTION_INTENT_ID}}': intent.id,
        '{{TRANSACTION_INTENT_DEADLINE}}': intent.deadline,
        '{{USER_SIGNATURE}}': intent.signature,
        '{{DOCUMENT_HASH}}': documentHash,
        '{{RECORD_ID}}': recordId,
        '{{ACCESS_TYPE}}': accessType,
        '{{USER_ID}}': userId,
        '{{CLIENT_IP}}': clientIP,
        '{{USER_AGENT}}': userAgent,
        '{{SALESFORCE_INSTANCE_URL}}': process.env.SALESFORCE_INSTANCE_URL || '',
        '{{SALESFORCE_ACCESS_TOKEN}}': process.env.SALESFORCE_ACCESS_TOKEN || ''
      };

      const dsl = this._applyReplacements(workflowTemplate, replacements);

      logger.debug('Prepared KRNL workflow DSL for access logging', {
        workflowName: 'document-access-logging-workflow.json',
        workflowParameters: safeWorkflowParams,
        dsl
      });

      const executeResponse = await axios.post(this.nodeUrl, {
        jsonrpc: '2.0',
        method: 'krnl_executeWorkflow',
        params: [dsl],
        id: 1
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 60000
      });

      const executeData = executeResponse && executeResponse.data ? executeResponse.data : null;
      if (executeData && executeData.error) {
        throw new Error(`KRNL executeWorkflow error: ${executeData.error.code} ${executeData.error.message}`);
      }

      const intentId = executeData && executeData.result ? executeData.result.intentId : null;
      if (!intentId) {
        throw new Error('KRNL executeWorkflow did not return an intentId');
      }

      // Store session so callers can poll for completion / on-chain settlement via JSON-RPC
      this.sessions.set(sessionId, {
        sessionId,
        documentHash,
        // Supabase/S3 file path used by /api/view
        documentPath: documentId || null,
        // Salesforce record ID (on-chain documentId)
        recordId,
        userId,
        accessType,
        clientIP,
        userAgent,
        status: 'RUNNING',
        startedAt: new Date().toISOString(),
        intentId,
        useJsonRpc: true,
        debug: {
          workflowName: 'document-access-logging-workflow.json',
          workflowTemplate,
          workflowParameters: safeWorkflowParams,
          dsl,
          pollingHistory: []
        }
      });

      return {
        sessionId,
        workflowId: intentId,
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
      const workflowTemplate = require('../../../workflows/document-integrity-validation-workflow.json');

      let intent;
      try {
        intent = await buildTransactionIntent4337({
          targetContract: process.env.DOCUMENT_REGISTRY_CONTRACT,
          // Integrity validation still uses the same AuthData pattern
          functionSignature: 'registerDocumentKRNL((uint256,uint256,bytes32,(bytes32,bytes,bytes)[],bytes,bool,bytes))'
        });
      } catch (e) {
        logger.warn('Falling back to legacy intent builder for integrity workflow', { error: e.message });
        intent = buildTransactionIntent({
          delegate: process.env.TARGET_CONTRACT_OWNER || process.env.SENDER_ADDRESS
        });
      }

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
        CURRENT_TIMESTAMP: new Date().toISOString(),
        TRANSACTION_INTENT_DELEGATE: intent.delegate,
        TRANSACTION_INTENT_ID: intent.id,
        TRANSACTION_INTENT_DEADLINE: intent.deadline,
        USER_SIGNATURE: intent.signature
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

  async _pollKRNLWorkflowUntilComplete(sessionId, workflowId, timeoutMs = 30000, intervalMs = 2000) {
    const startTime = Date.now();
    let lastStatus = null;

    const envTimeout = process.env.KRNL_POLL_TIMEOUT_MS
      ? parseInt(process.env.KRNL_POLL_TIMEOUT_MS, 10)
      : NaN;
    const effectiveTimeoutMs = Number.isFinite(envTimeout) && envTimeout > 0
      ? envTimeout
      : timeoutMs;

    // Poll KRNL node until workflow reaches a terminal state or timeout
    // This keeps the polling logic on the server side, similar to the facilitator client.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const elapsed = Date.now() - startTime;
      if (elapsed > effectiveTimeoutMs) {
        const status = lastStatus && lastStatus.status ? lastStatus.status : 'UNKNOWN';
        throw new Error(`Workflow polling timed out after ${effectiveTimeoutMs}ms (last status: ${status})`);
      }

      const response = await this._callKRNLNode('getWorkflowStatus', {
        sessionId,
        workflowId
      });

      lastStatus = response;
      const session = this.sessions.get(sessionId);
      if (session && session.debug && Array.isArray(session.debug.pollingHistory)) {
        session.debug.pollingHistory.push({
          timestamp: new Date().toISOString(),
          status: response.status,
          raw: response
        });
      }
      const statusUpper = (response.status || '').toUpperCase();

      if (statusUpper === 'COMPLETED' || statusUpper === 'FAILED' || statusUpper === 'CANCELLED') {
        return response;
      }

      logger.info('KRNL workflow still in progress', {
        sessionId,
        workflowId,
        status: response.status,
        elapsedMs: elapsed
      });

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  /**
   * Poll KRNL workflow status via JSON-RPC krnl_workflowStatus (used for access logging)
   */
  async _pollKRNLWorkflowStatusJsonRpc(intentId, timeoutMs = 30000, intervalMs = 2000, session) {
    const startTime = Date.now();
    let lastResult = null;

    const envTimeout = process.env.KRNL_POLL_TIMEOUT_MS
      ? parseInt(process.env.KRNL_POLL_TIMEOUT_MS, 10)
      : NaN;
    const effectiveTimeoutMs = Number.isFinite(envTimeout) && envTimeout > 0
      ? envTimeout
      : timeoutMs;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const elapsed = Date.now() - startTime;
      if (elapsed > effectiveTimeoutMs) {
        const code = lastResult && typeof lastResult.code !== 'undefined' ? lastResult.code : 'UNKNOWN';
        let lastSummary = '';
        if (lastResult) {
          try {
            lastSummary = JSON.stringify(lastResult);
          } catch (e) {
            lastSummary = String(lastResult);
          }
        }
        throw new Error(
          `Workflow polling (JSON-RPC) timed out after ${effectiveTimeoutMs}ms (last code: ${code}, last result: ${lastSummary})`
        );
      }

      const resp = await axios.post(this.nodeUrl, {
        jsonrpc: '2.0',
        method: 'krnl_workflowStatus',
        params: [intentId],
        id: 1
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000
      });

      const data = resp && resp.data ? resp.data : null;
      if (data && data.error) {
        throw new Error(`KRNL workflowStatus error: ${data.error.code} ${data.error.message}`);
      }

      const result = data && data.result ? data.result : null;
      lastResult = result;

      const code = result && typeof result.code !== 'undefined' ? result.code : undefined;

      if (session && session.debug && Array.isArray(session.debug.pollingHistory)) {
        session.debug.pollingHistory.push({
          timestamp: new Date().toISOString(),
          code,
          raw: result
        });
      }

      logger.debug('KRNL JSON-RPC workflow status poll result', {
        intentId,
        code,
        elapsedMs: elapsed,
        raw: result
      });

      // Interpret workflow status codes according to SDK:
      // 0 = PENDING, 1 = PROCESSING, 2 = SUCCESS, >=3 = error states
      if (code === undefined || code === null || code === 0 || code === 1) {
        logger.info('KRNL JSON-RPC workflow still in progress', {
          intentId,
          code,
          elapsedMs: elapsed
        });
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        continue;
      }

      logger.info('KRNL JSON-RPC workflow reached terminal status', {
        intentId,
        code,
        elapsedMs: elapsed,
        raw: result
      });

      const txHash = result && (result.txHash || result.transactionHash) ? (result.txHash || result.transactionHash) : null;
      let status = 'UNKNOWN';

      if (code === 2) {
        status = 'COMPLETED';
      } else if (code === 3) {
        status = 'FAILED';
      } else if (code === 4) {
        status = 'INTENT_NOT_FOUND';
      } else if (code === 5) {
        status = 'WORKFLOW_NOT_FOUND';
      } else if (code === 6) {
        status = 'INVALID';
      } else if (result && typeof result.status === 'string') {
        status = result.status;
      } else if (txHash) {
        status = 'COMPLETED';
      } else {
        status = 'FAILED';
      }

      return {
        status,
        txHash,
        result
      };
    }
  }

  /**
   * Wait for the on-chain transaction to be mined and confirm a DocumentAccessLogged event.
   * This provides an additional assurance layer beyond KRNL SUCCESS code.
   */
  async _waitForDocumentAccessLogged(txHash, documentHash) {
    if (!txHash) {
      logger.warn('No txHash provided to _waitForDocumentAccessLogged; will rely solely on event logs', {
        documentHash
      });
    }

    const rpcUrl = process.env.RPC_SEPOLIA_URL || process.env.RPC_URL;
    const contractAddress =
      process.env.DOCUMENT_REGISTRY_CONTRACT || process.env.TARGET_CONTRACT_ADDRESS;

    if (!rpcUrl || !contractAddress) {
      throw new Error('RPC URL or contract address not configured for DocumentAccessLogged confirmation');
    }

    // Minimal ABI for the event we care about
    const DOCUMENT_ACCESS_ABI = [
      'event DocumentAccessLogged(string documentHash, address accessor, string salesforceUserId, string accessType, string documentId, bytes32 accessHash, uint256 timestamp)'
    ];

    logger.info('Waiting for DocumentAccessLogged event', {
      txHash,
      documentHash,
      contractAddress
    });

    const provider = ethers.providers?.JsonRpcProvider
      ? new ethers.providers.JsonRpcProvider(rpcUrl)
      : new ethers.JsonRpcProvider(rpcUrl);

    // We don't reliably get a txHash back from KRNL's JSON-RPC API, so we
    // poll for the DocumentAccessLogged event around the current block and
    // derive the txHash from the event log itself.

    // Search a wide window to ensure we catch the event even if it was emitted
    // before we started polling. On testnets, blocks are fast, so go back further.
    const currentBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, currentBlock - 10000); // ~30 min on fast testnets

    const iface = new ethers.utils.Interface(DOCUMENT_ACCESS_ABI);
    const eventTopic = iface.getEventTopic('DocumentAccessLogged');

    const timeoutMs = 60000;
    const intervalMs = 3000;
    const deadline = Date.now() + timeoutMs;

    while (true) {
      if (Date.now() > deadline) {
        throw new Error('Timed out waiting for DocumentAccessLogged event');
      }

      const logs = await provider.getLogs({
        address: contractAddress,
        fromBlock,
        toBlock: 'latest',
        topics: [eventTopic]
      });

      logger.debug('Polled for DocumentAccessLogged events', {
        fromBlock,
        currentBlock: await provider.getBlockNumber(),
        logsFound: logs.length,
        targetDocumentHash: documentHash
      });

      for (const log of logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed && parsed.name === 'DocumentAccessLogged') {
            const loggedHash = parsed.args.documentHash;
            logger.debug('Found DocumentAccessLogged event', {
              loggedHash,
              targetHash: documentHash,
              blockNumber: log.blockNumber,
              txHash: log.transactionHash
            });
            if (!documentHash || loggedHash === documentHash) {
              const documentIdFromEvent = parsed.args.documentId;
              const accessHashFromEvent = parsed.args.accessHash;

              logger.info('DocumentAccessLogged event confirmed on-chain', {
                txHashFromEvent: log.transactionHash,
                blockNumber: log.blockNumber,
                documentHash: loggedHash,
                documentId: documentIdFromEvent,
                accessHash: accessHashFromEvent
              });

              return {
                eventConfirmed: true,
                reason: 'ok',
                txHash: log.transactionHash,
                blockNumber: log.blockNumber,
                documentId: documentIdFromEvent,
                accessHash: accessHashFromEvent
              };
            }
          }
        } catch (e) {
          // Not our event, ignore
        }
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
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
      let statusObj;
      if (session.useJsonRpc && session.intentId) {
        statusObj = await this._pollKRNLWorkflowStatusJsonRpc(session.intentId, undefined, undefined, session);
      } else {
        statusObj = await this._pollKRNLWorkflowUntilComplete(sessionId, session.workflowId);
      }

      // Update session with latest status from KRNL
      session.status = statusObj.status;
      session.result = statusObj.result;
      let txHash = statusObj.txHash
        || (statusObj.result && (statusObj.result.txHash || statusObj.result.transactionHash))
        || null;

      // For access logging workflows using JSON-RPC, wait for the on-chain
      // DocumentAccessLogged event. KRNL's JSON-RPC API does not currently
      // return a transaction hash from krnl_workflowStatus, so we derive the
      // txHash (and capture documentId/accessHash) from the event logs instead.
      if (session.useJsonRpc && session.documentHash && session.status === 'COMPLETED') {
        const eventResult = await this._waitForDocumentAccessLogged(txHash, session.documentHash);
        if (eventResult && eventResult.eventConfirmed) {
          session.status = 'COMPLETED_WITH_EVENT';
          if (eventResult.txHash) {
            txHash = eventResult.txHash;
          }
          if (eventResult.documentId) {
            session.documentId = eventResult.documentId;
          }
          if (eventResult.accessHash) {
            session.accessHash = eventResult.accessHash;
          }
        }
      }

      session.txHash = txHash;
      session.updatedAt = new Date().toISOString();

      return {
        sessionId,
        state: session.status,
        result: session.result,
        txHash,
        documentId: session.documentId || null,
        accessHash: session.accessHash || null,
        timestamp: session.updatedAt,
        progress: statusObj.progress || {},
        debug: session.debug || null
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

    // Seed session so getWorkflowStatus can find it immediately
    this.sessions.set(sessionId, {
      sessionId,
      ...params,
      status: 'RUNNING',
      startedAt: new Date().toISOString(),
      workflowId: `mock_access_${sessionId}`
    });

    // Simulate completion for access logging
    const txHash = `0x${Math.random().toString(16).substr(2, 64)}`;

    setTimeout(() => {
      const session = this.sessions.get(sessionId) || {
        sessionId,
        ...params
      };
      session.status = 'COMPLETED';
      session.result = {
        accessLogged: true,
        complianceStatus: 'COMPLIANT'
      };
      session.txHash = txHash;
      session.completedAt = new Date().toISOString();
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
    logger.info('Preparing KRNL node call', {
      method,
      mockMode: this.mockMode,
      nodeUrl: this.nodeUrl,
      sessionId: params && params.sessionId
    });

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
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      logger.info('KRNL node call succeeded', {
        method,
        sessionId: params && params.sessionId,
        status: response.data && response.data.status
      });

      logger.debug('KRNL node response payload', {
        method,
        sessionId: params && params.sessionId,
        data: response.data
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