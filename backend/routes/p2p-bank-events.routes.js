import crypto from 'crypto';
import express from 'express';
import { authenticateUser } from '../middlewares/auth.middleware.js';
import { confirmShopP2pPayment } from './shop.routes.js';
import {
    authenticateIntegrationToken,
    createIntegrationToken,
    listIntegrationTokens,
    revokeIntegrationToken
} from '../services/integration-tokens.service.js';

const WEBHOOK_BODY_LIMIT_BYTES = 64 * 1024;
const SHOP_PENDING_PURCHASE_TTL_MINUTES = 30;

function sha256(value) {
    return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function createWebhookToken() {
    return `br_p2p_${crypto.randomBytes(32).toString('base64url')}`;
}

function tokenHint(token) {
    const value = String(token || '');
    if (value.length <= 16) return value;
    return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function publicOrigin() {
    return String(process.env.PUBLIC_APP_ORIGIN || 'https://bullrun.ru').replace(/\/$/, '');
}

function publicWebhookUrl() {
    return `${publicOrigin()}/api/p2p/webhook`;
}

function safeJsonSize(value) {
    try {
        return Buffer.byteLength(JSON.stringify(value || {}), 'utf8');
    } catch {
        return WEBHOOK_BODY_LIMIT_BYTES + 1;
    }
}

function getDeepValue(source, paths) {
    for (const path of paths) {
        const value = path.split('.').reduce((acc, key) => (acc && acc[key] != null ? acc[key] : null), source);
        if (value != null && String(value).trim()) return value;
    }
    return null;
}

function extractTextPayload(body = {}) {
    const title = getDeepValue(body, ['title', 'notification.title', 'push.title', 'data.title']);
    const text = getDeepValue(body, [
        'text',
        'message',
        'content',
        'body',
        'notification.text',
        'notification.body',
        'push.text',
        'push.body',
        'data.text',
        'data.message',
        'data.body'
    ]);
    return [title, text].filter(Boolean).map((part) => String(part).trim()).join(' ').trim();
}

function extractSender(body = {}) {
    const value = getDeepValue(body, ['sender', 'from', 'app', 'package', 'notification.app', 'data.sender']);
    return value ? String(value).slice(0, 120) : null;
}

function extractEventTime(body = {}) {
    const value = getDeepValue(body, ['time', 'timestamp', 'date', 'event_time', 'notification.time', 'data.time']);
    if (!value) return null;
    const date = typeof value === 'number' ? new Date(value < 10_000_000_000 ? value * 1000 : value) : new Date(String(value));
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizeAmountToken(value) {
    const normalized = String(value || '')
        .replace(/\s+/g, '')
        .replace(',', '.')
        .replace(/[^\d.]/g, '');
    const amount = Number(normalized);
    return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function extractAmountRub(text) {
    const value = String(text || '');
    const currencyMatch = value.match(/(?:\+|поступ(?:ил|ило|ление)?|зачислен(?:ие|о)?|перевод|оплат[аы]?|пополнен(?:ие)?)[^\d]{0,30}(\d[\d\s]*(?:[,.]\d{1,2})?)\s*(?:₽|руб|rub|р\b)?/i)
        || value.match(/(\d[\d\s]*(?:[,.]\d{1,2})?)\s*(?:₽|руб\.?|rub)\b/i);
    return currencyMatch ? normalizeAmountToken(currencyMatch[1]) : null;
}

function redactBankText(text) {
    return String(text || '')
        .replace(/\b\d{4}\s?\d{4}\s?\d{4}\s?\d{4,7}\b/g, '[card]')
        .replace(/\b(?:\+7|8)\s?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g, '[phone]')
        .replace(/\b(?:баланс|остаток)[:\s]*[^\s,;]+(?:\s?[₽р]| rub)?/gi, 'баланс [hidden]')
        .replace(/\b\d{10,}\b/g, '[number]')
        .slice(0, 1000);
}

function buildDedupeKey({ body, rawText, amountRub, eventTime, sender }) {
    const explicitId = getDeepValue(body, ['id', 'message_id', 'event_id', 'notification.id', 'data.id']);
    if (explicitId) return `id:${String(explicitId).slice(0, 160)}`;
    const bucket = eventTime ? new Date(eventTime).toISOString().slice(0, 16) : new Date().toISOString().slice(0, 16);
    return `hash:${sha256([sender || '', amountRub || '', bucket, rawText || ''].join('|'))}`;
}

function parseBankNotificationPayload(body = {}) {
    const rawText = extractTextPayload(body);
    const sender = extractSender(body);
    const eventTime = extractEventTime(body);
    const amountRub = extractAmountRub(rawText);
    return {
        rawText,
        redactedText: redactBankText(rawText),
        sender,
        eventTime,
        amountRub,
        bankName: sender,
        dedupeKey: buildDedupeKey({ body, rawText, amountRub, eventTime, sender })
    };
}

function nearlySameRub(left, right) {
    return Math.abs(Number(left || 0) - Number(right || 0)) < 0.01;
}

function purchaseExpiresAt(purchase) {
    return new Date(new Date(purchase.created_at).getTime() + SHOP_PENDING_PURCHASE_TTL_MINUTES * 60 * 1000);
}

function eventFitsPurchaseTime(purchase, eventTime, skewMinutes) {
    if (!eventTime) return false;
    const eventMs = new Date(eventTime).getTime();
    const createdMs = new Date(purchase.created_at).getTime();
    const expiresMs = purchaseExpiresAt(purchase).getTime();
    const skewMs = Number(skewMinutes || 0) * 60 * 1000;
    return Number.isFinite(eventMs) && eventMs >= createdMs - skewMs && eventMs <= expiresMs + skewMs;
}

function groupPurchasesForMatching(purchases = []) {
    const groups = new Map();
    for (const purchase of purchases) {
        const batchToken = String(purchase.payload?.batch_token || '').trim();
        const key = batchToken || `purchase:${purchase.id}`;
        const group = groups.get(key) || {
            key,
            batchToken: batchToken || null,
            purchaseIds: [],
            purchases: [],
            amountRub: 0,
            statuses: new Set()
        };
        group.purchaseIds.push(purchase.id);
        group.purchases.push(purchase);
        group.amountRub += Number(purchase.payload?.amount_rub || 0);
        group.statuses.add(purchase.status);
        groups.set(key, group);
    }
    return Array.from(groups.values());
}

async function matchP2pBankEventToPaymentGroup(supabase, {
    ownerId,
    amountRub,
    eventTime,
    settings
}) {
    if (!Number.isFinite(Number(amountRub)) || Number(amountRub) <= 0) {
        return { status: 'unmatched', reason: 'amount_missing', candidates: [], autoCandidates: [] };
    }

    const { data: purchases, error } = await supabase
        .from('shop_purchases')
        .select('*')
        .eq('seller_owner_id', ownerId)
        .in('status', ['pending', 'awaiting_receipt'])
        .order('created_at', { ascending: false })
        .limit(200);
    if (error) throw error;

    const p2pPurchases = (purchases || []).filter((purchase) => String(purchase.payload?.payment_method || '').toLowerCase() === 'p2p');
    const groups = groupPurchasesForMatching(p2pPurchases).filter((group) => nearlySameRub(group.amountRub, amountRub));
    const timedGroups = groups.filter((group) =>
        eventTime && group.purchases.every((purchase) => eventFitsPurchaseTime(purchase, eventTime, settings?.match_clock_skew_minutes || 10))
    );
    const autoCandidates = timedGroups.filter((group) =>
        group.purchases.every((purchase) => purchase.status === 'awaiting_receipt')
    );

    if (!eventTime) {
        return { status: 'unmatched', reason: 'event_time_missing', candidates: groups, autoCandidates: [] };
    }

    if (autoCandidates.length === 1) {
        return { status: 'matched', reason: 'single_awaiting_receipt_group', candidates: autoCandidates, autoCandidates };
    }

    if (autoCandidates.length > 1) {
        return { status: 'ambiguous', reason: 'multiple_awaiting_receipt_groups', candidates: autoCandidates, autoCandidates };
    }

    if (timedGroups.length > 0) {
        return { status: 'ambiguous', reason: 'only_pending_or_mixed_groups', candidates: timedGroups, autoCandidates: [] };
    }

    return { status: 'unmatched', reason: 'no_matching_payment_group', candidates: groups, autoCandidates: [] };
}

function flattenPurchaseIds(groups = []) {
    return Array.from(new Set(groups.flatMap((group) => group.purchaseIds || [])));
}

function flattenBatchTokens(groups = []) {
    return Array.from(new Set(groups.map((group) => group.batchToken).filter(Boolean)));
}

async function latestActiveP2pIntegrationToken(supabase, ownerId) {
    const tokens = await listIntegrationTokens(supabase, { ownerId, purpose: 'p2p_webhook' });
    return tokens.find((token) => !token.revoked_at) || null;
}

function mergeP2pSettingsWithToken(settings, tokenRecord, ownerId) {
    return {
        owner_id: ownerId,
        enabled: tokenRecord ? true : false,
        auto_confirm_enabled: true,
        match_clock_skew_minutes: 10,
        ...(settings || {}),
        token_prefix: tokenRecord?.token_prefix || settings?.token_prefix || null,
        token_hint: tokenRecord?.token_hint || settings?.token_hint || null
    };
}

async function loadP2pWebhookSettingsForToken(supabase, tokenAuth, legacyToken) {
    if (tokenAuth?.ownerId) {
        const { data, error } = await supabase
            .from('p2p_webhook_settings')
            .select('*')
            .eq('owner_id', tokenAuth.ownerId)
            .maybeSingle();
        if (error) throw error;
        return {
            ...(data || {}),
            owner_id: tokenAuth.ownerId,
            enabled: data?.enabled !== false,
            auto_confirm_enabled: data?.auto_confirm_enabled !== false,
            match_clock_skew_minutes: data?.match_clock_skew_minutes || 10,
            integration_token_id: tokenAuth.token?.id || null
        };
    }

    const { data: settings, error: settingsError } = await supabase
        .from('p2p_webhook_settings')
        .select('*')
        .eq('token_hash', sha256(legacyToken))
        .maybeSingle();
    if (settingsError) throw settingsError;
    return settings || null;
}

export default function p2pBankEventsRoutes(supabase) {
    const router = express.Router();

    router.get('/settings', authenticateUser, async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('p2p_webhook_settings')
                .select('owner_id, token_prefix, token_hint, enabled, auto_confirm_enabled, match_clock_skew_minutes, last_webhook_at, last_used_at, last_used_ip, updated_at')
                .eq('owner_id', req.user.id)
                .maybeSingle();
            if (error) throw error;
            const tokenRecord = await latestActiveP2pIntegrationToken(supabase, req.user.id);

            res.json({
                success: true,
                settings: mergeP2pSettingsWithToken(data, tokenRecord, req.user.id),
                webhook_url: publicWebhookUrl()
            });
        } catch (error) {
            console.error('Ошибка загрузки настроек P2P webhook:', error.message);
            res.status(500).json({ error: 'Не удалось загрузить настройки автосверки' });
        }
    });

    router.post('/token', authenticateUser, async (req, res) => {
        try {
            const now = new Date().toISOString();
            const { token, record } = await createIntegrationToken(supabase, {
                ownerId: req.user.id,
                label: 'P2P касса / SMS Forward',
                purpose: 'p2p_webhook'
            });
            const oldTokens = await listIntegrationTokens(supabase, { ownerId: req.user.id, purpose: 'p2p_webhook' });
            await Promise.all(oldTokens
                .filter((item) => !item.revoked_at && item.id !== record.id)
                .map((item) => revokeIntegrationToken(supabase, {
                    ownerId: req.user.id,
                    tokenId: item.id,
                    reason: 'reissued_from_cashdesk'
                })));
            const payload = {
                owner_id: req.user.id,
                token_hash: null,
                token_prefix: null,
                token_hint: null,
                enabled: true,
                auto_confirm_enabled: req.body?.auto_confirm_enabled !== false,
                updated_at: now
            };

            const { data, error } = await supabase
                .from('p2p_webhook_settings')
                .upsert(payload, { onConflict: 'owner_id' })
                .select('owner_id, token_prefix, token_hint, enabled, auto_confirm_enabled, match_clock_skew_minutes, last_webhook_at, last_used_at, last_used_ip, updated_at')
                .single();
            if (error) throw error;

            res.json({
                success: true,
                token,
                settings: mergeP2pSettingsWithToken(data, record, req.user.id),
                webhook_url: publicWebhookUrl()
            });
        } catch (error) {
            console.error('Ошибка генерации P2P webhook token:', error.message);
            res.status(500).json({ error: 'Не удалось выпустить token' });
        }
    });

    router.post('/settings', authenticateUser, async (req, res) => {
        try {
            const payload = {
                owner_id: req.user.id,
                enabled: req.body?.enabled !== false,
                auto_confirm_enabled: req.body?.auto_confirm_enabled !== false,
                match_clock_skew_minutes: Math.max(0, Math.min(60, Number(req.body?.match_clock_skew_minutes || 10))),
                updated_at: new Date().toISOString()
            };
            const { data, error } = await supabase
                .from('p2p_webhook_settings')
                .upsert(payload, { onConflict: 'owner_id' })
                .select('owner_id, token_prefix, token_hint, enabled, auto_confirm_enabled, match_clock_skew_minutes, last_webhook_at, last_used_at, last_used_ip, updated_at')
                .single();
            if (error) throw error;
            res.json({ success: true, settings: data });
        } catch (error) {
            console.error('Ошибка сохранения P2P webhook settings:', error.message);
            res.status(500).json({ error: 'Не удалось сохранить автосверку' });
        }
    });

    router.get('/', authenticateUser, async (req, res) => {
        try {
            let query = supabase
                .from('p2p_bank_events')
                .select('*')
                .eq('owner_id', req.user.id)
                .order('received_at', { ascending: false })
                .limit(Math.min(100, Math.max(1, Number(req.query.limit || 50))));
            const status = String(req.query.status || '').trim();
            if (status) query = query.eq('status', status);
            const { data, error } = await query;
            if (error) throw error;
            res.json({ success: true, events: data || [] });
        } catch (error) {
            console.error('Ошибка загрузки P2P bank events:', error.message);
            res.status(500).json({ error: 'Не удалось загрузить события автосверки' });
        }
    });

    router.post('/test', authenticateUser, async (req, res) => {
        try {
            const parsed = parseBankNotificationPayload(req.body || {});
            const { data: settings } = await supabase
                .from('p2p_webhook_settings')
                .select('*')
                .eq('owner_id', req.user.id)
                .maybeSingle();
            const match = await matchP2pBankEventToPaymentGroup(supabase, {
                ownerId: req.user.id,
                amountRub: parsed.amountRub,
                eventTime: parsed.eventTime,
                settings: settings || {}
            });
            res.json({
                success: true,
                parsed,
                match: {
                    status: match.status,
                    reason: match.reason,
                    candidate_purchase_ids: flattenPurchaseIds(match.candidates),
                    candidate_batch_tokens: flattenBatchTokens(match.candidates)
                }
            });
        } catch (error) {
            console.error('Ошибка теста P2P bank parser:', error.message);
            res.status(500).json({ error: 'Не удалось проверить текст уведомления' });
        }
    });

    router.post('/webhook', async (req, res) => {
        const authHeader = String(req.headers.authorization || '');
        const token = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
        if (!token) return res.status(401).json({ error: 'Missing bearer token' });
        if (safeJsonSize(req.body || {}) > WEBHOOK_BODY_LIMIT_BYTES) {
            return res.status(413).json({ error: 'Payload too large' });
        }

        try {
            const tokenAuth = await authenticateIntegrationToken(supabase, {
                authorizationHeader: authHeader,
                requiredScopes: ['p2p:webhook'],
                purpose: 'p2p_webhook',
                requestIp: req.ip || req.headers['x-forwarded-for'] || ''
            });
            const settings = await loadP2pWebhookSettingsForToken(supabase, tokenAuth, token);
            if (!settings?.owner_id || settings.enabled === false) {
                return res.status(403).json({ error: 'Webhook disabled or token invalid' });
            }

            const parsed = parseBankNotificationPayload(req.body || {});
            const now = new Date().toISOString();

            const { data: existing } = await supabase
                .from('p2p_bank_events')
                .select('*')
                .eq('owner_id', settings.owner_id)
                .eq('dedupe_key', parsed.dedupeKey)
                .maybeSingle();
            if (existing) {
                await supabase
                    .from('p2p_webhook_settings')
                    .update({ last_webhook_at: now, last_used_at: now, last_used_ip: req.ip, updated_at: now })
                    .eq('owner_id', settings.owner_id);
                return res.json({
                    success: true,
                    duplicate: true,
                    status: existing.status,
                    purchase_ids: existing.matched_purchase_ids || [],
                    batch_token: existing.matched_batch_token || null
                });
            }

            const { data: inserted, error: insertError } = await supabase
                .from('p2p_bank_events')
                .insert({
                    owner_id: settings.owner_id,
                    source: 'sms_forward',
                    status: 'received',
                    raw_payload: req.body || {},
                    raw_text: parsed.rawText || null,
                    redacted_text: parsed.redactedText || null,
                    sender: parsed.sender || null,
                    amount_rub: parsed.amountRub || null,
                    currency: 'RUB',
                    bank_name: parsed.bankName || null,
                    event_time: parsed.eventTime || null,
                    dedupe_key: parsed.dedupeKey
                })
                .select('*')
                .single();
            if (insertError) throw insertError;

            const match = await matchP2pBankEventToPaymentGroup(supabase, {
                ownerId: settings.owner_id,
                amountRub: parsed.amountRub,
                eventTime: parsed.eventTime,
                settings
            });

            let status = match.status;
            let matchedGroup = null;
            let resolutionType = null;
            let matchReason = match.reason;

            if (match.status === 'matched' && settings.auto_confirm_enabled !== false && match.autoCandidates.length === 1) {
                matchedGroup = match.autoCandidates[0];
                try {
                    await confirmShopP2pPayment(supabase, {
                        sellerOwnerId: settings.owner_id,
                        purchaseIds: matchedGroup.purchaseIds,
                        batchToken: matchedGroup.batchToken,
                        confirmSource: 'bank_webhook',
                        bankEventId: inserted.id,
                        allowPending: false
                    });
                    status = 'confirmed';
                    resolutionType = 'auto_confirmed';
                } catch (confirmError) {
                    status = 'auto_confirm_failed';
                    matchReason = confirmError.message || match.reason;
                }
            }

            const eventPatch = {
                status,
                matched_purchase_ids: matchedGroup?.purchaseIds || (match.autoCandidates?.[0]?.purchaseIds || null),
                matched_batch_token: matchedGroup?.batchToken || (match.autoCandidates?.[0]?.batchToken || null),
                candidate_purchase_ids: flattenPurchaseIds(match.candidates),
                candidate_batch_tokens: flattenBatchTokens(match.candidates),
                resolution_type: resolutionType,
                resolved_at: resolutionType ? now : null,
                confirm_source: resolutionType ? 'bank_webhook' : null,
                match_reason: matchReason,
                updated_at: now
            };

            const { data: updated, error: updateError } = await supabase
                .from('p2p_bank_events')
                .update(eventPatch)
                .eq('id', inserted.id)
                .select('*')
                .single();
            if (updateError) throw updateError;

            await supabase
                .from('p2p_webhook_settings')
                .update({ last_webhook_at: now, last_used_at: now, last_used_ip: req.ip, updated_at: now })
                .eq('owner_id', settings.owner_id);

            res.json({
                success: true,
                status: updated.status,
                purchase_ids: updated.matched_purchase_ids || [],
                batch_token: updated.matched_batch_token || null,
                candidate_purchase_ids: updated.candidate_purchase_ids || [],
                candidate_batch_tokens: updated.candidate_batch_tokens || []
            });
        } catch (error) {
            console.error('Ошибка обработки P2P bank webhook:', error.message);
            res.status(500).json({ error: 'Webhook processing failed' });
        }
    });

    router.post('/:id/confirm', authenticateUser, async (req, res) => {
        try {
            const eventId = req.params.id;
            const { data: event, error: eventError } = await supabase
                .from('p2p_bank_events')
                .select('*')
                .eq('id', eventId)
                .eq('owner_id', req.user.id)
                .maybeSingle();
            if (eventError) throw eventError;
            if (!event) return res.status(404).json({ error: 'Событие банка не найдено' });
            if (event.status === 'confirmed') return res.status(400).json({ error: 'Это событие уже подтвердило оплату' });
            if (event.status === 'ignored') return res.status(400).json({ error: 'Событие уже скрыто' });

            const purchaseIds = parsePurchaseIds(req.body?.purchase_ids);
            const batchToken = String(req.body?.batch_token || '').trim() || null;
            const result = await confirmShopP2pPayment(supabase, {
                sellerOwnerId: req.user.id,
                purchaseIds,
                batchToken,
                confirmSource: 'bank_event_manual',
                bankEventId: eventId,
                allowPending: true
            });
            const now = new Date().toISOString();
            await supabase
                .from('p2p_bank_events')
                .update({
                    status: 'confirmed',
                    matched_purchase_ids: result.purchase_ids || purchaseIds,
                    matched_batch_token: result.batch_token || batchToken,
                    resolution_type: 'manual_confirmed',
                    resolved_at: now,
                    resolved_by_owner_id: req.user.id,
                    confirm_source: 'bank_event_manual',
                    updated_at: now
                })
                .eq('id', eventId)
                .eq('owner_id', req.user.id);
            res.json(result);
        } catch (error) {
            console.error('Ошибка ручного подтверждения P2P bank event:', error.message);
            res.status(error.statusCode || 500).json({ error: error.message || 'Не удалось подтвердить оплату' });
        }
    });

    router.post('/:id/ignore', authenticateUser, async (req, res) => {
        try {
            const { data: event, error: eventError } = await supabase
                .from('p2p_bank_events')
                .select('id, status')
                .eq('id', req.params.id)
                .eq('owner_id', req.user.id)
                .maybeSingle();
            if (eventError) throw eventError;
            if (!event) return res.status(404).json({ error: 'Событие банка не найдено' });
            if (event.status === 'confirmed') return res.status(400).json({ error: 'Подтвержденное событие нельзя скрыть' });

            const now = new Date().toISOString();
            const { error } = await supabase
                .from('p2p_bank_events')
                .update({
                    status: 'ignored',
                    resolution_type: 'ignored',
                    resolved_at: now,
                    resolved_by_owner_id: req.user.id,
                    updated_at: now
                })
                .eq('id', req.params.id)
                .eq('owner_id', req.user.id);
            if (error) throw error;
            res.json({ success: true, status: 'ignored' });
        } catch (error) {
            console.error('Ошибка ignore P2P bank event:', error.message);
            res.status(500).json({ error: 'Не удалось скрыть событие' });
        }
    });

    return router;
}

function parsePurchaseIds(value) {
    if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
    return String(value || '').split(',').map((item) => String(item || '').trim()).filter(Boolean);
}
