export function registerPaymentExactHandlers(bot, { service }) {
    // no exact-match payment handlers currently
}

export function registerPaymentRegexHandlers(bot, { service, botId }) {
    bot.action(/fiat_paid_(.+)/, async (ctx) => {
        const memo = ctx.match[1];
        await ctx.answerCbQuery();

        const { data: invoice } = await service.supabase
            .from('invoices')
            .select('id, tariff_id, tg_user_id, status')
            .eq('memo', memo)
            .eq('tg_user_id', ctx.from.id)
            .maybeSingle();

        if (!invoice) {
            await ctx.editMessageText('Не нашел этот счет у тебя в истории. Открой оплату заново и повтори шаг.', { parse_mode: 'Markdown' });
            return;
        }

        await service.supabase
            .from('invoices')
            .update({ status: 'awaiting_receipt' })
            .eq('id', invoice.id)
            .eq('tg_user_id', ctx.from.id);

        if (invoice) {
            const { data: tariff } = await service.supabase.from('tariffs').select('owner_id').eq('id', invoice.tariff_id).single();
            await service.logPaymentEvent({
                ownerId: tariff?.owner_id,
                invoiceId: invoice.id,
                provider: 'manual_rub',
                eventType: 'receipt_requested',
                status: 'awaiting_receipt',
                payload: { memo }
            });
        }

        await ctx.editMessageText(`Отлично! Пожалуйста, **отправьте прямо в этот чат фотографию чека или PDF-файл** об успешном переводе.\nID платежа: \`${memo}\``, { parse_mode: 'Markdown' });
    });

    bot.action(/check_payment_(.+)/, async (ctx) => {
        const memo = ctx.match[1];
        await ctx.answerCbQuery('Проверяем блокчейн...', { show_alert: true });
        try {
            const { data: invoice } = await service.supabase.from('invoices').select('*').eq('memo', memo).single();
            if (!invoice) return;
            if (invoice.status === 'paid') return ctx.reply('✅ Этот счет уже оплачен!');

            const ownerId = await service.getBotOwner(botId);
            const { data: settings } = await service.supabase.from('payment_settings').select('ton_wallet').eq('owner_id', ownerId).single();

            const isPaid = await service.checkTonPayment(memo, invoice.amount, settings.ton_wallet);
            await service.logPaymentEvent({
                ownerId,
                invoiceId: invoice.id,
                provider: 'manual_ton',
                eventType: 'ton_manual_check',
                status: isPaid ? 'paid' : 'pending',
                payload: { memo }
            });

            if (isPaid) {
                await service.supabase.from('invoices').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('memo', memo);
                await service.logPaymentEvent({
                    ownerId,
                    invoiceId: invoice.id,
                    provider: 'manual_ton',
                    eventType: 'ton_manual_confirmed',
                    status: 'paid',
                    payload: { memo }
                });
                await service.activateSubscription(bot, invoice);
            } else {
                await ctx.reply(`⏳ **Оплата пока не найдена.**\nID заказа: \`${memo}\`\nПодождите пару минут и проверьте еще раз.`, { parse_mode: 'Markdown' });
            }
        } catch (err) { console.error('Ошибка в чекере крипты:', err); }
    });
}
