import express from 'express';
import { authenticateUser } from '../middlewares/auth.middleware.js';
import { authenticateAgentOrUserToken } from '../utils/agent-mcp-auth.js';
import {
    authenticateIntegrationToken,
    createIntegrationToken,
    listIntegrationTokens,
    reissueIntegrationToken,
    revealIntegrationToken,
    revokeIntegrationToken
} from '../services/integration-tokens.service.js';

function legacyMcpId(id) {
    return `legacy:mcp:${id}`;
}

function legacyRecord(base) {
    return {
        scopes: [],
        can_reveal: false,
        legacy: true,
        metadata: {},
        revoked_at: null,
        revoked_reason: null,
        updated_at: null,
        ...base
    };
}

async function listLegacyMcpTokens(supabase, ownerId) {
    const { data, error } = await supabase
        .from('agent_mcp_tokens')
        .select('id, label, token_prefix, created_at, last_used_at, last_used_ip, revoked_at, revoked_reason')
        .eq('owner_id', ownerId)
        .order('created_at', { ascending: false });

    if (error) {
        if (String(error.message || '').includes('agent_mcp_tokens')) return [];
        throw error;
    }

    return (data || []).map((item) => legacyRecord({
        id: legacyMcpId(item.id),
        legacy_id: item.id,
        owner_id: ownerId,
        label: item.label || 'OpenClaw',
        purpose: 'mcp',
        scopes: ['mcp:use'],
        token_prefix: item.token_prefix,
        token_hint: item.token_prefix ? `brmcp_${item.token_prefix}_...` : null,
        last_used_at: item.last_used_at || null,
        last_used_ip: item.last_used_ip || null,
        revoked_at: item.revoked_at || null,
        revoked_reason: item.revoked_reason || null,
        created_at: item.created_at || null,
        legacy_source: 'agent_mcp_tokens'
    }));
}

async function listAllTokens(supabase, ownerId) {
    const [modern, legacyMcp] = await Promise.all([
        listIntegrationTokens(supabase, { ownerId }),
        listLegacyMcpTokens(supabase, ownerId)
    ]);

    return [...modern, ...legacyMcp]
        .sort((left, right) => new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime());
}

async function revokeLegacyToken(supabase, ownerId, tokenId, reason) {
    if (String(tokenId || '').startsWith('legacy:mcp:')) {
        const legacyId = String(tokenId).slice('legacy:mcp:'.length);
        const { error } = await supabase
            .from('agent_mcp_tokens')
            .update({
                revoked_at: new Date().toISOString(),
                revoked_reason: reason || 'reissued_to_integration_tokens'
            })
            .eq('id', legacyId)
            .eq('owner_id', ownerId)
            .is('revoked_at', null);
        if (error) throw error;
    }
}

function httpError(res, error, fallback = 'Ошибка интеграций') {
    res.status(error.statusCode || 500).json({ error: error.message || fallback });
}

export default function integrationsRoutes(supabase) {
    const router = express.Router();

    router.get('/tokens', authenticateUser, async (req, res) => {
        try {
            const tokens = await listAllTokens(supabase, req.user.id);
            res.json({ success: true, tokens });
        } catch (error) {
            httpError(res, error, 'Не удалось загрузить ключи интеграций.');
        }
    });

    router.post('/tokens', authenticateUser, async (req, res) => {
        try {
            const result = await createIntegrationToken(supabase, {
                ownerId: req.user.id,
                label: req.body?.label,
                purpose: req.body?.purpose,
                scopes: req.body?.scopes,
                metadata: req.body?.metadata
            });
            res.json({ success: true, ...result });
        } catch (error) {
            httpError(res, error, 'Не удалось выпустить ключ.');
        }
    });

    router.get('/tokens/:id/secret', authenticateUser, async (req, res) => {
        try {
            if (String(req.params.id || '').startsWith('legacy:')) {
                return res.status(409).json({
                    error: 'Старый ключ нельзя показать. Перевыпусти его, чтобы копировать с этой страницы.'
                });
            }
            const token = await revealIntegrationToken(supabase, {
                ownerId: req.user.id,
                tokenId: req.params.id
            });
            res.json({ success: true, token });
        } catch (error) {
            httpError(res, error, 'Не удалось показать ключ.');
        }
    });

    router.post('/tokens/:id/reissue', authenticateUser, async (req, res) => {
        try {
            if (String(req.params.id || '').startsWith('legacy:')) {
                await revokeLegacyToken(supabase, req.user.id, req.params.id, 'reissued_to_integration_tokens');
                const result = await createIntegrationToken(supabase, {
                    ownerId: req.user.id,
                    label: req.body?.label || 'Bullgram MCP',
                    purpose: 'mcp',
                    metadata: { reissued_from_legacy: req.params.id }
                });
                return res.json({ success: true, ...result });
            }

            const result = await reissueIntegrationToken(supabase, {
                ownerId: req.user.id,
                tokenId: req.params.id,
                reason: String(req.body?.reason || '').trim() || 'reissued_from_ui'
            });
            res.json({ success: true, ...result });
        } catch (error) {
            httpError(res, error, 'Не удалось перевыпустить ключ.');
        }
    });

    router.post('/tokens/:id/revoke', authenticateUser, async (req, res) => {
        try {
            if (String(req.params.id || '').startsWith('legacy:')) {
                await revokeLegacyToken(supabase, req.user.id, req.params.id, String(req.body?.reason || '').trim() || 'revoked_from_ui');
                return res.json({ success: true });
            }

            const result = await revokeIntegrationToken(supabase, {
                ownerId: req.user.id,
                tokenId: req.params.id,
                reason: String(req.body?.reason || '').trim() || 'revoked_from_ui'
            });
            res.json(result);
        } catch (error) {
            httpError(res, error, 'Не удалось отозвать ключ.');
        }
    });

    router.post('/tokens/test', authenticateUser, async (req, res) => {
        try {
            const providedToken = String(req.body?.token || '').trim();
            if (!providedToken) return res.status(400).json({ error: 'Передай token для проверки.' });

            const integrationAuth = await authenticateIntegrationToken(supabase, {
                authorizationHeader: `Bearer ${providedToken}`,
                requiredScopes: [],
                purpose: String(req.body?.purpose || '').trim(),
                requestIp: req.ip || req.headers['x-forwarded-for'] || ''
            });

            if (integrationAuth) {
                return res.json({
                    success: true,
                    kind: 'integration_token',
                    purpose: integrationAuth.token.purpose,
                    scopes: integrationAuth.scopes
                });
            }

            const mcpAuth = await authenticateAgentOrUserToken({
                supabase,
                authorizationHeader: `Bearer ${providedToken}`,
                requestIp: req.ip || req.headers['x-forwarded-for'] || ''
            });

            res.json({
                success: true,
                kind: mcpAuth.kind,
                purpose: mcpAuth.kind === 'agent_token' ? 'mcp' : 'user_jwt',
                scopes: mcpAuth.kind === 'agent_token' ? ['mcp:use'] : []
            });
        } catch (error) {
            res.status(400).json({ error: error.message || 'Проверка ключа не прошла.' });
        }
    });

    return router;
}
