// Simple helper to decode authData.result bytes as DocumentAccessParams
// Usage:
//   cd backend
//   node scripts/decodeAuthData.js 0x...

const { ethers } = require('ethers');

async function main() {
  const hex = process.argv[2];

  if (!hex) {
    console.error('Usage: node scripts/decodeAuthData.js <authDataResultHex>');
    process.exit(1);
  }

  if (!hex.startsWith('0x')) {
    console.error('Input must be a 0x-prefixed hex string');
    process.exit(1);
  }

  console.log('Raw authData.result hex:');
  console.log(hex);
  console.log('Length (bytes):', (hex.length - 2) / 2);

  // DocumentAccessParams struct in DocumentAccessRegistry.sol:
  // struct DocumentAccessParams {
  //     string accessType;
  //     string documentHash;
  //     string documentId;
  //     string ipAddress;
  //     string salesforceUserId;
  //     string userAgent;
  // }
  const types = [
    'tuple(string accessType,string documentHash,string documentId,string ipAddress,string salesforceUserId,string userAgent)'
  ];

  try {
    const decoded = ethers.utils.defaultAbiCoder.decode(types, hex);
    const params = decoded[0];

    console.log('\nDecoded DocumentAccessParams:');
    console.log('accessType       :', params.accessType);
    console.log('documentHash     :', params.documentHash);
    console.log('documentId       :', params.documentId);
    console.log('ipAddress        :', params.ipAddress);
    console.log('salesforceUserId :', params.salesforceUserId);
    console.log('userAgent        :', params.userAgent);
  } catch (err) {
    console.error('\n❌ Failed to decode as DocumentAccessParams');
    console.error(err && err.message ? err.message : err);
  }
}

main().catch((err) => {
  console.error('Unhandled error:', err && err.stack ? err.stack : err);
  process.exit(1);
});
