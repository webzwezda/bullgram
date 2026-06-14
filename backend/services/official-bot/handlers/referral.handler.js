import { loadReferralReserveState, getReferralEconomics } from '../../referral-reserve.service.js';
import {
    pendingReferralWalletInputs,
    pendingReferralWalletKey
} from '../shared/pending-state.js';

export function registerReferralHandlers(bot, { service, botId, username }) {
    const renderReferralScreen = async (ctx) => {
        try {
            const ownerId = await service.getBotOwner(botId);
            if (!ownerId) return;
            const settings = await service.getReferralSettings(ownerId);
            const existingProfile = await service.getReferralProfile(ownerId, ctx.from.id);
            if (!settings.referral_enabled && !existingProfile) {
                const msg = '💸 Партнерская программа сейчас выключена. Если админ ее включит, кнопка появится сама.';
                if (ctx.callbackQuery) {
                    await ctx.editMessageText(msg).catch(() => {});
                } else {
                    await ctx.reply(msg);
                }
                return;
            }

            const displayName = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ').trim() || null;
            const reserve = await loadReferralReserveState(service.supabase, ownerId, { ensure: true });

            if (!existingProfile && !reserve.canAcceptNewPartners) {
                const msg = '💸 Новые партнерские ссылки сейчас на паузе: админ еще не пополнил резерв или резерв закончился. Старые партнеры продолжают работать по своим условиям.';
                if (ctx.callbackQuery) {
                    await ctx.editMessageText(msg).catch(() => {});
                } else {
                    await ctx.reply(msg);
                }
                return;
            }

            const profile = existingProfile || await service.ensureReferralProfile(
                ownerId,
                ctx.from.id,
                ctx.from?.username || null,
                displayName
            );

            if (!profile) {
                const msg = '💸 Партнерка пока не включена или SQL под нее еще не применен.';
                if (ctx.callbackQuery) {
                    await ctx.editMessageText(msg).catch(() => {});
                } else {
                    await ctx.reply(msg);
                }
                return;
            }

            const snapshot = await service.getReferralSnapshot(ownerId, ctx.from.id);
            const paidCount = (snapshot?.events || []).filter(event => event.event_type === 'reward_granted' && event.status === 'completed').length;
            const leadsCount = snapshot?.leads?.length || 0;
            const payoutMethod = await service.getReferralPayoutMethod(ownerId, ctx.from.id);
            const pendingPayout = await service.getPendingReferralPayout(ownerId, ctx.from.id);
            const minPayoutTon = getReferralEconomics().minPayoutTon;
            const balanceTon = Number(profile.balance_ton || 0);
            
            const walletText = payoutMethod?.ton_wallet
                ? `<code>${payoutMethod.ton_wallet}</code>`
                : 'не указан';
            
            const payoutText = pendingPayout
                ? `\n⏳ Заявка на выплату: <b>${Number(pendingPayout.amount_ton || 0)} TON</b> (${pendingPayout.status})`
                : '';
            
            const payoutKeyboard = [
                [{ text: payoutMethod?.ton_wallet ? '✏️ Поменять TON-кошелек' : '➕ Указать TON-кошелек', callback_data: 'referral_wallet_setup' }]
            ];

            if (balanceTon >= minPayoutTon && payoutMethod?.ton_wallet && !pendingPayout) {
                payoutKeyboard.push([{ text: `💸 Запросить выплату ${balanceTon} TON`, callback_data: 'referral_payout_request' }]);
            }

            payoutKeyboard.push([{ text: '🔄 Обновить', callback_data: 'referral_info' }]);
            payoutKeyboard.push([{ text: '🔙 Назад', callback_data: 'back_to_main' }]);

            const text = `💸 <b>ПАРТНЕРСКАЯ ПРОГРАММА</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━━━\n` +
                `Твоя партнерская ссылка:\n<code>t.me/${username}?start=ref_${profile.referral_code}</code>\n\n` +
                `📊 <b>Статистика:</b>\n` +
                `   Привлечено лидов: <b>${leadsCount}</b>\n` +
                `   Закрыто оплат: <b>${paidCount}</b>\n\n` +
                `💰 <b>Баланс к выплате:</b>\n` +
                `   TON: <b>${balanceTon} TON</b>\n\n` +
                `👛 <b>Кошелек:</b> ${walletText}${payoutText}\n\n` +
                `⚠️ Минимальная выплата: <b>${minPayoutTon} TON</b>. Распространяйте ссылку среди целевой аудитории.`;

            if (ctx.callbackQuery) {
                await ctx.editMessageText(text, {
                    parse_mode: 'HTML',
                    disable_web_page_preview: true,
                    reply_markup: { inline_keyboard: payoutKeyboard }
                }).catch(async () => {
                    // fallback if editing is not possible
                    await ctx.reply(text, {
                        parse_mode: 'HTML',
                        disable_web_page_preview: true,
                        reply_markup: { inline_keyboard: payoutKeyboard }
                    });
                });
            } else {
                await ctx.reply(text, {
                    parse_mode: 'HTML',
                    disable_web_page_preview: true,
                    reply_markup: { inline_keyboard: payoutKeyboard }
                });
            }
        } catch (error) {
            console.error('Ошибка открытия рефералки:', error);
            await ctx.reply('Не получилось открыть партнерку.');
        }
    };

    bot.action('open_referral', async (ctx) => {
        await ctx.answerCbQuery();
        await renderReferralScreen(ctx);
    });

    bot.action('referral_info', async (ctx) => {
        await ctx.answerCbQuery();
        await renderReferralScreen(ctx);
    });

    bot.hears('🤝 Партнерка', async (ctx) => {
        await renderReferralScreen(ctx);
    });

    bot.action('referral_wallet_setup', async (ctx) => {
        await ctx.answerCbQuery();

        try {
            const ownerId = await service.getBotOwner(botId);
            if (!ownerId) return;

            const existingProfile = await service.getReferralProfile(ownerId, ctx.from.id);
            if (!existingProfile) {
                return ctx.reply('Сначала открой партнерку и получи свою ссылку.');
            }

            const pendingPayout = await service.getPendingReferralPayout(ownerId, ctx.from.id);
            if (pendingPayout) {
                return ctx.reply('У тебя уже есть заявка на выплату. Кошелек можно поменять после обработки заявки.');
            }

            pendingReferralWalletInputs.set(pendingReferralWalletKey(botId, ctx.from.id), {
                ownerId,
                requestedAt: Date.now()
            });

            await ctx.reply('Пришли TON-кошелек одним сообщением. Обычно он начинается на UQ или EQ. Выплаты ниже 5 TON пока не отправляем.');
        } catch (error) {
            console.error('Ошибка запуска ввода payout wallet:', error);
            await ctx.reply('Не получилось открыть ввод кошелька.');
        }
    });

    bot.action('referral_payout_request', async (ctx) => {
        await ctx.answerCbQuery();

        try {
            const ownerId = await service.getBotOwner(botId);
            if (!ownerId) return;

            const result = await service.requestReferralPartnerPayout(ownerId, ctx.from.id);
            if (result.error) {
                return ctx.reply(`💸 ${result.error}`);
            }

            await ctx.reply(`💸 Заявка создана: ${Number(result.payout.amount_ton || 0)} TON.\n\nАдмин увидит ее в партнерке и отправит выплату после проверки.`);
        } catch (error) {
            console.error('Ошибка создания payout request:', error);
            await ctx.reply('Не получилось создать заявку на выплату.');
        }
    });
}
