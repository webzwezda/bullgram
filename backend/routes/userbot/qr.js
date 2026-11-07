// QR-подключение юзербота (стадия 2a разрезки userbot.routes.js).
// Зона: POST /qr-start, GET /qr-status, POST /qr-password.
// GET /fingerprint-profiles переехал сюда на финальной стадии 2b — первым
// роутом, как в исходном порядке регистрации главного файла.
import { authenticateUser } from '../../middlewares/auth.middleware.js';
import { encrypt } from '../../utils/crypto.js';
import { enforceUserbotQuota } from '../../utils/product-tier.js';
import {
    PROXY_POOL_EXHAUSTED_ALERT_KEY,
    buildProxyDataFromManagedSlot,
    claimFreeManagedSlot,
    releaseFreeManagedSlot
} from '../../services/proxy-allocation.service.js';
import { notifyPlatformAlert } from '../../utils/platform-telegram-alert.js';
import { FRESH_IMPORT_RUNTIME_REASON, FRESH_IMPORT_RUNTIME_STATUS } from '../../utils/ops-center-selection.js';
import { buildTelegramProfilePatch } from '../../utils/telegram-profile.js';
import { isExpiredUserbotSessionError } from './helpers-core.js';
import { normalizeFingerprintPayload, validateCustomFingerprintPayload } from './helpers-center.js';
import {
    ensureExclusiveProxyAssignment,
    ensureUserbotNotOwnedByAnotherAdmin,
    loadOwnedProxy
} from './helpers-proxy.js';
import { reconcileExpiredTrialProxyLease } from './helpers-lease.js';

// BACKLOG §32: единый текст для владельца, когда free-pool claim не удался
// (pool_empty / race_lost) и своего прокси в запросе не было.
const PROXY_POOL_EMPTY_MESSAGE = 'Свободных платформенных прокси сейчас нет — подключите свой прокси или попробуйте позже.';

export function registerQr(router, ctx) {
    const { supabase, userbotService } = ctx;

    // ==========================================
    // 3. ГЕНЕРАЦИЯ QR (Классический метод)
    // ==========================================
    router.get('/fingerprint-profiles', authenticateUser, async (req, res) => {
        try {
            const profiles = await userbotService.listQrFingerprintProfiles(req.user.id);
            res.json({ profiles });
        } catch (error) {
            console.error('[USERBOT_FINGERPRINT_PROFILES] failed:', error?.message || error);
            res.status(500).json({ error: 'Не удалось загрузить fingerprint-пресеты.' });
        }
    });

    router.post('/qr-start', authenticateUser, async (req, res) => {
        // Слот, заклеймленный из платформенного пула (BACKLOG §32) на этом
        // запросе. Нужен в catch: любой провал после claim возвращает слот в пул.
        // reused = слот переиспользован из осиротевших (в пул не возвращается).
        let claimedSlotId = null;
        let claimedSlotReused = false;
        try {
            await userbotService.sweepStaleQrSessions();

            const { proxy_id, fingerprint_profile_id, custom_fingerprint, save_as_preset } = req.body;
            const normalizedCustomFingerprint = custom_fingerprint ? normalizeFingerprintPayload(custom_fingerprint) : null;

            if (normalizedCustomFingerprint) {
                validateCustomFingerprintPayload(normalizedCustomFingerprint);
            }

            console.log(
                '[QR-ROUTE] Начинаем генерацию QR, proxy_id:',
                proxy_id,
                'fingerprint_profile_id:',
                fingerprint_profile_id || 'default',
                'custom_fingerprint:',
                normalizedCustomFingerprint ? normalizedCustomFingerprint.label || 'custom' : 'none',
                'save_as_preset:',
                !!save_as_preset
            );

            // Ретрай QR: если прошлый запрос заклеймил слот, но до привязки не
            // дошёл (владелец бросил экран, авторизация не удалась) — вернём его
            // в пул перед новым claim. Non-fatal: провал не блокирует старт.
            const previousSession = userbotService.qrSessions.get(req.user.id);
            if (previousSession?.claimedProxySlotId) {
                const staleSlotId = previousSession.claimedProxySlotId;
                const staleWasReused = previousSession.claimedProxySlotReused === true;
                previousSession.claimedProxySlotId = null;
                previousSession.claimedProxySlotReused = false;
                if (staleWasReused) {
                    // Осиротевший слот владельца — он и остаётся у владельца;
                    // новый claim ниже переиспользует его же (консервация пула).
                    req.log.info({ owner_id: req.user.id, slot_id: staleSlotId }, 'QR retry: reused orphan slot stays with owner');
                } else {
                    try {
                        await releaseFreeManagedSlot(supabase, req.user.id, staleSlotId);
                        req.log.warn({ owner_id: req.user.id, slot_id: staleSlotId }, 'QR retry: unbound managed slot returned to pool');
                    } catch (releaseError) {
                        req.log.warn({ err: releaseError, owner_id: req.user.id, slot_id: staleSlotId }, 'QR retry: release of previous claimed slot failed (non-fatal)');
                    }
                }
            }

            let proxyData = null;
            if (!proxy_id) {
                // Бесшовная выдача (BACKLOG §32): proxy_id не передан — пробуем
                // занять свободный managed-слот ДО подключения к Telegram.
                // flag_off → ровно прежнее поведение (400 «выбери прокси»).
                // Алерт не инжектим в claim: текст с контекстом (owner, причина,
                // поверхность) собирает роут ниже, дедуп notifyPlatformAlert
                // гасит повтор от сервиса.
                const claim = await claimFreeManagedSlot(supabase, req.user.id);
                if (!claim.claimed) {
                    if (claim.reason === 'pool_empty' || claim.reason === 'race_lost') {
                        try {
                            await notifyPlatformAlert(
                                PROXY_POOL_EXHAUSTED_ALERT_KEY,
                                `Пул платформенных прокси исчерпан (${claim.reason}): owner ${req.user.id} не смог начать QR-подключение. Пополни пул mp_* слотов.`
                            );
                        } catch (alertError) {
                            req.log.warn({ err: alertError, owner_id: req.user.id }, 'proxy pool alert failed (non-fatal)');
                        }
                        return res.status(400).json({ error: PROXY_POOL_EMPTY_MESSAGE });
                    }
                    // Флаг выключен, а в UI платформенный пункт выбран по умолчанию:
                    // старый текст «выбери живой прокси» звучал бы как противоречие.
                    return res.status(400).json({ error: 'Платформенный прокси сейчас недоступен — выбери свой прокси в списке.' });
                }
                claimedSlotId = claim.slot.id;
                claimedSlotReused = claim.reused === true;
                proxyData = buildProxyDataFromManagedSlot(claim.slot);
                req.log.info({ owner_id: req.user.id, slot_id: claimedSlotId, reused: claimedSlotReused, host: claim.slot.host, port: claim.slot.port }, 'QR-ROUTE: claimed managed proxy slot from platform pool');
            } else if (req.profile?.role !== 'admin') {
                await reconcileExpiredTrialProxyLease(supabase, req.user.id, req.profile);
            }

            if (proxy_id) {
                const data = await loadOwnedProxy(supabase, req.user.id, proxy_id);
                if (data) {
                    proxyData = {
                        proxy_host: data.host,
                        proxy_port: data.port,
                        proxy_username: data.username,
                        proxy_password: data.password,
                        proxy_id: data.id,
                        is_working: data.is_working,
                        last_check_ip: data.last_check_ip,
                        last_check_country: data.last_check_country,
                        last_check_city: data.last_check_city,
                        force_ipv6: data.is_working === true && (!data.last_check_ip || data.last_check_ip.includes(':')),
                        provision_source: data.provision_source,
                        inventory_group: data.inventory_group
                    };
                    console.log('[QR-ROUTE] Прокси найден:', proxyData.proxy_host, ':', proxyData.proxy_port);
                    if (data.is_working === false) {
                        return res.status(400).json({ error: 'Этот прокси уже помечен как мертвый. Сначала почини его или выбери другой.' });
                    }
                    await ensureExclusiveProxyAssignment(supabase, req.user.id, proxy_id);
                } else {
                    console.log('[QR-ROUTE] Прокси с ID', proxy_id, 'не найден в БД');
                    return res.status(400).json({ error: 'Выбранный прокси не найден или не принадлежит тебе.' });
                }
            }

            const result = await userbotService.generateQR(req.user.id, proxyData, {
                profile_id: fingerprint_profile_id,
                custom_fingerprint: normalizedCustomFingerprint,
                save_as_preset: !!save_as_preset,
                preset_label: normalizedCustomFingerprint?.label || ''
            }, req.user.id);
            // Помечаем на qr-сессии, что слот заклеймлен здесь: qr-status по этой
            // метке привяжет слот к аккаунту или вернёт его в пул при провале.
            if (claimedSlotId) {
                const liveSession = userbotService.qrSessions.get(req.user.id);
                if (liveSession) {
                    liveSession.claimedProxySlotId = claimedSlotId;
                    liveSession.claimedProxySlotReused = claimedSlotReused;
                }
            }
            console.log('[QR-ROUTE] QR-сессия запущена, генерация идет в фоне');
            res.json(result);
        } catch (error) {
            if (claimedSlotId && !claimedSlotReused) {
                try {
                    await releaseFreeManagedSlot(supabase, req.user.id, claimedSlotId);
                    req.log.warn({ owner_id: req.user.id, slot_id: claimedSlotId }, 'QR start failed — claimed managed slot returned to pool');
                } catch (releaseError) {
                    req.log.warn({ err: releaseError, owner_id: req.user.id, slot_id: claimedSlotId }, 'release of claimed managed slot failed (non-fatal)');
                }
            }
            console.error('[QR-ROUTE] ❌ ОШИБКА при генерации QR:', error.message);
            const statusCode = String(error.message || '').includes('только через прокси') ? 400 : 500;
            res.status(statusCode).json({
                error: statusCode === 400
                    ? (error.message || 'Ошибка инициализации клиента')
                    : 'Не удалось подготовить QR-вход. Проверь прокси и попробуй еще раз.'
            });
        }
    });

    router.get('/qr-status', authenticateUser, async (req, res) => {
        await userbotService.sweepStaleQrSessions();

        const sessionData = userbotService.qrSessions.get(req.user.id);
        if (!sessionData) return res.status(404).json({ status: 'not_found' });

        try {
            if (sessionData.authState === 'failed') {
                // Подключение не состоялось — заклеймленный managed-слот
                // возвращаем в пул (BACKLOG §32). Non-fatal: статус failed важнее.
                if (sessionData.claimedProxySlotId) {
                    const failedSlotId = sessionData.claimedProxySlotId;
                    const failedWasReused = sessionData.claimedProxySlotReused === true;
                    sessionData.claimedProxySlotId = null;
                    sessionData.claimedProxySlotReused = false;
                    if (failedWasReused) {
                        // Осиротевший слот возвращается в состояние «у владельца,
                        // без привязки» — в общий пул его не отдаём.
                        req.log.info({ owner_id: req.user.id, slot_id: failedSlotId }, 'QR auth failed — reused orphan slot stays with owner');
                    } else {
                        try {
                            await releaseFreeManagedSlot(supabase, req.user.id, failedSlotId);
                            req.log.warn({ owner_id: req.user.id, slot_id: failedSlotId }, 'QR auth failed — claimed managed slot returned to pool');
                        } catch (releaseError) {
                            req.log.warn({ err: releaseError, owner_id: req.user.id, slot_id: failedSlotId }, 'release of claimed managed slot failed (non-fatal)');
                        }
                    }
                }
                return res.json({
                    status: 'failed',
                    error: sessionData.authError || 'QR-вход не прошел. Сгенерируй QR заново.'
                });
            }
            if (sessionData.authState === '2fa_required') {
                // Скан принят, Telegram ждет auth.checkPassword — фронт покажет
                // форму облачного пароля, ответ придет в POST /qr-password.
                const gate = sessionData.passwordGate;
                return res.json({
                    status: '2fa_required',
                    password_hint: gate?.getHint() || '',
                    password_error: gate?.getError() || null
                });
            }
            if (sessionData.authState !== 'authorized') {
                if (!sessionData.currentQrCode) {
                    // Клиент еще поднимается через прокси, первого токена нет.
                    return res.json({ status: 'generating' });
                }
                // Токен QR ротируется каждые ~30с: отдаём свежую картинку,
                // фронт подменяет QR на экране, пока владелец ещё не отсканил.
                return res.json({ status: 'pending', qr_code: sessionData.currentQrCode });
            }

            const savedSession = sessionData.client?.session?.save?.() || '';
            if (savedSession === '') {
                return res.json({ status: 'pending' });
            }

            const token = savedSession;
            const me = await sessionData.client.getMe();
            let existingAccountId = null;

            const { data: existingAccount } = await supabase
                .from('tg_accounts')
                .select('id, proxy_id')
                .eq('owner_id', req.user.id)
                .eq('account_type', 'userbot')
                .eq('tg_account_id', me.id.toString())
                .maybeSingle();

            existingAccountId = existingAccount?.id || null;
            // Консервация пула (§32): аккаунт уже имеет прокси — реконнект не
            // должен выдавать второй слот. Новый клейм возвращаем в пул,
            // существующая привязка остаётся (в upsert пишем её же).
            if (sessionData.claimedProxySlotId && existingAccount?.proxy_id && existingAccount.proxy_id !== sessionData.claimedProxySlotId) {
                const staleSlotId = sessionData.claimedProxySlotId;
                const staleWasReused = sessionData.claimedProxySlotReused === true;
                sessionData.claimedProxySlotId = null;
                sessionData.claimedProxySlotReused = false;
                sessionData.keepExistingProxyId = existingAccount.proxy_id;
                if (staleWasReused) {
                    req.log.warn({ owner_id: req.user.id, slot_id: staleSlotId, account_id: existingAccountId }, 'reconnect: account already has proxy, reused orphan slot stays with owner');
                } else {
                    try {
                        await releaseFreeManagedSlot(supabase, req.user.id, staleSlotId);
                        req.log.warn({ owner_id: req.user.id, slot_id: staleSlotId, account_id: existingAccountId }, 'reconnect: account already has proxy, claimed slot returned to pool');
                    } catch (releaseError) {
                        req.log.warn({ err: releaseError, owner_id: req.user.id, slot_id: staleSlotId }, 'reconnect: release of claimed slot failed (non-fatal)');
                    }
                }
            }
            await enforceUserbotQuota({
                supabase,
                ownerId: req.user.id,
                profile: req.profile,
                ignoreAccountId: existingAccountId
            });
            await ensureUserbotNotOwnedByAnotherAdmin(supabase, req.user.id, me.id.toString(), existingAccountId);
            if (sessionData.proxyData?.proxy_id) {
                await ensureExclusiveProxyAssignment(supabase, req.user.id, sessionData.proxyData.proxy_id, existingAccountId);
            }

            const upsertProxyId = sessionData.claimedProxySlotId
                ? sessionData.claimedProxySlotId
                : sessionData.keepExistingProxyId
                    ? sessionData.keepExistingProxyId
                    : sessionData.proxyData
                        ? sessionData.proxyData.proxy_id
                        : null;
            await supabase.from('tg_accounts').upsert({
                owner_id: req.user.id,
                account_type: 'userbot',
                ...buildTelegramProfilePatch(me),
                session_data: encrypt(userbotService.stringifySessionData(token, sessionData.fingerprint, 'qr')),
                proxy_id: upsertProxyId,
                runtime_status: FRESH_IMPORT_RUNTIME_STATUS,
                runtime_error: FRESH_IMPORT_RUNTIME_REASON,
                allow_proxy_failover: false,
                failover_proxy_ids: []
            }, { onConflict: 'owner_id, tg_account_id' });

            // Привязка заклеймленного managed-слота (BACKLOG §32): upsert уже
            // записал proxy_id из proxyData; дообновляем tenant-безопасным
            // update (where id + owner_id). После привязки слот потреблён —
            // release больше не делаем. Non-fatal: провал не ломает успех.
            const claimedSlotId = sessionData.claimedProxySlotId || null;
            if (claimedSlotId) {
                sessionData.claimedProxySlotId = null;
                try {
                    const { data: savedAccount } = await supabase
                        .from('tg_accounts')
                        .select('id')
                        .eq('owner_id', req.user.id)
                        .eq('account_type', 'userbot')
                        .eq('tg_account_id', me.id.toString())
                        .maybeSingle();
                    if (savedAccount?.id) {
                        const { error: linkError } = await supabase
                            .from('tg_accounts')
                            .update({ proxy_id: claimedSlotId })
                            .eq('id', savedAccount.id)
                            .eq('owner_id', req.user.id);
                        if (linkError) throw linkError;
                        req.log.info({ owner_id: req.user.id, account_id: savedAccount.id, slot_id: claimedSlotId }, 'claimed managed proxy slot bound to account after QR connect');
                    }
                } catch (linkError) {
                    req.log.warn({ err: linkError, owner_id: req.user.id, slot_id: claimedSlotId }, 'managed slot binding after QR connect failed (non-fatal)');
                }
            }

            await sessionData.client.disconnect();
            userbotService.qrSessions.delete(req.user.id);
            return res.json({
                status: 'success',
                runtime_status: FRESH_IMPORT_RUNTIME_STATUS,
                runtime_reason: FRESH_IMPORT_RUNTIME_REASON,
                fingerprint_profile_id: sessionData.fingerprint?.profileId || null,
                fingerprint_profile_label: sessionData.fingerprint?.profileLabel || null
            });
        } catch (error) {
            const raw = String(error?.errorMessage || error?.message || error || '');
            console.error('[QR-STATUS] failed:', raw);

            if (
                isExpiredUserbotSessionError(error)
                || raw.includes('Cannot send requests while disconnected')
                || raw.includes('TIMEOUT')
                || raw.includes('timed out')
            ) {
                return res.json({ status: 'pending' });
            }

            // Не-transient провал до привязки аккаунта — слот возвращаем в пул
            // (BACKLOG §32). Non-fatal: важнее честный 500 наверх.
            if (sessionData.claimedProxySlotId) {
                const failedSlotId = sessionData.claimedProxySlotId;
                sessionData.claimedProxySlotId = null;
                try {
                    await releaseFreeManagedSlot(supabase, req.user.id, failedSlotId);
                    req.log.warn({ owner_id: req.user.id, slot_id: failedSlotId }, 'QR status failed — claimed managed slot returned to pool');
                } catch (releaseError) {
                    req.log.warn({ err: releaseError, owner_id: req.user.id, slot_id: failedSlotId }, 'release of claimed managed slot failed (non-fatal)');
                }
            }

            return res.status(500).json({ error: 'Не удалось проверить статус QR-входа. Попробуй сгенерировать QR заново.' });
        }
    });

    // Облачный пароль (2FA) для QR-входа: скан уже принят, авторизация
    // запаркована на гейте — отдаем пароль в signInWithPassword.
    router.post('/qr-password', authenticateUser, async (req, res) => {
        await userbotService.sweepStaleQrSessions();

        const sessionData = userbotService.qrSessions.get(req.user.id);
        if (!sessionData || sessionData.authState !== '2fa_required') {
            return res.status(404).json({
                error: 'Нет активного запроса пароля. Отсканируй QR — Telegram сам попросит пароль, если он нужен.'
            });
        }

        const password = String(req.body?.password || '').trim();
        if (!password) {
            return res.status(400).json({ error: 'Введи облачный пароль (2FA) этого аккаунта.' });
        }

        const accepted = sessionData.passwordGate?.submit(password);
        if (!accepted) {
            return res.status(409).json({ error: 'Пароль уже принят, ждем ответ Telegram.' });
        }

        sessionData.authState = 'pending';
        return res.json({ status: 'checking' });
    });

}
