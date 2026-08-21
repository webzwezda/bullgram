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

function httpError(res, error, fallback = 'Ошибка интеграций') {
    res.status(error.statusCode || 500).json({ error: error.message || fallback });
}

export default function integrationsRoutes(supabase) {
    const router = express.Router();

    router.get('/tokens', authenticateUser, async (req, res) => {
        try {
            const purpose = String(req.query?.purpose || '').trim();
            const tokens = await listIntegrationTokens(supabase, {
                ownerId: req.user.id,
                ...(purpose ? { purpose } : {})
            });
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

    // --- Audit log ----------------------------------------------------------
    // Returns mcp_tool_log rows for the current owner, filtered by query params.
    // Used by /app/claw/log to show every MCP+REST call made with their tokens.
    router.get('/audit-log', authenticateUser, async (req, res) => {
        try {
            const q = req.query || {};
            const limit = Math.min(Math.max(parseInt(q.limit, 10) || 100, 1), 500);
            const offset = Math.min(Math.max(parseInt(q.offset, 10) || 0, 0), 100000);

            let builder = supabase
                .from('mcp_tool_log')
                .select('id, token_id, auth_kind, owner_id, operation_name, source, userbot_id, chat_id, arguments_hash, latency_ms, status, error_code, error_message, telegram_error_event_id, request_ip, user_agent, request_id, started_at, finished_at')
                .eq('owner_id', req.user.id);

            if (q.operation) builder = builder.eq('operation_name', String(q.operation));
            if (q.status)    builder = builder.eq('status', String(q.status));
            if (q.source)    builder = builder.eq('source', String(q.source));
            if (q.token_id)  builder = builder.eq('token_id', String(q.token_id));
            if (q.userbot_id) builder = builder.eq('userbot_id', String(q.userbot_id));
            if (q.since)     builder = builder.gte('started_at', String(q.since));
            if (q.until)     builder = builder.lt('started_at', String(q.until));

            builder = builder.order('started_at', { ascending: false }).limit(limit).range(offset, offset + limit - 1);

            const { data, error } = await builder;
            if (error) throw error;

            // Aggregate counts by status for the dashboard header.
            const aggregates = { success: 0, error: 0, rate_limited: 0, insufficient_scope: 0, forbidden_account: 0, safe_mode_blocked: 0, account_restricted: 0, started: 0 };
            for (const row of data || []) {
                if (Object.prototype.hasOwnProperty.call(aggregates, row.status)) {
                    aggregates[row.status] += 1;
                }
            }

            res.json({ success: true, entries: data || [], aggregates });
        } catch (error) {
            httpError(res, error, 'Не удалось загрузить audit log.');
        }
    });

    // --- Trial API/MCP usage -------------------------------------------------
    router.get('/usage', authenticateUser, async (req, res) => {
        try {
            const tier = String(req.profile?.product_tier || 'trial').trim().toLowerCase();
            const isAdmin = req.profile?.role === 'admin';
            if (isAdmin || tier === 'pro') {
                return res.json({ success: true, usage: null, tier: isAdmin ? 'admin' : 'pro' });
            }

            const parsedLimit = Number(process.env.TRIAL_API_REQUESTS_PER_MONTH);
            const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.floor(parsedLimit) : 500;

            const now = new Date();
            const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
            const resetsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();

            const { data, error } = await supabase
                .from('api_usage_monthly')
                .select('calls_count')
                .eq('owner_id', req.user.id)
                .eq('month', month)
                .maybeSingle();

            if (error) throw error;

            res.json({
                success: true,
                tier: 'trial',
                usage: {
                    month,
                    used: Number(data?.calls_count || 0),
                    limit,
                    resets_at: resetsAt
                }
            });
        } catch (error) {
            httpError(res, error, 'Не удалось загрузить лимит запросов.');
        }
    });

    return router;
}
