import crypto from 'crypto';
import { authenticateIntegrationToken } from '../services/integration-tokens.service.js';

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

export function generateAgentMcpToken() {
    const secret = crypto.randomBytes(24).toString('base64url');
    const prefix = secret.slice(0, 8);
    const token = `brmcp_${prefix}_${secret}`;
    return {
        token,
        tokenPrefix: prefix,
        tokenHash: hashToken(token)
    };
}

function normalExpired(profile) {
    if (String(profile?.product_tier || '').trim().toLowerCase() !== 'normal') return false;
    if (!profile?.normal_ends_at) return false;
    const endsAt = new Date(profile.normal_ends_at).getTime();
    return Number.isFinite(endsAt) && endsAt <= Date.now();
}

async function downgradeExpiredNormalProfile(supabase, profile) {
    if (!normalExpired(profile)) return profile;

    const { error } = await supabase
        .from('profiles')
        .update({ product_tier: 'trial' })
        .eq('id', profile.id)
        .eq('product_tier', 'normal');

    if (error && !String(error.message || '').includes('normal_ends_at')) {
        throw error;
    }

    return {
        ...profile,
        product_tier: 'trial'
    };
}

export async function loadProfileForUser(supabase, user) {
    const withPlan = await supabase
        .from('profiles')
        .select('id, role, email, full_name, product_tier, trial_started_at, trial_ends_at, normal_started_at, normal_ends_at')
        .eq('id', user.id)
        .maybeSingle();

    let profile = withPlan.data;
    let profileError = withPlan.error;

    if (profileError && (
        (profileError.message || '').includes('product_tier')
        || (profileError.message || '').includes('trial_started_at')
        || (profileError.message || '').includes('trial_ends_at')
        || (profileError.message || '').includes('normal_started_at')
        || (profileError.message || '').includes('normal_ends_at')
    )) {
        const fallback = await supabase
            .from('profiles')
            .select('id, role, email, full_name')
            .eq('id', user.id)
            .maybeSingle();

        profileError = fallback.error;
        profile = fallback.data ? {
            ...fallback.data,
            product_tier: 'trial',
            trial_started_at: null,
            trial_ends_at: null,
            normal_started_at: null,
            normal_ends_at: null
        } : null;
    }

    if (profileError) {
        throw new Error('Не удалось загрузить профиль пользователя.');
    }

    const normalizedProfile = profile || {
        id: user.id,
        role: null,
        email: user.email || null,
        full_name: null,
        product_tier: 'trial',
        trial_started_at: null,
        trial_ends_at: null,
        normal_started_at: null,
        normal_ends_at: null
    };

    return downgradeExpiredNormalProfile(supabase, normalizedProfile);
}

export async function authenticateAgentOrUserToken({ supabase, authorizationHeader, requestIp = '' }) {
    const authHeader = authorizationHeader;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error('Отсутствует или неверный Authorization заголовок');
    }

    const token = authHeader.split(' ')[1];
    const tokenHash = hashToken(token);

    const integrationToken = await authenticateIntegrationToken(supabase, {
        authorizationHeader: authHeader,
        requiredScopes: ['mcp:use'],
        purpose: 'mcp',
        requestIp
    });

    if (integrationToken?.ownerId) {
        const user = {
            id: integrationToken.ownerId,
            email: null,
            is_mcp_token: true,
            is_integration_token: true
        };
        const profile = await loadProfileForUser(supabase, user);

        return {
            kind: 'integration_token',
            user,
            profile,
            agentToken: integrationToken.token,
            integrationToken: integrationToken.token
        };
    }

    const { data: agentToken, error: agentTokenError } = await supabase
        .from('agent_mcp_tokens')
        .select('id, owner_id, label, revoked_at')
        .eq('token_hash', tokenHash)
        .is('revoked_at', null)
        .maybeSingle();

    if (agentTokenError && !String(agentTokenError.message || '').includes('agent_mcp_tokens')) {
        throw agentTokenError;
    }

    if (agentToken?.owner_id) {
        const user = {
            id: agentToken.owner_id,
            email: null,
            is_mcp_token: true
        };
        const profile = await loadProfileForUser(supabase, user);

        void supabase
            .from('agent_mcp_tokens')
            .update({
                last_used_at: new Date().toISOString(),
                last_used_ip: String(requestIp || '').slice(0, 120) || null
            })
            .eq('id', agentToken.id)
            .then(() => {})
            .catch(() => {});

        return {
            kind: 'agent_token',
            user,
            profile,
            agentToken
        };
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
        throw new Error('Недействительный токен');
    }

    const profile = await loadProfileForUser(supabase, user);
    return {
        kind: 'user_token',
        user,
        profile,
        agentToken: null
    };
}
