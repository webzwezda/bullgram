/**
 * Seed-реакция активного канала: меню «❤️ Автореакция» + callback seed_set:*.
 */
import { Markup } from 'telegraf';
import { normalizeSeedEmojiList } from './reactions.js';
import { resolveActiveChannel } from './active-channel.js';

export function registerSeedReactionsHandler(bot, service, botId) {
    const supabase = service.supabase;

    // Управление seed-реакцией на активном канале.
    // После нажатия показывает текущую реакцию и предлагает выбрать одну из
    // предустановленных (или выключить). Применяется к active-каналу админа
    // (active_modes[tgUserId], fallback channels[0]).
    bot.hears('❤️ Автореакция', async (ctx) => {
        const tgUserId = ctx.from.id;
        const { bot: botData, isAdmin } = await service.getBotAdminContext(botId, tgUserId);
        if (!isAdmin) return ctx.reply('Доступ запрещен.');

        const channel = await resolveActiveChannel(supabase, botId, botData, tgUserId);
        if (!channel) {
            return ctx.reply('Сначала подключите канал.');
        }

        const current = channel.seed_reaction_emoji || 'выключено';
        const options = [
            { emoji: '👍', label: '👍 Лайк' },
            { emoji: '👎', label: '👎 Дизлайк' },
            { emoji: '❤️', label: '❤️ Сердце' },
            { emoji: '🔥', label: '🔥 Огонь' },
            { emoji: '🥰', label: '🥰 Восхищение' },
            { emoji: '🎉', label: '🎉 Праздник' }
        ];

        // По 2 кнопки в ряд: 👍👎 / ❤️🔥 / 🥰🎉 — компактнее на экране.
        const rows = [];
        for (let i = 0; i < options.length; i += 2) {
            const pair = options.slice(i, i + 2).map(opt => {
                // В БД значение хранится нормализованным ('❤', без VS16) —
                // сравниваем в той же форме, иначе ✅ теряется после сохранения.
                const mark = normalizeSeedEmojiList(channel.seed_reaction_emoji) === normalizeSeedEmojiList(opt.emoji) ? '✅ ' : '';
                return Markup.button.callback(`${mark}${opt.label}`, `seed_set:${opt.emoji}`);
            });
            rows.push(pair);
        }
        rows.push([Markup.button.callback(
            channel.seed_reaction_emoji ? '🚫 Выключить' : '🚫 Уже выключено',
            `seed_set:off`
        )]);

        await ctx.reply(
            `Бот будет ставить выбранную реакцию под каждый новый пост в канале «${channel.title}».\n\n` +
            `Сейчас: ${current}\n\nВыберите новую:`,
            Markup.inlineKeyboard(rows)
        );
    });

    bot.action(/seed_set:(.+)/, async (ctx) => {
        const raw = ctx.match[1];
        const tgUserId = ctx.from.id;
        const { bot: botData, isAdmin } = await service.getBotAdminContext(botId, tgUserId);
        if (!isAdmin) return ctx.answerCbQuery('Доступ запрещен');

        const channel = await resolveActiveChannel(supabase, botId, botData, tgUserId);
        if (!channel) {
            await ctx.answerCbQuery('Канал не найден');
            return;
        }

        const ALLOWED = ['❤️', '👍', '👎', '🔥', '🥰', '👏', '😁', '🤔', '🤯', '😱', '🎉', '🤩', '💯', '💩', '🤣', '⚡'];
        // Нормализуем перед сохранением (❤️ → ❤, без VS16) — Telegram принимает
        // только каноничное значение, с VS16 даёт REACTION_INVALID.
        const value = raw === 'off' ? null : normalizeSeedEmojiList(raw);
        if (value !== null && !ALLOWED.map((x) => x.replace(/\uFE0F/g, '')).includes(value)) {
            return ctx.answerCbQuery('Недопустимый эмодзи');
        }

        await supabase
            .from('channels')
            .update({ seed_reaction_emoji: value })
            .eq('id', channel.id);

        await ctx.answerCbQuery(value ? `Установлено: ${value}` : 'Выключено');
        try { await ctx.deleteMessage(); } catch (e) {}
        const label = value ? value : 'выключено';
        await ctx.reply(`Готово. Реакция для «${channel.title}»: ${label}`);
    });
}
