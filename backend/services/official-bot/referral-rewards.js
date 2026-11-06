// Деньги партнерки: заявки на выплату партнеров и начисление награды по инвойсу
// (processReferralReward с атомарным RPC referral_apply_reward) — вынесено дословно
// из official-bot.service.js; this.supabase -> параметр supabase, module-level activeBots
// главного файла передается параметром, notify/profile-вызовы — импорт функций.

import { normalizeTonWallet, looksLikeTonWallet } from './shared/pending-state.js';
import { getReferralEconomics, loadReferralReserveState, reconcileReferralReserveAccount } from '../referral-reserve.service.js';
import { convertAmountToTon } from '../crypto-rates.service.js';
import { getTariffDisplayTitle } from './tariff-format.js';
import {
    getReferralSettings,
    ensureReferralProfile,
    getReferralProfile,
    getReferralPayoutMethod,
    getPendingReferralPayout
} from './referral-profiles.js';
import {
    notifyReferralPayoutRequested,
    notifyReferralPayoutAvailable,
    notifyReferralReserveStatus
} from './referral-notify.js';

export async function saveReferralPayoutWallet(supabase, ownerId, tgUserId, tonWallet) {
    const normalizedWallet = normalizeTonWallet(tonWallet);
    if (!looksLikeTonWallet(normalizedWallet)) {
        return { error: 'Похоже, это не TON-кошелек. Пришли адрес из Tonkeeper/Tonhub, который начинается на UQ/EQ, или raw-адрес вида 0:...' };
    }

    const pendingPayout = await getPendingReferralPayout(supabase, ownerId, tgUserId);
    if (pendingPayout) {
        return { error: 'У тебя уже есть заявка на выплату. Кошелек можно поменять после обработки этой заявки.' };
    }

    const now = new Date().toISOString();
    const { data, error } = await supabase
        .from('referral_partner_payout_methods')
        .upsert({
            owner_id: ownerId,
            tg_user_id: String(tgUserId),
            ton_wallet: normalizedWallet,
            status: 'active',
            verified_at: now,
            last_changed_at: now,
            updated_at: now
        }, { onConflict: 'owner_id,tg_user_id' })
        .select('*')
        .single();

    if (error) {
        if ((error.message || '').includes('referral_partner_payout_methods')) {
            return { error: 'SQL под payout-кошельки еще не применен.' };
        }
        throw error;
    }

    return { wallet: data };
}

export async function requestReferralPartnerPayout(activeBots, supabase, ownerId, tgUserId) {
    const economics = getReferralEconomics();
    const minPayoutTon = Number(economics.minPayoutTon || 5);
    const profile = await getReferralProfile(supabase, ownerId, tgUserId);
    if (!profile) return { error: 'Сначала нужно открыть партнерку и получить ссылку.' };

    const balanceTon = Number(profile.balance_ton || 0);
    if (!Number.isFinite(balanceTon) || balanceTon < minPayoutTon) {
        return { error: `Минимальная выплата ${minPayoutTon} TON. Сейчас на балансе ${balanceTon} TON.` };
    }

    const payoutMethod = await getReferralPayoutMethod(supabase, ownerId, tgUserId);
    if (!payoutMethod?.ton_wallet || payoutMethod.status !== 'active') {
        return { error: 'Сначала укажи TON-кошелек для выплаты.' };
    }

    const pendingPayout = await getPendingReferralPayout(supabase, ownerId, tgUserId);
    if (pendingPayout) {
        return { error: `Заявка уже создана: ${Number(pendingPayout.amount_ton || 0)} TON. Дождись обработки.` };
    }

    const amountTon = Number(balanceTon.toFixed(6));
    const { data, error } = await supabase
        .from('referral_partner_payouts')
        .insert({
            owner_id: ownerId,
            tg_user_id: String(tgUserId),
            amount_ton: amountTon,
            network_fee_ton: 0,
            status: 'requested',
            ton_wallet: payoutMethod.ton_wallet,
            payload: {
                source: 'partner_bot_request',
                balance_ton_at_request: balanceTon
            }
        })
        .select('*')
        .single();

    if (error) {
        if (error.code === '23505' || (error.message || '').includes('duplicate key')) {
            return { error: 'Заявка уже создана. Дождись обработки.' };
        }
        if ((error.message || '').includes('referral_partner_payouts')) {
            return { error: 'SQL под заявки на выплату еще не применен.' };
        }
        throw error;
    }

    notifyReferralPayoutRequested(activeBots, supabase, ownerId, data).catch((notifyError) => {
        console.error('Ошибка уведомления админа о referral payout request:', notifyError.message || notifyError);
    });

    return { payout: data };
}

export async function processReferralReward(activeBots, supabase, bot, invoice, tariff, ownerId) {
    try {
        const settings = await getReferralSettings(supabase, ownerId);

        const { data: attribution, error: attributionError } = await supabase
            .from('referral_attributions')
            .select('*')
            .eq('owner_id', ownerId)
            .eq('referred_tg_user_id', String(invoice.tg_user_id))
            .maybeSingle();

        if (attributionError) {
            if ((attributionError.message || '').includes('referral_attributions')) return null;
            throw attributionError;
        }

        if (!attribution) return null;
        if (String(attribution.referrer_tg_user_id) === String(invoice.tg_user_id)) return null;
        if (attribution.converted_at) return null;
        if (attribution.discount_eligible === false) return null;

        const settlementTime = invoice.paid_at ? new Date(invoice.paid_at) : new Date();
        if (attribution.expires_at && new Date(attribution.expires_at) < settlementTime) return null;

        const { data: existingReward, error: rewardCheckError } = await supabase
            .from('referral_events')
            .select('id')
            .eq('owner_id', ownerId)
            .eq('invoice_id', invoice.id)
            .eq('event_type', 'reward_granted')
            .maybeSingle();

        if (rewardCheckError) {
            if ((rewardCheckError.message || '').includes('referral_events')) return null;
            throw rewardCheckError;
        }

        if (existingReward) return null;

        const reserve = await loadReferralReserveState(supabase, ownerId, { ensure: true });
        const economics = getReferralEconomics();
        const rewardPercent = Number(attribution.reward_percent_snapshot ?? settings.referral_reward_percent ?? 0);
        if (rewardPercent <= 0) return null;

        const clientDiscountPercent = Number(attribution.client_discount_percent_snapshot ?? settings.referral_client_discount_percent ?? economics.clientDiscountPercent);
        const rewardBaseAmount = Number(tariff.price || invoice.amount || 0);
        const paidAmount = Number(invoice.amount || 0);
        const rewardAmountRaw = rewardBaseAmount * rewardPercent / 100;
        const currency = String(invoice.currency || '').toUpperCase();
        const rewardAmount = ['TON', 'USDT'].includes(currency)
            ? Number(rewardAmountRaw.toFixed(4))
            : Number(rewardAmountRaw.toFixed(2));
        // decimals для скидки клиента: RUB-ветка (toFixed(2)) удалена — новые RUB-награды заблокированы whitelist'ом ниже,
        // TON/USDT считают в 4 знаках как раньше
        const clientDiscountAmount = Math.max(0, Number((rewardBaseAmount - paidAmount).toFixed(4)));

        if (rewardAmount <= 0) return null;
        // Новые RUB-награды заблокированы (продуктовое решение: валюты TON/USDT); исторические RUB-события читаются в referral.routes.js как легаси-данные
        if (!['TON', 'USDT'].includes(currency)) return null;

        const convertedReward = await convertAmountToTon(supabase, rewardAmount, currency);
        if (!convertedReward?.amountTon) {
            throw new Error(`Нет свежего курса TON для ${currency}`);
        }

        const rewardTonAmount = convertedReward.amountTon;
        const bullgramFeeTonAmount = Number((rewardTonAmount * economics.bullgramFeePercent / 100).toFixed(6));

        const referrerProfile = await ensureReferralProfile(supabase, ownerId, attribution.referrer_tg_user_id);
        if (!referrerProfile) return null;

        // Атомарное ядро начисления (SQL: backend/sql/referral-apply-reward.sql): маркер
        // reward_granted по unique-индексу -> инкремент баланса -> ledger-обязательства ->
        // converted_at. Либо все сразу, либо {granted:false} без единой записи — двойное
        // начисление при гонке live-пути (activateSubscription) и settlement-retry невозможно.
        const { data: rewardResult, error: rewardError } = await supabase.rpc('referral_apply_reward', {
            p_owner_id: ownerId,
            p_attribution_id: attribution.id,
            p_referrer_profile_id: referrerProfile.id,
            p_referrer_tg_user_id: String(attribution.referrer_tg_user_id),
            p_referred_tg_user_id: String(invoice.tg_user_id),
            p_invoice_id: invoice.id,
            p_tariff_id: tariff.id,
            p_reserve_account_id: reserve.id || null,
            p_reserve_coverage_status: reserve.canAcceptNewPartners ? 'covered' : 'admin_debt',
            p_reward_ton_amount: rewardTonAmount,
            p_bullgram_fee_ton_amount: bullgramFeeTonAmount,
            p_bullgram_fee_percent: economics.bullgramFeePercent,
            p_reward_base_amount: rewardBaseAmount,
            p_reward_amount: rewardAmount,
            p_currency: currency,
            p_client_discount_percent: clientDiscountPercent,
            p_client_discount_amount: clientDiscountAmount,
            p_exchange_rate_id: convertedReward.rate?.id || null,
            p_payload: {
                tariff_title: tariff.title,
                reward_percent: rewardPercent,
                client_discount_percent: clientDiscountPercent,
                paid_amount: paidAmount,
                bullgram_fee_percent: economics.bullgramFeePercent,
                bullgram_fee_ton_amount: bullgramFeeTonAmount,
                reward_original_amount: rewardAmount,
                reward_original_currency: currency,
                reward_ton_amount: rewardTonAmount,
                exchange_rate: convertedReward.rate
                    ? {
                        id: convertedReward.rate.id || null,
                        base_currency: convertedReward.rate.base_currency,
                        quote_currency: convertedReward.rate.quote_currency,
                        rate: convertedReward.rate.rate,
                        provider: convertedReward.rate.provider,
                        fetched_at: convertedReward.rate.fetched_at
                    }
                    : null
            }
        });

        if (rewardError) throw rewardError;

        if (rewardResult?.granted === false) {
            // Награда по этому инвойсу уже начислена — тихо выходим, как и раньше при дедупе.
            if ((rewardResult.reason || '') === 'duplicate') {
                // Легаси-хвост старого неатомарного кода: событие награды вставлено, а
                // converted_at остался null — settlement-retry будет гонять такую атрибуцию
                // вечно. Событие = маркер того, что награда по этому инвойсу реально
                // начислена, поэтому закрываем конверсию отдельным безопасным обновлением
                // (только если она все еще открыта — параллельный вызов уже мог закрыть).
                await supabase
                    .from('referral_attributions')
                    .update({
                        converted_at: new Date().toISOString(),
                        paid_invoice_id: invoice.id
                    })
                    .eq('id', attribution.id)
                    .is('converted_at', null);
            }
            return null;
        }

        const previousBalanceTon = Number(Number(rewardResult?.previous_balance_ton || 0).toFixed(6));
        const newBalanceTon = Number(Number(rewardResult?.new_balance_ton || 0).toFixed(6));

        if (reserve.id) {
            const reconciled = await reconcileReferralReserveAccount(supabase, {
                id: reserve.id,
                owner_id: ownerId,
                deposit_address: reserve.depositAddress || null,
                minimum_deposit_ton: reserve.minimumDepositTon,
                total_deposited_ton: reserve.totalDepositedTon,
                available_reserve_ton: reserve.availableReserveTon,
                reserved_obligations_ton: reserve.reservedObligationsTon,
                admin_debt_ton: reserve.adminDebtTon,
                bullgram_fee_accrued_ton: reserve.bullgramFeeTon,
                network_fee_accrued_ton: reserve.networkFeeTon,
                locked_until: reserve.lockedUntil || null,
                last_deposit_at: reserve.lastDepositAt || null,
                status: reserve.status
            });

            if (reconciled.statusChanged) {
                notifyReferralReserveStatus(
                    activeBots,
                    supabase,
                    ownerId,
                    reconciled.reserveAccount,
                    reconciled.previousStatus
                ).catch((notifyError) => {
                    console.error('Ошибка уведомления о referral reserve status:', notifyError.message || notifyError);
                });
            }
        }

        if (bot?.telegram) {
            await bot.telegram.sendMessage(
                attribution.referrer_tg_user_id,
                `💸 По твоей реф-ссылке закрылась оплата.\n\nКлиент: ${invoice.tg_user_id}\nТариф: ${getTariffDisplayTitle(tariff)}\nБонус: ${rewardTonAmount} TON\n\nБаланс уже обновлен.`
            ).catch(() => {});
        }

        const minPayoutTon = Number(economics.minPayoutTon || 5);
        if (previousBalanceTon < minPayoutTon && newBalanceTon >= minPayoutTon) {
            notifyReferralPayoutAvailable(activeBots, supabase, ownerId, attribution.referrer_tg_user_id, newBalanceTon).catch((notifyError) => {
                console.error('Ошибка уведомления о доступной referral payout:', notifyError.message || notifyError);
            });
        }

        return {
            referrerTgUserId: String(attribution.referrer_tg_user_id),
            rewardAmount: rewardTonAmount,
            rewardCurrency: 'TON'
        };
    } catch (error) {
        // RPC не применен (миграцию прогнали после деплоя) — это сломанное начисление денег,
        // а не «таблиц еще нет»; кричим в лог, чтобы не потерять под общим «referral_» глушителем.
        if ((error.message || '').includes('referral_apply_reward')) {
            console.error('RPC referral_apply_reward не найден — прогони backend/sql/referral-apply-reward.sql до деплоя:', error.message || error);
        }
        if ((error.message || '').includes('referral_')) return null;
        console.error('Ошибка начисления рефералки:', error);
        return null;
    }
}
