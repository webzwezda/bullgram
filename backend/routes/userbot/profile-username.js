// Быстрая смена @username юзербота из кабинета: живой Telegram-вызов
// account.updateUsername, затем getMe-перечитывание и persist тем же
// патчем, что и sync/update. Вынесено из profile.js (лимит размера файла).
import { authenticateUser } from '../../middlewares/auth.middleware.js';
import { decrypt } from '../../utils/crypto.js';
import { Api, TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';
import { isFreshImportedUserbot } from '../../utils/ops-center-selection.js';
import { buildTelegramProfilePatch, normalizeTelegramUsernameInput } from '../../utils/telegram-profile.js';
import { withDeadline } from '../../utils/with-deadline.js';
import { isUserbotOnDeadProxy } from './helpers-core.js';

export function registerProfileUsername(router, ctx) {
    const { supabase, userbotService } = ctx;
    router.post('/username/:id', authenticateUser, async (req, res) => {
        const accountId = req.params.id;
        let client = null;

        const username = normalizeTelegramUsernameInput(req.body?.username);
        if (!username) {
            return res.status(400).json({ error: 'Username не подходит: 5–32 символа, латиница, цифры и _, начинается с буквы.' });
        }

        try {
            const { data: account, error } = await supabase
                .from('tg_accounts')
                .select('*, proxies(host, port, username, password, is_working, provision_source, inventory_group)')
                .eq('id', accountId)
                .eq('owner_id', req.user.id)
                .single();

            if (error || !account) {
                return res.status(404).json({ error: 'Аккаунт не найден.' });
            }
            if (account.account_type !== 'userbot') {
                return res.status(400).json({ error: 'Username так меняем только у юзерботов.' });
            }
            if (isFreshImportedUserbot(account)) {
                return res.status(409).json({ error: 'Аккаунт в safe-mode. Сначала сделай живую активацию через проверку Telegram.' });
            }
            if (isUserbotOnDeadProxy(account)) {
                return res.status(409).json({ error: 'У юзербота мертвый прокси. Сначала почини или смени прокси.' });
            }

            const { updatedAccount } = await withDeadline((async () => {
                const decryptedData = decrypt(account.session_data);
                if (!decryptedData) {
                    throw new Error('Сессия не читается или уже недействительна.');
                }

                const { token, fingerprint } = userbotService.parseSessionData(decryptedData);
                const proxyData = account.proxies
                    ? {
                        proxy_host: account.proxies.host,
                        proxy_port: account.proxies.port,
                        proxy_username: account.proxies.username,
                        proxy_password: account.proxies.password
                    }
                    : undefined;

                const clientConfig = userbotService._getClientConfig(userbotService._buildProxy(proxyData), 1, fingerprint, proxyData);
                // Короткий FLOOD_WAIT не должен авто-спать до 60 сек внутри HTTP-запроса:
                // для смены username флад обычно длинный, пусть падает сразу с текстом.
                clientConfig.floodSleepThreshold = 0;
                client = new TelegramClient(new StringSession(token), fingerprint.api_id, fingerprint.api_hash, clientConfig);
                userbotService.prepareServiceClient(client);
                userbotService._forceManagedIpv6Dc(client, proxyData);
                await userbotService.connectWithProxyFallback(client, proxyData);

                try {
                    await client.updateUsername(username);
                } catch (tgError) {
                    // У FloodWaitError слово FLOOD живёт в errorMessage, не в message.
                    const raw = String(tgError?.message || '') + ' ' + String(tgError?.errorMessage || '');
                    if (/FLOOD/i.test(raw)) {
                        throw new Error('Telegram просит подождать перед следующей сменой username. ' + raw);
                    }
                    throw tgError;
                }

                const me = await client.getMe();
                const syncedAt = new Date().toISOString();
                const patch = buildTelegramProfilePatch(me, {
                    tg_profile_synced_at: syncedAt,
                    tg_profile_sync_attempted_at: syncedAt,
                    tg_profile_sync_error: null
                });

                const { data: updated, error: updateError } = await supabase
                    .from('tg_accounts')
                    .update(patch)
                    .eq('id', account.id)
                    .eq('owner_id', req.user.id)
                    .select('*')
                    .single();

                if (updateError || !updated) {
                    throw new Error(updateError?.message || 'Username изменился в Telegram, но не сохранился в БД.');
                }

                return { updatedAccount: updated };
            })(), 45000, 'Telegram не ответил за 45 сек — прокси или сессия зависли. Попробуй ещё раз.');

            return res.json({
                success: true,
                tg_username: updatedAccount.tg_username || null,
                account: updatedAccount,
                message: 'Username сохранён в Telegram.'
            });
        } catch (error) {
            console.error('[USERBOT_USERNAME] failed', {
                accountId,
                ownerId: req.user?.id || null,
                error: error.message || String(error || '')
            });
            try {
                await supabase
                    .from('tg_accounts')
                    .update({
                        tg_profile_sync_error: error.message || 'Не удалось сменить username.',
                        tg_profile_sync_attempted_at: new Date().toISOString()
                    })
                    .eq('id', accountId)
                    .eq('owner_id', req.user.id);
            } catch (updateError) {
                console.error('[USERBOT_USERNAME] error marker failed:', updateError?.message || updateError);
            }
            return res.status(500).json({ error: error.message || 'Не удалось сменить username.' });
        } finally {
            if (client) {
                try {
                    await client.disconnect();
                } catch {
                    // no-op
                }
            }
        }
    });
}
