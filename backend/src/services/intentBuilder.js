const crypto = require('crypto');

function buildTransactionIntent(options = {}) {
    const delegate = options.delegate || process.env.TARGET_CONTRACT_OWNER || process.env.SENDER_ADDRESS || '';
    const nowSeconds = Math.floor(Date.now() / 1000);
    const deadlineSeconds = nowSeconds + (options.ttlSeconds || 3600);
    const nonceSource = `${delegate}:${nowSeconds}:${Math.random()}`;

    const idHash = crypto.createHash('sha256').update(nonceSource).digest('hex');

    const appSecret = process.env.APP_SECRET || process.env.JWT_SECRET || 'test_secret_for_development';
    const signatureHash = crypto
        .createHmac('sha256', appSecret)
        .update(idHash)
        .digest('hex');

    return {
        id: `0x${idHash}`,
        deadline: deadlineSeconds.toString(),
        signature: `0x${signatureHash}`,
        delegate
    };
}

module.exports = {
    buildTransactionIntent
};
