// Универсальный механизм админ-прав контура ("ensure-admin").
// Проверяет и выдаёт админ-права official-боту и привязанным юзерботам по каждой
// площадке контура, результат каждой ячейки (target × actor) пишется в
// sales_contour_actor_rights (миграция 20260916200000, backend/sql/sales-contour-actor-rights.sql).
//
// Принципы:
//   - одна упавшая ячейка никогда не роняет прогон — ошибки Telegram классифицируются;
//   - flood_wait останавливает обработку остальных площадок этого юзербота (cooldown);
//   - после promote обязательная перечитка админ-состояния (verification required);
//   - юзербот никогда не получает can_promote_members (safety, см. CONTOUR_USERBOT_MAX_RIGHTS).

import { Telegraf } from 'telegraf';
import { Api } from 'telegram';
import { decrypt } from '../utils/crypto.js';
import { loadReservedUserbotIds } from '../utils/shop-reservations.js';
import { SalesContourError, normalizeBotKind } from './sales-contour.service.js';

// Максимальные права official-бота в площадках контура.
export const CONTOUR_OFFICIAL_BOT_MAX_RIGHTS = Object.freeze({
    can_manage_chat: true,
    can_invite_users: true,
    can_restrict_members: true,
    can_promote_members: true
});

// Максимальные права юзербота в площадках контура.
// can_promote_members намеренно отсутствует (safety): юзербот не должен раздавать админок.
// Если перевернуть этот флаг здесь — включатся юзерботы-промоутеры (pool-promoter).
export const CONTOUR_USERBOT_MAX_RIGHTS = Object.freeze({
    can_invite_users: true,
    can_restrict_members: true
});

const CHANNEL_CHAT_TYPES = new Set(['channel']);
const GROUP_CHAT_TYPES = new Set(['group', 'supergroup']);
const ADMIN_MEMBER_STATUSES = new Set(['administrator', 'creator']);
const LEFT_STATUSES = new Set(['left', 'kicked']);
const BLOCKED_USERBOT_STATUSES = new Set(['restricted', 'expired', 'error']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INTER_CELL_DELAY_MS = 500;
const MEMBERSHIP_WAIT_ATTEMPTS = 3;
const MEMBERSHIP_WAIT_INTERVAL_MS = 2000;

// Копия CONTOUR_TARGET_CONFIG из sales-contour.service.js (там не экспортируется, а
// добавлять экспорт сверх согласованных правок нельзя). Поля и семантика должны совпадать.
const CONTOUR_TARGET_CONFIG = Object.freeze({
    public_channel: {
        field: 'public_channel_id',
        label: 'открытый канал',
        allowedChatTypes: CHANNEL_CHAT_TYPES
    },
    public_chat: {
        field: 'public_chat_id',
        label: 'открытый чат',
        allowedChatTypes: GROUP_CHAT_TYPES
    },
    paid_channel: {
        field: 'paid_channel_id',
        label: 'закрытый канал',
        allowedChatTypes: CHANNEL_CHAT_TYPES
    },
    paid_chat: {
        field: 'paid_chat_id',
        label: 'закрытый чат',
        allowedChatTypes: GROUP_CHAT_TYPES
    }
});

function normalizeUuidValue(value) {
    const raw = String(value || '').trim();
    return UUID_RE.test(raw) ? raw : null;
}

function extractInviteHash(inviteLink) {
    if (!inviteLink) return null;
    const match = inviteLink.match(/[+](\w[\w-]+)/) || inviteLink.match(/joinchat\/([\w-]+)/);
    return match ? match[1] : null;
}

function buildErrorMessage(error) {
    return String(error?.errorMessage || error?.response?.description || error?.message || error || '').trim()
        || 'неизвестная ошибка Telegram';
}

// Права участника из ответа Bot API getChatMember (семантика buildTelegramMemberRights
// из sales-contour.service.js).
function buildBotApiMemberRights(member) {
    const status = String(member?.status || '').trim().toLowerCase();
    const isAdmin = ADMIN_MEMBER_STATUSES.has(status);

    return {
        status: status || 'unknown',
        is_admin: isAdmin,
        is_creator: status === 'creator',
        can_invite_users: !!member?.can_invite_users || status === 'creator',
        can_restrict_members: !!member?.can_restrict_members || status === 'creator',
        can_promote_members: !!member?.can_promote_members || status === 'creator',
        can_manage_chat: !!member?.can_manage_chat || status === 'creator'
    };
}

// Права юзербота из ответа GramJS channels.getParticipant
// (сам участник или обёртка { participant } — поддерживаем обе формы).
function buildUserbotRightsFromParticipant(participantResult) {
    const raw = participantResult?.participant || participantResult || {};
    const className = String(raw?.className || '').trim();
    const isCreator = className === 'ChannelParticipantCreator';
    const isAdministrator = className === 'ChannelParticipantAdmin';
    const adminRights = raw?.adminRights || {};

    return {
        status: isCreator ? 'creator' : isAdministrator ? 'administrator' : 'member',
        is_admin: isCreator || isAdministrator,
        is_creator: isCreator,
        can_invite_users: isCreator || adminRights.inviteUsers === true,
        can_restrict_members: isCreator || adminRights.banUsers === true,
        can_promote_members: isCreator || adminRights.addAdmins === true,
        can_manage_chat: isCreator || isAdministrator
    };
}

// Проверяет, что текущие права покрывают желаемые.
// creator считается всемогущим даже без объекта флагов.
export function ensureFlagsSufficient(currentFlags, desiredFlags) {
    const desired = desiredFlags && typeof desiredFlags === 'object' ? desiredFlags : {};
    const wanted = Object.keys(desired).filter((flag) => desired[flag] === true);

    if (!wanted.length) {
        return { sufficient: true, missing: [] };
    }

    const status = String(currentFlags?.status || '').trim().toLowerCase();
    if (status === 'creator' || currentFlags?.is_creator === true) {
        return { sufficient: true, missing: [] };
    }

    if (!currentFlags?.is_admin) {
        return { sufficient: false, missing: wanted };
    }

    const missing = wanted.filter((flag) => currentFlags[flag] !== true);
    return { sufficient: missing.length === 0, missing };
}

// Классификация ошибки Telegram/GramJS/Bot API.
// retry_after при flood_wait дописывается в сам объект ошибки (err.retry_after, секунды).
export function classifyTelegramError(error, adminStatus = '') {
    const raw = [
        error?.errorMessage,
        error?.response?.description,
        error?.description,
        error?.message,
        typeof error === 'string' ? error : ''
    ].map((part) => String(part || '')).join(' ');
    const lower = raw.toLowerCase();
    const normalizedAdminStatus = String(adminStatus || '').trim().toLowerCase();

    if (lower.includes('user_already_participant')) {
        return 'already_member';
    }

    if (
        lower.includes('flood_wait')
        || lower.includes('phone_number_flood')
        || lower.includes('peer_flood')
    ) {
        const match = raw.match(/FLOOD_WAIT[_\s]?(\d+)/i) || raw.match(/retry after (\d+)/i);
        const retryAfter = match
            ? Number(match[1])
            : error?.parameters?.retry_after != null ? Number(error.parameters.retry_after) : null;
        if (retryAfter != null && Number.isFinite(retryAfter)) {
            try {
                error.retry_after = retryAfter;
            } catch {
                // read-only объект ошибки — просто не сможем достать retry_after
            }
        }
        return 'flood_wait';
    }

    const adminRequired = lower.includes('chat_admin_required') || lower.includes('not enough rights');
    if (adminRequired) {
        return normalizedAdminStatus === 'administrator' || normalizedAdminStatus === 'creator'
            ? 'owner_appointed'
            : 'promote_forbidden';
    }

    return 'unknown';
}

function createDefaultBotApiFactory() {
    return async (botAccount) => {
        const token = botAccount?.session_data ? decrypt(botAccount.session_data) : '';
        if (!token) {
            throw new SalesContourError('У official-бота нет сохраненного токена.', 409, 'bot_token_missing');
        }
        return new Telegraf(token).telegram;
    };
}

function createDefaultUserbotClientFactory(supabase) {
    return async (userbotAccount) => {
        const { UserbotService } = await import('./userbot.service.js');
        const userbotService = new UserbotService(supabase);
        return userbotService.createAuthorizedClient(userbotAccount, 1);
    };
}

export class ContourAdminRightsService {
    constructor(supabase, deps = {}) {
        this.supabase = supabase;
        this.deps = {
            botApiFactory: deps.botApiFactory || createDefaultBotApiFactory(),
            userbotClientFactory: deps.userbotClientFactory || createDefaultUserbotClientFactory(supabase),
            sleep: deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
            now: deps.now || (() => Date.now())
        };
    }

    /**
     * Проверяет и выдаёт админ-права по всем площадкам контура для official-бота
     * и всех активных юзерботов. Одна ячейка не роняет прогон.
     * @returns {{ results: Array, summary: string }}
     */
    async ensureAll(ownerId, { botId: rawBotId, autoJoin = true, repairMode = false } = {}) {
        const botId = normalizeUuidValue(rawBotId);
        if (!botId) {
            throw new SalesContourError('Не передан bot_id.', 400, 'bot_id_missing');
        }

        const [bot, channels, contour] = await Promise.all([
            this.assertOwnedSalesBot(ownerId, botId),
            this.loadOwnedChannels(ownerId),
            this.loadContourForBot(ownerId, botId)
        ]);

        if (!contour) {
            throw new SalesContourError('Сначала сохрани контур продаж для этого бота.', 409, 'sales_contour_missing');
        }

        const targets = this.buildContourTargets(channels, contour);
        if (!targets.length) {
            throw new SalesContourError('В контуре нет привязанных площадок.', 409, 'no_targets');
        }

        // repairMode (монитор): official-бот только что проверен самим монитором —
        // чиним только юзерботов, без дублирующих проверок бота.
        const actors = [];
        if (!repairMode) {
            actors.push({ type: 'official_bot', id: bot.id, account: bot });
        }
        for (const account of await this.loadActorUserbots(ownerId, botId, contour)) {
            actors.push({ type: 'userbot', id: account.id, account });
        }

        const botApi = await this.deps.botApiFactory(bot);

        const results = [];
        let isFirstActor = true;
        for (const actor of actors) {
            if (!isFirstActor) await this.deps.sleep(INTER_CELL_DELAY_MS);
            isFirstActor = false;

            const actorResults = actor.type === 'official_bot'
                ? await this.ensureOfficialBotActor(botApi, actor, targets)
                : await this.ensureUserbotActor(botApi, actor, targets, { autoJoin });

            for (const result of actorResults) {
                results.push(result);
                await this.saveActorRight(ownerId, botId, result);
            }
        }

        const okCount = results.filter((item) => item.state === 'ok').length;
        const warningCount = results.reduce((sum, item) => sum + (item.warnings?.length || 0), 0);
        const summary = `${okCount} из ${results.length} — права подтверждены/выданы. Предупреждений: ${warningCount}.`;

        return { results, summary };
    }

    async ensureOfficialBotActor(botApi, actor, targets) {
        const results = [];
        const botTgId = String(actor.account.tg_account_id || '').trim();

        for (let index = 0; index < targets.length; index++) {
            const { key, channel, label } = targets[index];
            if (index > 0) await this.deps.sleep(INTER_CELL_DELAY_MS);

            const base = {
                actor_type: 'official_bot',
                actor_id: actor.id,
                actor_username: actor.account.tg_username || null,
                target: key,
                channel_id: channel.id || null,
                channel_title: channel.title || null,
                label
            };

            if (!botTgId) {
                results.push({
                    ...base,
                    state: 'promote_forbidden',
                    is_admin: false,
                    flags: {},
                    warnings: ['У official-бота нет Telegram ID.'],
                    message: `${label}: у бота нет Telegram ID — выдай права вручную.`
                });
                continue;
            }

            // Verify-only: сам себя бот повысить не может, любые ошибки — просто ячейка.
            let member = null;
            let checkError = null;
            try {
                member = await botApi.getChatMember(channel.tg_chat_id, botTgId);
            } catch (error) {
                checkError = error;
            }

            if (checkError) {
                const cell = classifyTelegramError(checkError, 'member') === 'flood_wait'
                    ? this.floodWaitCell(base, checkError, 'бота')
                    : {
                        ...base,
                        state: 'error',
                        is_admin: false,
                        flags: {},
                        warnings: [],
                        message: `${label}: не получилось проверить права бота — ${buildErrorMessage(checkError)}.`,
                        stop: false
                    };
                const { stop, ...entry } = cell;
                results.push(entry);
                if (stop) break;
                continue;
            }

            const rights = buildBotApiMemberRights(member);

            if (!rights.is_admin) {
                results.push({
                    ...base,
                    state: 'promote_forbidden',
                    is_admin: false,
                    flags: rights,
                    warnings: ['бот не админ в площадке — добавь админом вручную'],
                    message: `${label}: бот не админ в площадке — добавь админом вручную.`
                });
                continue;
            }

            const check = ensureFlagsSufficient(rights, CONTOUR_OFFICIAL_BOT_MAX_RIGHTS);
            if (check.sufficient) {
                results.push({
                    ...base,
                    state: 'ok',
                    is_admin: true,
                    flags: rights,
                    warnings: [],
                    message: `${label}: у бота все нужные права${rights.is_creator ? ' (владелец)' : ''}.`
                });
                continue;
            }

            const warnings = [`Не хватает прав: ${check.missing.join(', ')}.`, 'выдай боту права вручную'];
            results.push({
                ...base,
                state: 'promote_forbidden',
                is_admin: true,
                flags: rights,
                warnings,
                message: `${label}: боту не хватает прав (${check.missing.join(', ')}) — выдай боту права вручную.`
            });
        }

        return results;
    }

    async ensureUserbotActor(botApi, actor, targets, { autoJoin }) {
        const results = [];
        const userbotTgId = String(actor.account.tg_account_id || '').trim();

        let client = null;
        let clientError = null;
        try {
            client = await this.deps.userbotClientFactory(actor.account);
        } catch (error) {
            clientError = error;
        }

        if (!client) {
            for (const { key, channel, label } of targets) {
                results.push({
                    actor_type: 'userbot',
                    actor_id: actor.id,
                    actor_username: actor.account.tg_username || null,
                    target: key,
                    channel_id: channel.id || null,
                    channel_title: channel.title || null,
                    label,
                    state: 'error',
                    is_admin: false,
                    flags: {},
                    warnings: [],
                    message: `${label}: не получилось подключить юзербота — ${buildErrorMessage(clientError)}.`
                });
            }
            return results;
        }

        try {
            for (let index = 0; index < targets.length; index++) {
                const { key, channel, label } = targets[index];
                if (index > 0) await this.deps.sleep(INTER_CELL_DELAY_MS);

                const base = {
                    actor_type: 'userbot',
                    actor_id: actor.id,
                    actor_username: actor.account.tg_username || null,
                    target: key,
                    channel_id: channel.id || null,
                    channel_title: channel.title || null,
                    label
                };

                let cell;
                try {
                    cell = await this.ensureUserbotTarget(botApi, client, base, channel, {
                        autoJoin,
                        userbotTgId
                    });
                } catch (error) {
                    // страховка: всё, что не поймали внутри, классифицируем здесь
                    cell = classifyTelegramError(error, 'member') === 'flood_wait'
                        ? this.floodWaitCell(base, error)
                        : {
                            ...base,
                            state: 'error',
                            is_admin: false,
                            flags: {},
                            warnings: [],
                            message: `${label}: ${buildErrorMessage(error)}.`,
                            stop: false
                        };
                }

                const { stop, ...entry } = cell;
                results.push(entry);
                if (stop) {
                    console.warn(`[contour-admin-rights] flood_wait on userbot ${actor.id}, stopping remaining targets`);
                    break;
                }
            }
        } finally {
            if (client?.disconnect) {
                await client.disconnect().catch(() => {});
            }
        }

        return results;
    }

    async ensureUserbotTarget(botApi, client, base, channel, { autoJoin, userbotTgId }) {
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
            isMember = await this.isBotApiMember(botApi, tgChatId, userbotTgId);
        } catch (memberError) {
            if (classifyTelegramError(memberError, 'member') === 'flood_wait') {
                return this.floodWaitCell(base, memberError);
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

            const joined = await this.joinUserbotToChannel(botApi, client, channel, warnings);
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

            const confirmed = await this.waitForBotApiMembership(botApi, tgChatId, userbotTgId);
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
            rights = await this.readUserbotAdminState(client, tgChatId, userbotTgId);
        } catch (error) {
            if (classifyTelegramError(error, 'member') === 'flood_wait') {
                return this.floodWaitCell(base, error);
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
                return this.floodWaitCell(base, promoteError);
            }

            let reRead = null;
            try {
                reRead = await this.readUserbotAdminState(client, tgChatId, userbotTgId);
            } catch (readError) {
                if (classifyTelegramError(readError, 'member') === 'flood_wait') {
                    return this.floodWaitCell(base, readError);
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
            verified = await this.readUserbotAdminState(client, tgChatId, userbotTgId);
        } catch (error) {
            if (classifyTelegramError(error, 'member') === 'flood_wait') {
                return this.floodWaitCell(base, error);
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

    // Чтение админ-состояния юзербота в площадке (юзербот читает сам себя).
    // ВАЖНО (проверено на telegram@2.26.22):
    //   - client.getParticipant НЕ существует (только getParticipants);
    //   - InputUserSelf не кастится в InputPeer ("Cannot cast InputUserSelf to any kind
    //     of InputPeer") — рабочий вариант: resolved-пир + InputPeerSelf.
    // Поэтому сначала резолвим entity: базисные группы (InputPeerChat) не поддерживают
    // channels.GetParticipant — список участников читаем через messages.GetFullChat.
    async readUserbotAdminState(client, tgChatId, userbotTgId) {
        const peer = await client.getInputEntity(tgChatId);

        if (peer instanceof Api.InputPeerChat) {
            // базисная группа: гранулярных админ-флагов нет — админ = все флаги
            const full = await client.invoke(new Api.messages.GetFullChat({ chatId: peer.chatId }));
            const participants = full?.fullChat?.participants?.participants
                || full?.participants?.participants
                || [];
            const self = participants.find((p) => String(p?.userId ?? '') === String(userbotTgId));
            if (!self) {
                return {
                    status: 'left',
                    is_admin: false,
                    is_creator: false,
                    can_invite_users: false,
                    can_restrict_members: false,
                    can_promote_members: false,
                    can_manage_chat: false
                };
            }
            const isCreator = self.className === 'ChatParticipantCreator';
            const isAdmin = isCreator || self.className === 'ChatParticipantAdmin';
            return {
                status: isCreator ? 'creator' : isAdmin ? 'administrator' : 'member',
                is_admin: isCreator || isAdmin,
                is_creator: isCreator,
                can_invite_users: isAdmin || isCreator,
                can_restrict_members: isAdmin || isCreator,
                can_promote_members: isAdmin || isCreator,
                can_manage_chat: isAdmin || isCreator
            };
        }

        // канал/супергруппа
        const res = await client.invoke(new Api.channels.GetParticipant({
            channel: peer,
            participant: new Api.InputPeerSelf()
        }));
        return buildUserbotRightsFromParticipant(res);
    }

    // Членство через Bot API. «user not found / participant_id_invalid» = не состоит
    // (обычный ответ для не-участника канала). flood → throw (cooldown). Остальные
    // ошибки (бот не видит состав площадки) → throw: caller решает, это не «не состоит».
    async isBotApiMember(botApi, tgChatId, tgUserId) {
        let member;
        try {
            member = await botApi.getChatMember(tgChatId, String(tgUserId));
        } catch (error) {
            if (classifyTelegramError(error, 'member') === 'flood_wait') throw error;
            const message = buildErrorMessage(error);
            if (/user not found|user_not_participant|participant_id_invalid|member not found/i.test(message)) {
                return false;
            }
            throw error;
        }
        return !LEFT_STATUSES.has(String(member?.status || '').toLowerCase());
    }

    async waitForBotApiMembership(botApi, tgChatId, tgUserId, {
        attempts = MEMBERSHIP_WAIT_ATTEMPTS,
        interval = MEMBERSHIP_WAIT_INTERVAL_MS
    } = {}) {
        for (let attempt = 0; attempt < attempts; attempt++) {
            try {
                if (await this.isBotApiMember(botApi, tgChatId, tgUserId)) return true;
            } catch (error) {
                if (classifyTelegramError(error, 'member') === 'flood_wait') throw error;
                // проверка не удалась — считаем «ещё не появился» и пробуем снова
            }
            if (attempt < attempts - 1) await this.deps.sleep(interval);
        }
        return false;
    }

    // Стратегия вступления из joinSingleTarget: публичный username → JoinChannel,
    // приватная площадка → инвайт-ссылка через бота + ImportChatInvite.
    async joinUserbotToChannel(botApi, client, channel, warnings) {
        const tgChatId = channel.tg_chat_id;
        const username = String(channel.username || '').trim().replace(/^@/, '');

        if (username) {
            try {
                const entity = await client.getEntity(username);
                await client.invoke(new Api.channels.JoinChannel({ channel: entity }));
                return true;
            } catch (error) {
                const classified = classifyTelegramError(error, 'member');
                if (classified === 'flood_wait') throw error;
                if (classified === 'already_member') return true;
                warnings.push(`вступление по username не получилось (${buildErrorMessage(error)}) — пробуем инвайт-ссылку`);
            }
        }

        const inviteSources = [
            () => botApi.exportChatInviteLink(tgChatId).then((link) => ({
                hash: extractInviteHash(link),
                revoke: null
            })),
            () => botApi.createChatInviteLink(tgChatId, {}).then((created) => ({
                hash: extractInviteHash(created?.invite_link),
                revoke: created?.invite_link || null
            }))
        ];

        for (const getInvite of inviteSources) {
            let hash = null;
            let revoke = null;
            try {
                ({ hash, revoke } = await getInvite());
            } catch (error) {
                if (classifyTelegramError(error, 'member') === 'flood_wait') throw error;
                continue;
            }
            if (!hash) continue;

            try {
                await client.invoke(new Api.messages.ImportChatInvite({ hash }));
                return true;
            } catch (error) {
                const classified = classifyTelegramError(error, 'member');
                if (classified === 'flood_wait') throw error;
                if (classified === 'already_member') return true;
            } finally {
                if (revoke) {
                    await botApi.revokeChatInviteLink(tgChatId, revoke).catch(() => {});
                }
            }
        }

        return false;
    }

    floodWaitCell(base, error, subject = 'юзербота') {
        const retryAfter = Number.isFinite(error?.retry_after) ? error.retry_after : null;
        return {
            ...base,
            state: 'error',
            is_admin: false,
            flags: {},
            warnings: [],
            message: `${base.label}: Telegram просит паузу (flood wait${retryAfter != null ? ` ${retryAfter} c` : ''}). Обработка остальных площадок для этого ${subject} приостановлена.`,
            stop: true
        };
    }

    async saveActorRight(ownerId, botId, result) {
        const checkedAt = new Date(this.deps.now()).toISOString();
        const payload = {
            owner_id: ownerId,
            bot_id: botId,
            actor_type: result.actor_type,
            actor_id: result.actor_id,
            channel_id: result.channel_id || null,
            target: result.target,
            state: result.state,
            is_admin: !!result.is_admin,
            flags: result.flags || {},
            warnings: result.warnings || [],
            message: result.message || '',
            checked_at: checkedAt,
            updated_at: checkedAt
        };

        const { error } = await this.supabase
            .from('sales_contour_actor_rights')
            .upsert(payload, { onConflict: 'bot_id,actor_type,actor_id,target' });

        if (error) {
            console.error(`[contour-admin-rights] upsert failed (${result.actor_type}/${result.target}):`, error.message);
        }
        return payload;
    }

    buildContourTargets(channels, contour) {
        return Object.keys(CONTOUR_TARGET_CONFIG)
            .map((key) => {
                const config = CONTOUR_TARGET_CONFIG[key];
                const channelId = contour?.[config.field];
                if (!channelId) return null;
                const channel = (channels || []).find((item) => String(item.id) === String(channelId));
                if (!channel) return null;
                return { key, channel, label: config.label };
            })
            .filter(Boolean);
    }

    // Активные юзерботы-акторы: is_active-связки + single-режим контура.
    // Shop-reserved / свежий импорт / мёртвый прокси / заблокированные — пропускаем
    // (та же логика, что buildUserbotOption в sales-contour.service.js).
    async loadActorUserbots(ownerId, botId, contour) {
        const ids = new Set();

        try {
            const { data: bindings, error } = await this.supabase
                .from('official_bot_userbot_bindings')
                .select('bot_id, userbot_id, is_active, created_at')
                .eq('bot_id', botId)
                .eq('is_active', true);
            if (error) throw error;
            for (const binding of bindings || []) {
                ids.add(String(binding.userbot_id));
            }
        } catch (error) {
            console.error('[contour-admin-rights] failed to load userbot bindings:', error.message);
        }

        if (contour?.userbot_mode === 'single' && contour?.selected_userbot_id) {
            ids.add(String(contour.selected_userbot_id));
        }

        const userbotIds = [...ids].filter((id) => normalizeUuidValue(id));
        if (!userbotIds.length) return [];

        const [reservedUserbotIds, response] = await Promise.all([
            loadReservedUserbotIds(this.supabase, ownerId),
            this.supabase
                .from('tg_accounts')
                .select('id, owner_id, account_type, tg_account_id, tg_username, session_data, proxy_id, runtime_status, proxies(id, name, is_working, last_check_country, last_check_country_code)')
                .eq('owner_id', ownerId)
                .eq('account_type', 'userbot')
                .in('id', userbotIds)
        ]);

        if (response.error) throw response.error;

        return (response.data || []).filter((userbot) => this.isUserbotEligible(userbot, reservedUserbotIds));
    }

    isUserbotEligible(userbot, reservedUserbotIds) {
        if (reservedUserbotIds?.has(String(userbot?.id || ''))) return false;
        const runtimeStatus = String(userbot?.runtime_status || '').trim().toLowerCase();
        if (runtimeStatus === 'pending_activation') return false;
        if (BLOCKED_USERBOT_STATUSES.has(runtimeStatus)) return false;
        if (userbot?.proxy_id && userbot?.proxies?.is_working === false) return false;
        return true;
    }

    // Тот же assertOwnedSalesBot, что в sales-contour.service.js (те же колонки и проверки).
    async assertOwnedSalesBot(ownerId, botId) {
        const { data, error } = await this.supabase
            .from('tg_accounts')
            .select('id, owner_id, account_type, tg_username, tg_account_id, bot_role, bot_kind, runtime_status, runtime_error, session_data')
            .eq('id', botId)
            .eq('owner_id', ownerId)
            .eq('account_type', 'bot')
            .maybeSingle();

        if (error) throw error;

        if (!data) {
            throw new SalesContourError('Бот не найден.', 404, 'bot_not_found');
        }

        if (normalizeBotKind(data.bot_kind, { allowMissing: true }) !== 'sales') {
            throw new SalesContourError('Сохранять sales contour можно только для bot_kind=sales.', 409, 'bot_kind_not_sales');
        }

        if ((data.bot_role || 'sales') === 'ops') {
            throw new SalesContourError('Ops-бот не может владеть sales contour.', 409, 'bot_role_not_sales');
        }

        return data;
    }

    // Те же колонки, что loadOwnedChannels в sales-contour.service.js.
    async loadOwnedChannels(ownerId) {
        const { data, error } = await this.supabase
            .from('channels')
            .select('id, owner_id, bot_id, tg_chat_id, title, chat_type, username, visibility, last_visibility_check_at, created_at')
            .eq('owner_id', ownerId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data || [];
    }

    // Те же колонки, что loadContourForBot в sales-contour.service.js.
    async loadContourForBot(ownerId, botId) {
        const { data, error } = await this.supabase
            .from('sales_bot_contours')
            .select('bot_id, owner_id, public_channel_id, paid_channel_id, public_chat_id, paid_chat_id, userbot_mode, selected_userbot_id, selected_userbot_ids, created_at, updated_at')
            .eq('owner_id', ownerId)
            .eq('bot_id', botId)
            .maybeSingle();

        if (error) throw error;
        return data || null;
    }
}

export function createContourAdminRightsService(supabase, deps = {}) {
    return new ContourAdminRightsService(supabase, deps);
}
