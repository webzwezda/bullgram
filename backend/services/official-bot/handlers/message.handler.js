import {
    pendingGiftCodeInputs,
    pendingGiftCodeKey,
    pendingReferralWalletInputs,
    pendingReferralWalletKey
} from '../shared/pending-state.js';

export function registerMessageHandlers(bot, { service, botId }) {
    bot.on('message', async (ctx) => {
        if (ctx.chat.type === 'private' && ctx.message?.text) {
            const pendingGiftCode = pendingGiftCodeInputs.get(pendingGiftCodeKey(botId, ctx.from.id));
            if (pendingGiftCode?.mode === 'redeem') {
                pendingGiftCodeInputs.delete(pendingGiftCodeKey(botId, ctx.from.id));

                if (Date.now() - Number(pendingGiftCode.requestedAt || 0) > 15 * 60 * 1000) {
                    await ctx.reply('Ввод кода устарел. Нажми кнопку «Ввести код» еще раз.');
                    return;
                }

                try {
                    const result = await service.redeemGiftAccessCode({
                        bot,
                        botId,
                        tgUserId: ctx.from.id,
                        code: ctx.message.text
                    });
                    if (result.error) {
                        await ctx.reply(`🎁 ${result.error}`);
                        return;
                    }

                    await ctx.reply(
                        `🎁 Код принят!\n\n${result.tariffTitle ? `Тариф: **${result.tariffTitle}**\n` : ''}Срок: **${result.durationText}**${result.expiresAt ? `\nДо: **${new Date(result.expiresAt).toLocaleDateString('ru-RU')}**` : ''}\n\n${result.inviteLinks.map((link, i) => `${i + 1}. **${link.title}**\n${link.url}`).join('\n\n')}${result.resourceTargets.length ? `\n\n**Доп. материалы:**\n${result.resourceTargets.map((r, i) => `${i + 1}. ${r.title}: ${r.url}`).join('\n')}` : ''}\n\nВсе ссылки работают через запрос на вступление и закреплены за твоим аккаунтом.`,
                        { parse_mode: 'Markdown', disable_web_page_preview: true }
                    );
                } catch (error) {
                    console.error('Ошибка активации gift code:', error);
                    await ctx.reply('Не получилось активировать код.');
                }
                return;
            }

            const pendingWallet = pendingReferralWalletInputs.get(pendingReferralWalletKey(botId, ctx.from.id));
            if (pendingWallet) {
                pendingReferralWalletInputs.delete(pendingReferralWalletKey(botId, ctx.from.id));

                if (Date.now() - Number(pendingWallet.requestedAt || 0) > 15 * 60 * 1000) {
                    await ctx.reply('Ввод кошелька устарел. Нажми кнопку в партнерке еще раз.');
                    return;
                }

                try {
                    const result = await service.saveReferralPayoutWallet(pendingWallet.ownerId, ctx.from.id, ctx.message.text);
                    if (result.error) {
                        await ctx.reply(result.error);
                        return;
                    }

                    await ctx.reply(`Готово. TON-кошелек для выплат сохранен:\n<code>${result.wallet.ton_wallet}</code>`, {
                        parse_mode: 'HTML',
                        reply_markup: { inline_keyboard: [[{ text: '💸 Открыть партнерку', callback_data: 'referral_info' }]] }
                    });
                } catch (error) {
                    console.error('Ошибка сохранения referral payout wallet:', error);
                    await ctx.reply('Не получилось сохранить TON-кошелек.');
                }
                return;
            }
        }

        if (!ctx.message || (!ctx.message.photo && !ctx.message.document)) return;
        if (ctx.chat.type !== 'private') return;

        const userId = ctx.from.id;

        try {
            const { data: invoices, error } = await service.supabase.from('invoices')
                .select('*').eq('tg_user_id', userId).eq('status', 'awaiting_receipt').order('created_at', { ascending: false }).limit(1);
            const invoice = invoices && invoices.length > 0 ? invoices[0] : null;

            if (error || !invoice) return ctx.reply('⚠️ Я не жду от вас чек в данный момент.\nЕсли вы ошиблись скриншотом — напишите /start и пройдите процесс заново.', { parse_mode: 'Markdown' });

            let tariffName = 'Неизвестный тариф';
            if (invoice.tariff_id) {
                const { data: tariff } = await service.supabase.from('tariffs').select('title').eq('id', invoice.tariff_id).single();
                if (tariff) tariffName = tariff.title;
            }

            const ownerId = await service.getBotOwner(botId);
            const adminContext = await service.getBotAdminContext(botId, ownerId);

            if (!adminContext?.adminTgId) return ctx.reply('❌ Ошибка системы: у этого бота не указан Telegram ID админа.');

            await service.supabase.from('invoices').update({ status: 'wait_admin' }).eq('id', invoice.id);
            await service.logPaymentEvent({
                ownerId,
                invoiceId: invoice.id,
                provider: 'manual_rub',
                eventType: 'receipt_uploaded',
                status: 'wait_admin',
                payload: {
                    memo: invoice.memo,
                    tg_user_id: userId
                }
            });

            const captionForAdmin = `🔔 **Новый чек на проверку!**\n\nПокупатель: @${ctx.from.username || 'Без юзернейма'} (ID: \`${userId}\`)\nТариф: **${tariffName}**\nСумма: **${invoice.amount} RUB**\n\nНажмите кнопку ниже после проверки.`;

            await ctx.telegram.copyMessage(adminContext.adminTgId, ctx.chat.id, ctx.message.message_id, {
                caption: captionForAdmin, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '✅ Одобрить и выдать доступ', callback_data: `admin_approve_${invoice.memo}` }], [{ text: '❌ Отклонить (Фейк)', callback_data: `admin_reject_${invoice.memo}` }]]}
            });

            await ctx.reply(`✅ Чек успешно отправлен администратору!\nКак только он подтвердит перевод, бот пришлет вам ссылку.`);
        } catch (err) { await ctx.reply('❌ Произошла ошибка при отправке чека администратору.'); }
    });
}
