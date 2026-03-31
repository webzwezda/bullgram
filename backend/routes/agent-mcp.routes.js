import express from 'express';
import { authenticateUser } from '../middlewares/auth.middleware.js';
import { enforceOwnedProxyQuota } from '../utils/product-tier.js';
import {
    buildAgentInfraPayload,
    normalizeAdminInventoryGroup,
    parseProxyPasteInput,
    supportsProxyInventoryGroup,
    supportsProxyProvisionSource
} from '../utils/agent-tools.js';
import { authenticateAgentOrUserToken, generateAgentMcpToken } from '../utils/agent-mcp-auth.js';

const MCP_PROTOCOL_VERSION = '2025-03-26';

function makeJsonRpcResult(id, result) {
    return {
        jsonrpc: '2.0',
        id,
        result
    };
}

function makeJsonRpcError(id, code, message, data = null) {
    return {
        jsonrpc: '2.0',
        id: id ?? null,
        error: {
            code,
            message,
            ...(data ? { data } : {})
        }
    };
}

function buildToolDefinitions() {
    return [
        {
            name: 'bullrun_infra_summary',
            title: 'BullRun infra summary',
            description: 'Возвращает summary по proxy, userbot и лимитам текущего BullRun аккаунта.',
            inputSchema: {
                type: 'object',
                additionalProperties: false,
                properties: {}
            }
        },
        {
            name: 'bullrun_proxy_preview',
            title: 'BullRun proxy preview',
            description: 'Разбирает сырой текст proxy и возвращает preview перед сохранением.',
            inputSchema: {
                type: 'object',
                additionalProperties: false,
                required: ['raw'],
                properties: {
                    raw: {
                        type: 'string',
                        description: 'Сырой текст с proxy, включая грязный vendor-формат.'
                    }
                }
            }
        },
        {
            name: 'bullrun_proxy_import',
            title: 'BullRun proxy import',
            description: 'Сохраняет proxy в BullRun после подтверждения пользователя.',
            inputSchema: {
                type: 'object',
                additionalProperties: false,
                required: ['raw', 'confirmed'],
                properties: {
                    raw: {
                        type: 'string',
                        description: 'Сырой текст с proxy.'
                    },
                    confirmed: {
                        type: 'boolean',
                        description: 'Явное подтверждение пользователя на импорт после preview.'
                    },
                    name: {
                        type: 'string',
                        description: 'Опциональное имя proxy.'
                    },
                    inventory_group: {
                        type: 'string',
                        enum: ['self_use', 'shop_sale'],
                        description: 'Только для admin: куда положить proxy.'
                    }
                }
            }
        }
    ];
}

async function handleToolCall({ supabase, req, name, args }) {
    if (name === 'bullrun_infra_summary') {
        return buildAgentInfraPayload({
            supabase,
            user: req.user,
            profile: req.profile
        });
    }

    if (name === 'bullrun_proxy_preview') {
        const parsed = parseProxyPasteInput(args?.raw || '');
        return {
            success: true,
            parsed,
            message: 'Proxy разобран. Можно показать preview и спросить подтверждение на импорт.'
        };
    }

    if (name === 'bullrun_proxy_import') {
        if (args?.confirmed !== true) {
            throw new Error('Импорт proxy требует явного confirmed=true после preview и подтверждения пользователя.');
        }

        const sourceSupported = await supportsProxyProvisionSource(supabase);
        const inventoryGroupSupported = await supportsProxyInventoryGroup(supabase);
        const isAdmin = req.profile?.role === 'admin';
        const parsed = parseProxyPasteInput(args?.raw || '');
        const nameValue = String(args?.name || '').trim() || `${parsed.host}:${parsed.port}`;
        const normalizedInventoryGroup = normalizeAdminInventoryGroup(args?.inventory_group);

        if (!isAdmin) {
            await enforceOwnedProxyQuota({
                supabase,
                ownerId: req.user.id,
                profile: req.profile
            });
        }

        const proxyData = {
            owner_id: req.user.id,
            name: nameValue,
            host: parsed.host,
            port: parsed.port,
            username: parsed.username,
            password: parsed.password,
            is_working: null,
            last_checked_at: null,
            last_check_ip: null,
            last_check_country: null,
            last_check_city: null,
            last_check_isp: null,
            last_check_error: null
        };

        if (sourceSupported) {
            proxyData.provision_source = isAdmin ? 'manual_admin' : 'manual_owned';
        }
        if (inventoryGroupSupported && isAdmin) {
            proxyData.inventory_group = normalizedInventoryGroup;
        }

        const { data: inserted, error } = await supabase
            .from('proxies')
            .insert([proxyData])
            .select('id, name, host, port')
            .single();

        if (error) throw error;

        return {
            success: true,
            proxy: inserted,
            parsed,
            message: 'Proxy сохранён из вставленного текста.'
        };
    }

    throw new Error(`Unknown tool: ${name}`);
}

export default function agentMcpRoutes(supabase) {
    const router = express.Router();

    router.get('/tokens', authenticateUser, async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('agent_mcp_tokens')
                .select('id, label, token_prefix, created_at, last_used_at, last_used_ip, revoked_at, revoked_reason')
                .eq('owner_id', req.user.id)
                .order('created_at', { ascending: false });

            if (error) throw error;
            res.json({
                tokens: (data || []).map((item) => ({
                    ...item,
                    token_hint: item.token_prefix ? `brmcp_${item.token_prefix}_...` : null
                }))
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Не удалось загрузить MCP токены.' });
        }
    });

    router.post('/tokens', authenticateUser, async (req, res) => {
        try {
            const label = String(req.body?.label || '').trim() || 'OpenClaw';
            const { token, tokenPrefix, tokenHash } = generateAgentMcpToken();

            const { data, error } = await supabase
                .from('agent_mcp_tokens')
                .insert([{
                    owner_id: req.user.id,
                    label,
                    token_prefix: tokenPrefix,
                    token_hash: tokenHash
                }])
                .select('id, label, token_prefix, created_at, last_used_at, last_used_ip, revoked_at, revoked_reason')
                .single();

            if (error) throw error;

            res.json({
                token,
                record: {
                    ...data,
                    token_hint: data?.token_prefix ? `brmcp_${data.token_prefix}_...` : null
                }
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Не удалось создать MCP токен.' });
        }
    });

    router.post('/tokens/:id/revoke', authenticateUser, async (req, res) => {
        try {
            const revokePayload = {
                revoked_at: new Date().toISOString(),
                revoked_reason: String(req.body?.reason || '').trim() || 'revoked_by_user'
            };

            const { data, error } = await supabase
                .from('agent_mcp_tokens')
                .update(revokePayload)
                .eq('id', req.params.id)
                .eq('owner_id', req.user.id)
                .is('revoked_at', null)
                .select('id')
                .maybeSingle();

            if (error) throw error;
            if (!data?.id) {
                return res.status(404).json({ error: 'Токен не найден или уже отозван.' });
            }

            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Не удалось отозвать MCP токен.' });
        }
    });

    router.post('/tokens/test', authenticateUser, async (req, res) => {
        try {
            const providedToken = String(req.body?.token || '').trim();
            if (!providedToken) {
                return res.status(400).json({ error: 'Передай token для проверки.' });
            }

            const auth = await authenticateAgentOrUserToken({
                supabase,
                authorizationHeader: `Bearer ${providedToken}`,
                requestIp: req.ip || req.headers['x-forwarded-for'] || ''
            });

            const summary = await buildAgentInfraPayload({
                supabase,
                user: auth.user,
                profile: auth.profile
            });

            res.json({
                success: true,
                kind: auth.kind,
                profile_role: auth.profile?.role || null,
                product_tier: summary.summary?.product_tier || null,
                proxy_total: summary.summary?.proxy_total || 0,
                userbot_total: summary.summary?.userbot_total || 0
            });
        } catch (error) {
            res.status(400).json({ error: error.message || 'Проверка MCP токена не прошла.' });
        }
    });

    router.post('/', async (req, res) => {
        const rpc = req.body || {};
        const id = rpc.id ?? null;

        try {
            const auth = await authenticateAgentOrUserToken({
                supabase,
                authorizationHeader: req.headers.authorization,
                requestIp: req.ip || req.headers['x-forwarded-for'] || ''
            });
            req.user = auth.user;
            req.profile = auth.profile;

            if (rpc.jsonrpc !== '2.0') {
                return res.status(400).json(makeJsonRpcError(id, -32600, 'Invalid Request'));
            }

            if (rpc.method === 'initialize') {
                return res.json(makeJsonRpcResult(id, {
                    protocolVersion: MCP_PROTOCOL_VERSION,
                    capabilities: {
                        tools: {
                            listChanged: false
                        }
                    },
                    serverInfo: {
                        name: 'bullrun-mcp',
                        version: '0.1.0'
                    }
                }));
            }

            if (rpc.method === 'notifications/initialized') {
                return res.status(202).end();
            }

            if (rpc.method === 'ping') {
                return res.json(makeJsonRpcResult(id, {}));
            }

            if (rpc.method === 'tools/list') {
                return res.json(makeJsonRpcResult(id, {
                    tools: buildToolDefinitions()
                }));
            }

            if (rpc.method === 'tools/call') {
                const toolName = rpc.params?.name;
                const args = rpc.params?.arguments || {};
                const result = await handleToolCall({
                    supabase,
                    req,
                    name: toolName,
                    args
                });

                return res.json(makeJsonRpcResult(id, {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2)
                        }
                    ],
                    structuredContent: result
                }));
            }

            return res.status(404).json(makeJsonRpcError(id, -32601, `Method not found: ${rpc.method}`));
        } catch (error) {
            const message = error?.message || 'Internal error';
            return res.status(500).json(makeJsonRpcError(id, -32000, message));
        }
    });

    return router;
}
