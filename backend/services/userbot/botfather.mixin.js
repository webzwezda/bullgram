// Стадия 2 разрезки монстра userbot.service.js (план §7.3b): методы перенесены из
// класса ДОСЛОВНО (тела/JSDoc/комментарии без изменений); this.* зовётся через
// цепочку прототипов mixin-композиции в services/userbot.service.js.
import { MCPError, ERROR_CODES } from '../../shared/errors.js';
import { withTimeout } from '../../shared/utils.js';
import { wrapTelegramError } from './telegram-errors.js';
import { safeDisconnect } from './helpers.js';
import { assertFeatureEnabled, assertUserbotOperatable, waitForBotFatherReply, isBotFatherRefusal, parseBotFatherToken, botFatherCreateBotInFlight } from './botfather-lib.js';

export const BotfatherMixin = (Base) => class extends Base {
    /**
     * Создать бота через DM-диалог с @BotFather — ОДИН клиент на операцию,
     * никаких персистентных клиентов (правило плана). Флоу: /newbot → имя →
     * username → парс токена из ответа. DM-гейта нет — как у SpamBot-инспектора.
     * Гард от параллельного запуска на одном юзерботе (RATE_LIMITED) и
     * редакция токена из raw_reply.
     */
    async botFatherCreateBot(userbot, { botName, botUsername, stepTimeoutMs } = {}) {
        assertUserbotOperatable(userbot);
        assertFeatureEnabled('USERBOT_BOTFATHER_ENABLED', 'Создание ботов через BotFather');

        const inFlightKey = String(userbot.id);
        if (botFatherCreateBotInFlight.has(inFlightKey)) {
            throw new MCPError(ERROR_CODES.RATE_LIMITED, 'Создание бота для этого юзербота уже идёт', {});
        }
        botFatherCreateBotInFlight.set(inFlightKey, true);

        const name = String(botName || '').trim();
        if (!name || name.length > 64) {
            throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "bot_name" is required (1-64 chars).', {});
        }
        const username = String(botUsername || '').trim().toLowerCase().replace(/^@/, '');
        if (!username) {
            throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "bot_username" is required.', {});
        }

        const client = await this.createAuthorizedClient(userbot);
        try {
            const peer = await withTimeout(
                client.getInputEntity('botfather'),
                30_000,
                'botFatherCreateBot.resolvePeer'
            );
            // Baseline: id последнего сообщения в диалоге — ответы BotFather ищем строго выше его.
            const baseline = await withTimeout(
                client.getMessages(peer, { limit: 1 }),
                30_000,
                'botFatherCreateBot.baseline'
            );
            const baselineId = Number(baseline?.[0]?.id || 0);

            const sendStep = async (text, label) => {
                const sent = await withTimeout(
                    client.sendMessage(peer, { message: text }),
                    30_000,
                    `${label}.send`
                );
                const afterId = Math.max(Number(sent?.id || 0), baselineId);
                return waitForBotFatherReply(client, peer, afterId, stepTimeoutMs, label);
            };

            const assertNotRefusal = (reply, step) => {
                const refusal = isBotFatherRefusal(reply);
                if (refusal) {
                    throw new MCPError(
                        ERROR_CODES.INVALID_PARAMS,
                        `BotFather отказал на шаге ${step}: ${refusal}`,
                        {}
                    );
                }
            };

            assertNotRefusal(await sendStep('/newbot', 'botFatherCreateBot.step1'), '/newbot');
            assertNotRefusal(await sendStep(name, 'botFatherCreateBot.step2'), 'имя');
            const reply = await sendStep(username, 'botFatherCreateBot.step3');
            assertNotRefusal(reply, 'юзернейм');

            if (/taken|unavailable/i.test(reply)) {
                throw new MCPError(
                    ERROR_CODES.INVALID_PARAMS,
                    `BotFather отклонил username: ${reply.slice(0, 300)}`,
                    {}
                );
            }
            const token = parseBotFatherToken(reply);
            if (!token) {
                throw new MCPError(
                    ERROR_CODES.TELEGRAM_ERROR,
                    `BotFather ответил без токена: ${reply.slice(0, 300)}`,
                    { auditStatus: 'telegram_error' }
                );
            }

            console.log('[UserbotService] botFatherCreateBot: бот создан:', {
                userbot_id: userbot.id,
                bot_username: `@${username}`
            });

            return {
                bot_username: `@${username}`,
                bot_token: token,
                raw_reply: token ? reply.replace(token, '<redacted>') : reply.slice(0, 1000)
            };
        } catch (error) {
            throw await wrapTelegramError(this.supabase, userbot, error, 'botFatherCreateBot');
        } finally {
            botFatherCreateBotInFlight.delete(inFlightKey);
            await safeDisconnect(client);
        }
    }

    // ============================================================
    // Волна 2 userbot-ops: банальные операции с сообщениями/чатами.
    // Без флагов-kill-switch (необратимость delete закрыта явным confirm-ом
    // на уровне операции); peer резолвим волновским resolveChatPeer.
    // ============================================================
};
