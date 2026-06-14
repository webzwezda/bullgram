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
            await ctx.editMessageText('❌ Не удалось найти этот счет в истории. Пожалуйста, откройте оплату заново.', { parse_mode: 'HTML' });
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

        const uploadPromptText = `💳 <b>ОЖИДАНИЕ ПОДТВЕРЖДЕНИЯ</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `Отлично! Пожалуйста, <b>отправьте прямо в этот чат скриншот чека или PDF-документ</b>, подтверждающий успешный перевод.\n\n` +
            `<b>ID платежа:</b> <code>${memo}</code>`;

        await ctx.editMessageText(uploadPromptText, { parse_mode: 'HTML' });
    });

    bot.action(/check_payment_(.+)/, async (ctx) => {
        const memo = ctx.match[1];
        await ctx.answerCbQuery('Проверяем блокчейн...', { show_alert: true });
        try {
            const { data: invoice } = await service.supabase.from('invoices').select('*').eq('memo', memo).single();
            if (!invoice) return;
            if (invoice.status === 'paid') return ctx.reply('✅ <b>Этот счет уже успешно оплачен!</b>', { parse_mode: 'HTML' });

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
                const notFoundText = `⏳ <b>ОПЛАТА НЕ НАЙДЕНА</b>\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `Пока не удалось обнаружить транзакцию в блокчейне.\n\n` +
                    `<b>ID заказа:</b> <code>${memo}</code>\n` +
                    `Пожалуйста, подождите пару минут и нажмите кнопку «Проверить оплату» повторно.`;
                await ctx.reply(notFoundText, { parse_mode: 'HTML' });
            }
        } catch (err) { console.error('Ошибка в чекере крипты:', err); }
    });
}
