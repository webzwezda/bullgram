import { registerGiftCodeHandlers } from './admin-gift-codes.js';

export function registerAdminHandlers(bot, { service, botId }) {
    async function renderVerifyReceipts(ctx, index) {
        const ownerId = await service.getBotOwner(botId);
        if (!ownerId) return ctx.reply('❌ Не удалось определить владельца бота.');

        // Get tariffs for this bot
        const { data: botTariffs } = await service.supabase
            .from('tariffs')
            .select('id, title')
            .eq('bot_id', botId);
        
        const botTariffIds = (botTariffs || []).map(t => t.id);
        if (botTariffIds.length === 0) {
            return ctx.editMessageText('ℹ️ У этого бота нет активных тарифов, соответственно нет счетов на проверку.', {
                reply_markup: { inline_keyboard: [[{ text: '🔙 К панели', callback_data: 'admin_panel' }]] },
                parse_mode: 'HTML'
            });
        }

        // Get invoices waiting verification
        const { data: invoices, error } = await service.supabase
            .from('invoices')
            .select('*')
            .in('status', ['awaiting_receipt', 'wait_admin'])
            .in('tariff_id', botTariffIds)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching invoices for bot admin:', error);
            return ctx.reply('❌ Ошибка при загрузке счетов.');
        }

        if (!invoices || invoices.length === 0) {
            const emptyText = `🎉 <b>Очередь проверок пуста!</b>\n\nВсе чеки по тарифам этого бота проверены и разобраны.`;
            const keyboard = [[{ text: '🔙 К панели управления', callback_data: 'admin_panel' }]];
            await ctx.editMessageText(emptyText, { reply_markup: { inline_keyboard: keyboard }, parse_mode: 'HTML' }).catch(() => {});
            return;
        }

        const activeIdx = Math.max(0, Math.min(index, invoices.length - 1));
        const invoice = invoices[activeIdx];
        const tariff = botTariffs.find(t => t.id === invoice.tariff_id);
        const tariffTitle = tariff?.title || 'Тариф';

        let creatorDisplay = `TG ID <code>${invoice.tg_user_id}</code>`;
        const { data: member } = await service.supabase
            .from('channel_audience_members')
            .select('username, first_name, display_name')
            .eq('tg_user_id', invoice.tg_user_id)
            .maybeSingle();

        if (member) {
            const name = member.display_name || member.first_name || '';
            const usernameStr = member.username ? ` (@${member.username})` : '';
            creatorDisplay = `${name}${usernameStr} (ID: <code>${invoice.tg_user_id}</code>)`;
        }

        const dateStr = new Date(invoice.created_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
        const hasReceipt = invoice.payload?.receipt_file_url;

        let statusText = 'Ждет проверки';
        if (invoice.status === 'awaiting_receipt') {
            statusText = 'Ждет прикрепления чека (клиент нажал «я оплатил»)';
        } else if (invoice.status === 'wait_admin') {
            statusText = 'Чек отправлен, ждет решения админа';
        }

        const detailsText = `🔎 <b>ПРОВЕРКА ЧЕКОВ (Запись ${activeIdx + 1} из ${invoices.length})</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `📦 <b>Тариф:</b> ${tariffTitle}\n` +
            `💰 <b>Сумма:</b> <code>${invoice.amount} ${invoice.currency || 'RUB'}</code>\n` +
            `👤 <b>Покупатель:</b> ${creatorDisplay}\n` +
            `📅 <b>Дата создания:</b> <code>${dateStr}</code>\n` +
            `🚦 <b>Состояние:</b> <code>${statusText}</code>\n\n` +
            `📎 <b>Чек:</b> ${hasReceipt ? 'Прикреплен (кнопка ниже)' : '<i>Не приложен</i>'}`;

        const inlineKeyboard = [];

        inlineKeyboard.push([
            { text: '✅ Одобрить', callback_data: `admin_verify_approve_${invoice.memo}_idx_${activeIdx}` },
            { text: '❌ Отклонить', callback_data: `admin_verify_reject_${invoice.memo}_idx_${activeIdx}` }
        ]);

        if (hasReceipt) {
            const publicAppOrigin = String(process.env.PUBLIC_APP_ORIGIN || 'https://bullgram.xyz').replace(/\/$/, '');
            inlineKeyboard.push([{ text: '📄 Посмотреть чек', url: `${publicAppOrigin}${hasReceipt}` }]);
        }

        const paginationRow = [];
        if (activeIdx > 0) {
            paginationRow.push({ text: '◀️ Назад', callback_data: `admin_verify_receipts_idx_${activeIdx - 1}` });
        }
        if (activeIdx < invoices.length - 1) {
            paginationRow.push({ text: 'Вперед ▶️', callback_data: `admin_verify_receipts_idx_${activeIdx + 1}` });
        }
        if (paginationRow.length > 0) {
            inlineKeyboard.push(paginationRow);
        }

        inlineKeyboard.push([{ text: '🔙 К панели управления', callback_data: 'admin_panel' }]);

        await ctx.editMessageText(detailsText, { reply_markup: { inline_keyboard: inlineKeyboard }, parse_mode: 'HTML' }).catch(() => {});
    }

    bot.action(/admin_verify_receipts(?:_idx_(\d+))?/, async (ctx) => {
        await ctx.answerCbQuery().catch(() => {});
        const index = parseInt(ctx.match[1] || '0', 10);
        await renderVerifyReceipts(ctx, index);
    });

    bot.action(/admin_verify_approve_(.+?)_idx_(\d+)/, async (ctx) => {
        const memo = ctx.match[1];
        const nextIdx = Math.max(0, parseInt(ctx.match[2] || '0', 10) - 1);
        try {
            const { data: invoice } = await service.supabase.from('invoices').select('*').eq('memo', memo).single();
            if (!invoice || invoice.status === 'paid') return ctx.answerCbQuery('Уже обработано!', { show_alert: true });

            await service.supabase.from('invoices').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('memo', memo);
            const { data: tariff } = await service.supabase.from('tariffs').select('owner_id').eq('id', invoice.tariff_id).single();
            await service.logPaymentEvent({
                ownerId: tariff?.owner_id,
                invoiceId: invoice.id,
                provider: 'manual_rub',
                eventType: 'admin_approved',
                status: 'paid',
                payload: { memo }
            });
            await service.activateSubscription(bot, invoice);
            await ctx.answerCbQuery('Счет успешно подтвержден!');
            await renderVerifyReceipts(ctx, nextIdx);
        } catch (err) { 
            console.error('Ошибка одобрения в проверке:', err); 
            await ctx.answerCbQuery('Ошибка при обработке.', { show_alert: true });
        }
    });

    bot.action(/admin_verify_reject_(.+?)_idx_(\d+)/, async (ctx) => {
        const memo = ctx.match[1];
        const nextIdx = Math.max(0, parseInt(ctx.match[2] || '0', 10) - 1);
        try {
            const { data: invoice } = await service.supabase.from('invoices').select('*').eq('memo', memo).single();
            if (!invoice) return ctx.answerCbQuery('Счет не найден', { show_alert: true });

            await service.supabase.from('invoices').update({ status: 'rejected' }).eq('memo', memo);
            const { data: tariff } = await service.supabase.from('tariffs').select('owner_id').eq('id', invoice.tariff_id).single();
            await service.logPaymentEvent({
                ownerId: tariff?.owner_id,
                invoiceId: invoice.id,
                provider: 'manual_rub',
                eventType: 'admin_rejected',
                status: 'rejected',
                payload: { memo }
            });
            await bot.telegram.sendMessage(invoice.tg_user_id, `❌ <b>Оплата отклонена администратором.</b>\nСвяжитесь с поддержкой.`, { parse_mode: 'HTML' });
            await ctx.answerCbQuery('Счет отклонен!');
            await renderVerifyReceipts(ctx, nextIdx);
        } catch (err) { 
            console.error('Ошибка отклонения в проверке:', err); 
            await ctx.answerCbQuery('Ошибка при обработке.', { show_alert: true });
        }
    });

    bot.action(/admin_approve_(.+)/, async (ctx) => {
        const memo = ctx.match[1];
        try {
            const { data: invoice } = await service.supabase.from('invoices').select('*').eq('memo', memo).single();
            if (!invoice || invoice.status === 'paid') return ctx.answerCbQuery('Уже обработано!', { show_alert: true });

            await service.supabase.from('invoices').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('memo', memo);
            const { data: tariff } = await service.supabase.from('tariffs').select('owner_id').eq('id', invoice.tariff_id).single();
            await service.logPaymentEvent({
                ownerId: tariff?.owner_id,
                invoiceId: invoice.id,
                provider: 'manual_rub',
                eventType: 'admin_approved',
                status: 'paid',
                payload: { memo }
            });
            await service.activateSubscription(bot, invoice);
            await ctx.editMessageCaption(`✅ <b>Чек одобрен!</b>\nКлиенту (ID: ${invoice.tg_user_id}) выдана ссылка.`, { parse_mode: 'HTML' });
        } catch (err) { console.error('Ошибка одобрения:', err); }
    });

    bot.action(/admin_reject_(.+)/, async (ctx) => {
        const memo = ctx.match[1];
        try {
            const { data: invoice } = await service.supabase.from('invoices').select('*').eq('memo', memo).single();
            if (!invoice) return ctx.answerCbQuery('Счет не найден', { show_alert: true });

            await service.supabase.from('invoices').update({ status: 'rejected' }).eq('memo', memo);
            const { data: tariff } = await service.supabase.from('tariffs').select('owner_id').eq('id', invoice.tariff_id).single();
            await service.logPaymentEvent({
                ownerId: tariff?.owner_id,
                invoiceId: invoice.id,
                provider: 'manual_rub',
                eventType: 'admin_rejected',
                status: 'rejected',
                payload: { memo }
            });
            await bot.telegram.sendMessage(invoice.tg_user_id, `❌ <b>Оплата отклонена администратором.</b>\nСвяжитесь с поддержкой.`, { parse_mode: 'HTML' });
            await ctx.editMessageCaption(`❌ <b>Отклонено!</b>\nКлиент уведомлен.`, { parse_mode: 'HTML' });
        } catch (err) { console.error('Ошибка отклонения:', err); }
    });

    registerGiftCodeHandlers(bot, service, botId);

    bot.action('admin_tariffs', async (ctx) => {
        await ctx.answerCbQuery();
        
        const text = `⚙️ <b>УПРАВЛЕНИЕ ТАРИФАМИ</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `Для управления тарифами используйте веб-панель:\n\n` +
            `📱 Откройте <b>/app/sales-bot</b> в админке и выберите бота\n\n` +
            `Там вы можете:\n` +
            `• Создавать и удалять тарифы\n` +
            `• Изменять цены и сроки доступа\n` +
            `• Настраивать комплекты и каналы\n\n` +
            `Все изменения мгновенно применяются в боте.`;
            
        const inlineKeyboard = [[{ text: '🔙 Назад', callback_data: 'admin_panel' }]];

        if (ctx.callbackQuery) {
            await ctx.editMessageText(text, { reply_markup: { inline_keyboard: inlineKeyboard }, parse_mode: 'HTML' }).catch(() => {});
        } else {
            await ctx.reply(text, { reply_markup: { inline_keyboard: inlineKeyboard }, parse_mode: 'HTML' });
        }
    });

    bot.action('admin_referral', async (ctx) => {
        await ctx.answerCbQuery();
        try {
            const ownerId = await service.getBotOwner(botId);
            if (!ownerId) return;

            const snapshot = await service.getReferralSnapshot(ownerId, null);
            const totalEvents = snapshot?.events?.length || 0;
            const completedRewards = (snapshot?.events || []).filter(e => e.event_type === 'reward_granted' && e.status === 'completed').length;
            const totalLeads = snapshot?.leads?.length || 0;

            const text = `💸 <b>ПАРТНЕРСКАЯ ПРОГРАММА</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━━━\n` +
                `📊 <b>Общая статистика:</b>\n` +
                `   Всего лидов: <b>${totalLeads}</b>\n` +
                `   Начислено бонусов: <b>${completedRewards}</b>\n` +
                `   Всего событий: <b>${totalEvents}</b>\n\n` +
                `Для детальной настройки и управления выплатами:\n` +
                `📱 Откройте <b>/app/referrals</b> в веб-панели`;

            const inlineKeyboard = [
                [{ text: '🔄 Обновить', callback_data: 'admin_referral' }],
                [{ text: '🔙 Назад', callback_data: 'admin_panel' }]
            ];

            if (ctx.callbackQuery) {
                await ctx.editMessageText(text, { reply_markup: { inline_keyboard: inlineKeyboard }, parse_mode: 'HTML' }).catch(() => {});
            } else {
                await ctx.reply(text, { reply_markup: { inline_keyboard: inlineKeyboard }, parse_mode: 'HTML' });
            }
        } catch (error) {
            console.error('Ошибка admin_referral:', error);
            await ctx.reply('Не удалось загрузить статистику партнерки.');
        }
    });

    bot.action('admin_profile', async (ctx) => {
        await ctx.answerCbQuery();
        const adminContext = await service.getBotAdminContext(botId);
        
        const text = `👤 <b>ПРОФИЛЬ АДМИНИСТРАТОРА</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `${service.buildAdminOwnershipHint(adminContext, 'sales')}\n\n` +
            `Для детальной настройки и управления:\n` +
            `📱 Откройте <b>/app/sales-bot</b> в веб-панели`;

        const inlineKeyboard = [[{ text: '🔙 Назад', callback_data: 'admin_panel' }]];

        if (ctx.callbackQuery) {
            await ctx.editMessageText(text, { reply_markup: { inline_keyboard: inlineKeyboard }, parse_mode: 'HTML' }).catch(() => {});
        } else {
            await ctx.reply(text, { reply_markup: { inline_keyboard: inlineKeyboard }, parse_mode: 'HTML' });
        }
    });

    bot.action('admin_stats', async (ctx) => {
        await ctx.answerCbQuery();
        try {
            const ownerId = await service.getBotOwner(botId);
            if (!ownerId) return;

            const { count: totalSubs } = await service.supabase
                .from('subscriptions')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'active');

            const { count: totalTariffs } = await service.supabase
                .from('tariffs')
                .select('*', { count: 'exact', head: true })
                .eq('is_active', true);

            const text = `📊 <b>СТАТИСТИКА БОТА</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━━━\n` +
                `📦 Активных подписок: <b>${totalSubs || 0}</b>\n` +
                `💳 Активных тарифов: <b>${totalTariffs || 0}</b>\n\n` +
                `Для детального анализа и графиков:\n` +
                `📱 Откройте <b>/app/analytics</b> в веб-панели`;

            const inlineKeyboard = [
                [{ text: '🔄 Обновить', callback_data: 'admin_stats' }],
                [{ text: '🔙 Назад', callback_data: 'admin_panel' }]
            ];

            if (ctx.callbackQuery) {
                await ctx.editMessageText(text, { reply_markup: { inline_keyboard: inlineKeyboard }, parse_mode: 'HTML' }).catch(() => {});
            } else {
                await ctx.reply(text, { reply_markup: { inline_keyboard: inlineKeyboard }, parse_mode: 'HTML' });
            }
        } catch (error) {
            console.error('Ошибка admin_stats:', error);
            await ctx.reply('Не удалось загрузить статистику.');
        }
    });
}
