const codes = new Map();
const CODE_TTL_MS = 5 * 60 * 1000;

function pruneExpired() {
    const now = Date.now();
    for (const [key, entry] of codes) {
        if (entry.expiresAt <= now) codes.delete(key);
    }
}

function generateCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do {
        code = 'BULL-';
        for (let i = 0; i < 4; i += 1) {
            code += alphabet[Math.floor(Math.random() * alphabet.length)];
        }
    } while (codes.has(code));
    return code;
}

export function createLinkCode(ownerId) {
    pruneExpired();
    const code = generateCode();
    codes.set(code, {
        ownerId,
        expiresAt: Date.now() + CODE_TTL_MS,
        consumed: false
    });
    return code;
}

export function consumeLinkCode(code) {
    pruneExpired();
    const entry = codes.get(code);
    if (!entry || entry.consumed) return null;
    codes.delete(code);
    return entry.ownerId;
}

export function getTtlMs() {
    return CODE_TTL_MS;
}
