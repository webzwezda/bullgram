// Стадия 2 разрезки монстра userbot.service.js (план §7.3b): методы перенесены из
// класса ДОСЛОВНО (тела/JSDoc/комментарии без изменений); this.* зовётся через
// цепочку прототипов mixin-композиции в services/userbot.service.js.
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import QRCode from 'qrcode';
import { logger } from '../../utils/logger.js';
import { withTimeout } from '../../shared/utils.js';
import { runQrAuthWithRotation, createQrPasswordGate } from '../../utils/qr-auth.js';
import { QR_SESSION_TTL_MS, QR_TOKEN_RESTART_LIMIT, QR_GENERATE_TIMEOUT_MS, getQrConnectTimeoutMs, DEFAULT_QR_FINGERPRINT_PROFILE_ID } from './constants.js';

export const QrMixin = (Base) => class extends Base {
    /**
     * Генерация QR кода для авторизации
     */
    async generateQR(userId, proxyData = null, fingerprintSelection = {}, ownerId = null) {
        if (this.qrSessions.has(userId)) {
            const oldSession = this.qrSessions.get(userId);
            if (oldSession.client) try { await oldSession.client.disconnect(); } catch(e) {}
            this.qrSessions.delete(userId);
        }

        const proxyConfig = this._buildProxy(proxyData);
        const selectedProfileId = String(
            fingerprintSelection?.profile_id
            || fingerprintSelection?.fingerprint_profile_id
            || DEFAULT_QR_FINGERPRINT_PROFILE_ID
        ).trim();
        const wantsCustomFingerprint = fingerprintSelection?.custom_fingerprint && typeof fingerprintSelection.custom_fingerprint === 'object';
        let selectedProfile = null;
        let fingerprint = null;

        if (wantsCustomFingerprint) {
            const customLabel = String(
                fingerprintSelection?.custom_fingerprint?.label
                || fingerprintSelection?.preset_label
                || 'Свой профиль'
            ).trim();

            fingerprint = this._normalizeFingerprint({
                api_id: fingerprintSelection.custom_fingerprint.api_id,
                api_hash: fingerprintSelection.custom_fingerprint.api_hash,
                deviceModel: fingerprintSelection.custom_fingerprint.device_model ?? fingerprintSelection.custom_fingerprint.deviceModel,
                systemVersion: fingerprintSelection.custom_fingerprint.system_version ?? fingerprintSelection.custom_fingerprint.systemVersion,
                appVersion: fingerprintSelection.custom_fingerprint.app_version ?? fingerprintSelection.custom_fingerprint.appVersion,
                systemLangCode: fingerprintSelection.custom_fingerprint.system_lang_code ?? fingerprintSelection.custom_fingerprint.systemLangCode,
                langCode: fingerprintSelection.custom_fingerprint.lang_code ?? fingerprintSelection.custom_fingerprint.langCode,
                profileId: null,
                profileLabel: customLabel,
                source: 'custom_input'
            });

            if (fingerprintSelection?.save_as_preset && ownerId) {
                selectedProfile = await this.saveQrFingerprintPreset(ownerId, {
                    label: customLabel,
                    note: fingerprintSelection?.custom_fingerprint?.note || null,
                    ...fingerprintSelection.custom_fingerprint
                });
                fingerprint = this._normalizeFingerprint({
                    ...selectedProfile.fingerprint,
                    profileId: selectedProfile.id,
                    profileLabel: selectedProfile.label,
                    source: 'custom_preset'
                });
            }
        } else {
            selectedProfile = ownerId
                ? await this.getQrFingerprintProfileForOwner(ownerId, selectedProfileId)
                : this.getQrFingerprintProfile(selectedProfileId);

            fingerprint = this._normalizeFingerprint({
                ...selectedProfile.fingerprint,
                profileId: selectedProfile.id,
                profileLabel: selectedProfile.label,
                source: selectedProfile.is_system ? 'qr_profile' : 'custom_preset'
            });
        }

        const clientConfig = this._getClientConfig(proxyConfig, 5, fingerprint, proxyData);

        // Санитизированный лог вместо дампа proxyConfig (там username/password прокси).
        logger.info({
            has_proxy: Boolean(proxyConfig),
            proxy_host: proxyData?.host ?? null,
            proxy_port: proxyData?.port ?? null,
            has_auth: Boolean(proxyConfig?.username && proxyConfig?.password)
        }, '[QR-GENERATE] Создаем TelegramClient');

        const client = new TelegramClient(new StringSession(''), fingerprint.api_id, fingerprint.api_hash, clientConfig);
        this.prepareServiceClient(client);
        this._forceManagedIpv6Dc(client, proxyData);

        const isIgnorableQrAuthError = (error) => {
            const raw = String(error?.errorMessage || error?.message || '');
            return (
                raw.includes('AUTH_KEY_UNREGISTERED') ||
                raw.includes('Cannot send requests while disconnected') ||
                raw.includes('TIMEOUT')
            );
        };

        // 2FA: после принятого скана Telegram требует auth.checkPassword с
        // нового клиента. Без коллбека password GramJS сразу умирает с
        // «Account has 2FA enabled.» (регрессия 2026-11-04) — теперь авторизация
        // паркуется на гейте, пароль приходит через POST /qr-password.
        const passwordGate = createQrPasswordGate();

        const qrSession = {
            client,
            proxyData,
            fingerprint,
            authState: 'pending',
            authError: null,
            createdAt: Date.now(),
            currentQrCode: null,
            passwordGate
        };

        // Сессия в карте сразу: qr-start отвечает мгновенно, прогресс (и ошибки)
        // владелец видит через /qr-status. Генерация — в фоновой задаче ниже.
        this.qrSessions.set(userId, qrSession);

        void this._runQrGeneration(client, proxyData, fingerprint, qrSession);

        return {
            success: true,
            qr_pending: true,
            fingerprint_profile_id: fingerprint.profileId || selectedProfile?.id || null,
            fingerprint_profile_label: fingerprint.profileLabel || selectedProfile?.label || null
        };
    }

    /**
     * Фоновая часть QR-входа: connect → RPC-check → signInUserWithQrCode.
     * Прогресс и вердикты пишет в qrSession; HTTP-запрос qr-start не блокирует
     * (иначе медленный прокси доводил запрос до 504 nginx, регрессия 2026-11-04).
     */
    async _runQrGeneration(client, proxyData, fingerprint, qrSession) {
        let fatalError = null;
        try {
            console.log('[QR-GENERATE] Подключаемся к Telegram...');
            await withTimeout(
                this.connectWithProxyFallback(client, proxyData),
                getQrConnectTimeoutMs(),
                'Telegram не ответил на подключение за отведенное время.'
            );
            await this._verifyTelegramRpc(client);
            console.log('[QR-GENERATE] ✅ Подключение успешно!');
        } catch (connectError) {
            const message = String(connectError?.message || connectError || '');
            console.error('[QR-GENERATE] ❌ Ошибка подключения:', message);
            qrSession.authState = 'failed';
            qrSession.authError = message.includes('Telegram RPC check timed out')
                ? 'Прокси открыл TCP до Telegram, но не тянет нормальный MTProto/QR поток. Такой прокси не подходит для QR и юзерботов.'
                : (message || 'Прокси не смог подключиться к Telegram. Проверь прокси и попробуй еще раз.');
            try { await client.disconnect(); } catch (e) {}
            return;
        }

        // Токен QR ротируется каждые ~30 секунд: GramJS дергает коллбек на
        // каждом цикле опроса. Все картинки складываем в qrSession.currentQrCode —
        // их забирает /qr-status, иначе на экране висит заведомо протухший QR.
        let tokenSeq = 0;
        const qrCodeCallback = async (code) => {
            const seq = ++tokenSeq;
            console.log('[QR-GENERATE] qrCode callback получен, генерируем изображение...');
            try {
                const qrUrl = `tg://login?token=${code.token.toString('base64url')}`;
                const qrImageBase64 = await QRCode.toDataURL(qrUrl);
                console.log('[QR-GENERATE] ✅ QR изображение готово, размер:', qrImageBase64.length);
                if (seq === tokenSeq) {
                    qrSession.currentQrCode = qrImageBase64;
                }
            } catch (err) {
                console.error('[QR-GENERATE] Ошибка генерации QR изображения:', err);
                qrSession.authState = 'failed';
                qrSession.authError = 'Не удалось отрисовать QR-код. Попробуй сгенерировать заново.';
                try { await client.disconnect(); } catch (e) {}
            }
        };

        // Токен QR живёт ~30 секунд, а грамджсовский цикл опроса (30с) не
        // ловит AUTH_TOKEN_EXPIRED — helper падает целиком, если владелец не
        // успел сканировать. Перезапускаем авторизацию: свежий
        // ExportLoginToken даст новый токен, коллбек обновит QR на экране.
        // Иначе владелец получает сырой «AUTH_TOKEN_EXPIRED», просто не
        // успев достать телефон (регрессия 2026-11-04).
        const authPromise = runQrAuthWithRotation(
            () => client.signInUserWithQrCode({ apiId: fingerprint.api_id, apiHash: fingerprint.api_hash }, {
                onError: (error) => {
                    console.error('[QR-GENERATE] onError callback:', error.message);
                    fatalError = error;
                    // Неверный 2FA-пароль: signInWithPassword уходит на
                    // следующий виток и снова запрашивает пароль — покажем
                    // ошибку на форме ввода.
                    if (String(error?.errorMessage || error?.message || '').includes('PASSWORD_HASH_INVALID')) {
                        qrSession.passwordGate.setError('Неверный пароль. Попробуй еще раз.');
                    }
                },
                qrCode: qrCodeCallback,
                // Парковка: Telegram ждет auth.checkPassword, мы — пароль
                // владельца из /qr-password.
                password: async (hint) => {
                    qrSession.authState = '2fa_required';
                    return qrSession.passwordGate.request(hint);
                }
            }),
            { maxRestarts: QR_TOKEN_RESTART_LIMIT }
        );

        authPromise
            .then(() => {
                qrSession.authState = 'authorized';
                qrSession.authError = null;
            })
            .catch((error) => {
                const raw = String(error?.errorMessage || error?.message || error || '');
                qrSession.authError = raw;
                if (isIgnorableQrAuthError(error)) {
                    console.warn('[QR-GENERATE] Игнорируем фоновую ошибку QR auth flow:', raw);
                    return;
                }

                console.error('[QR-GENERATE] signInUserWithQrCode promise rejected:', raw);
                qrSession.authState = 'failed';
            });

        // Не даем promise жить без обработчика и засорять лог unhandled rejection.
        void authPromise.catch(() => {});

        // Через свежеподнятый прокси Telegram может отдавать QR не мгновенно.
        // Даем до 90 секунд, дальше честный failed — но уже без 504: qr-start
        // давно ответил, статус смотрят поллингом.
        setTimeout(() => {
            if (!qrSession.currentQrCode && qrSession.authState === 'pending') {
                console.error('[QR-GENERATE] ❌ Таймаут 90 секунд - QR не сгенерирован');
                qrSession.authState = 'failed';
                qrSession.authError = fatalError
                    ? `Telegram не отдал QR вовремя. Последняя ошибка: ${fatalError.message}`
                    : 'Таймаут генерации QR кода (90 сек). Прокси живой, но Telegram не успел отдать QR. Попробуйте еще раз или проверьте задержки на прокси.';
                try { client.disconnect(); } catch (e) {}
            }
        }, QR_GENERATE_TIMEOUT_MS);
    }

    getQRStatus(userId) {
        if (!this.qrSessions.has(userId)) return { status: 'not_found' };
        return { status: 'pending' };
    }

    /**
     * Чистит брошенные QR-сессии старше TTL: иначе они держат подключённый клиент бессрочно.
     * Вызывается при каждом qr-start и qr-status. Ошибки disconnect глотаем.
     */
    async sweepStaleQrSessions(maxAgeMs = QR_SESSION_TTL_MS) {
        const now = Date.now();
        for (const [userId, sessionData] of this.qrSessions.entries()) {
            const startedAt = Number(sessionData?.createdAt || 0);
            if (!startedAt || (now - startedAt) < maxAgeMs) continue;

            this.qrSessions.delete(userId);
            if (sessionData?.client) {
                try {
                    await sessionData.client.disconnect();
                } catch (error) {
                    console.warn('[QR-SWEEP] Не удалось отключить брошенный QR-клиент:', error?.message || error);
                }
            }
        }
    }
};
