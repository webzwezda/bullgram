import crypto from 'crypto';
import { decrypt, encrypt } from '../utils/crypto.js';

const PURPOSE_CONFIG = {
    mcp: {
        label: 'Bullgram MCP',
        defaultScopes: ['mcp:use'],
        tokenPrefix: 'brmcp'
    },
    api: {
        label: 'API ключ',
        defaultScopes: ['api:use'],
        tokenPrefix: 'brapi'
    },
    custom: {
        label: 'API key',
        defaultScopes: ['integrations:read'],
        tokenPrefix: 'brapi'
    }
};

const ALLOWED_SCOPES = new Set([
    'mcp:use',
    'api:use',
    'integrations:read',
    'orders:read',
    'shop:read',
    'payments:read',
    'cashdesk:read'
]);

export function hashIntegrationToken(token) {
    return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

export function tokenHint(token) {
    const value = String(token || '').trim();
    if (value.length <= 18) return value;
    return `${value.slice(0, 14)}...${value.slice(-6)}`;
}

export function normalizePurpose(value) {
    const purpose = String(value || '').trim().toLowerCase();
    return PURPOSE_CONFIG[purpose] ? purpose : 'custom';
}

function uniqueStrings(values = []) {
    return Array.from(new Set(values.map((item) => String(item || '').trim()).filter(Boolean)));
}

export function normalizeScopesForPurpose(purposeValue, requestedScopes = []) {
    const purpose = normalizePurpose(purposeValue);
    const defaults = PURPOSE_CONFIG[purpose].defaultScopes || [];
    const requested = Array.isArray(requestedScopes) ? requestedScopes : [];
    return uniqueStrings([...defaults, ...requested]).filter((scope) => ALLOWED_SCOPES.has(scope));
}

function generateSecret() {
    return crypto.randomBytes(24).toString('base64url');
}

export function generateIntegrationToken({ purpose: purposeValue } = {}) {
    const purpose = normalizePurpose(purposeValue);
    const config = PURPOSE_CONFIG[purpose];
    const secret = generateSecret();
    const prefix = secret.slice(0, 8);
    const token = `${config.tokenPrefix}_${prefix}_${secret}`;

    return {
        token,
        tokenPrefix: prefix,
        tokenHash: hashIntegrationToken(token),
        tokenHint: tokenHint(token),
        tokenEncrypted: encrypt(token)
    };
}

export function serializeIntegrationToken(record, extra = {}) {
    if (!record) return null;
    return {
        id: record.id,
        owner_id: record.owner_id,
        label: record.label,
        purpose: record.purpose,
        scopes: Array.isArray(record.scopes) ? record.scopes : [],
        token_prefix: record.token_prefix,
        token_hint: record.token_hint || null,
        can_reveal: Boolean(record.token_encrypted && !record.revoked_at),
        metadata: record.metadata || {},
        last_used_at: record.last_used_at || null,
        last_used_ip: record.last_used_ip || null,
        revoked_at: record.revoked_at || null,
        revoked_reason: record.revoked_reason || null,
        created_at: record.created_at || null,
        updated_at: record.updated_at || null,
        legacy: false,
        ...extra
    };
}

function isMissingIntegrationTable(error) {
    const message = String(error?.message || '');
    return error?.code === '42P01' || message.includes('integration_tokens');
}

export async function listIntegrationTokens(supabase, { ownerId, purpose = '' }) {
    let query = supabase
        .from('integration_tokens')
        .select('id, owner_id, label, purpose, scopes, token_prefix, token_hint, metadata, last_used_at, last_used_ip, revoked_at, revoked_reason, created_at, updated_at, token_encrypted')
        .eq('owner_id', ownerId)
        .order('created_at', { ascending: false });

    if (purpose) query = query.eq('purpose', normalizePurpose(purpose));

    const { data, error } = await query;
    if (error) {
        if (isMissingIntegrationTable(error)) return [];
        throw error;
    }

    return (data || []).map((record) => serializeIntegrationToken(record));
}

export async function createIntegrationToken(supabase, {
    ownerId,
    label = '',
    purpose: purposeValue = 'custom',
    scopes: requestedScopes = [],
    metadata = {}
}) {
    const purpose = normalizePurpose(purposeValue);
    const scopes = normalizeScopesForPurpose(purpose, requestedScopes);
    const generated = generateIntegrationToken({ purpose });
    const now = new Date().toISOString();
    const payload = {
        owner_id: ownerId,
        label: String(label || '').trim() || PURPOSE_CONFIG[purpose].label,
        purpose,
        scopes,
        token_prefix: generated.tokenPrefix,
        token_hint: generated.tokenHint,
        token_hash: generated.tokenHash,
        token_encrypted: generated.tokenEncrypted,
        metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {},
        updated_at: now
    };

    const { data, error } = await supabase
        .from('integration_tokens')
        .insert([payload])
        .select('id, owner_id, label, purpose, scopes, token_prefix, token_hint, metadata, last_used_at, last_used_ip, revoked_at, revoked_reason, created_at, updated_at, token_encrypted')
        .single();

    if (error) throw error;
    return {
        token: generated.token,
        record: serializeIntegrationToken(data)
    };
}

export async function revealIntegrationToken(supabase, { ownerId, tokenId }) {
    const { data, error } = await supabase
        .from('integration_tokens')
        .select('id, owner_id, token_encrypted, revoked_at')
        .eq('id', tokenId)
        .eq('owner_id', ownerId)
        .maybeSingle();

    if (error) throw error;
    if (!data?.id) {
        const notFound = new Error('Ключ не найден.');
        notFound.statusCode = 404;
        throw notFound;
    }
    if (data.revoked_at) {
        const revoked = new Error('Отозванный ключ нельзя показать.');
        revoked.statusCode = 400;
        throw revoked;
    }
    if (!data.token_encrypted) {
        const legacy = new Error('Старый ключ нельзя показать. Перевыпусти его, чтобы копировать с этой страницы.');
        legacy.statusCode = 409;
        throw legacy;
    }

    return decrypt(data.token_encrypted);
}

export async function revokeIntegrationToken(supabase, {
    ownerId,
    tokenId,
    reason = 'revoked_by_user'
}) {
    const now = new Date().toISOString();
    const { data, error } = await supabase
        .from('integration_tokens')
        .update({
            revoked_at: now,
            revoked_reason: String(reason || '').trim() || 'revoked_by_user',
            updated_at: now
        })
        .eq('id', tokenId)
        .eq('owner_id', ownerId)
        .is('revoked_at', null)
        .select('id')
        .maybeSingle();

    if (error) throw error;
    if (!data?.id) {
        const notFound = new Error('Ключ не найден или уже отозван.');
        notFound.statusCode = 404;
        throw notFound;
    }

    return { success: true };
}

export async function reissueIntegrationToken(supabase, {
    ownerId,
    tokenId,
    reason = 'reissued_by_user'
}) {
    const { data: current, error } = await supabase
        .from('integration_tokens')
        .select('id, owner_id, label, purpose, scopes, metadata, revoked_at')
        .eq('id', tokenId)
        .eq('owner_id', ownerId)
        .maybeSingle();

    if (error) throw error;
    if (!current?.id) {
        const notFound = new Error('Ключ не найден.');
        notFound.statusCode = 404;
        throw notFound;
    }

    if (!current.revoked_at) {
        await revokeIntegrationToken(supabase, { ownerId, tokenId, reason });
    }

    return createIntegrationToken(supabase, {
        ownerId,
        label: current.label,
        purpose: current.purpose,
        scopes: current.scopes || [],
        metadata: {
            ...(current.metadata || {}),
            reissued_from: current.id
        }
    });
}

export async function authenticateIntegrationToken(supabase, {
    authorizationHeader,
    requiredScopes = [],
    purpose = '',
    requestIp = ''
}) {
    const authHeader = String(authorizationHeader || '');
    if (!authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.split(' ')[1];
    if (!token) return null;

    const required = uniqueStrings(Array.isArray(requiredScopes) ? requiredScopes : [requiredScopes]);
    const tokenHash = hashIntegrationToken(token);
    let query = supabase
        .from('integration_tokens')
        .select('id, owner_id, label, purpose, scopes, revoked_at')
        .eq('token_hash', tokenHash)
        .is('revoked_at', null);
    if (purpose) query = query.eq('purpose', normalizePurpose(purpose));

    const { data, error } = await query.maybeSingle();
    if (error) {
        if (isMissingIntegrationTable(error)) return null;
        throw error;
    }
    if (!data?.owner_id) return null;

    const scopes = Array.isArray(data.scopes) ? data.scopes : [];
    const missingScopes = required.filter((scope) => !scopes.includes(scope));
    if (missingScopes.length) {
        const denied = new Error(`Недостаточно прав ключа: ${missingScopes.join(', ')}`);
        denied.statusCode = 403;
        throw denied;
    }

    void supabase
        .from('integration_tokens')
        .update({
            last_used_at: new Date().toISOString(),
            last_used_ip: String(requestIp || '').slice(0, 120) || null
        })
        .eq('id', data.id)
        .then(() => {})
        .catch(() => {});

    return {
        kind: 'integration_token',
        token: data,
        ownerId: data.owner_id,
        scopes
    };
}
