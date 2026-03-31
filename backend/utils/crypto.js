// backend/crypto.js
import crypto from 'crypto';
import 'dotenv/config';

const ALGORITHM = 'aes-256-gcm';
const LEGACY_ALGORITHM = 'aes-256-cbc';
const RAW_ENCRYPTION_KEY = String(process.env.ENCRYPTION_KEY || '');
if (!RAW_ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY is required');
}
const LEGACY_ENCRYPTION_KEY = Buffer.from(RAW_ENCRYPTION_KEY, 'utf-8');
const ENCRYPTION_KEY = LEGACY_ENCRYPTION_KEY.length === 32
    ? LEGACY_ENCRYPTION_KEY
    : crypto.createHash('sha256').update(RAW_ENCRYPTION_KEY, 'utf-8').digest();
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const VERSION_PREFIX = 'v2';

function decryptLegacy(text) {
    const textParts = String(text || '').split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const candidateKeys = [];

    if (LEGACY_ENCRYPTION_KEY.length === 32) {
        candidateKeys.push(LEGACY_ENCRYPTION_KEY);
    }
    if (!candidateKeys.some((key) => key.equals(ENCRYPTION_KEY))) {
        candidateKeys.push(ENCRYPTION_KEY);
    }

    for (const key of candidateKeys) {
        try {
            const decipher = crypto.createDecipheriv(LEGACY_ALGORITHM, key, iv);
            let decrypted = decipher.update(encryptedText);
            decrypted = Buffer.concat([decrypted, decipher.final()]);
            return decrypted.toString();
        } catch {}
    }

    throw new Error('Legacy decrypt failed');
}

export function encrypt(text) {
    if (!text) return text;
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
        VERSION_PREFIX,
        iv.toString('hex'),
        tag.toString('hex'),
        encrypted.toString('hex')
    ].join(':');
}

export function decrypt(text) {
    if (!text) return text;
    const parts = String(text).split(':');

    if (parts[0] !== VERSION_PREFIX) {
        return decryptLegacy(text);
    }

    const [, ivHex, tagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex || '', 'hex');
    const tag = Buffer.from(tagHex || '', 'hex');
    const encryptedText = Buffer.from(encryptedHex || '', 'hex');

    if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH || !encryptedText.length) {
        throw new Error('Encrypted payload is malformed');
    }

    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString('utf8');
}
