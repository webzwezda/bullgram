// Универсальный роутер исходящих ЛС (messaging router): одна точка для ручных отправок,
// рассылок и фолбэков. Даёт: единый eligibility-фильтр актёров (зеркало isUserbotEligible
// из contour-admin-rights.service.js), квоты по леджеру userbot_send_log, персистентные
// паузы на tg_accounts.dm_paused_until, ротацию пула (touchpoint первым → наименее
// загруженный) и джиттер между попытками.
// План: docs/plans/2026-09-16-messaging-router.md, SQL: backend/sql/messaging-router.sql
import { createClient } from '@supabase/supabase-js';
import { UserbotService } from './userbot.service.js';
import { classifyTelegramError } from '../utils/telegram-error-events.js';

const DEFAULT_HOURLY_CAP = 20;
const DEFAULT_DAILY_CAP = 50;
const DEFAULT_JITTER_PERCENT = 20;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// sendMessage очеловечивает ошибки Telegram (getDirectMessageError) и теряет retry_after.
// Без секунд паузим на консервативный максимум часового flood-окна.
const FLOOD_FALLBACK_SECONDS = 3600;
const FLOOD_MAX_SECONDS = 3600;
const FLOOD_PAUSE_PADDING_MS = 30 * 1000;
const FLAGGED_PAUSE_MS = 24 * HOUR_MS;

// Те же маркеры недоступности, что в contour isUserbotEligible (BLOCKED_USERBOT_STATUSES).
const BLOCKED_USERBOT_STATUSES = new Set(['restricted', 'expired', 'error']);

// Фразы из getDirectMessageError (userbot.service.js): он возвращает готовый русский текст,
// исходные Telegram-маркеры до classifyTelegramError не доживают.
const HUMANIZED_ERROR_MARKERS = [
    ['flood wait', 'flood_wait'],
    ['spambot подтвердил', 'account_flagged'],
    ['сессия юзербота сдохла', 'session_revoked'],
    ['приватность', 'privacy_restricted'],
    ['заблокировал юзербота', 'user_blocked'],
    ['не смог корректно собрать telegram peer', 'peer_invalid']
];

function readNonNegativeIntEnv(raw, fallback) {
    const parsed = Number.parseInt(String(raw ?? '').trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return parsed;
}

function parseTimestampMs(value) {
    if (value == null || value === '') return null;
    const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isNaN(ms) ? null : ms;
}

export function resolveMessagingCaps(env = process.env) {
    return {
        hourlyCap: readNonNegativeIntEnv(env.USERBOT_DM_HOURLY_CAP, DEFAULT_HOURLY_CAP),
        dailyCap: readNonNegativeIntEnv(env.USERBOT_DM_DAILY_CAP, DEFAULT_DAILY_CAP),
        jitterPercent: readNonNegativeIntEnv(env.USERBOT_DM_JITTER_PERCENT, DEFAULT_JITTER_PERCENT)
    };
}

export function estimateCapacity({ audienceSize, poolSize, dailyCap }) {
    const audience = Math.max(0, Math.trunc(Number(audienceSize) || 0));
    const pool = Math.max(0, Math.trunc(Number(poolSize) || 0));
    // cap <= 0 ломает деление — считаем как 1 (худший случай); валидные cap всегда > 0.
    const cap = Math.max(1, Math.trunc(Number(dailyCap) || 0));

    if (audience === 0) {
        return { audienceSize: 0, poolSize: pool, dailyCap: cap, botsNeeded: 0, days: 0 };
    }

    return {
        audienceSize: audience,
        poolSize: pool,
        dailyCap: cap,
        botsNeeded: Math.ceil(audience / cap),
        days: pool > 0 ? Math.ceil(audience / (pool * cap)) : null
    };
}

export function isActorEligible(account, { now } = {}) {
    if (!account) return false;
    const runtimeStatus = String(account.runtime_status || '').trim().toLowerCase();
    if (runtimeStatus === 'pending_activation') return false;
    if (BLOCKED_USERBOT_STATUSES.has(runtimeStatus)) return false;
    // мёртвый прокси — тот же маркер, что в contour isUserbotEligible
    if (account.proxy_id && account.proxies?.is_working === false) return false;
    const nowMs = parseTimestampMs(now) ?? Date.now();
    const pausedUntilMs = parseTimestampMs(account.dm_paused_until);
    if (pausedUntilMs != null && pausedUntilMs > nowMs) return false;
    return true;
}

function classifySendErrorKind(error) {
    const kind = classifyTelegramError(error).restriction_kind;
    if (kind && kind !== 'unknown') return kind;
    const normalized = String(
        error?.errorMessage || error?.message || error?.description || error || ''
    ).toLowerCase();
    for (const [marker, mapped] of HUMANIZED_ERROR_MARKERS) {
        if (normalized.includes(marker)) return mapped;
    }
    return 'unknown';
}

function extractFloodRetrySeconds(error) {
    const direct = Number(error?.retry_after ?? error?.parameters?.retry_after);
    if (Number.isFinite(direct) && direct >= 0) return direct;
    const match = String(error?.errorMessage || error?.message || '')
        .toUpperCase()
        .match(/FLOOD_WAIT_(\d+)/);
    return match ? Number(match[1]) : null;
}

function createDefaultSupabase() {
    return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function createDefaultSendUserbot(supabase) {
    const userbotService = new UserbotService(
        supabase,
        Number(process.env.TG_API_ID) || 4,
        process.env.TG_API_HASH || '014b35b6184100b085b0d0572f9b5103'
    );
    return (account, tgUserId, text, options) =>
        userbotService.sendMessage(account, tgUserId, text, options);
}

export class MessagingRouter {
    constructor(deps = {}) {
        this.supabase = deps.supabase || createDefaultSupabase();
        this.caps = resolveMessagingCaps(process.env);
        this.deps = {
            now: deps.now || (() => Date.now()),
            sleep: deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
            random: deps.random || Math.random,
            sendUserbot: deps.sendUserbot || createDefaultSendUserbot(this.supabase)
        };
    }

    // Квоты считаются по леджеру: только реально доставленные ('sent') попытки.
    async countSends(actorId, { since } = {}) {
        if (!actorId) return 0;
        let query = this.supabase
            .from('userbot_send_log')
            .select('id', { count: 'exact', head: true })
            .eq('actor_id', actorId)
            .eq('status', 'sent');
        if (since) query = query.gte('created_at', since);
        const { count, error } = await query;
        if (error) throw error;
        return count || 0;
    }

    async isUnderQuota(actorId, { now } = {}) {
        const nowMs = parseTimestampMs(now) ?? this.deps.now();
        const hourly = await this.countSends(actorId, { since: new Date(nowMs - HOUR_MS).toISOString() });
        if (hourly >= this.caps.hourlyCap) return { ok: false, reason: 'hourly_cap' };
        const daily = await this.countSends(actorId, { since: new Date(nowMs - DAY_MS).toISOString() });
        if (daily >= this.caps.dailyCap) return { ok: false, reason: 'daily_cap' };
        return { ok: true, reason: null };
    }

    async getActorPause(accountId) {
        const { data, error } = await this.supabase
            .from('tg_accounts')
            .select('dm_paused_until, dm_pause_reason')
            .eq('id', accountId)
            .maybeSingle();
        if (error) throw error;
        if (!data?.dm_paused_until) return null;
        return { until: data.dm_paused_until, reason: data.dm_pause_reason || null };
    }

    async pauseActor(accountId, untilIso, reason, ownerId = null) {
        let query = this.supabase
            .from('tg_accounts')
            .update({ dm_paused_until: untilIso, dm_pause_reason: reason || null })
            .eq('id', accountId);
        if (ownerId) query = query.eq('owner_id', ownerId);
        const { error } = await query;
        if (error) throw error;
    }

    async clearPause(accountId, ownerId = null) {
        let query = this.supabase
            .from('tg_accounts')
            .update({ dm_paused_until: null, dm_pause_reason: null })
            .eq('id', accountId);
        if (ownerId) query = query.eq('owner_id', ownerId);
        const { error } = await query;
        if (error) throw error;
    }

    async recordSend({
        ownerId,
        actorType = 'userbot',
        actorId,
        campaignId = null,
        tgUserId,
        status,
        errorKind = null,
        idempotencyKey = null
    }) {
        const { error } = await this.supabase
            .from('userbot_send_log')
            .insert({
                owner_id: ownerId,
                actor_type: actorType,
                actor_id: actorId,
                campaign_id: campaignId || null,
                tg_user_id: String(tgUserId ?? ''),
                status,
                error_kind: errorKind || null,
                idempotency_key: idempotencyKey || null
            });
        if (!error) return { recorded: true };
        // Ключ уже отработал (частичный unique index по idempotency_key) — дубль, не бросаем.
        if (error.code === '23505' || /duplicate key|unique constraint|idempotency/i.test(String(error.message || ''))) {
            return { recorded: false };
        }
        throw error;
    }

    /**
     * Отправка одному получателю через пул юзерботов: touchpoint-актёр первым,
     * далее по минимуму суточных отправок. Неэлигибельные/на паузе/исчерпавшие
     * квоту — пропускаются без sleep и без попытки. Между попытками — джиттер
     * ±jitterPercent от baseDelayMs (не перед первой попыткой). Наружу не бросает.
     */
    async deliver({
        ownerId,
        tgUserId,
        text,
        pool,
        baseDelayMs = 5000,
        touchpointActorId = null,
        commonChatId = null,
        eventSource = 'messaging_router',
        campaignId = null,
        idempotencyKey = null
    }) {
        const poolExhausted = {
            status: 'failed',
            actorType: null,
            actorId: null,
            errorKind: 'pool_exhausted',
            errorText: 'Юзерботы пула недоступны: пауза, квота или ошибка Telegram.'
        };

        const candidates = (Array.isArray(pool) ? pool : []).filter(Boolean);
        if (candidates.length === 0) return poolExhausted;

        // Счётчик отправлений за сутки: читаем один раз, дальше обновляем в памяти.
        const dayAgoIso = new Date(this.deps.now() - DAY_MS).toISOString();
        const sentCounts = new Map();
        for (const account of candidates) {
            sentCounts.set(String(account.id), await this.countSends(account.id, { since: dayAgoIso }));
        }

        const touchpointId = touchpointActorId != null ? String(touchpointActorId) : null;
        const ordered = [...candidates].sort((a, b) => {
            const aTouch = a && touchpointId != null && String(a.id) === touchpointId ? 0 : 1;
            const bTouch = b && touchpointId != null && String(b.id) === touchpointId ? 0 : 1;
            if (aTouch !== bTouch) return aTouch - bTouch;
            return (sentCounts.get(String(a.id)) || 0) - (sentCounts.get(String(b.id)) || 0);
        });

        let attempts = 0;
        for (const account of ordered) {
            const nowMs = this.deps.now();
            if (!isActorEligible(account, { now: nowMs })) continue;
            const quota = await this.isUnderQuota(account.id, { now: nowMs });
            if (!quota.ok) continue;

            if (attempts > 0) {
                const jitterSpan = (this.caps.jitterPercent / 100) * baseDelayMs;
                await this.deps.sleep(Math.max(0, baseDelayMs + (this.deps.random() * 2 - 1) * jitterSpan));
            }
            attempts += 1;
            // Ключ идемпотентности держит только первая попытка: если первая не прошла,
            // повторная попытка в рамках этого deliver не должна упираться в уже
            // отработавший ключ и остаться незаходящей в леджер.
            const attemptIdempotencyKey = attempts === 1 ? idempotencyKey : null;

            try {
                await this.deps.sendUserbot(account, tgUserId, text, {
                    event_source: eventSource,
                    event_type: 'messaging_router',
                    ...(campaignId ? { campaign_id: campaignId } : {}),
                    ...(commonChatId ? { common_chat_id: String(commonChatId) } : {})
                });
            } catch (error) {
                const errorKind = classifySendErrorKind(error);
                await this.recordSend({
                    ownerId,
                    actorId: account.id,
                    campaignId,
                    tgUserId,
                    status: 'failed',
                    errorKind,
                    idempotencyKey: attemptIdempotencyKey
                });

                if (errorKind === 'flood_wait') {
                    const retrySeconds = extractFloodRetrySeconds(error);
                    const bounded = Math.min(
                        Number.isFinite(retrySeconds) && retrySeconds != null ? retrySeconds : FLOOD_FALLBACK_SECONDS,
                        FLOOD_MAX_SECONDS
                    );
                    const pausedUntilIso = new Date(this.deps.now() + bounded * 1000 + FLOOD_PAUSE_PADDING_MS).toISOString();
                    await this.pauseActor(account.id, pausedUntilIso, 'flood_wait', ownerId);
                    // Зеркалим паузу на in-memory снимок пула: пул загружается один раз на
                    // кампанию/тик, и без зеркала остаток получателей продолжил бы бить
                    // реальными попытками по flood-лимированной сессии.
                    account.dm_paused_until = pausedUntilIso;
                    account.dm_pause_reason = 'flood_wait';
                } else if (['account_flagged', 'session_revoked', 'account_restricted'].includes(errorKind)) {
                    const pausedUntilIso = new Date(this.deps.now() + FLAGGED_PAUSE_MS).toISOString();
                    await this.pauseActor(account.id, pausedUntilIso, errorKind, ownerId);
                    account.dm_paused_until = pausedUntilIso;
                    account.dm_pause_reason = errorKind;
                }
                continue;
            }

            await this.recordSend({
                ownerId,
                actorId: account.id,
                campaignId,
                tgUserId,
                status: 'sent',
                idempotencyKey: attemptIdempotencyKey
            });
            sentCounts.set(String(account.id), (sentCounts.get(String(account.id)) || 0) + 1);
            return {
                status: 'sent',
                actorType: 'userbot',
                actorId: account.id,
                errorKind: null,
                errorText: null
            };
        }

        return poolExhausted;
    }
}
