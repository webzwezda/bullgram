import { Telegraf } from 'telegraf';
import { consumeLinkCode } from './tg-link.service.js';

let botInstance = null;

export async function getPlatformBot(supabase) {
    if (botInstance) return botInstance;

    const token = process.env.TG_BOT_TOKEN;
    const username = process.env.PLATFORM_BOT_USERNAME;
    if (!token || !username) {
        console.warn('PLATFORM_BOT: TG_BOT_TOKEN or PLATFORM_BOT_USERNAME not set, bot disabled');
        return null;
    }

    const bot = new Telegraf(token);

    bot.start(async (ctx) => {
        const code = (ctx.startPayload || '').trim();
        if (!code) {
            return ctx.reply(
                'Этот бот используется для привязки Telegram к аккаунту Bullgram. ' +
                'Откройте профиль на bullgram.xyz/app/profile и нажмите «Привязать Telegram».'
            );
        }

        const telegramUserId = ctx.from?.id;
        if (!telegramUserId) {
            return ctx.reply('❌ Не удалось определить ваш Telegram ID.');
        }
        const telegramUsername = ctx.from?.username || null;

        const ownerId = consumeLinkCode(code);
        if (!ownerId) {
            return ctx.reply('❌ Код истёк или уже использован. Сгенерируйте новый в профиле.');
        }

        const { error } = await supabase
            .from('profiles')
            .update({
                telegram_user_id: telegramUserId,
                telegram_username: telegramUsername
            })
            .eq('id', ownerId);

        if (error) {
            if (String(error.code || '').includes('23505')) {
                return ctx.reply('❌ Этот Telegram уже привязан к другому аккаунту Bullgram.');
            }
            return ctx.reply('❌ Ошибка сохранения: ' + (error.message || 'неизвестная'));
        }

        return ctx.reply(
            `✅ Telegram привязан к аккаунту Bullgram.\n` +
            `ID: ${telegramUserId}` +
            (telegramUsername ? `\nUsername: @${telegramUsername}` : '')
        );
    });

    bot.catch((err) => {
        console.error(`❌ Platform bot @${username} error:`, err?.message || err);
    });

    try {
        const me = await bot.telegram.getMe();
        console.log(`🤖 Platform bot @${me.username} verified (id=${me.id}), launching polling…`);
    } catch (err) {
        console.error(`❌ Platform bot @${username} getMe failed:`, err?.message || err);
        return null;
    }

    // bot.launch() resolves only on stop; fire and forget. Errors surface via bot.catch.
    bot.launch({ dropPendingUpdates: true }).catch((err) => {
        console.error(`❌ Platform bot @${username} launch failed:`, err?.message || err);
    });

    botInstance = bot;
    return bot;
}
