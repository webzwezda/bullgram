// Health-check юзербота (стадия 2a разрезки userbot.routes.js).
// Зона: GET /check/:id. Константы таймаутов используются только этой зоной
// и переехали сюда вместе с ней.
import { authenticateUser } from '../../middlewares/auth.middleware.js';
import { decrypt } from '../../utils/crypto.js';
import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';
import { logTelegramErrorEvent } from '../../utils/telegram-error-events.js';
import { cleanupRestrictedUserbotProxy, unpublishRestrictedUserbotListings } from '../../utils/restricted-userbot-ops.js';
import {
    FRESH_IMPORT_RUNTIME_REASON,
    FRESH_IMPORT_RUNTIME_STATUS,
    isFreshImportedUserbot
} from '../../utils/ops-center-selection.js';
import { buildHealthSummary } from '../../utils/telegram-profile.js';
import {
    buildCheckResponse,
    isExpiredUserbotSessionError,
    isUserbotOnDeadProxy,
    withTimeout
} from './helpers-core.js';

const USERBOT_HEALTH_CONNECT_TIMEOUT_MS = Number(process.env.USERBOT_HEALTH_CONNECT_TIMEOUT_MS || 25000);
const USERBOT_HEALTH_INSPECT_TIMEOUT_MS = Number(process.env.USERBOT_HEALTH_INSPECT_TIMEOUT_MS || 35000);

export function registerHealthCheck(router, ctx) {
    const { supabase, userbotService, managedProxyService } = ctx;
    router.get('/check/:id', authenticateUser, async (req, res) => {
        try {
            const { data: account } = await supabase.from('tg_accounts').select('*, proxies(host, port, username, password, is_working, provision_source, inventory_group)').eq('id', req.params.id).eq('owner_id', req.user.id).single();
            if (!account) return res.status(404).json({ error: 'Аккаунт не найден' });
            const activate = String(req.query.activate || '').trim().toLowerCase() === 'true';
            console.log('[USERBOT_CHECK] request', {
                accountId: req.params.id,
                ownerId: req.user?.id || null,
                role: req.profile?.role || null,
                activate,
                runtimeStatus: account.runtime_status || null
            });
            if (isFreshImportedUserbot(account) && activate !== true) {
                return res.status(409).json({
                    status: FRESH_IMPORT_RUNTIME_STATUS,
                    reason: `${FRESH_IMPORT_RUNTIME_REASON} Нажми отдельную живую проверку с подтверждением, чтобы активировать аккаунт.`
                });
            }
            if (isUserbotOnDeadProxy(account)) {
                const failover = await userbotService.tryAutoFailoverUserbot(account);
                if (failover.switched) {
                    await supabase.from('tg_accounts').update({
                        runtime_status: 'online',
                        runtime_error: null,
                        last_checked_at: new Date().toISOString()
                    }).eq('id', account.id).eq('owner_id', req.user.id);
                    console.log('[USERBOT_CHECK] failover_switched', {
                        accountId: account.id,
                        ownerId: req.user?.id || null,
                        nextStatus: 'online',
                        proxyId: failover.to_proxy_id
                    });
                    return res.json(buildCheckResponse(
                        'online',
                        'Сессия отвечает. Прокси был автоматически переключен на живой.',
                        {
                            session: 'alive',
                            restriction: 'clear',
                            restriction_reason: '',
                            spambot: {
                                state: 'not_checked',
                                reason: '',
                                source: 'failover_only'
                            }
                        },
                        { failover_switched: true, proxy_id: failover.to_proxy_id }
                    ));
                }
                await supabase.from('tg_accounts').update({
                    runtime_status: 'dead_proxy',
                    runtime_error: 'У юзербота мертвый прокси.',
                    last_checked_at: new Date().toISOString()
                }).eq('id', account.id).eq('owner_id', req.user.id);
                await logTelegramErrorEvent(supabase, {
                    owner_id: req.user.id,
                    userbot_id: account.id,
                    event_source: 'userbot_health',
                    event_type: 'health_check',
                    restriction_kind: 'dead_proxy',
                    severity: 'danger',
                    error_message: 'У юзербота мертвый прокси.',
                    meta: {
                        account_type: account.account_type || 'userbot'
                    }
                });
                return res.json(buildCheckResponse(
                    'inactive_proxy',
                    'У юзербота мертвый прокси.',
                    {
                        session: 'unknown',
                        restriction: 'unknown',
                        restriction_reason: '',
                        spambot: {
                            state: 'not_checked',
                            reason: '',
                            source: 'proxy_dead'
                        }
                    }
                ));
            }
            const checkedAt = new Date().toISOString();
            const decryptedData = decrypt(account.session_data);
            if (!decryptedData) {
                await supabase.from('tg_accounts').update({
                    runtime_status: 'expired',
                    runtime_error: 'Сессия не читается или уже недействительна.',
                    last_checked_at: checkedAt
                }).eq('id', account.id).eq('owner_id', req.user.id);
                await logTelegramErrorEvent(supabase, {
                    owner_id: req.user.id,
                    userbot_id: account.id,
                    event_source: 'userbot_health',
                    event_type: 'health_check',
                    restriction_kind: 'session_revoked',
                    severity: 'danger',
                    is_restriction: true,
                    error_message: 'Сессия не читается или уже недействительна.',
                    meta: {
                        account_type: account.account_type || 'userbot'
                    }
                });
                return res.json(buildCheckResponse(
                    'expired',
                    'Сессия не читается или уже недействительна.',
                    {
                        session: 'dead',
                        restriction: 'unknown',
                        restriction_reason: '',
                        spambot: {
                            state: 'not_checked',
                            reason: '',
                            source: 'session_invalid'
                        }
                    }
                ));
            }
            const { token, fingerprint } = userbotService.parseSessionData(decryptedData);

            if (account.account_type === 'bot') {
                try {
                    const botToken = String(token || decryptedData || '').trim();
                    const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
                    const data = await response.json();
                    const status = data.ok ? 'online' : 'expired';
                    await supabase.from('tg_accounts').update({
                        runtime_status: status,
                        runtime_error: data.ok ? null : 'Telegram не подтвердил токен official-бота.',
                        last_checked_at: checkedAt
                    }).eq('id', account.id).eq('owner_id', req.user.id);
                    return res.json(buildCheckResponse(status, data.ok ? 'Official-бот отвечает.' : 'Telegram не подтвердил токен official-бота.'));
                } catch (e) {
                    await supabase.from('tg_accounts').update({
                        runtime_status: 'expired',
                        runtime_error: 'Telegram не ответил на проверку official-бота.',
                        last_checked_at: checkedAt
                    }).eq('id', account.id).eq('owner_id', req.user.id);
                    return res.json(buildCheckResponse('expired', 'Telegram не ответил на проверку official-бота.'));
                }
            }

            const proxyData = account.proxies ? { proxy_host: account.proxies.host, proxy_port: account.proxies.port, proxy_username: account.proxies.username, proxy_password: account.proxies.password } : undefined;
            const clientConfig = userbotService._getClientConfig(userbotService._buildProxy(proxyData), 1, fingerprint, proxyData);
            const client = new TelegramClient(new StringSession(token), fingerprint.api_id, fingerprint.api_hash, clientConfig);
            userbotService.prepareServiceClient(client);
            userbotService._forceManagedIpv6Dc(client, proxyData);
            let connectOk = false;
            let getMeOk = false;
            try {
                console.log('[USERBOT_CHECK] connect_start', {
                    accountId: account.id,
                    ownerId: req.user?.id || null,
                    proxy: proxyData?.proxy_host && proxyData?.proxy_port
                        ? `${proxyData.proxy_host}:${proxyData.proxy_port}`
                        : null
                });
                await withTimeout(
                    userbotService.connectWithProxyFallback(client, proxyData),
                    USERBOT_HEALTH_CONNECT_TIMEOUT_MS,
                    'Telegram не ответил на подключение за отведенное время. Проверь прокси и повтори проверку.'
                );
                connectOk = true;
                console.log('[USERBOT_CHECK] connect_ok', {
                    accountId: account.id,
                    ownerId: req.user?.id || null
                });
                await withTimeout(
                    client.getMe(),
                    USERBOT_HEALTH_INSPECT_TIMEOUT_MS,
                    'Telegram не отдал профиль аккаунта за отведенное время.'
                );
                getMeOk = true;
                console.log('[USERBOT_CHECK] get_me_ok', {
                    accountId: account.id,
                    ownerId: req.user?.id || null
                });
                const health = await withTimeout(
                    userbotService.inspectAccountHealth(client, {
                        userbotId: account.id
                    }),
                    USERBOT_HEALTH_INSPECT_TIMEOUT_MS,
                    'Telegram health-check завис на SpamBot/profile check. Проверь прокси и повтори проверку.'
                );
                await supabase.from('tg_accounts').update({
                    runtime_status: health.status || 'error',
                    runtime_error: health.reason || null,
                    last_checked_at: checkedAt,
                    health_summary: buildHealthSummary(health, checkedAt)
                }).eq('id', account.id).eq('owner_id', req.user.id);
                console.log('[USERBOT_CHECK] result', {
                    accountId: account.id,
                    ownerId: req.user?.id || null,
                    nextStatus: health.status || 'error',
                    reason: health.reason || null
                });
                if (String(health.status || '') === 'restricted') {
                    await unpublishRestrictedUserbotListings(supabase, req.user.id, account.id, health.reason || 'account_restricted');
                    await cleanupRestrictedUserbotProxy(supabase, managedProxyService, req.user.id, account);
                }
                // Заморозка: аккаунт жив, сессия нужна для апелляции — снимаем с
                // витрины, но прокси и аккаунт не трогаем (пуржа для frozen нет).
                if (String(health.status || '') === 'frozen') {
                    await unpublishRestrictedUserbotListings(supabase, req.user.id, account.id, health.reason || 'account_frozen');
                }
                res.json(buildCheckResponse(
                    health.status,
                    health.reason || null,
                    health.details || null
                ));
                if (['restricted', 'expired', 'error', 'frozen'].includes(String(health.status || ''))) {
                    await logTelegramErrorEvent(supabase, {
                        owner_id: req.user.id,
                        userbot_id: account.id,
                        event_source: 'userbot_health',
                        event_type: 'health_check',
                        restriction_kind: health.status === 'restricted' ? 'account_restricted' : (health.status || 'error'),
                        severity: ['restricted', 'frozen'].includes(health.status) ? 'danger' : 'warning',
                        is_restriction: health.status === 'restricted',
                        error_message: health.reason || 'Проблема при health-check.',
                        meta: {
                            account_type: account.account_type || 'userbot'
                        }
                    });
                }
            }
            catch (authErr) {
                const rawCheckError = String(authErr?.message || authErr || '').trim();
                const normalizedCheckError = rawCheckError.toUpperCase();
                const isInspectTimeout = rawCheckError.includes('health-check')
                    || rawCheckError.includes('SpamBot')
                    || rawCheckError.includes('профиль аккаунта');
                const isSessionInvalid = isExpiredUserbotSessionError(authErr)
                    || normalizedCheckError.includes('USER_DEACTIVATED')
                    || normalizedCheckError.includes('AUTH_KEY_INVALID');
                const isConnectFailure = !connectOk && (
                    rawCheckError.includes('подключение')
                    || normalizedCheckError.includes('ECONNREFUSED')
                    || normalizedCheckError.includes('ETIMEDOUT')
                    || normalizedCheckError.includes('SOCKS')
                    || normalizedCheckError.includes('NETWORK')
                    || normalizedCheckError.includes('CONNECTION')
                );
                const isDegradedAfterAlive = getMeOk && isInspectTimeout;
                const isFrozenDetected = normalizedCheckError.includes('FROZEN_METHOD_INVALID');
                const nextStatus = isFrozenDetected ? 'frozen'
                    : isConnectFailure ? 'dead_proxy'
                    : (isSessionInvalid ? 'expired'
                        : (isDegradedAfterAlive ? 'online'
                            : (isInspectTimeout ? 'error' : 'expired')));
                const nextReason = isDegradedAfterAlive
                    ? 'Сессия отвечает, но SpamBot/profile check не успел завершиться.'
                    : (rawCheckError || 'Проверка сессии не прошла.');
                console.error('Ошибка health-check юзербота:', authErr);
                await supabase.from('tg_accounts').update({
                    runtime_status: nextStatus,
                    runtime_error: isDegradedAfterAlive ? null : nextReason,
                    last_checked_at: checkedAt
                }).eq('id', account.id).eq('owner_id', req.user.id);
                console.error('[USERBOT_CHECK] auth_failed', {
                    accountId: account.id,
                    ownerId: req.user?.id || null,
                    nextStatus,
                    connectOk,
                    getMeOk,
                    isInspectTimeout,
                    reason: nextReason
                });
                if (!isDegradedAfterAlive) {
                    await logTelegramErrorEvent(supabase, {
                        owner_id: req.user.id,
                        userbot_id: account.id,
                        event_source: 'userbot_health',
                        event_type: 'health_check',
                        restriction_kind: nextStatus,
                        error: authErr,
                        severity: nextStatus === 'expired' ? 'danger' : 'warning',
                        meta: {
                            account_type: account.account_type || 'userbot'
                        }
                    });
                }
                res.json(buildCheckResponse(
                    nextStatus,
                    nextReason,
                    {
                        session: (isDegradedAfterAlive || (connectOk && isInspectTimeout))
                            ? 'alive'
                            : (nextStatus === 'expired' ? 'dead' : 'unknown'),
                        restriction: 'unknown',
                        restriction_reason: '',
                        spambot: {
                            state: isInspectTimeout ? 'error' : 'not_checked',
                            reason: isInspectTimeout ? nextReason : '',
                            source: isInspectTimeout ? 'inspection_timeout' : 'auth_error'
                        }
                    }
                ));
            }
            finally { await client.disconnect(); }
        } catch (error) { res.status(500).json({ error: 'Ошибка проверки' }); }
    });

}
