// Стадия 2 разрезки монстра userbot.service.js (план §7.3b): методы перенесены из
// класса ДОСЛОВНО (тела/JSDoc/комментарии без изменений); this.* зовётся через
// цепочку прототипов mixin-композиции в services/userbot.service.js.
import { Api } from 'teleproto';
import { MCPError, ERROR_CODES } from '../../shared/errors.js';
import { withTimeout } from '../../shared/utils.js';
import { wrapTelegramError } from './telegram-errors.js';
import { safeDisconnect } from './helpers.js';
import { assertUserbotOperatable } from './botfather-lib.js';

export const ResolversMixin = (Base) => class extends Base {
    /**
     * Резолв пользователя Telegram по @username или tg_user_id (ровно один).
     * Фундамент access_hash для invite/promote. GramJS: client.getEntity(...)
     * → Api.User: id/username/firstName/lastName/verified/accessHash.
     */
    async resolveTelegramUser(userbot, { username, tgUserId } = {}) {
        assertUserbotOperatable(userbot);

        const usernameStr = String(username ?? '').trim();
        const idStr = String(tgUserId ?? '').trim();
        if (Boolean(usernameStr) === Boolean(idStr)) {
            throw new MCPError(
                ERROR_CODES.INVALID_PARAMS,
                'Pass exactly one of "username" or "tg_user_id".',
                {}
            );
        }
        // Формат username проверяем до getEntity: Telegram отвечает на мусор
        // невнятной peer-ошибкой, лучше валить сразу.
        if (usernameStr && !/^@?[a-zA-Z0-9_]{4,32}$/.test(usernameStr)) {
            throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Некорректный username', {});
        }
        const lookup = usernameStr
            ? `@${usernameStr.replace(/^@/, '')}`
            : idStr;

        const client = await this.createAuthorizedClient(userbot);
        try {
            const entity = await withTimeout(
                client.getEntity(lookup),
                30_000,
                'resolveTelegramUser.getEntity'
            );
            if (entity?.id == null) {
                throw new MCPError(
                    ERROR_CODES.TELEGRAM_ERROR,
                    'Telegram не вернул профиль пользователя.',
                    { auditStatus: 'telegram_error' }
                );
            }
            return {
                id: String(entity.id),
                username: entity.username || null,
                first_name: entity.firstName || entity.first_name || null,
                last_name: entity.lastName || entity.last_name || null,
                verified: entity.verified === true,
                access_hash: entity.accessHash != null ? String(entity.accessHash) : ''
            };
        } catch (error) {
            throw await wrapTelegramError(this.supabase, userbot, error, 'resolveTelegramUser');
        } finally {
            await safeDisconnect(client);
        }
    }

    /**
     * Резолв peer чата: свежий клиент не знает peer по сырому id — при провале
     * ищем в диалогах по bare id (паттерн resolveChatEntity / broadcast-cleanup resolvePeer).
     * User-ветка тоже принимается: волна-2 операции должны работать и по DM-пирам.
     */
    async resolveChatPeer(client, chatId) {
        try {
            return await client.getInputEntity(chatId);
        } catch (error) {
            const dialogs = await withTimeout(
                client.getDialogs({ limit: 300 }),
                120_000,
                'resolveChatPeer.scanDialogs'
            );
            const bare = String(chatId).replace(/^-100/, '');
            const hit = (dialogs || []).find(dialog =>
                String(dialog?.id || '').replace(/^-100/, '') === bare &&
                (dialog?.entity?.className === 'Channel'
                    || dialog?.entity?.className === 'Chat'
                    || dialog?.entity?.className === 'User'));
            if (!hit?.entity) throw error;
            return hit.entity;
        }
    }

    /**
     * InputUser участника с access_hash: сначала getEntity, без access_hash —
     * getParticipants-скан чата (паттерн chat-admin-rights.service.js findPromoterUserbot).
     * В скане username сравниваем case-insensitively, id нормализуем —
     * у участников Telegram отдаёт bare id без '-100'/'-'.
     */
    async resolveMemberInputUser(client, channel, member) {
        const raw = String(member || '').trim();
        const isNumericId = /^-?\d+$/.test(raw);
        const lookup = isNumericId ? raw : `@${raw.replace(/^@/, '')}`;
        const bareId = isNumericId ? raw.replace(/^-100/, '').replace(/^-/, '') : null;
        const bareUsername = isNumericId ? null : raw.replace(/^@/, '').toLowerCase();

        if (!isNumericId) {
            try {
                const entity = await withTimeout(
                    client.getEntity(lookup),
                    30_000,
                    'resolveMemberInputUser.getEntity'
                );
                if (entity?.id != null && entity?.accessHash != null) {
                    return new Api.InputUser({
                        userId: BigInt(String(entity.id)),
                        accessHash: BigInt(String(entity.accessHash))
                    });
                }
            } catch {
                // нет access_hash через getEntity — пробуем скан участников
            }
        }

        const participants = await withTimeout(
            client.getParticipants(channel, { limit: 5000 }),
            120_000,
            'resolveMemberInputUser.scanParticipants'
        );
        const target = (participants || []).find(p =>
            (bareId != null && String(p?.id || '') === bareId)
            || (bareUsername != null && String(p?.username || '').toLowerCase() === bareUsername));
        if (target?.id != null && target?.accessHash != null) {
            return new Api.InputUser({
                userId: BigInt(String(target.id)),
                accessHash: BigInt(String(target.accessHash))
            });
        }

        throw new MCPError(
            ERROR_CODES.INVALID_PARAMS,
            `Не удалось найти участника ${raw} в этом чате. Участник должен состоять в чате, иначе Telegram не отдаёт access_hash.`,
            {}
        );
    }

    async _lastTelegramEventFor(userbotId) {
        if (!userbotId) return null;
        const { data } = await this.supabase
            .from('telegram_error_events')
            .select('event_type, error_code, error_message, created_at')
            .eq('userbot_id', userbotId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        return data || null;
    }
};
