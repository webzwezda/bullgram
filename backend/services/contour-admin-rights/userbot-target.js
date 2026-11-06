// Ячейка прав «юзербот × площадка» contour-admin-rights (leaf: только shared.js).
// Разрезка contour-admin-rights.service.js; метод ensureUserbotTarget класса
// делегируется сюда (service-инстанс первым аргументом вместо this).

import {
    CONTOUR_USERBOT_MAX_RIGHTS,
    buildErrorMessage,
    classifyTelegramError,
    ensureFlagsSufficient
} from './shared.js';

export async function ensureUserbotTarget(service, botApi, client, base, channel, { autoJoin, userbotTgId, ownerId, botId }) {
    const tgChatId = channel.tg_chat_id;
    const label = base.label;
    const warnings = [];

    if (!userbotTgId) {
        return {
            ...base,
            state: 'error',
            is_admin: false,
            flags: {},
            warnings,
            message: `${label}: у юзербота нет Telegram ID.`,
            stop: false
        };
    }

    // 1. Членство — через Bot API (бот-админ видит состав площадки).
    // Проверка может не удалась (бот не видит состав) — это не «не состоит»:
    //   - flood → cooldown cell;
    //   - autoJoin=false (repair) → error-ячейка, чтобы не писать ложное missing_membership;
    //   - autoJoin=true → идём в join: само вступление покажет, состоит ли юзербот.
    let isMember = false;
    try {
        isMember = await service.isBotApiMember(botApi, tgChatId, userbotTgId);
    } catch (memberError) {
        if (classifyTelegramError(memberError, 'member') === 'flood_wait') {
            return service.floodWaitCell(base, memberError);
        }
        if (!autoJoin) {
            return {
                ...base,
                state: 'error',
                is_admin: false,
                flags: {},
                warnings,
                message: `${label}: не удалось проверить членство (у бота нет доступа к составу площадки).`,
                stop: false
            };
        }
        warnings.push(`не удалось проверить членство (${buildErrorMessage(memberError)}) — пробуем вступить`);
    }

    if (!isMember) {
        if (!autoJoin) {
            return {
                ...base,
                state: 'missing_membership',
                is_admin: false,
                flags: {},
                warnings,
                message: `${label}: юзербота нет в площадке (авто-вступление выключено).`,
                stop: false
            };
        }

        const joined = await service.joinUserbotToChannel(botApi, client, channel, warnings, {
            ownerId,
            botId,
            target: base.target,
            excludeActorId: base.actor_id
        });
        if (!joined) {
            return {
                ...base,
                state: 'missing_membership',
                is_admin: false,
                flags: {},
                warnings,
                message: `${label}: юзербота нет в площадке — вступить не получилось ни одним из способов.`,
                stop: false
            };
        }

        const confirmed = await service.waitForBotApiMembership(botApi, tgChatId, userbotTgId);
        if (!confirmed) {
            return {
                ...base,
                state: 'missing_membership',
                is_admin: false,
                flags: {},
                warnings,
                message: `${label}: юзербот не появился в площадке после вступления.`,
                stop: false
            };
        }
        warnings.push('юзербот только что вступил в площадку');
    }

    // 2. Текущее админ-состояние — через GramJS (чтение участника самим юзерботом).
    let rights = null;
    try {
        rights = await service.readUserbotAdminState(client, tgChatId, userbotTgId);
    } catch (error) {
        if (classifyTelegramError(error, 'member') === 'flood_wait') {
            return service.floodWaitCell(base, error);
        }
        // CHAT_ADMIN_REQUIRED/CHANNEL_PRIVATE на чтении участника = не админ или скрыто.
        // Продолжаем: promote + перечитка дадут фактическое состояние.
        warnings.push(`не получилось прочитать роль юзербота (${classifyTelegramError(error, 'member')}) — пробуем выдать права`);
    }

    if (rights?.is_admin) {
        const check = ensureFlagsSufficient(rights, CONTOUR_USERBOT_MAX_RIGHTS);
        if (check.sufficient) {
            return {
                ...base,
                state: 'ok',
                is_admin: true,
                flags: rights,
                warnings,
                message: `${label}: юзербот уже админ с нужными правами${rights.is_creator ? ' (владелец)' : ''}.`,
                stop: false
            };
        }
        // Админ, но флагов не хватает — пробуем добор ниже. Если админа назначил
        // владелец, promote упадёт с CHAT_ADMIN_REQUIRED → классифицируем как owner_appointed.
    }

    // 3. Выдача/добор прав через official-бота.
    try {
        await botApi.promoteChatMember(tgChatId, Number(userbotTgId), CONTOUR_USERBOT_MAX_RIGHTS);
    } catch (promoteError) {
        const preClassified = classifyTelegramError(promoteError, rights?.status || 'member');
        if (preClassified === 'flood_wait') {
            return service.floodWaitCell(base, promoteError);
        }

        let reRead = null;
        try {
            reRead = await service.readUserbotAdminState(client, tgChatId, userbotTgId);
        } catch (readError) {
            if (classifyTelegramError(readError, 'member') === 'flood_wait') {
                return service.floodWaitCell(base, readError);
            }
        }

        // Права фактически есть — админа назначил владелец, бот менять их не может.
        const classified = reRead?.is_admin
            ? classifyTelegramError(promoteError, reRead.status)
            : preClassified;

        if (reRead?.is_admin) {
            const reCheck = ensureFlagsSufficient(reRead, CONTOUR_USERBOT_MAX_RIGHTS);
            if (classified === 'owner_appointed') {
                if (reCheck.sufficient) {
                    warnings.push('админ назначен владельцем — права достаточны');
                    return {
                        ...base,
                        state: 'ok',
                        is_admin: true,
                        flags: reRead,
                        warnings,
                        message: `${label}: юзербот уже админ с нужными правами — назначен владельцем, бот не может менять его права.`,
                        stop: false
                    };
                }
                warnings.push(`Не хватает прав: ${reCheck.missing.join(', ')} — выдай вручную`);
                return {
                    ...base,
                    state: 'owner_appointed',
                    is_admin: true,
                    flags: reRead,
                    warnings,
                    message: `${label}: админ назначен владельцем — бот не может менять его права; не хватает прав (${reCheck.missing.join(', ')}) — выдай вручную.`,
                    stop: false
                };
            }
            if (reCheck.sufficient) {
                warnings.push('юзербот уже админ с нужными правами — promote не потребовался');
                return {
                    ...base,
                    state: 'ok',
                    is_admin: true,
                    flags: reRead,
                    warnings,
                    message: `${label}: юзербот уже админ с нужными правами.`,
                    stop: false
                };
            }
            warnings.push('юзербот админ, но флагов не хватает, а бот не может их поменять');
            return {
                ...base,
                state: 'needs_promote',
                is_admin: true,
                flags: reRead,
                warnings,
                message: `${label}: юзербот админ, но не хватает прав (${reCheck.missing.join(', ')}).`,
                stop: false
            };
        }

        const message = classified === 'promote_forbidden'
            ? `${label}: official-бот не смог выдать права юзерботу — проверь, что у бота в площадке есть право «добавление админов».`
            : `${label}: не получилось выдать права юзерботу (${classified}).`;
        return {
            ...base,
            state: classified === 'promote_forbidden' ? 'promote_forbidden' : 'error',
            is_admin: false,
            flags: reRead || rights || {},
            warnings,
            message,
            stop: false
        };
    }

    // 4. Promote прошёл — обязательная перечитка админ-состояния.
    let verified = null;
    try {
        verified = await service.readUserbotAdminState(client, tgChatId, userbotTgId);
    } catch (error) {
        if (classifyTelegramError(error, 'member') === 'flood_wait') {
            return service.floodWaitCell(base, error);
        }
        verified = null;
    }

    if (verified?.is_admin) {
        const check = ensureFlagsSufficient(verified, CONTOUR_USERBOT_MAX_RIGHTS);
        if (check.sufficient) {
            return {
                ...base,
                state: 'ok',
                is_admin: true,
                flags: verified,
                warnings,
                message: `${label}: юзербот получил права админа.`,
                stop: false
            };
        }
        warnings.push(`после выдачи прав не хватает: ${check.missing.join(', ')}`);
        return {
            ...base,
            state: 'needs_promote',
            is_admin: true,
            flags: verified,
            warnings,
            message: `${label}: юзербот админ, но после выдачи прав не хватает: ${check.missing.join(', ')}.`,
            stop: false
        };
    }

    return {
        ...base,
        state: 'needs_promote',
        is_admin: false,
        flags: verified || {},
        warnings: [...warnings, 'после promote юзербот не виден как админ'],
        message: `${label}: promote прошёл, но перечитка не подтвердила админ-права.`,
        stop: false
    };
}
