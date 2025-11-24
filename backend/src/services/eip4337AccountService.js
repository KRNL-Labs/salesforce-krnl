const { logger } = require('../utils/logger');
const { ethers } = require('ethers');

/**
 * Initialize EIP-4337 smart account for the backend using the factory + EOA pattern.
 *
 * On success, this will:
 * - Resolve the deterministic smart account address from the factory
 * - Verify whether the smart account is deployed
 * - Set process.env.SENDER_ADDRESS and process.env.TARGET_CONTRACT_OWNER
 *
 * This mirrors the logic in client-eoa-eip4337.ts but runs on the backend.
 */
async function initSmartAccountFromEnv() {
  const rpcUrl = process.env.RPC_SEPOLIA_URL || process.env.RPC_URL;
  const factoryAddress = process.env.FACTORY_ADDRESS;
  const appSecret = process.env.APP_SECRET;
  const eoaPrivateKey = process.env.EOA_PRIVATE_KEY || process.env.CLIENT_PRIVATE_KEY;

  if (!rpcUrl || !factoryAddress || !appSecret || !eoaPrivateKey) {
    logger.warn('EIP-4337 smart account init skipped: missing RPC_SEPOLIA_URL/FACTORY_ADDRESS/APP_SECRET/EOA_PRIVATE_KEY');
    return null;
  }

  logger.info('Initializing EIP-4337 smart account for backend', {
    rpcUrl,
    factoryAddress
  });

  const provider = ethers.providers?.JsonRpcProvider
    ? new ethers.providers.JsonRpcProvider(rpcUrl)
    : new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(eoaPrivateKey, provider);

  // Minimal ABI for getDelegatedAccountAddress(owner, salt)
  const factoryAbi = [
    'function getDelegatedAccountAddress(address owner, bytes32 salt) view returns (address)',
    'function createDelegatedAccount(address owner, bytes32 salt) returns (address)'
  ];

  const factory = new ethers.Contract(factoryAddress, factoryAbi, provider);
  const factoryWithSigner = factory.connect(wallet);

  // Calculate salt: keccak256(eoaAddress + appSecret)
  const saltInput = `${wallet.address}${appSecret}`;
  const saltBytes32 = ethers.utils.id(saltInput); // keccak256 of UTF-8 string

  const smartAccountAddress = await factory.getDelegatedAccountAddress(wallet.address, saltBytes32);

  // Check if the smart account is deployed
  const code = await provider.getCode(smartAccountAddress);
  const isDeployed = code && code !== '0x';

  logger.info('Resolved EIP-4337 smart account', {
    eoaAddress: wallet.address,
    smartAccountAddress,
    isDeployed
  });

  // Expose smart account as sender/owner for KRNL workflows
  process.env.SENDER_ADDRESS = smartAccountAddress;
  process.env.TARGET_CONTRACT_OWNER = smartAccountAddress;

  if (!isDeployed) {
    logger.warn('EIP-4337 smart account is not deployed. Attempting automatic deployment via factory.', {
      smartAccountAddress
    });

    try {
      const tx = await factoryWithSigner.createDelegatedAccount(wallet.address, saltBytes32);

      logger.info('Sent smart account deployment transaction', {
        txHash: tx.hash
      });

      const receipt = tx.wait
        ? await tx.wait()
        : await provider.waitForTransaction(tx.hash);

      logger.info('Smart account deployment transaction mined', {
        txHash: receipt.transactionHash || tx.hash,
        status: receipt.status
      });

      const codeAfter = await provider.getCode(smartAccountAddress);
      const isDeployedAfter = codeAfter && codeAfter !== '0x';

      logger.info('Post-deployment smart account status', {
        smartAccountAddress,
        isDeployed: isDeployedAfter
      });

      return {
        eoaAddress: wallet.address,
        smartAccountAddress,
        isDeployed: isDeployedAfter
      };
    } catch (error) {
      logger.error('Failed to auto-deploy EIP-4337 smart account via factory', {
        error: error.message
      });

      return {
        eoaAddress: wallet.address,
        smartAccountAddress,
        isDeployed: false
      };
    }
  }

  return {
    eoaAddress: wallet.address,
    smartAccountAddress,
    isDeployed
  };
}

module.exports = {
  initSmartAccountFromEnv
};
