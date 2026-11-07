// Импорт файла сессии (.session / sqlite / json) (стадия 2a разрезки userbot.routes.js).
// Зона: POST /import-session-file. Multer-инстанс `upload` используется только
// этой зоной и переехал сюда вместе с ней.
import multer from 'multer';
import os from 'os';
import path from 'path';
import { authenticateUser } from '../../middlewares/auth.middleware.js';
import { encrypt } from '../../utils/crypto.js';
import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';
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
import {
    isMissingRecoveryTable,
    sanitizeUserbotImportError,
    shouldStoreRecoverySource
} from './helpers-core.js';
import {
    cleanupUploadedFiles,
    ensureExclusiveProxyAssignment,
    ensureUserbotNotOwnedByAnotherAdmin,
    loadOwnedProxy
} from './helpers-proxy.js';
import { reconcileExpiredTrialProxyLease } from './helpers-lease.js';

// Настраиваем загрузку файлов во временную папку сервера
const upload = multer({
    dest: os.tmpdir(),
    limits: {
        files: 2,
        fileSize: 2 * 1024 * 1024
    },
    fileFilter: (_req, file, callback) => {
        const field = String(file?.fieldname || '').trim();
        const name = String(file?.originalname || '').trim().toLowerCase();

        if (field === 'sessionFile') {
            callback(null, name.endsWith('.session'));
            return;
        }

        if (field === 'jsonFile') {
            callback(null, name.endsWith('.json'));
            return;
        }

        callback(null, false);
    }
});

// BACKLOG §32: единый текст для владельца, когда free-pool claim не удался
// (pool_empty / race_lost) и своего прокси в запросе не было.
const PROXY_POOL_EMPTY_MESSAGE = 'Свободных платформенных прокси сейчас нет — подключите свой прокси или попробуйте позже.';

export function registerSessions(router, ctx) {
    const { supabase, userbotService } = ctx;
    router.post('/import-session-file', authenticateUser, upload.fields([
        { name: 'sessionFile', maxCount: 1 },
        { name: 'jsonFile', maxCount: 1 }
    ]), async (req, res) => {
        const uploadedFiles = [
            ...(req.files?.sessionFile || []),
            ...(req.files?.jsonFile || [])
        ];
        // Слот, заклеймленный из платформенного пула (BACKLOG §32), и признак,
        // что аккаунт встал с этим слотом. Нужны в catch: любой провал после
        // claim до создания аккаунта возвращает слот в пул.
        let claimedSlotId = null;
        let accountBound = false;

        try {
            const sessionFile = req.files?.sessionFile?.[0];
            const jsonFile = req.files?.jsonFile?.[0];

            if (!sessionFile) return res.status(400).json({ error: 'Загрузи именно `.session` файл. Папки `tdata`, архивы и другие форматы здесь не поддержаны.' });
            const { proxy_id } = req.body;

            if (!jsonFile) {
                return res.status(400).json({ error: 'Для безопасного импорта нужен и `.json` с fingerprint. Без него аккаунт остаётся в risk-case по device/app mismatch.' });
            }

            await userbotService.validateSessionSqliteFile(sessionFile.path);
            const fingerprint = await userbotService.validateConfigJsonFile(jsonFile.path);

            let proxyData = null;
            if (!proxy_id) {
                // Бесшовная выдача (BACKLOG §32): proxy_id не передан — пробуем
                // занять свободный managed-слот ДО подключения к Telegram.
                // flag_off → ровно прежнее поведение (400 «нужен прокси»).
                // Алерт не инжектим в claim: текст с контекстом (owner, причина,
                // поверхность) собирает роут ниже, дедуп notifyPlatformAlert
                // гасит повтор от сервиса.
                const claim = await claimFreeManagedSlot(supabase, req.user.id);
                if (!claim.claimed) {
                    if (claim.reason === 'pool_empty' || claim.reason === 'race_lost') {
                        try {
                            await notifyPlatformAlert(
                                PROXY_POOL_EXHAUSTED_ALERT_KEY,
                                `Пул платформенных прокси исчерпан (${claim.reason}): owner ${req.user.id} не смог начать импорт сессии. Пополни пул mp_* слотов.`
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
                proxyData = buildProxyDataFromManagedSlot(claim.slot);
                req.log.info({ owner_id: req.user.id, slot_id: claimedSlotId, host: claim.slot.host, port: claim.slot.port }, 'import: claimed managed proxy slot from platform pool');
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
                }
                if (!proxyData) {
                    return res.status(400).json({ error: 'Выбранный прокси не найден или не принадлежит тебе.' });
                }
                if (data.is_working === false) {
                    return res.status(400).json({ error: 'Этот прокси уже помечен как мертвый. Сначала почини его или выбери другой.' });
                }
            }

            const sessionString = await userbotService.extractSessionFromSqlite(sessionFile.path);

            const proxyConfig = userbotService._buildProxy(proxyData);
            const clientConfig = userbotService._getClientConfig(proxyConfig, 1, fingerprint, proxyData);

            const client = new TelegramClient(new StringSession(sessionString), fingerprint.api_id, fingerprint.api_hash, clientConfig);
            userbotService.prepareServiceClient(client);
            userbotService._forceManagedIpv6Dc(client, proxyData);
            try {
                await userbotService.connectWithProxyFallback(client, proxyData);

                const me = await client.getMe();
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
                await ensureExclusiveProxyAssignment(supabase, req.user.id, proxyData.proxy_id, existingAccountId);

                await supabase.from('tg_accounts').upsert({
                    owner_id: req.user.id,
                    account_type: 'userbot',
                    ...buildTelegramProfilePatch(me),
                    session_data: encrypt(userbotService.stringifySessionData(client.session.save(), fingerprint, 'session_import')),
                    proxy_id: proxyData ? proxyData.proxy_id : null,
                    runtime_status: FRESH_IMPORT_RUNTIME_STATUS,
                    runtime_error: FRESH_IMPORT_RUNTIME_REASON,
                    allow_proxy_failover: false,
                    failover_proxy_ids: []
                }, { onConflict: 'owner_id, tg_account_id' }).select('id').single();
                // Upsert уже записал proxy_id из proxyData (для claimed-пути —
                // заклеймленный слот): дальше release не делаем, слот потреблён.
                accountBound = true;

                const { data: savedAccount } = await supabase
                    .from('tg_accounts')
                    .select('id')
                    .eq('owner_id', req.user.id)
                    .eq('account_type', 'userbot')
                    .eq('tg_account_id', me.id.toString())
                    .maybeSingle();

                // Привязка заклеймленного managed-слота (BACKLOG §32):
                // дообновляем tenant-безопасным update (where id + owner_id).
                // Non-fatal: провал не ломает импорт, привязка уже есть из upsert.
                if (claimedSlotId && savedAccount?.id) {
                    try {
                        const { error: linkError } = await supabase
                            .from('tg_accounts')
                            .update({ proxy_id: claimedSlotId })
                            .eq('id', savedAccount.id)
                            .eq('owner_id', req.user.id);
                        if (linkError) throw linkError;
                        req.log.info({ owner_id: req.user.id, account_id: savedAccount.id, slot_id: claimedSlotId }, 'claimed managed proxy slot bound to account after session import');
                    } catch (linkError) {
                        req.log.warn({ err: linkError, owner_id: req.user.id, slot_id: claimedSlotId }, 'managed slot binding after session import failed (non-fatal)');
                    }
                }

                if (savedAccount?.id) {
                    try {
                        if (shouldStoreRecoverySource(req.body?.save_recovery_source)) {
                            await userbotService.saveRecoverySource({
                                accountId: savedAccount.id,
                                ownerId: req.user.id,
                                tgAccountId: me.id.toString(),
                                sessionFilePath: sessionFile.path,
                                sessionOriginalName: sessionFile.originalname,
                                jsonFilePath: jsonFile?.path || null,
                                jsonOriginalName: jsonFile?.originalname || null,
                                fingerprint
                            });
                        }
                    } catch (restoreError) {
                        if (!isMissingRecoveryTable(restoreError)) {
                            throw restoreError;
                        }
                    }
                }

                cleanupUploadedFiles(uploadedFiles);

                res.json({
                    success: true,
                    username: me.username || me.firstName,
                    runtime_status: FRESH_IMPORT_RUNTIME_STATUS,
                    runtime_reason: FRESH_IMPORT_RUNTIME_REASON,
                    recovery_source_saved: shouldStoreRecoverySource(req.body?.save_recovery_source)
                });
            } finally {
                if (client) {
                    try {
                        await client.disconnect();
                    } catch {
                        // no-op
                    }
                }
            }

        } catch (error) {
            // Любой провал после claim до создания аккаунта (коннект, getMe,
            // квота, проверки, upsert) — возвращаем слот в пул (BACKLOG §32).
            if (claimedSlotId && !accountBound) {
                try {
                    await releaseFreeManagedSlot(supabase, req.user.id, claimedSlotId);
                    req.log.warn({ owner_id: req.user.id, slot_id: claimedSlotId }, 'import failed — claimed managed slot returned to pool');
                } catch (releaseError) {
                    req.log.warn({ err: releaseError, owner_id: req.user.id, slot_id: claimedSlotId }, 'release of claimed managed slot failed (non-fatal)');
                }
            }
            cleanupUploadedFiles(uploadedFiles);
            console.error('[USERBOT_IMPORT] failed:', error?.message || error);
            const sanitized = sanitizeUserbotImportError(error);
            res.status(sanitized.statusCode).json({ error: sanitized.message });
        }
    });

}
