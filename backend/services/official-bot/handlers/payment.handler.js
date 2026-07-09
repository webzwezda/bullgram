import { verifyTonConnectPayment } from '../../ton-connect-verify.service.js';

const TON_NANO = 1_000_000_000n;

function tonToNano(value) {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0n;
    return BigInt(Math.round(numeric * Number(TON_NANO)));
}

export function registerPaymentExactHandlers(bot, { service }) {
    // no exact-match payment handlers currently
}

export function registerPaymentRegexHandlers(bot, { service, botId }) {
    bot.action(/check_payment_(.+)/, async (ctx) => {
        const memo = ctx.match[1];
        await ctx.answerCbQuery('Проверяем блокчейн...', { show_alert: true });
        try {
            const { data: invoice } = await service.supabase.from('invoices').select('*').eq('memo', memo).single();
            if (!invoice) return;
            if (invoice.status === 'paid') return ctx.reply('✅ <b>Этот счет уже успешно оплачен!</b>', { parse_mode: 'HTML' });
            if (invoice.status === 'expired' || (invoice.expires_at && new Date(invoice.expires_at) < new Date())) {
                return ctx.reply('⌛ <b>Срок счёта истёк.</b>\nСоздайте новый в боте.', { parse_mode: 'HTML' });
            }

            const ownerId = await service.getBotOwner(botId);
            const { data: settings } = await service.supabase.from('payment_settings').select('ton_wallet').eq('owner_id', ownerId).single();
            if (!settings?.ton_wallet) {
                return ctx.reply('❌ У продавца не настроен TON-кошелёк.', { parse_mode: 'HTML' });
            }

            const result = await verifyTonConnectPayment({
                merchantWallet: settings.ton_wallet,
                memo,
                expectedNanoTon: tonToNano(invoice.amount).toString(),
                maxAttempts: 1
            });

            await service.logPaymentEvent({
                ownerId,
                invoiceId: invoice.id,
                provider: 'manual_ton',
                eventType: 'ton_manual_check',
                status: result.ok ? 'paid' : 'pending',
                payload: { memo }
            });

            if (result.ok) {
                // Atomic claim — handles the race against cron and the verify endpoint.
                const { data: claimed } = await service.supabase
                    .from('invoices')
                    .update({
                        status: 'paid',
                        paid_at: new Date().toISOString(),
                        verified_at: new Date().toISOString(),
                        tx_hash: result.txHash || null
                    })
                    .eq('id', invoice.id)
                    .eq('status', 'pending')
                    .select()
                    .maybeSingle();

                if (claimed) {
                    await service.logPaymentEvent({
                        ownerId,
                        invoiceId: invoice.id,
                        provider: 'manual_ton',
                        eventType: 'ton_manual_confirmed',
                        status: 'paid',
                        payload: { memo, tx_hash: result.txHash }
                    });
                    await service.activateSubscription(bot, claimed);
                } else {
                    // Another caller already claimed it — nothing to do.
                }
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
