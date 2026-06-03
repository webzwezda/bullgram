export function registerAdminHandlers(bot, { service, botId }) {
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
            await ctx.editMessageCaption(`✅ **Чек одобрен!**\nКлиенту (ID: ${invoice.tg_user_id}) выдана ссылка.`, { parse_mode: 'Markdown' });
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
            await bot.telegram.sendMessage(invoice.tg_user_id, `❌ **Оплата отклонена администратором.**\nСвяжитесь с поддержкой.`, { parse_mode: 'Markdown' });
            await ctx.editMessageCaption(`❌ **Отклонено!**\nКлиент уведомлен.`, { parse_mode: 'Markdown' });
        } catch (err) { console.error('Ошибка отклонения:', err); }
    });

    bot.action('admin_gift_code', async (ctx) => {
        await ctx.answerCbQuery();

        const userRole = await service.getUserRole(ctx, botId);
        if (userRole !== 'admin') {
            await ctx.reply('Эта кнопка доступна только админу проекта.');
            return;
        }

        const ownerId = await service.getBotOwner(botId);
        if (!ownerId) {
            await ctx.reply('Не удалось определить владельца бота.');
            return;
        }

        const { data: tariffs, error } = await service.supabase
            .from('tariffs')
            .select('id, title, channel_id, duration_days, is_active, channels(id, title)')
            .eq('owner_id', ownerId)
            .eq('is_active', true)
            .order('price', { ascending: true });

        if (error || !tariffs || !tariffs.length) {
            await ctx.reply('У этого бота нет активных тарифов для промокода.');
            return;
        }

        const rows = tariffs.map((tariff) => {
            const durationText = Number(tariff.duration_days) > 0 ? `${tariff.duration_days} дн.` : 'Навсегда';
            const channelTitle = tariff.channels?.title || 'Без канала';
            return [{ text: `${tariff.title} (${durationText}) — ${channelTitle}`, callback_data: `admin_gift_code_tariff_${tariff.id}` }];
        });

        await ctx.reply(
            'Выбери тариф для промокода. Получатель получит все каналы и ресурсы тарифа.',
            {
                reply_markup: {
                    inline_keyboard: [
                        ...rows,
                        [{ text: 'Отмена', callback_data: 'admin_panel' }]
                    ]
                }
            }
        );
    });

    bot.action(/^admin_gift_code_tariff_(.+)$/, async (ctx) => {
        await ctx.answerCbQuery();

        const ownerId = await service.getBotOwner(botId);
        if (!ownerId) {
            await ctx.reply('Не удалось определить владельца бота.');
            return;
        }

        const tariffId = ctx.match[1];
        const { data: tariff, error } = await service.supabase
            .from('tariffs')
            .select('id, title, channel_id, duration_days')
            .eq('id', tariffId)
            .eq('owner_id', ownerId)
            .eq('is_active', true)
            .single();

        if (error || !tariff) {
            await ctx.reply('Тариф не найден или неактивен.');
            return;
        }

        try {
            const durationDays = Number(tariff.duration_days || 0);
            const giftCode = await service.createGiftAccessCode({
                ownerId,
                botId,
                channelId: tariff.channel_id,
                tariffId: tariff.id,
                durationDays,
                createdByTgUserId: ctx.from.id
            });

            const validUntil = giftCode.expires_at
                ? new Date(giftCode.expires_at).toLocaleDateString('ru-RU')
                : 'без срока';
            const durationText = durationDays > 0 ? `${durationDays} дней` : 'Навсегда';

            await ctx.reply(
                `🎁 Промокод готов.\n\nТариф: ${tariff.title}\nСрок доступа: ${durationText}\nКод: <code>${giftCode.code}</code>\nКод действует до: ${validUntil}\n\nПолучатель открывает бот, жмёт «Ввести код» и получает все ссылки тарифа.`,
                { parse_mode: 'HTML' }
            );
        } catch (err) {
            console.error('Ошибка генерации gift code:', err);
            await ctx.reply('Не получилось выпустить промокод.');
        }
    });

    bot.action('admin_tariffs', async (ctx) => {
        await ctx.answerCbQuery();
        await ctx.reply('⚙️ <b>Управление тарифами</b>\n\nДля управления тарифами используйте веб-панель:\n\n📱 Откройте <b>/app/plans</b> в админке\n\nТам можно:\n• Создавать и удалять тарифы\n• Менять цены и сроки\n• Настраивать комплекты\n\nИзменения сразу применяются в боте.', { parse_mode: 'HTML' });
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

            await ctx.reply(
                `💸 <b>Статистика партнерки</b>\n\n📊 Общая статистика:\n   Всего лидов: <b>${totalLeads}</b>\n   Начислено бонусов: <b>${completedRewards}</b>\n   Всего событий: <b>${totalEvents}</b>\n\nДля управления партнеркой:\n📱 Откройте <b>/app/referrals</b> в админке`,
                { parse_mode: 'HTML' }
            );
        } catch (error) {
            console.error('Ошибка admin_referral:', error);
            await ctx.reply('Не удалось загрузить статистику партнерки.');
        }
    });

    bot.action('admin_profile', async (ctx) => {
        await ctx.answerCbQuery();
        const adminContext = await service.getBotAdminContext(botId);
        await ctx.reply(
            `👤 <b>Профиль администратора</b>\n\n${service.buildAdminOwnershipHint(adminContext, 'sales')}\n\nДля управления профилем:\n📱 Откройте <b>/app/botfather</b> в админке`,
            { parse_mode: 'HTML' }
        );
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

            await ctx.reply(
                `📊 <b>Статистика</b>\n\n📦 Активных подписок: <b>${totalSubs || 0}</b>\n💳 Активных тарифов: <b>${totalTariffs || 0}</b>\n\nДля подробной статистики:\n📱 Откройте <b>/app/analytics</b> в админке`,
                { parse_mode: 'HTML' }
            );
        } catch (error) {
            console.error('Ошибка admin_stats:', error);
            await ctx.reply('Не удалось загрузить статистику.');
        }
    });
}
