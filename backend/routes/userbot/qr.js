// QR-подключение юзербота (стадия 2a разрезки userbot.routes.js).
// Зона: POST /qr-start, GET /qr-status, POST /qr-password.
// GET /fingerprint-profiles переехал сюда на финальной стадии 2b — первым
// роутом, как в исходном порядке регистрации главного файла.
import { authenticateUser } from '../../middlewares/auth.middleware.js';
import { encrypt } from '../../utils/crypto.js';
import { enforceUserbotQuota } from '../../utils/product-tier.js';
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

            if (!proxy_id) {
                return res.status(400).json({ error: 'Юзербота можно подключать только через прокси. Сначала выбери живой прокси.' });
            }

            if (req.profile?.role !== 'admin') {
                await reconcileExpiredTrialProxyLease(supabase, req.user.id, req.profile);
            }

            let proxyData = null;
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

            const result = await userbotService.generateQR(req.user.id, proxyData, {
                profile_id: fingerprint_profile_id,
                custom_fingerprint: normalizedCustomFingerprint,
                save_as_preset: !!save_as_preset,
                preset_label: normalizedCustomFingerprint?.label || ''
            }, req.user.id);
            console.log('[QR-ROUTE] QR-сессия запущена, генерация идет в фоне');
            res.json(result);
        } catch (error) {
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
                .select('id')
                .eq('owner_id', req.user.id)
                .eq('account_type', 'userbot')
                .eq('tg_account_id', me.id.toString())
                .maybeSingle();

            existingAccountId = existingAccount?.id || null;
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

            await supabase.from('tg_accounts').upsert({
                owner_id: req.user.id,
                account_type: 'userbot',
                ...buildTelegramProfilePatch(me),
                session_data: encrypt(userbotService.stringifySessionData(token, sessionData.fingerprint, 'qr')),
                proxy_id: sessionData.proxyData ? sessionData.proxyData.proxy_id : null,
                runtime_status: FRESH_IMPORT_RUNTIME_STATUS,
                runtime_error: FRESH_IMPORT_RUNTIME_REASON,
                allow_proxy_failover: false,
                failover_proxy_ids: []
            }, { onConflict: 'owner_id, tg_account_id' });

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
