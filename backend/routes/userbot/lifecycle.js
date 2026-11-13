// Жизненный цикл юзербота: удаление, восстановление, safe-mode, метка
// (стадия 2a разрезки userbot.routes.js).
// Зона: DELETE /:id, POST /restore/:id, POST /safe-mode/:id, PATCH /custom-label/:id.
// GET /recovery-status переехал сюда на финальной стадии 2b — первым роутом,
// как в исходном порядке регистрации главного файла (после registerProfile).
// Критично: registerLifecycle зовётся ПОСЛЕ registerProxiesCheck —
// DELETE /proxies/:id должен матчиться раньше дженерика DELETE /:id.
import { authenticateUser } from '../../middlewares/auth.middleware.js';
import { encrypt, decrypt } from '../../utils/crypto.js';
import { buildShopFileArchive } from '../../services/shop-delivery.service.js';
import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';
import { FRESH_IMPORT_RUNTIME_REASON, FRESH_IMPORT_RUNTIME_STATUS } from '../../utils/ops-center-selection.js';
import { buildTelegramProfilePatch } from '../../utils/telegram-profile.js';
import {
    getDeadProxyMessage,
    getFailoverCooldownMessage,
    isMissingRecoveryTable,
    isUserbotOnDeadProxy,
    sanitizeUserbotImportError
} from './helpers-core.js';
import { ensureExclusiveProxyAssignment, ensureUserbotNotOwnedByAnotherAdmin } from './helpers-proxy.js';

export function registerLifecycle(router, ctx) {
    const { supabase, userbotService } = ctx;

    // Свой rate-limit для тяжёлой операции (архив собирается в памяти):
    // 10 запусков в минуту на пользователя.
    const archiveHitsByUser = new Map();
    function archiveRateLimit(userId) {
        const now = Date.now();
        const windowStart = now - 60_000;
        for (const [key, hits] of archiveHitsByUser) {
            const fresh = hits.filter((t) => t > windowStart);
            if (fresh.length > 0) archiveHitsByUser.set(key, fresh);
            else archiveHitsByUser.delete(key);
        }
        const hits = archiveHitsByUser.get(userId) || [];
        if (hits.length >= 10) return false;
        hits.push(now);
        archiveHitsByUser.set(userId, hits);
        return true;
    }

    router.get('/recovery-status', authenticateUser, async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('userbot_restore_sources')
                .select('account_id, source_type, session_filename, json_filename, updated_at, last_restored_at, last_restore_status, last_restore_error, intake_batch_id')
                .eq('owner_id', req.user.id);

            if (error) {
                if (isMissingRecoveryTable(error)) {
                    return res.json({ support: { recovery: false }, rows: [] });
                }
                throw error;
            }

            res.json({
                support: { recovery: true },
                rows: data || []
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Ошибка загрузки recovery status' });
        }
    });

    // Скачивание архива файлов сессии владельцем своего аккаунта (панель
    // «Файлы сессии» в кабинете). Это данные владельца — без окон и квот;
    // состав архива тот же, что увыдачи покупателю (buildShopFileArchive).
    // Чужие/несуществующие аккаунты отвечают 404 без деталей.
    router.get('/restore-sources/:accountId/archive', authenticateUser, async (req, res) => {
        const { accountId } = req.params;
        try {
            if (!archiveRateLimit(req.user.id)) {
                return res.status(429).json({ error: 'Слишком много запросов. Попробуйте позже.' });
            }

            const { data: account, error: accountError } = await supabase
                .from('tg_accounts')
                .select('id, custom_label')
                .eq('id', accountId)
                .eq('owner_id', req.user.id)
                .eq('account_type', 'userbot')
                .maybeSingle();
            if (accountError) throw accountError;
            if (!account) return res.status(404).json({ error: 'Аккаунт не найден' });

            const { data: source, error: sourceError } = await supabase
                .from('userbot_restore_sources')
                .select('session_blob_encrypted, json_blob_encrypted, tdata_blob_encrypted, two_fa_secret_encrypted')
                .eq('account_id', accountId)
                .eq('owner_id', req.user.id)
                .maybeSingle();
            if (sourceError) throw sourceError;
            if (!source?.session_blob_encrypted) {
                return res.status(404).json({ error: 'Файлы сессии для этого аккаунта не сохранены' });
            }

            const archive = buildShopFileArchive({ label: account.custom_label, source });
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="${archive.basename}.zip"`);
            res.setHeader('X-Archive-Sha256', archive.sha256);
            return res.send(archive.buffer);
        } catch (error) {
            console.error('Ошибка выдачи архива файлов сессии владельцу:', error);
            return res.status(500).json({ error: 'Ошибка выдачи архива' });
        }
    });

    router.delete('/:id', authenticateUser, async (req, res) => {
        try {
            try {
                await userbotService.deleteRecoverySource(req.user.id, req.params.id);
            } catch (error) {
                if (!isMissingRecoveryTable(error)) {
                    throw error;
                }
            }
            await supabase.from('tg_accounts').delete().eq('id', req.params.id).eq('owner_id', req.user.id);
            res.status(200).json({ success: true });
        } catch (error) { res.status(500).json({ error: 'Ошибка при удалении' }); }
    });

    router.post('/restore/:id', authenticateUser, async (req, res) => {
        try {
            const { data: account } = await supabase
                .from('tg_accounts')
                .select('*, proxies(host, port, username, password, is_working, provision_source, inventory_group)')
                .eq('id', req.params.id)
                .eq('owner_id', req.user.id)
                .single();

            if (!account) return res.status(404).json({ error: 'Юзербот не найден' });

            const activateNow = String(req.body?.activate_now || '').trim().toLowerCase() === 'true';
            let targetAccount = account;
            if (isUserbotOnDeadProxy(account)) {
                const failover = await userbotService.tryAutoFailoverUserbot(account);
                if (failover.switched) {
                    targetAccount = failover.account;
                } else if (failover.reason === 'cooldown') {
                    return res.status(409).json({ error: getFailoverCooldownMessage(failover.retry_after_ms) });
                } else {
                    return res.status(409).json({ error: getDeadProxyMessage() });
                }
            }

            let restoreSource;
            try {
                restoreSource = await userbotService.getRecoverySource(req.user.id, targetAccount.id);
            } catch (restoreError) {
                if (isMissingRecoveryTable(restoreError)) {
                    return res.status(400).json({ error: 'Сначала примени SQL под session recovery foundation.' });
                }
                throw restoreError;
            }

            if (!restoreSource?.session_blob_encrypted) {
                return res.status(404).json({ error: 'Для этого юзербота нет сохраненного restore source. Нужен новый импорт .session/.json.' });
            }

            const sessionBuffer = Buffer.from(decrypt(restoreSource.session_blob_encrypted), 'base64');
            const sessionString = await userbotService.extractSessionFromSqliteBuffer(sessionBuffer);

            let fingerprint = userbotService.getDefaultFingerprint();
            if (restoreSource.json_blob_encrypted) {
                try {
                    fingerprint = userbotService.parseConfigJsonContent(decrypt(restoreSource.json_blob_encrypted));
                } catch {}
            } else if (restoreSource.fingerprint) {
                fingerprint = userbotService._normalizeFingerprint(restoreSource.fingerprint);
            } else if (targetAccount.session_data) {
                const parsed = userbotService.parseSessionData(decrypt(targetAccount.session_data));
                fingerprint = parsed.fingerprint;
            }

            const proxyData = targetAccount.proxies
                ? {
                    proxy_host: targetAccount.proxies.host,
                    proxy_port: targetAccount.proxies.port,
                    proxy_username: targetAccount.proxies.username,
                    proxy_password: targetAccount.proxies.password,
                    provision_source: targetAccount.proxies.provision_source,
                    inventory_group: targetAccount.proxies.inventory_group
                }
                : undefined;

            const clientConfig = userbotService._getClientConfig(userbotService._buildProxy(proxyData), 1, fingerprint, proxyData);
            const client = new TelegramClient(new StringSession(sessionString), fingerprint.api_id, fingerprint.api_hash, clientConfig);
            userbotService.prepareServiceClient(client);
            userbotService._forceManagedIpv6Dc(client, proxyData);

            try {
                await userbotService.connectWithProxyFallback(client, proxyData);
                const me = await client.getMe();

                await ensureUserbotNotOwnedByAnotherAdmin(supabase, req.user.id, me.id.toString(), targetAccount.id);
                if (targetAccount.proxy_id) {
                    await ensureExclusiveProxyAssignment(supabase, req.user.id, targetAccount.proxy_id, targetAccount.id);
                }

                await supabase
                    .from('tg_accounts')
                    .update({
                        ...buildTelegramProfilePatch(me),
                        session_data: encrypt(userbotService.stringifySessionData(client.session.save(), fingerprint, 'restored')),
                        runtime_status: activateNow ? 'online' : FRESH_IMPORT_RUNTIME_STATUS,
                        runtime_error: activateNow ? null : FRESH_IMPORT_RUNTIME_REASON,
                        allow_proxy_failover: false,
                        failover_proxy_ids: [],
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', targetAccount.id)
                    .eq('owner_id', req.user.id);

                await supabase
                    .from('userbot_restore_sources')
                    .update({
                        tg_account_id: me.id.toString(),
                        last_restored_at: new Date().toISOString(),
                        last_restore_status: 'restored',
                        last_restore_error: null,
                        updated_at: new Date().toISOString()
                    })
                    .eq('account_id', targetAccount.id)
                    .eq('owner_id', req.user.id);

                res.json({
                    success: true,
                    username: me.username || me.firstName,
                    tg_account_id: me.id.toString(),
                    runtime_status: activateNow ? 'online' : FRESH_IMPORT_RUNTIME_STATUS,
                    runtime_reason: activateNow ? null : FRESH_IMPORT_RUNTIME_REASON
                });
            } catch (error) {
                await supabase
                    .from('userbot_restore_sources')
                    .update({
                        last_restore_status: 'failed',
                        last_restore_error: error.message || 'restore_failed',
                        updated_at: new Date().toISOString()
                    })
                    .eq('account_id', targetAccount.id)
                    .eq('owner_id', req.user.id);

                throw error;
            } finally {
                try { await client.disconnect(); } catch {}
            }
        } catch (error) {
            console.error('Ошибка восстановления юзербота:', error?.message || error);
            const sanitized = sanitizeUserbotImportError(error);
            res.status(sanitized.statusCode).json({
                error: sanitized.statusCode === 500
                    ? 'Восстановление из сохраненного комплекта не прошло. Проверь источник и прокси, затем повтори.'
                    : sanitized.message
            });
        }
    });

    router.post('/safe-mode/:id', authenticateUser, async (req, res) => {
        try {
            const enabled = req.body?.enabled === true;
            console.log('[USERBOT_SAFE_MODE] request', {
                accountId: req.params.id,
                ownerId: req.user?.id || null,
                role: req.profile?.role || null,
                enabled
            });
            const { data: account, error } = await supabase
                .from('tg_accounts')
                .select('id, owner_id, account_type, runtime_status')
                .eq('id', req.params.id)
                .eq('owner_id', req.user.id)
                .single();

            if (error || !account) {
                return res.status(404).json({ error: 'Аккаунт не найден' });
            }

            if (account.account_type !== 'userbot') {
                return res.status(400).json({ error: 'Safe-mode работает только для юзерботов.' });
            }

            if (enabled !== true) {
                return res.status(400).json({ error: 'Выключение safe-mode делается через живую Telegram-проверку.' });
            }

            const { data: updatedAccount, error: updateError } = await supabase
                .from('tg_accounts')
                .update({
                    runtime_status: FRESH_IMPORT_RUNTIME_STATUS,
                    runtime_error: FRESH_IMPORT_RUNTIME_REASON
                })
                .eq('id', account.id)
                .eq('owner_id', req.user.id)
                .select('id, runtime_status, runtime_error')
                .single();

            if (updateError || !updatedAccount) {
                throw new Error(updateError?.message || 'Safe-mode update не сохранился.');
            }

            console.log('[USERBOT_SAFE_MODE] switched', {
                accountId: updatedAccount.id,
                ownerId: req.user?.id || null,
                prevStatus: account.runtime_status || null,
                nextStatus: updatedAccount.runtime_status || null
            });

            return res.json({
                success: true,
                runtime_status: updatedAccount.runtime_status || null,
                runtime_reason: updatedAccount.runtime_error || null
            });
        } catch (error) {
            console.error('[USERBOT_SAFE_MODE] failed', {
                accountId: req.params.id,
                ownerId: req.user?.id || null,
                role: req.profile?.role || null,
                error: error.message || String(error || '')
            });
            res.status(500).json({ error: error.message || 'Не удалось переключить safe-mode.' });
        }
    });

    router.patch('/custom-label/:id', authenticateUser, async (req, res) => {
        try {
            const raw = typeof req.body?.custom_label === 'string' ? req.body.custom_label.trim() : '';
            const custom_label = raw.slice(0, 100) || null;

            const { data: account, error: accountError } = await supabase
                .from('tg_accounts')
                .select('id, owner_id, account_type')
                .eq('id', req.params.id)
                .eq('owner_id', req.user.id)
                .single();

            if (accountError || !account) {
                return res.status(404).json({ error: 'Аккаунт не найден' });
            }

            if (account.account_type !== 'userbot') {
                return res.status(400).json({ error: 'Метку можно поставить только юзерботу.' });
            }

            const { data: updated, error: updateError } = await supabase
                .from('tg_accounts')
                .update({ custom_label })
                .eq('id', account.id)
                .eq('owner_id', req.user.id)
                .select('id, custom_label')
                .single();

            if (updateError || !updated) {
                throw new Error(updateError?.message || 'Метка не сохранилась.');
            }

            return res.json({ success: true, custom_label: updated.custom_label || '' });
        } catch (error) {
            console.error('[USERBOT_CUSTOM_LABEL] failed', {
                accountId: req.params.id,
                ownerId: req.user?.id || null,
                error: error.message || String(error || '')
            });
            res.status(500).json({ error: error.message || 'Не удалось сохранить метку.' });
        }
    });
}
