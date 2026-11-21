// Short-lived signed links for internally-stored chat media.
//
// Chat media downloaded by the userbot lands in uploads-internal/ (NOT under
// the public /uploads static). MCP clients authenticate with brmcp_ tokens,
// which the REST endpoint rejects — so the media_save operation returns a
// signed, expiring URL instead: /api/external/v1/media/{token}?p={relPath}.
//
// Token = base64url(JSON {p: relPath, e: expiresSec}) + '.' + HMAC-SHA256.
// Key: ENCRYPTION_KEY (same secret that encrypts userbot sessions).

import crypto from 'node:crypto';

const VERSION = 'v1';

export const MEDIA_URL_TTL_MS_DEFAULT = 15 * 60 * 1000;

function hmacKey() {
    const raw = String(process.env.ENCRYPTION_KEY || '');
    if (!raw) throw new Error('ENCRYPTION_KEY is required for media links');
    return Buffer.from(raw, 'utf-8').length === 32
        ? Buffer.from(raw, 'utf-8')
        : crypto.createHash('sha256').update(raw, 'utf-8').digest();
}

function hmac(payload) {
    return crypto.createHmac('sha256', hmacKey()).update(payload).digest('base64url');
}

export function signMediaToken({ relPath, ttlMs = MEDIA_URL_TTL_MS_DEFAULT, mime = null, now = Date.now() }) {
    if (!relPath || typeof relPath !== 'string') {
        throw new Error('signMediaToken: relPath is required');
    }
    const expiresSec = Math.floor((now + ttlMs) / 1000);
    const body = { p: relPath, e: expiresSec };
    if (mime) body.m = String(mime);
    const payload = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
    return `${payload}.${hmac(`${VERSION}:${payload}`)}`;
}

export function verifyMediaToken(token, now = Date.now()) {
    if (typeof token !== 'string' || !token.includes('.')) {
        return { ok: false, reason: 'malformed' };
    }
    const [payload, signature] = token.split('.');
    const expected = hmac(`${VERSION}:${payload}`);
    const given = Buffer.from(signature || '', 'utf8');
    const want = Buffer.from(expected, 'utf8');
    if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
        return { ok: false, reason: 'bad_signature' };
    }
    let parsed;
    try {
        parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
        return { ok: false, reason: 'malformed' };
    }
    if (!parsed || typeof parsed.p !== 'string' || !Number.isFinite(parsed.e)) {
        return { ok: false, reason: 'malformed' };
    }
    if (parsed.e * 1000 <= now) {
        return { ok: false, reason: 'expired', relPath: parsed.p };
    }
    return { ok: true, relPath: parsed.p, expiresAtMs: parsed.e * 1000, mime: typeof parsed.m === 'string' ? parsed.m : null };
}
