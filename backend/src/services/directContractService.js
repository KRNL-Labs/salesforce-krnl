const { ethers } = require('ethers');
const { logger } = require('../utils/logger');

// Contract ABI for direct registration (no KRNL AuthData)
const DOCUMENT_REGISTRY_ABI = [
  'function registerDocumentDirect(string documentHash, string salesforceRecordId, string metadata) external',
  'event DocumentRegistered(string indexed documentHash, string salesforceRecordId, address registeredBy, uint256 timestamp)'
];

/**
 * Register a document directly on DocumentAccessRegistry contract
 * @param {Object} params
 * @param {string} params.documentHash - Document hash (0x prefixed hex)
 * @param {string} params.salesforceRecordId - Salesforce record ID
 * @param {string} params.metadata - JSON metadata string
 * @returns {Promise<{txHash: string, blockNumber: number}>}
 */
async function registerDocumentDirect({ documentHash, salesforceRecordId, metadata = '{}' }) {
  // Prefer existing KRNL env conventions:
  // - RPC_SEPOLIA_URL is already set in .env
  // - DOCUMENT_REGISTRY_CONTRACT holds the DocumentAccessRegistry address
  // Fall back to RPC_URL / TARGET_CONTRACT_ADDRESS if present.
  const rpcUrl = process.env.RPC_SEPOLIA_URL || process.env.RPC_URL;
  const contractAddress =
    process.env.DOCUMENT_REGISTRY_CONTRACT || process.env.TARGET_CONTRACT_ADDRESS;
  const eoaPrivateKey = process.env.EOA_PRIVATE_KEY || process.env.CLIENT_PRIVATE_KEY;

  if (!rpcUrl || !contractAddress || !eoaPrivateKey) {
    throw new Error(
      'Missing required environment variables: RPC_SEPOLIA_URL/RPC_URL, ' +
      'DOCUMENT_REGISTRY_CONTRACT/TARGET_CONTRACT_ADDRESS, ' +
      'and EOA_PRIVATE_KEY/CLIENT_PRIVATE_KEY'
    );
  }

  logger.info('Registering document directly on contract', {
    documentHash,
    salesforceRecordId,
    contractAddress
  });

  // Initialize provider and wallet
  const provider = ethers.providers?.JsonRpcProvider
    ? new ethers.providers.JsonRpcProvider(rpcUrl)
    : new ethers.JsonRpcProvider(rpcUrl);
  
  const wallet = new ethers.Wallet(eoaPrivateKey, provider);
  
  // Connect to contract
  const contract = new ethers.Contract(contractAddress, DOCUMENT_REGISTRY_ABI, wallet);

  // Send transaction directly (no KRNL auth)
  const tx = await contract.registerDocumentDirect(documentHash, salesforceRecordId, metadata);
  
  logger.info('Document registration transaction sent', {
    txHash: tx.hash,
    documentHash,
    salesforceRecordId
  });

  // Wait for confirmation
  const receipt = tx.wait
    ? await tx.wait()
    : await provider.waitForTransaction(tx.hash);

  logger.info('Document registration confirmed', {
    txHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber,
    documentHash,
    salesforceRecordId
  });

  return {
    txHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed?.toString()
  };
}

module.exports = {
  registerDocumentDirect
};
