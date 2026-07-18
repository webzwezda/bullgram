/**
 * Telegraf handlers для checklist-бота.
 *
 * Триггеры создания списка:
 *   1. /todo command в DM или в reply на другое сообщение в группе
 *   2. Mention @bot_username в группе
 *   3. DM (private chat) — весь текст
 *
 * Toggle:
 *   callback_query с data='chk:<listId>:<idx>'
 *
 * Edit support:
 *   edited_message / edited_channel_post — находим list по source_message_id,
 *   перечитываем текст, синхронизируем items.
 */

import { createAndPost, toggleItem, syncFromEditedText, reloadList } from './lists.service.js';
import { buildKeyboard } from './keyboard.js';
import { parseTextToItems } from './parser.js';

async function ensureAdmin(ctx, bot) {
    if (ctx.chat?.type === 'private') return true;
    try {
        const me = bot.botInfo || await bot.telegram.getMe();
        const member = await ctx.telegram.getChatMember(ctx.chat.id, me.id);
        if (!['administrator', 'creator'].includes(member.status)) {
            await ctx.reply(
                `Сделай меня админом в этой группе — иначе я не смогу постить чеклисты. ` +
                `Зайди в настройки группы → Administrators → добавь меня.`
            );
            return false;
        }
        return true;
    } catch (e) {
        // Если не можем проверить — позволяем попробовать; если прав нет, sendMessage упадёт
        return true;
    }
}

/**
 * Регистрирует все handlers на инстансе бота.
 * Mention-хендлер регистрируем после getMe — иначе не знаем username.
 */
export function registerHandlers(bot, ownerId, botId, supabase) {
    // --- /start ---
    bot.start(async (ctx) => {
        const me = bot.botInfo?.username || 'бота';
        await ctx.reply(
            `Привет! Я — бот для семейных чеклистов.\n\n` +
            `Как мной пользоваться:\n` +
            `• В личке: просто пришли текст — я сделаю чеклист\n` +
            `• В группе: ответь на сообщение с /todo — я его конвертирую\n` +
            `• Или напиши @${me} и список под ним\n\n` +
            `Пример:\n` +
            `Список покупок:\n` +
            `- Молоко\n- Хлеб\n- Яйца\n\n` +
            `Опечатка? Просто отредактируй исходное сообщение — я обновлю чеклист, ` +
            `уже нажатые пункты сохранят состояние.`
        );
    });

    bot.help(async (ctx) => ctx.reply(
        `Просто пришли текст с пунктами (по строке или через запятую).\n` +
        `В группе — ответь на сообщение с /todo. Опечатки — редактируй исходное сообщение.`
    ));

    // --- /todo [text]  или  /todo в reply на другое сообщение ---
    bot.command('todo', async (ctx) => {
        const replied = ctx.message.reply_to_message;
        const source = ctx.chat.type === 'private'
            ? 'telegram_dm'
            : (replied ? 'telegram_reply' : 'telegram_command');

        const rawText = replied
            ? (replied.text || replied.caption || '')
            : (ctx.message.text || '').replace(/^\/(?:todo|checklist|cl)\s*/i, '').trim();

        if (!rawText) {
            await ctx.reply(
                'Пришли текст после /todo. Например:\n\n' +
                '/todo\n- Молоко\n- Хлеб\n\n' +
                'Или ответь /todo на любое сообщение с текстом списка.'
            );
            return;
        }

        if (!(await ensureAdmin(ctx, bot))) return;

        try {
            await createAndPost({
                supabase, ownerId, botId, bot,
                chatId: ctx.chat.id,
                rawText,
                source,
                sourceMessageId: replied?.message_id || ctx.message.message_id
            });
        } catch (e) {
            console.error('[checklist] /todo failed', botId, e.message);
            await ctx.reply(`Не получилось создать чеклист: ${String(e.message || '').slice(0, 200)}`);
        }
    });

    // --- Mention: регистрируем после getMe ---
    bot.telegram.getMe().then(me => {
        if (!me?.username) return;
        const mentionRe = new RegExp(`@${me.username}`, 'i');
        bot.hears(mentionRe, async (ctx) => {
            // Только если mention в начале сообщения (не реагируем на упоминание в середине чата)
            const text = ctx.message.text || '';
            if (!mentionRe.test(text)) return;

            const cleaned = text.replace(/@\w+/g, '').trim();
            if (!cleaned) return;

            if (!(await ensureAdmin(ctx, bot))) return;

            try {
                await createAndPost({
                    supabase, ownerId, botId, bot,
                    chatId: ctx.chat.id,
                    rawText: cleaned,
                    source: 'telegram_mention',
                    sourceMessageId: ctx.message.message_id
                });
            } catch (e) {
                console.error('[checklist] mention failed', botId, e.message);
                await ctx.reply(`Не получилось: ${String(e.message || '').slice(0, 200)}`);
            }
        });
    }).catch(e => console.error('[checklist] getMe failed', botId, e.message));

    // --- DM: весь текст как список ---
    bot.on('text', async (ctx) => {
        // В группе игнорируем (там только /todo, reply, mention)
        if (ctx.chat?.type !== 'private') return;
        // Команды (/start, /help, /todo) уже обработаны выше
        if ((ctx.message.text || '').startsWith('/')) return;

        const rawText = ctx.message.text || '';
        if (!rawText.trim()) return;

        try {
            await createAndPost({
                supabase, ownerId, botId, bot,
                chatId: ctx.chat.id,
                rawText,
                source: 'telegram_dm',
                sourceMessageId: ctx.message.message_id
            });
        } catch (e) {
            console.error('[checklist] DM failed', botId, e.message);
            await ctx.reply(`Не получилось: ${String(e.message || '').slice(0, 200)}`);
        }
    });

    // --- Edit support:edited_message и edited_channel_post ---
    const editHandler = async (ctx) => handleEdit(ctx, { supabase, bot });
    bot.on('edited_message', editHandler);
    bot.on('edited_channel_post', editHandler);

    // --- Toggle callback ---
    bot.on('callback_query', async (ctx) => {
        const data = ctx.callbackQuery?.data || '';
        if (!data.startsWith('chk:')) return;

        const parts = data.split(':');
        const listId = parts[1];
        const idx = Number(parts[2]);

        if (!listId || !Number.isFinite(idx)) {
            await ctx.answerCbQuery({ text: 'Некорректный запрос' });
            return;
        }

        try {
            const list = await toggleItem(supabase, listId, idx);
            if (!list) {
                await ctx.answerCbQuery({ text: 'Список удалён или не найден' });
                return;
            }
            await ctx.answerCbQuery();
            await ctx.editMessageReplyMarkup(buildKeyboard(list));
        } catch (e) {
            console.error('[checklist] toggle failed', listId, idx, e.message);
            await ctx.answerCbQuery({ text: 'Ошибка, попробуй ещё раз' });
        }
    });
}

/**
 * Универсальный обработчик edit: находим list по (chat_id, source_message_id),
 * синхронизируем items с сохранением checked у остающихся, обновляем keyboard+text.
 */
async function handleEdit(ctx, { supabase, bot }) {
    const edited = ctx.editedMessage || ctx.editedChannelPost;
    if (!edited?.message_id || !edited.text) return;

    const chatId = edited.chat?.id;
    if (!chatId) return;

    const { data: list } = await supabase.from('checklist_lists')
        .select('id, message_id, title, status')
        .eq('chat_id', chatId)
        .eq('source_message_id', edited.message_id)
        .eq('status', 'posted')
        .maybeSingle();
    if (!list) return;

    try {
        const updated = await syncFromEditedText(supabase, {
            listId: list.id,
            rawText: edited.text
        });
        if (!updated) return;

        // Обновляем текст+keyboard сообщения бота
        try {
            await bot.telegram.editMessageText(
                chatId,
                list.message_id,
                undefined,
                `📋 ${updated.title}`
            );
        } catch (e) {
            // "message is not modified" если текст не изменился — игнорируем
            if (!String(e.message || '').includes('not modified')) {
                console.error('[checklist] edit_message_text failed', list.id, e.message);
            }
        }
        try {
            await bot.telegram.editMessageReplyMarkup(
                chatId,
                list.message_id,
                undefined,
                buildKeyboard(updated)
            );
        } catch (e) {
            if (!String(e.message || '').includes('not modified')) {
                console.error('[checklist] edit_message_reply_markup failed', list.id, e.message);
            }
        }
    } catch (e) {
        console.error('[checklist] handleEdit failed', list.id, e.message);
    }
}
