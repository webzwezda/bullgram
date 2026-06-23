/**
 * /start + onboarding callback set_owner_admin.
 */
import { Markup } from 'telegraf';
import { getAdminKeyboard } from '../keyboard.js';

export function registerOnboardingHandler(bot, service, botId) {
    const supabase = service.supabase;

    bot.start(async (ctx) => {
        const tgUserId = ctx.from.id;
        const { data: botData } = await supabase
            .from('autopost_bots')
            .select('*')
            .eq('id', botId)
            .single();

        if (!botData) {
            return ctx.reply('Ошибка: бот не найден в системе.');
        }

        const adminTgIds = botData.admin_tg_ids || [];
        const isOwnerOrAdmin = adminTgIds.map(String).includes(String(tgUserId));

        const startPayload = ctx.payload;

        if (isOwnerOrAdmin) {
            const keyboard = await getAdminKeyboard(botId, tgUserId, supabase);
            return ctx.reply('Добро пожаловать в админ-панель автопостера!', keyboard);
        }

        if (adminTgIds.length === 0) {
            return ctx.reply(
                'Бот не настроен. Нажмите кнопку ниже, чтобы привязать его к вашему аккаунту.',
                Markup.inlineKeyboard([
                    Markup.button.callback('✅ Я администратор', 'set_owner_admin')
                ])
            );
        }

        if (startPayload && startPayload.startsWith('add_admin_')) {
            const code = startPayload.replace('add_admin_', '');
            const expected = botData.invite_secret;
            if (!expected || code !== expected) {
                return ctx.reply('Недействительный код приглашения.');
            }
            if (!adminTgIds.map(String).includes(String(tgUserId))) {
                adminTgIds.push(tgUserId);
                await supabase
                    .from('autopost_bots')
                    .update({ admin_tg_ids: adminTgIds })
                    .eq('id', botId);
            }
            const keyboard = await getAdminKeyboard(botId, tgUserId, supabase);
            return ctx.reply('Вы успешно добавлены в список администраторов бота!', keyboard);
        }

        if (startPayload && startPayload.startsWith('suggest_ch')) {
            const channelId = startPayload.replace('suggest_ch', '');
            try {
                const { data: channel } = await supabase
                    .from('channels')
                    .select('*')
                    .eq('id', channelId)
                    .single();

                if (channel) {
                    await service.setGuestSession(botId, tgUserId, {
                        targetChannelId: channel.tg_chat_id
                    });
                    return ctx.reply(`Отлично! Пришлите фото (или альбом из нескольких фото) с текстом подписи, чтобы предложить пост в канал "${channel.title}".`);
                } else {
                    return ctx.reply('Канал для предложения новостей не найден.');
                }
            } catch (err) {
                console.error('[Autopost] Ошибка получения канала по ссылке предложки:', err.message);
                return ctx.reply('Не удалось найти указанный канал.');
            }
        }

        if (startPayload && (startPayload === 'suggest_pub' || startPayload === 'suggest_priv')) {
            await service.setGuestSession(botId, tgUserId, {
                targetChannelType: startPayload === 'suggest_pub' ? 'public' : 'private'
            });
            return ctx.reply('Отлично! Пришлите фото (или альбом из нескольких фото) с текстом подписи, чтобы предложить пост в канал.');
        }

        return ctx.reply('Привет! Вы можете предложить новость для публикации в наших каналах. Нажмите кнопку "Предложить новость" под постами в канале.');
    });

    bot.action('set_owner_admin', async (ctx) => {
        const tgUserId = ctx.from.id;
        const { data: botData } = await supabase
            .from('autopost_bots')
            .select('*')
            .eq('id', botId)
            .single();
        if (!botData) return ctx.answerCbQuery('Бот не найден');

        const adminTgIds = botData.admin_tg_ids || [];
        if (adminTgIds.length > 0) {
            return ctx.answerCbQuery('Администратор уже назначен.');
        }

        adminTgIds.push(tgUserId);
        await supabase
            .from('autopost_bots')
            .update({ admin_tg_ids: adminTgIds })
            .eq('id', botId);

        await ctx.answerCbQuery('Вы успешно назначены администратором!');
        await ctx.editMessageText('Вы назначены администратором бота.');

        const keyboard = await getAdminKeyboard(botId, tgUserId, supabase);
        await ctx.reply('Панель управления активирована:', keyboard);
    });
}
