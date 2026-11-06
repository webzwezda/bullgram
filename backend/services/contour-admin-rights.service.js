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
//
// Разрезка (behavior-preserving): константы/хелперы — ./contour-admin-rights/shared.js,
// ячейка юзербот×площадка — ./contour-admin-rights/userbot-target.js, join/wait/peer-invite
// хелперы — ./contour-admin-rights/join-invites.js, персистентность/лоадеры —
// ./contour-admin-rights/persistence.js. Этот файл — фасад: публичные имена реэкспортируются.

import { Telegraf } from 'telegraf';
import { decrypt } from '../utils/crypto.js';
import { SalesContourError, normalizeBotKind } from './sales-contour.service.js';
import {
    CONTOUR_OFFICIAL_BOT_MAX_RIGHTS,
    CONTOUR_USERBOT_MAX_RIGHTS,
    INTER_CELL_DELAY_MS,
    buildBotApiMemberRights,
    buildErrorMessage,
    classifyTelegramError,
    ensureFlagsSufficient,
    normalizeUuidValue
} from './contour-admin-rights/shared.js';
import {
    floodWaitCell,
    isBotApiMember,
    joinUserbotToChannel,
    loadPeerInviteCandidates,
    readUserbotAdminState,
    revokePeerInvite,
    tryJoinViaPeerUserbotInvite,
    waitForBotApiMembership
} from './contour-admin-rights/join-invites.js';
import { ensureUserbotTarget } from './contour-admin-rights/userbot-target.js';
import {
    buildContourTargets,
    isUserbotEligible,
    loadActorUserbots,
    loadContourForBot,
    loadOwnedChannels,
    saveActorRight
} from './contour-admin-rights/persistence.js';

// Публичные имена модуля (импортируются тестами и sales-contour.service.js —
// фасад держит существующий цикл импортов как есть).
export {
    CONTOUR_OFFICIAL_BOT_MAX_RIGHTS,
    CONTOUR_USERBOT_MAX_RIGHTS,
    classifyTelegramError,
    ensureFlagsSufficient
};

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
                : await this.ensureUserbotActor(botApi, actor, targets, { autoJoin, ownerId, botId });

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

    async ensureUserbotActor(botApi, actor, targets, { autoJoin, ownerId, botId }) {
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
                        userbotTgId,
                        ownerId,
                        botId
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

    async ensureUserbotTarget(botApi, client, base, channel, options) {
        return ensureUserbotTarget(this, botApi, client, base, channel, options);
    }

    async readUserbotAdminState(client, tgChatId, userbotTgId) {
        return readUserbotAdminState(client, tgChatId, userbotTgId);
    }

    async isBotApiMember(botApi, tgChatId, tgUserId) {
        return isBotApiMember(botApi, tgChatId, tgUserId);
    }

    async waitForBotApiMembership(botApi, tgChatId, tgUserId, options = {}) {
        return waitForBotApiMembership(this, botApi, tgChatId, tgUserId, options);
    }

    async joinUserbotToChannel(botApi, client, channel, warnings, options = {}) {
        return joinUserbotToChannel(this, botApi, client, channel, warnings, options);
    }

    async tryJoinViaPeerUserbotInvite(options) {
        return tryJoinViaPeerUserbotInvite(this, options);
    }

    async revokePeerInvite(exporter, peer, link) {
        return revokePeerInvite(exporter, peer, link);
    }

    async loadPeerInviteCandidates(ownerId, botId, target, excludeActorId) {
        return loadPeerInviteCandidates(this, ownerId, botId, target, excludeActorId);
    }

    floodWaitCell(base, error, subject) {
        return floodWaitCell(base, error, subject);
    }

    async saveActorRight(ownerId, botId, result) {
        return saveActorRight(this, ownerId, botId, result);
    }

    buildContourTargets(channels, contour) {
        return buildContourTargets(channels, contour);
    }

    async loadActorUserbots(ownerId, botId, contour) {
        return loadActorUserbots(this, ownerId, botId, contour);
    }

    isUserbotEligible(userbot, reservedUserbotIds) {
        return isUserbotEligible(userbot, reservedUserbotIds);
    }

    async loadOwnedChannels(ownerId) {
        return loadOwnedChannels(this, ownerId);
    }

    async loadContourForBot(ownerId, botId) {
        return loadContourForBot(this, ownerId, botId);
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
}

export function createContourAdminRightsService(supabase, deps = {}) {
    return new ContourAdminRightsService(supabase, deps);
}
