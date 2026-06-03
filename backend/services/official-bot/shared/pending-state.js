const pendingReferralWalletInputs = new Map();
const pendingGiftCodeInputs = new Map();

function normalizeTonWallet(value) {
    return String(value || '').trim();
}

function looksLikeTonWallet(value) {
    const wallet = normalizeTonWallet(value);
    if (/^[UEk]Q[A-Za-z0-9_-]{46}$/.test(wallet)) return true;
    if (/^[0-9-]+:[a-fA-F0-9]{64}$/.test(wallet)) return true;
    return false;
}

function normalizeTelegramUsername(value) {
    return String(value || '').trim().replace(/^@/, '') || null;
}

function resolveTelegramVisibility(username) {
    return normalizeTelegramUsername(username) ? 'public' : 'private';
}

function buildChannelVisibilityPayload(chat = {}) {
    const username = normalizeTelegramUsername(chat.username);
    return {
        username,
        visibility: resolveTelegramVisibility(username),
        last_visibility_check_at: new Date().toISOString()
    };
}

function pendingReferralWalletKey(botId, tgUserId) {
    return `${botId}:${tgUserId}`;
}

function pendingGiftCodeKey(botId, tgUserId) {
    return `${botId}:${tgUserId}`;
}

function generateGiftCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const parts = [];
    for (let group = 0; group < 3; group += 1) {
        let chunk = '';
        for (let i = 0; i < 4; i += 1) {
            chunk += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
        }
        parts.push(chunk);
    }
    return parts.join('-');
}

export {
    pendingReferralWalletInputs,
    pendingGiftCodeInputs,
    pendingReferralWalletKey,
    pendingGiftCodeKey,
    generateGiftCode,
    normalizeTonWallet,
    looksLikeTonWallet,
    normalizeTelegramUsername,
    resolveTelegramVisibility,
    buildChannelVisibilityPayload
};
