/**
 * Подсчёт нативных реакций Telegram под опубликованными постами.
 *
 * На каждый message_reaction event считает дельту (нет/есть реакция у юзера)
 * и инкрементирует reaction_total у найденного через posted_message_ids поста.
 *
 * Telegram присылает message_reaction индивидуально для каждого user'а,
 * не агрегированно. Поэтому новый реакций-сет одного юзера = +1 к total,
 * снятие всех реакций юзером = -1, замена эмодзи внутри одного user'а = 0.
 *
 * Посты опубликованные ДО запуска счётчика не имеют posted_message_ids
 * (старые rows с NULL'ом), reactions под ними не учитываются — backfill
 * невозможен (Bot API 7.2 убрал getMessageReactions).
 */
import { log } from '../logger.js';

export function registerReactionsHandler(bot, service, botId) {
    bot.on('message_reaction', async (ctx) => {
        try {
            const reaction = ctx.update.message_reaction;
            const messageId = reaction?.message_id;
            if (!messageId) return;

            const delta = computeReactionDelta(reaction);
            if (delta === 0) return;

            const itemId = await service.applyReactionDelta(messageId, delta);
            if (itemId) {
                log.debug('reactions', 'delta_applied', {
                    botId,
                    itemId,
                    messageId,
                    delta
                });
            }
        } catch (err) {
            log.error('reactions', 'handler_failed', { botId, err: err.message });
        }
    });
}

/**
 * Дельта-логика:
 *   old empty + new non-empty → +1 (юзер впервые отреагировал)
 *   old non-empty + new empty → -1 (юзер снял реакцию)
 *   old non-empty + new non-empty → 0  (юзер заменил эмодзи — итого 1 юзер)
 *   old empty + new empty → 0  (no-op, маловероятно но безопасно)
 *
 * act — это массив реакций пользователя. Пустой массив = реакции нет.
 */
export function computeReactionDelta(reaction) {
    const oldArr = Array.isArray(reaction?.old_reaction) ? reaction.old_reaction : [];
    const newArr = Array.isArray(reaction?.new_reaction) ? reaction.new_reaction : [];
    const had = oldArr.length > 0;
    const has = newArr.length > 0;
    if (had && !has) return -1;
    if (!had && has) return 1;
    return 0;
}
