import { loadReferralReserveState, getReferralEconomics } from '../../referral-reserve.service.js';
import {
    pendingReferralWalletInputs,
    pendingReferralWalletKey
} from '../shared/pending-state.js';

export function registerReferralHandlers(bot, { service, botId, username }) {
    bot.action('open_referral', async (ctx) => {
        await ctx.answerCbQuery();

        try {
            const ownerId = await service.getBotOwner(botId);
            if (!ownerId) return;
            const settings = await service.getReferralSettings(ownerId);
            if (!settings.referral_enabled) {
                return ctx.reply('Партнерка сейчас выключена. Если админ ее включит, кнопка появится сама.');
            }

            const displayName = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ').trim() || null;
            const existingProfile = await service.getReferralProfile(ownerId, ctx.from.id);
            const reserve = await loadReferralReserveState(service.supabase, ownerId, { ensure: true });

            if (!existingProfile && !reserve.canAcceptNewPartners) {
                return ctx.reply('Партнерка сейчас не выдает новые ссылки: админ еще не пополнил резерв или резерв на паузе. Старые партнеры продолжают видеть свою статистику.');
            }

            const profile = existingProfile || await service.ensureReferralProfile(
                ownerId,
                ctx.from.id,
                ctx.from?.username || null,
                displayName
            );

            if (!profile) {
                return ctx.reply('Рефералка пока не включена или SQL под нее еще не применен.');
            }

            const snapshot = await service.getReferralSnapshot(ownerId, ctx.from.id);
            const paidCount = (snapshot?.events || []).filter(event => event.event_type === 'reward_granted' && event.status === 'completed').length;
            const leadsCount = snapshot?.leads?.length || 0;
            const link = `https://t.me/${username}?start=ref_${profile.referral_code}`;

            await ctx.reply(
                `💸 <b>Партнерка / рефералка</b>\n\nТвоя ссылка:\n<code>${link}</code>\n\nЛидов привел: <b>${leadsCount}</b>\nОплат закрыто: <b>${paidCount}</b>\nБаланс RUB: <b>${Number(profile.balance_rub || 0)}</b>\nБаланс TON: <b>${Number(profile.balance_ton || 0)}</b>\nБаланс USDT: <b>${Number(profile.balance_usdt || 0)}</b>\n\nШли эту ссылку тем, кому реально нужен продукт. Как только по ней придет первая оплата, бонус прилетит автоматически.`,
                { parse_mode: 'HTML', disable_web_page_preview: true }
            );
        } catch (error) {
            console.error('Ошибка открытия рефералки:', error);
            await ctx.reply('Не получилось открыть партнерку.');
        }
    });

    bot.action('referral_info', async (ctx) => {
        await ctx.answerCbQuery();

        try {
            const ownerId = await service.getBotOwner(botId);
            if (!ownerId) return;
            const settings = await service.getReferralSettings(ownerId);
            const existingProfile = await service.getReferralProfile(ownerId, ctx.from.id);
            if (!settings.referral_enabled && !existingProfile) {
                return ctx.reply('💸 Партнерская программа сейчас выключена. Если админ ее включит, кнопка появится сама.');
            }

            const displayName = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ').trim() || null;
            const reserve = await loadReferralReserveState(service.supabase, ownerId, { ensure: true });

            if (!existingProfile && !reserve.canAcceptNewPartners) {
                return ctx.reply('💸 Новые партнерские ссылки сейчас на паузе: админ еще не пополнил резерв или резерв закончился. Старые партнеры продолжают работать по своим условиям.');
            }

            const profile = existingProfile || await service.ensureReferralProfile(
                ownerId,
                ctx.from.id,
                ctx.from?.username || null,
                displayName
            );

            if (!profile) {
                return ctx.reply('💸 Партнерка пока не включена или SQL под нее еще не применен.');
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

            await ctx.reply(
                `💸 <b>Партнерская программа</b>\n\nТвоя партнерская ссылка:\n<code>t.me/${username}?start=ref_${profile.referral_code}</code>\n\n📊 Статистика:\n   Привлечено лидов: <b>${leadsCount}</b>\n   Закрыто оплат: <b>${paidCount}</b>\n\n💰 Баланс к выплате:\n   TON: <b>${balanceTon}</b>\n\n👛 Кошелек: ${walletText}${payoutText}\n\nМинимальная выплата: <b>${minPayoutTon} TON</b>. Шли ссылку тем, кому нужен продукт.`,
                { parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: { inline_keyboard: payoutKeyboard } }
            );
        } catch (error) {
            console.error('Ошибка открытия рефералки:', error);
            await ctx.reply('Не получилось открыть партнерку.');
        }
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
