const { logger } = require('../utils/logger');
const { ethers } = require('ethers');
const axios = require('axios');

/**
 * Fetch KRNL node config via JSON-RPC krnl_getConfig (same pattern as client-eoa-eip4337.ts)
 */
async function getKRNLNodeConfig() {
  const nodeUrl = process.env.KRNL_NODE_URL;

  if (!nodeUrl) {
    throw new Error('KRNL_NODE_URL is not set');
  }

  try {
    const payload = {
      jsonrpc: '2.0',
      method: 'krnl_getConfig',
      params: [],
      id: 1
    };

    const response = await axios.post(nodeUrl, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Failed to fetch node config: ${response.status} ${response.statusText}`);
    }

    const data = response.data;

    if (!data || !data.result) {
      throw new Error('Invalid response from KRNL node: missing result');
    }

    // Handle both old and new formats (mirrors client-eoa-eip4337.ts)
    if (data.result.workflow && data.result.workflow.node_address) {
      return {
        nodeAddress: data.result.workflow.node_address,
        executorImages: data.result.workflow.executor_images || []
      };
    }

    if (data.result.nodeAddress) {
      return data.result;
    }

    throw new Error(`Unexpected KRNL node response format: ${JSON.stringify(data.result)}`);
  } catch (error) {
    logger.warn('Failed to get KRNL node config, using fallback', { error: error.message });
    return {
      nodeAddress: process.env.FALLBACK_NODE_ADDRESS || '0xb18e8F975b8AF9717d74b753f8ba357c0d77Eb06',
      executorImages: []
    };
  }
}

/**
 * Get contract nonce for intent generation (mirrors getContractNonce in client)
 */
async function getContractNonce(targetContractAddress, senderAddress, provider) {
  const noncesAbi = [
    'function nonces(address account) view returns (uint256)'
  ];

  try {
    const contract = new ethers.Contract(targetContractAddress, noncesAbi, provider);
    const nonce = await contract.nonces(senderAddress);
    return nonce; // BigNumber
  } catch (error) {
    logger.warn('Could not read contract nonce, using timestamp-based nonce', {
      error: error.message
    });
    const nowSeconds = Math.floor(Date.now() / 1000);
    return ethers.BigNumber.from(nowSeconds);
  }
}

/**
 * Compute function selector from full function signature (same as getFunctionSelector in client script)
 */
function getFunctionSelector(functionSignature) {
  const hash = ethers.utils.keccak256(Buffer.from(functionSignature));
  return hash.slice(0, 10); // 4-byte selector as 0x-prefixed hex
}

/**
 * Build and sign KRNL transaction intent using the exact EIP-4337 pattern from client-eoa-eip4337.ts.
 *
 * Returns an object compatible with existing intentBuilder output, plus extra debugging fields.
 */
async function buildTransactionIntent4337(options = {}) {
  const rpcUrl = process.env.RPC_SEPOLIA_URL || process.env.RPC_URL;
  const eoaPrivateKey = process.env.EOA_PRIVATE_KEY || process.env.CLIENT_PRIVATE_KEY;
  const senderAddress = process.env.SENDER_ADDRESS;
  const delegateAddress = process.env.TARGET_CONTRACT_OWNER || senderAddress;
  const targetContract = options.targetContract || process.env.DOCUMENT_REGISTRY_CONTRACT;
  const functionSignature = options.functionSignature;
  const ttlSeconds = options.ttlSeconds || 3600;

  if (!rpcUrl || !eoaPrivateKey || !senderAddress || !delegateAddress || !targetContract || !functionSignature) {
    throw new Error('Missing required EIP-4337 intent environment or options');
  }

  const provider = ethers.providers?.JsonRpcProvider
    ? new ethers.providers.JsonRpcProvider(rpcUrl)
    : new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(eoaPrivateKey, provider);

  const nodeConfig = await getKRNLNodeConfig();

  const nonce = await getContractNonce(targetContract, senderAddress, provider);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const deadlineSeconds = nowSeconds + ttlSeconds;
  const deadline = ethers.BigNumber.from(deadlineSeconds);

  const functionSelector = getFunctionSelector(functionSignature);

  // Intent ID: keccak256(abi.encodePacked(sender, nonce, deadline))
  const intentId = ethers.utils.solidityKeccak256(
    ['address', 'uint256', 'uint256'],
    [senderAddress, nonce, deadline]
  );

  // Full intent hash: keccak256(abi.encodePacked(target, value, id, nodeAddress, delegate, targetFunction, nonce, deadline))
  const value = ethers.BigNumber.from(0);

  const intentHash = ethers.utils.solidityKeccak256(
    ['address', 'uint256', 'bytes32', 'address', 'address', 'bytes4', 'uint256', 'uint256'],
    [targetContract, value, intentId, nodeConfig.nodeAddress, delegateAddress, functionSelector, nonce, deadline]
  );

  const signature = await wallet.signMessage(ethers.utils.arrayify(intentHash));

  logger.info('Built EIP-4337 transaction intent', {
    senderAddress,
    delegateAddress,
    targetContract,
    nodeAddress: nodeConfig.nodeAddress,
    nonce: nonce.toString(),
    deadline: deadline.toString(),
    intentId,
    functionSelector
  });

  return {
    id: intentId,
    deadline: deadline.toString(),
    signature,
    delegate: delegateAddress,
    // extra fields (not sent directly to KRNL DSL but useful for debugging)
    nonce: nonce.toString(),
    nodeAddress: nodeConfig.nodeAddress,
    functionSelector
  };
}

module.exports = {
  buildTransactionIntent4337
};
