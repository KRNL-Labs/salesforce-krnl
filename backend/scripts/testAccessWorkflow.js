/*
 * Standalone script to test the KRNL document access logging workflow.
 *
 * Usage:
 *   node scripts/testAccessWorkflow.js <documentHash> <userId> <recordId> [accessType] [clientIP] [userAgent]
 *
 * Example:
 *   node scripts/testAccessWorkflow.js 0xabc123... 005xxxxxxxxxxxx view 127.0.0.1 "Salesforce_LWC_Test"
 */

require('dotenv').config();

const path = require('path');
const axios = require('axios');
const { buildTransactionIntent4337 } = require('../src/services/eip4337IntentBuilder');
const { initSmartAccountFromEnv } = require('../src/services/eip4337AccountService');

const workflowTemplate = require(path.join(__dirname, '..', '..', 'workflows', 'document-access-logging-workflow.json'));

// Simple template processor: recursively replace all {{PLACEHOLDER}} tokens in string values
function applyReplacements(node, replacements) {
  if (node === null || node === undefined) {
    return node;
  }

  if (typeof node === 'string') {
    let result = node;
    for (const [key, value] of Object.entries(replacements)) {
      if (result.includes(key)) {
        result = result.split(key).join(String(value));
      }
    }
    return result;
  }

  if (Array.isArray(node)) {
    return node.map((item) => applyReplacements(item, replacements));
  }

  if (typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] = applyReplacements(v, replacements);
    }
    return out;
  }

  return node;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.error('Usage: node scripts/testAccessWorkflow.js <documentHash> <userId> <recordId> [accessType] [clientIP] [userAgent]');
    process.exit(1);
  }

  const [documentHash, userId, recordId, accessTypeArg, clientIPArg, userAgentArg] = args;
  const accessType = accessTypeArg || 'view';
  const clientIP = clientIPArg || '127.0.0.1';
  const userAgent = userAgentArg || 'KRNL_Access_Workflow_Test';

  console.log('--- KRNL Access Workflow Test (JSON-RPC) ---');
  console.log('KRNL_NODE_URL             :', process.env.KRNL_NODE_URL);
  console.log('DOCUMENT_REGISTRY_CONTRACT:', process.env.DOCUMENT_REGISTRY_CONTRACT);
  console.log('SENDER_ADDRESS            :', process.env.SENDER_ADDRESS);
  console.log('ATTESTOR_ADDRESS          :', process.env.ATTESTOR_ADDRESS);
  console.log('SALESFORCE_INSTANCE_URL   :', process.env.SALESFORCE_INSTANCE_URL);
  console.log('SALESFORCE_ACCESS_TOKEN   :', process.env.SALESFORCE_ACCESS_TOKEN ? '[SET]' : '[NOT SET]');
  console.log('documentHash              :', documentHash);
  console.log('userId                    :', userId);
  console.log('recordId                  :', recordId);
  console.log('accessType                :', accessType);
  console.log('clientIP                  :', clientIP);
  console.log('userAgent                 :', userAgent);
  console.log('-------------------------------------------');

  if (!process.env.KRNL_NODE_URL) {
    console.error('KRNL_NODE_URL is not set in backend/.env');
    process.exit(1);
  }

  // Initialize EIP-4337 smart account from EOA so SENDER_ADDRESS is the smart account
  console.log('\n> Initializing EIP-4337 smart account from env...');
  const saInfo = await initSmartAccountFromEnv();
  if (!saInfo || !saInfo.smartAccountAddress) {
    console.error('Failed to initialize smart account. Check RPC_SEPOLIA_URL / FACTORY_ADDRESS / APP_SECRET / EOA_PRIVATE_KEY in backend/.env');
    process.exit(1);
  }
  console.log('Smart account address     :', saInfo.smartAccountAddress);
  console.log('Smart account deployed    :', saInfo.isDeployed);

  // 1) Build transaction intent using the same EIP-4337 pattern as client-eoa-eip4337.ts
  console.log('\n> Building KRNL transaction intent via buildTransactionIntent4337...');
  const intent = await buildTransactionIntent4337({
    targetContract: process.env.DOCUMENT_REGISTRY_CONTRACT,
    functionSignature: 'logDocumentAccessKRNL((uint256,uint256,bytes32,(bytes32,bytes,bytes)[],bytes,bool,bytes))'
  });

  console.log('Intent:', {
    id: intent.id,
    deadline: intent.deadline,
    delegate: intent.delegate,
    nonce: intent.nonce,
    nodeAddress: intent.nodeAddress,
    functionSelector: intent.functionSelector
  });

  // 2) Prepare replacements for the workflow template (same style as executeWorkflowFromTemplate)
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

  console.log('\n> Applying template replacements to document-access-logging-workflow.json...');
  const dsl = applyReplacements(workflowTemplate, replacements);

  console.log('\nFinal DSL to send to krnl_executeWorkflow:');
  console.log(JSON.stringify(dsl, null, 2));

  // 3) Call KRNL node via JSON-RPC krnl_executeWorkflow
  console.log('\n> Calling KRNL node krnl_executeWorkflow...');
  let executeResponse;
  try {
    executeResponse = await axios.post(process.env.KRNL_NODE_URL, {
      jsonrpc: '2.0',
      method: 'krnl_executeWorkflow',
      params: [dsl],
      id: 1
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 60000
    });
  } catch (err) {
    console.error('❌ Error calling krnl_executeWorkflow');
    console.error(err && err.response ? err.response.data : err);
    process.exit(1);
  }

  console.log('krnl_executeWorkflow response:');
  console.log(JSON.stringify(executeResponse.data, null, 2));

  const intentId = executeResponse.data?.result?.intentId;
  if (!intentId) {
    console.error('❌ No intentId returned from krnl_executeWorkflow');
    process.exit(1);
  }

  console.log('\n> Polling krnl_workflowStatus for intentId:', intentId);

  const maxPollMs = Number(process.env.KRNL_POLL_TIMEOUT_MS || '60000');
  const intervalMs = 3000;
  const startTime = Date.now();

  // 4) Poll workflow status until completion or timeout
  // We mirror the basic logic from useWorkflowExecution: just log status codes
  while (true) {
    const elapsed = Date.now() - startTime;
    if (elapsed > maxPollMs) {
      console.error(`❌ Workflow status polling timed out after ${maxPollMs}ms`);
      break;
    }

    let statusResponse;
    try {
      statusResponse = await axios.post(process.env.KRNL_NODE_URL, {
        jsonrpc: '2.0',
        method: 'krnl_workflowStatus',
        params: [intentId],
        id: 1
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000
      });
    } catch (err) {
      console.error('❌ Error calling krnl_workflowStatus');
      console.error(err && err.response ? err.response.data : err);
      break;
    }

    console.log('krnl_workflowStatus response:');
    console.log(JSON.stringify(statusResponse.data, null, 2));

    const code = statusResponse.data?.result?.code;
    if (code === undefined || code === null) {
      console.log('   (no status code yet, continuing to poll...)');
    } else {
      console.log('   Status code:', code);
      // For now we just stop on any non-processing code. Exact numeric values are
      // defined in WorkflowStatusCode in the SDK; this is just for manual testing.
      if (code !== 1 && code !== 2) { // assume 1/2 are PENDING/PROCESSING-like
        console.log('   Stopping polling due to terminal/non-processing status code');
        break;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

main().catch((err) => {
  console.error('\n❌ Unhandled error in testAccessWorkflow');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
