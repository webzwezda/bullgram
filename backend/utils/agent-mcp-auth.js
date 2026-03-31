import crypto from 'crypto';

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

export async function loadProfileForUser(supabase, user) {
    const withPlan = await supabase
        .from('profiles')
        .select('id, role, email, full_name, product_tier, trial_started_at, trial_ends_at')
        .eq('id', user.id)
        .maybeSingle();

    let profile = withPlan.data;
    let profileError = withPlan.error;

    if (profileError && ((profileError.message || '').includes('product_tier') || (profileError.message || '').includes('trial_started_at') || (profileError.message || '').includes('trial_ends_at'))) {
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
            trial_ends_at: null
        } : null;
    }

    if (profileError) {
        throw new Error('Не удалось загрузить профиль пользователя.');
    }

    return profile || {
        id: user.id,
        role: null,
        email: user.email || null,
        full_name: null,
        product_tier: 'trial',
        trial_started_at: null,
        trial_ends_at: null
    };
}

export async function authenticateAgentOrUserToken({ supabase, authorizationHeader, requestIp = '' }) {
    const authHeader = authorizationHeader;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error('Отсутствует или неверный Authorization заголовок');
    }

    const token = authHeader.split(' ')[1];
    const tokenHash = hashToken(token);

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
