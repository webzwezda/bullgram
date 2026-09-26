/**
 * Admin-команды: переключение направления, добавление поста, очередь, предложки.
 * Также /stats и /schedule bot-команды.
 */
import { Markup } from 'telegraf';
import { getAdminKeyboard, showQueueForChannel, suggestionInlineKeyboard } from '../keyboard.js';
import { formatMonthLabel } from '../best-of.js';
import { classifyMonthInTz } from '../timezone.js';
import { normalizeSeedEmojiList } from './reactions.js';

export function registerAdminCommandsHandler(bot, service, botId) {
    const supabase = service.supabase;

    bot.hears(/🔄 Направление/, async (ctx) => {
        const tgUserId = ctx.from.id;
        const { bot: botData, isAdmin } = await service.getBotAdminContext(botId, tgUserId);
        if (!isAdmin) return ctx.reply('Доступ запрещен.');

        const { data: channels } = await supabase
            .from('channels')
            .select('*')
            .eq('autopost_bot_id', botId);

        if (!channels || channels.length === 0) {
            return ctx.reply('Нет подключенных каналов. Пожалуйста, добавьте бота в каналы как администратора.');
        }

        const activeModes = botData.active_modes || {};
        const currentActive = activeModes[String(tgUserId)];

        let nextIndex = 0;
        if (currentActive) {
            const currentIndex = channels.findIndex(c => String(c.tg_chat_id) === String(currentActive));
            if (currentIndex !== -1) {
                nextIndex = (currentIndex + 1) % channels.length;
            }
        }

        const nextChannel = channels[nextIndex];
        activeModes[String(tgUserId)] = String(nextChannel.tg_chat_id);

        await supabase
            .from('autopost_bots')
            .update({ active_modes: activeModes })
            .eq('id', botId);

        const keyboard = await getAdminKeyboard(botId, tgUserId, supabase);
        await ctx.reply(`Активный канал переключен на: ${nextChannel.title}`, keyboard);
    });

    bot.hears(['➕ Добавить пост', '➕ Фото/Видео'], async (ctx) => {
        const tgUserId = ctx.from.id;
        const { isAdmin } = await service.getBotAdminContext(botId, tgUserId);
        if (!isAdmin) return ctx.reply('Доступ запрещен.');
        ctx.reply('Просто отправьте мне фото или альбом с текстом подписи, и я подготовлю пост.');
    });

    bot.hears('📝 Текст', async (ctx) => {
        const tgUserId = ctx.from.id;
        const { bot: botData, isAdmin } = await service.getBotAdminContext(botId, tgUserId);
        if (!isAdmin) return ctx.reply('Доступ запрещен.');

        const { data: channels } = await supabase
            .from('channels')
            .select('*')
            .eq('autopost_bot_id', botId);
        if (!channels || channels.length === 0) {
            return ctx.reply('Сначала добавьте меня в канал как администратора!');
        }

        // Активный канал из active_modes, fallback на первый (как в media.js:60-64)
        const activeModes = botData.active_modes || {};
        const activeId = activeModes[String(tgUserId)];
        let targetChannel = channels.find(c => String(c.tg_chat_id) === String(activeId));
        if (!targetChannel) targetChannel = channels[0];

        service.setAwaitTextPost(tgUserId, {
            targetChannelId: targetChannel.tg_chat_id,
            targetChannelTitle: targetChannel.title
        });

        await ctx.reply(
            `📝 Жду текст поста для канала «${targetChannel.title}».\n\n` +
            `Пришлите его следующим сообщением. Действует 10 минут.\n` +
            `Для отмены — /cancel.`
        );
    });

    bot.command('cancel', async (ctx) => {
        const tgUserId = ctx.from.id;
        const state = service.adminStates.get(tgUserId);
        if (state?.action === 'await_text_post') {
            if (state.timer) clearTimeout(state.timer);
            service.adminStates.delete(tgUserId);
            return ctx.reply('❌ Создание текстового поста отменено.');
        }
        if (state?.action === 'await_channel_select') {
            if (state.timer) clearTimeout(state.timer);
            service.adminStates.delete(tgUserId);
            return ctx.reply('❌ Выбор каналов отменён.');
        }
        if (state?.action === 'await_checklist_text' || state?.action === 'await_checklist_channel') {
            if (state.timer) clearTimeout(state.timer);
            service.adminStates.delete(tgUserId);
            return ctx.reply('❌ Создание чек-листа отменено.');
        }
    });

    bot.hears('📋 Очередь', async (ctx) => {
        const tgUserId = ctx.from.id;
        const { bot: botData, isAdmin } = await service.getBotAdminContext(botId, tgUserId);
        if (!isAdmin) return ctx.reply('Доступ запрещен.');

        const { data: channels } = await supabase
            .from('channels')
            .select('*')
            .eq('autopost_bot_id', botId);

        if (!channels || channels.length === 0) {
            return ctx.reply('Нет подключенных каналов. Пожалуйста, добавьте бота в каналы как администратора.');
        }

        const activeModes = botData.active_modes || {};
        const activeId = activeModes[String(tgUserId)];
        let activeChannel = channels.find(c => String(c.tg_chat_id) === String(activeId));
        if (!activeChannel) {
            activeChannel = channels[0];
        }

        await showQueueForChannel(ctx, botId, activeChannel, supabase);
    });

    bot.hears('📥 Предложки', async (ctx) => {
        const tgUserId = ctx.from.id;
        const { isAdmin } = await service.getBotAdminContext(botId, tgUserId);
        if (!isAdmin) return ctx.reply('Доступ запрещен.');

        const { data: items, error } = await supabase
            .from('autopost_items')
            .select('*')
            .eq('bot_id', botId)
            .eq('status', 'suggested')
            .order('created_at', { ascending: true })
            .limit(10);

        if (error || !items || items.length === 0) {
            return ctx.reply('Предложка пуста.');
        }

        await ctx.reply(`📥 **Предложенные посты (модерация):**`);

        for (const item of items) {
            const fileId = item.file_ids && item.file_ids.length > 0 ? item.file_ids[0] : item.file_id;

            const { data: channel } = await supabase
                .from('channels')
                .select('*')
                .eq('tg_chat_id', item.target_channel_id)
                .maybeSingle();

            const destTitle = channel ? channel.title : 'Неизвестно';
            const captionText = `Канал назначения: ${destTitle}\n\n${item.caption || ''}`;
            const inlineKeyboard = suggestionInlineKeyboard(item);

            if (fileId) {
                const type = item.media_type || 'photo';
                if (type === 'video') {
                    await ctx.replyWithVideo(fileId, { caption: captionText, ...inlineKeyboard });
                } else if (type === 'animation') {
                    await ctx.replyWithAnimation(fileId, { caption: captionText, ...inlineKeyboard });
                } else if (type === 'document') {
                    await ctx.replyWithDocument(fileId, { caption: captionText, ...inlineKeyboard });
                } else {
                    await ctx.replyWithPhoto(fileId, { caption: captionText, ...inlineKeyboard });
                }
            } else {
                await ctx.reply(captionText, inlineKeyboard);
            }
        }
    });

    // Подборка "Лучшее за месяц" по reaction_total.
    // Сначала показывает календарь: для каждого месяца, где есть посты с
    // реакциями в активном канале, кнопка "Месяц YYYY (N)". Текущий месяц
    // всегда в списке, даже с нулём реакций.
    bot.hears('🏆 Лучшее', async (ctx) => {
        const tgUserId = ctx.from.id;
        const { bot: botData, isAdmin } = await service.getBotAdminContext(botId, tgUserId);
        if (!isAdmin) return ctx.reply('Доступ запрещен.');

        const channel = await resolveActiveChannel(botData, tgUserId);
        if (!channel) {
            return ctx.reply('Сначала подключите канал и добавьте бота туда как администратора.');
        }

        const tz = channel.timezone || 'UTC';
        const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

        const { data: rows } = await supabase
            .from('autopost_items')
            .select('posted_at')
            .eq('bot_id', botId)
            .eq('target_channel_id', String(channel.tg_chat_id))
            .eq('status', 'posted')
            .gt('reaction_total', 0)
            .gte('posted_at', cutoff)
            .order('posted_at', { ascending: false });

        const monthCounts = new Map();
        for (const r of rows || []) {
            const key = classifyMonthInTz(r.posted_at, tz);
            if (!key) continue;
            monthCounts.set(key, (monthCounts.get(key) || 0) + 1);
        }

        // Текущий месяц в tz канала (не UTC!).
        const nowParts = classifyMonthInTz(new Date().toISOString(), tz);
        if (nowParts) monthCounts.set(nowParts, monthCounts.get(nowParts) || 0);

        const sorted = Array.from(monthCounts.keys()).sort((a, b) => b.localeCompare(a)).slice(0, 12);

        const buttons = sorted.map(key => {
            const [yStr, mStr] = key.split('-');
            const year = parseInt(yStr, 10);
            const month = parseInt(mStr, 10);
            const count = monthCounts.get(key);
            const label = formatMonthLabel(year, month);
            const suffix = count > 0 ? ` (${count})` : '';
            return [Markup.button.callback(`📅 ${label}${suffix}`, `bestof:prev:${key}`)];
        });

        const message = buttons.length === 0
            ? `🏆 Лучшее за месяц\n\nВ канале «${channel.title}» пока нет постов с реакциями.\nПодписчики начнут реагировать — здесь появятся месяцы.`
            : `🏆 Лучшее за месяц\n\nКанал: «${channel.title}».\nВыберите месяц — пришлю предпросмотр топа. Потом можно опубликовать в канал.`;

        await ctx.reply(message, Markup.inlineKeyboard(buttons));
    });

    // Управление seed-реакцией на активном канале.
    // После нажатия показывает текущую реакцию и предлагает выбрать одну из
    // предустановленных (или выключить). Применяется к active-каналу админа
    // (active_modes[tgUserId], fallback channels[0]).
    bot.hears('❤️ Автореакция', async (ctx) => {
        const tgUserId = ctx.from.id;
        const { bot: botData, isAdmin } = await service.getBotAdminContext(botId, tgUserId);
        if (!isAdmin) return ctx.reply('Доступ запрещен.');

        const channel = await resolveActiveChannel(botData, tgUserId);
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

        const channel = await resolveActiveChannel(botData, tgUserId);
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

    // Меню чек-листов: активные списки с прогрессом + инлайн-действия.
    // Детали/закрытие/создание — в handlers/checklist-menu.js (clstate/clcancel/clnew).
    bot.hears('☑️ Чек-листы', async (ctx) => {
        const tgUserId = ctx.from.id;
        const { isAdmin } = await service.getBotAdminContext(botId, tgUserId);
        if (!isAdmin) return ctx.reply('Доступ запрещен.');

        // Фильтр 'active' считается в коде после fetch — берём с запасом и режем до 10.
        const { items: lists } = await service.listChecklists(botId, { status: 'active', limit: 50 });
        const active = (lists || []).slice(0, 10);

        if (active.length === 0) {
            return ctx.reply(
                'Активных чек-листов нет. Создай через Bullgram MCP или /bots/autopost.',
                Markup.inlineKeyboard([[Markup.button.callback('＋ Новый список', 'clnew')]])
            );
        }

        // Прогресс одним батч-запросом по странице (паттерн itemsCountByChecklist в keyboard.js).
        const { data: itemRows } = await supabase
            .from('autopost_checklist_items')
            .select('checklist_id, is_checked')
            .in('checklist_id', active.map((c) => c.id));
        const progress = new Map();
        for (const r of itemRows || []) {
            const p = progress.get(r.checklist_id) || { done: 0, total: 0 };
            p.total += 1;
            if (r.is_checked === true) p.done += 1;
            progress.set(r.checklist_id, p);
        }

        const lines = active.map((c, i) => {
            const p = progress.get(c.id) || { done: 0, total: 0 };
            const expires = c.expires_at ? ` · до ${shortExpiry(c.expires_at)}` : '';
            return `${i + 1}. ☑️ ${c.title || 'Без названия'} — Выполнено ${p.done} из ${p.total}${expires}`;
        });

        const rows = active.map((c) => [
            Markup.button.callback(`🧾 Итог · ${(c.title || 'Без названия').slice(0, 20)}`, `clstate:${c.id}`),
            Markup.button.callback('Закрыть список', `clcancel:${c.id}`)
        ]);
        rows.push([Markup.button.callback('＋ Новый список', 'clnew')]);

        await ctx.reply(`☑️ Активные чек-листы (${active.length}):\n\n${lines.join('\n')}`, Markup.inlineKeyboard(rows));
    });

    bot.command('stats', async (ctx) => {
        try {
            const stats = await service.getStats(botId);
            const next = stats.nextScheduledAt
                ? new Date(stats.nextScheduledAt).toLocaleDateString('ru-RU')
                : 'не запланировано';

            await ctx.reply(
                `📊 **Статистика очереди**\n\n` +
                `📦 В очереди: ${stats.queued}\n` +
                `📅 Запланировано: ${stats.scheduled}\n` +
                `✅ Опубликовано: ${stats.posted}\n` +
                `❌ Ошибки: ${stats.failed}\n\n` +
                `⏭ Следующий пост: ${next}`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.error('[Autopost] Ошибка stats:', error);
        }
    });

    bot.command('schedule', async (ctx) => {
        try {
            const count = await service.scheduleNextBatch(botId);
            if (count === 0) {
                await ctx.reply('Нет нераспределённых картинок для планирования.');
            } else {
                await ctx.reply(`📅 Запланировано ${count} постов. Крон-задача опубликует их по расписанию.`);
            }
        } catch (error) {
            console.error('[Autopost] Ошибка schedule:', error);
            await ctx.reply('❌ Ошибка при планировании.');
        }
    });

    // Короткий «до 18.09 14:00» для меню. Серверная таймзона — это подсказка,
    // а не источник истины: expires_at лежит в БД в ISO.
    function shortExpiry(iso) {
        const d = new Date(iso);
        if (!iso || Number.isNaN(d.getTime())) return '';
        const p = (n) => String(n).padStart(2, '0');
        return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    async function resolveActiveChannel(botData, tgUserId) {
        const { data: channels } = await supabase
            .from('channels')
            .select('*')
            .eq('autopost_bot_id', botId);
        if (!channels || channels.length === 0) return null;
        const activeModes = botData?.active_modes || {};
        const activeId = activeModes[String(tgUserId)];
        const active = channels.find(c => String(c.tg_chat_id) === String(activeId));
        return active || channels[0];
    }
}
