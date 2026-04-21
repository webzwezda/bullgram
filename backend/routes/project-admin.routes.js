import express from 'express';
import { authenticateUser } from '../middlewares/auth.middleware.js';
import { getTonReserveSenderConfig, getTonReserveWalletSnapshot } from '../services/ton-reserve-sender.service.js';

function requireProjectAdmin(req, res, next) {
    if (req.profile?.role !== 'admin') {
        return res.status(403).json({ error: 'Этот экран доступен только администратору проекта.' });
    }

    next();
}

function numberOrZero(value) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

function roundTon(value) {
    return Number(numberOrZero(value).toFixed(6));
}

function normalizeTonWallet(value) {
    return String(value || '').trim().replace(/\s+/g, '');
}

function looksLikeTonWallet(value) {
    const wallet = normalizeTonWallet(value);
    if (/^[UEk]Q[A-Za-z0-9_-]{46}$/.test(wallet)) return true;
    if (/^[0-9-]+:[a-fA-F0-9]{64}$/.test(wallet)) return true;
    return false;
}

function sumRows(rows, field = 'amount_ton') {
    return roundTon((rows || []).reduce((sum, row) => sum + numberOrZero(row?.[field]), 0));
}

async function loadAdminOwnerIds(supabase) {
    const { data, error } = await supabase
        .from('profiles')
        .select('id')
        .eq('role', 'admin');

    if (error) throw error;
    return (data || []).map((row) => row.id).filter(Boolean);
}

async function loadShopRevenue(supabase, adminOwnerIds) {
    if (!adminOwnerIds.length) {
        return {
            paidTon: 0,
            pendingTon: 0,
            paidCount: 0,
            pendingCount: 0
        };
    }

    const { data, error } = await supabase
        .from('shop_purchases')
        .select('id, seller_owner_id, status, amount_ton, ownership_transfer_status, payload, created_at')
        .in('seller_owner_id', adminOwnerIds)
        .in('status', ['pending', 'awaiting_receipt', 'paid'])
        .order('created_at', { ascending: false })
        .limit(2000);

    if (error) {
        const message = error.message || '';
        if (message.includes('shop_purchases')) {
            return {
                paidTon: 0,
                pendingTon: 0,
                paidCount: 0,
                pendingCount: 0
            };
        }
        throw error;
    }

    const paid = (data || []).filter((row) => row.status === 'paid');
    const pending = (data || []).filter((row) => row.status !== 'paid');

    return {
        paidTon: sumRows(paid),
        pendingTon: sumRows(pending),
        paidCount: paid.length,
        pendingCount: pending.length
    };
}

async function loadReferralTreasury(supabase) {
    const { data: ledgerRows, error: ledgerError } = await supabase
        .from('referral_reserve_ledger')
        .select('entry_type, direction, amount_ton')
        .limit(5000);

    if (ledgerError) {
        const message = ledgerError.message || '';
        if (message.includes('referral_reserve_ledger')) {
            return {
                bullrunFeeTon: 0,
                networkFeeTon: 0,
                partnerObligationTon: 0
            };
        }
        throw ledgerError;
    }

    const summary = (ledgerRows || []).reduce((acc, row) => {
        const amount = numberOrZero(row.amount_ton);
        const type = String(row.entry_type || '');
        const direction = String(row.direction || '');

        if (type === 'bullrun_fee_created') acc.bullrunFeeTon += amount;
        if (type === 'reward_obligation_created') acc.partnerObligationTon += amount;
        if (type === 'network_fee_reserved' && direction === 'credit') acc.networkFeeTon -= amount;
        if (type === 'network_fee_reserved' && direction !== 'credit') acc.networkFeeTon += amount;
        return acc;
    }, {
        bullrunFeeTon: 0,
        networkFeeTon: 0,
        partnerObligationTon: 0
    });

    return {
        bullrunFeeTon: roundTon(summary.bullrunFeeTon),
        networkFeeTon: roundTon(summary.networkFeeTon),
        partnerObligationTon: roundTon(summary.partnerObligationTon)
    };
}

async function loadPartnerLiability(supabase) {
    const { data: profiles, error: profilesError } = await supabase
        .from('referral_profiles')
        .select('balance_ton')
        .limit(5000);

    if (profilesError) {
        const message = profilesError.message || '';
        if (!message.includes('referral_profiles')) throw profilesError;
    }

    const { data: payouts, error: payoutsError } = await supabase
        .from('referral_partner_payouts')
        .select('amount_ton, status')
        .in('status', ['requested', 'queued', 'sending', 'sent'])
        .limit(5000);

    if (payoutsError) {
        const message = payoutsError.message || '';
        if (!message.includes('referral_partner_payouts')) throw payoutsError;
    }

    return {
        partnerBalanceTon: sumRows(profiles || [], 'balance_ton'),
        activePayoutTon: sumRows(payouts || [])
    };
}

async function loadReserveLiability(supabase) {
    const { data, error } = await supabase
        .from('referral_reserve_accounts')
        .select('available_reserve_ton, reserved_obligations_ton, admin_debt_ton, status')
        .limit(5000);

    if (error) {
        const message = error.message || '';
        if (message.includes('referral_reserve_accounts')) {
            return {
                availableReserveTon: 0,
                reservedObligationsTon: 0,
                adminDebtTon: 0
            };
        }
        throw error;
    }

    return {
        availableReserveTon: sumRows(data || [], 'available_reserve_ton'),
        reservedObligationsTon: sumRows(data || [], 'reserved_obligations_ton'),
        adminDebtTon: sumRows(data || [], 'admin_debt_ton')
    };
}

async function loadWithdrawals(supabase) {
    const { data, error } = await supabase
        .from('project_treasury_withdrawals')
        .select('*')
        .order('requested_at', { ascending: false })
        .limit(50);

    if (error) {
        const message = error.message || '';
        if (message.includes('project_treasury_withdrawals')) {
            return [];
        }
        throw error;
    }

    return data || [];
}

function summarizeWithdrawals(withdrawals) {
    return (withdrawals || []).reduce((acc, row) => {
        const amount = numberOrZero(row.amount_ton);
        const fee = numberOrZero(row.network_fee_ton);
        const status = String(row.status || '');

        if (['requested', 'queued', 'sending'].includes(status)) {
            acc.pendingTon += amount + fee;
        }
        if (['sent', 'confirmed'].includes(status)) {
            acc.sentTon += amount + fee;
        }
        if (status === 'failed') {
            acc.failedCount += 1;
        }

        return acc;
    }, {
        pendingTon: 0,
        sentTon: 0,
        failedCount: 0
    });
}

async function buildTreasurySummary(supabase) {
    const adminOwnerIds = await loadAdminOwnerIds(supabase);
    const [shop, referral, partnerLiability, reserveLiability, withdrawals, walletSnapshotResult] = await Promise.all([
        loadShopRevenue(supabase, adminOwnerIds),
        loadReferralTreasury(supabase),
        loadPartnerLiability(supabase),
        loadReserveLiability(supabase),
        loadWithdrawals(supabase),
        getTonReserveWalletSnapshot().then(
            (snapshot) => ({ snapshot, error: null }),
            (error) => ({ snapshot: null, error })
        )
    ]);

    const withdrawalSummary = summarizeWithdrawals(withdrawals);
    const grossRevenueTon = roundTon(shop.paidTon + referral.bullrunFeeTon);
    const partnerLiabilityTon = roundTon(Math.max(
        partnerLiability.partnerBalanceTon,
        partnerLiability.activePayoutTon,
        referral.partnerObligationTon
    ));
    const adminReserveLiabilityTon = roundTon(reserveLiability.availableReserveTon);
    const networkFeeReserveTon = roundTon(referral.networkFeeTon);
    const protectedLiabilityTon = roundTon(
        partnerLiabilityTon
        + adminReserveLiabilityTon
        + networkFeeReserveTon
    );
    const accountingAvailableTon = roundTon(Math.max(0, grossRevenueTon - withdrawalSummary.pendingTon - withdrawalSummary.sentTon));
    const walletSnapshot = walletSnapshotResult.snapshot;
    const walletStatus = walletSnapshot ? 'synced' : 'unavailable';
    const walletBalanceTon = roundTon(walletSnapshot?.balanceTon || 0);
    const safetyBufferTon = roundTon(walletSnapshot?.minWalletBalanceTon ?? getTonReserveSenderConfig().minWalletBalanceTon);
    const walletAvailableTon = walletSnapshot
        ? roundTon(Math.max(0, walletBalanceTon - protectedLiabilityTon - withdrawalSummary.pendingTon - safetyBufferTon))
        : 0;
    const availableToWithdrawTon = roundTon(Math.min(accountingAvailableTon, walletAvailableTon));

    return {
        summary: {
            grossRevenueTon,
            availableToWithdrawTon,
            accountingAvailableTon,
            walletAvailableTon,
            walletBalanceTon,
            walletAddress: walletSnapshot?.walletAddress || null,
            walletCheckedAt: walletSnapshot?.checkedAt || null,
            walletStatus,
            walletError: walletSnapshotResult.error ? (walletSnapshotResult.error.message || 'wallet_unavailable') : null,
            safetyBufferTon,
            protectedLiabilityTon,
            pendingWithdrawalsTon: roundTon(withdrawalSummary.pendingTon),
            sentWithdrawalsTon: roundTon(withdrawalSummary.sentTon),
            failedWithdrawalsCount: withdrawalSummary.failedCount,
            reconciliationStatus: walletSnapshot ? 'synced' : 'wallet_unavailable'
        },
        buckets: {
            platformRevenueTon: grossRevenueTon,
            shopRevenueTon: shop.paidTon,
            referralFeeTon: referral.bullrunFeeTon,
            partnerLiabilityTon,
            adminReserveLiabilityTon,
            networkFeeReserveTon,
            pendingPaymentTon: shop.pendingTon
        },
        counters: {
            adminOwners: adminOwnerIds.length,
            paidShopPurchases: shop.paidCount,
            pendingShopPurchases: shop.pendingCount
        },
        withdrawals
    };
}

export default function projectAdminRoutes(supabase) {
    const router = express.Router();

    router.get('/treasury', authenticateUser, requireProjectAdmin, async (_req, res) => {
        try {
            const payload = await buildTreasurySummary(supabase);
            res.json(payload);
        } catch (error) {
            console.error('Ошибка project treasury summary:', error);
            res.status(500).json({ error: 'Не удалось загрузить казну проекта.' });
        }
    });

    router.post('/treasury/withdrawals', authenticateUser, requireProjectAdmin, async (req, res) => {
        const amountTon = roundTon(req.body?.amount_ton);
        const networkFeeTon = roundTon(req.body?.network_fee_ton || 0.05);
        const toWallet = normalizeTonWallet(req.body?.to_wallet);
        const note = String(req.body?.note || '').trim();

        if (!looksLikeTonWallet(toWallet)) {
            return res.status(400).json({ error: 'Укажи корректный TON-кошелек для вывода.' });
        }

        if (!Number.isFinite(amountTon) || amountTon <= 0) {
            return res.status(400).json({ error: 'Сумма вывода должна быть больше нуля.' });
        }

        try {
            const treasury = await buildTreasurySummary(supabase);
            const availableTon = numberOrZero(treasury.summary.availableToWithdrawTon);
            const totalDebitTon = roundTon(amountTon + networkFeeTon);

            if (totalDebitTon > availableTon) {
                return res.status(400).json({
                    error: `Можно запросить максимум ${availableTon} TON с учетом комиссии сети.`
                });
            }

            const { data, error } = await supabase
                .from('project_treasury_withdrawals')
                .insert({
                    requested_by: req.user.id,
                    to_wallet: toWallet,
                    amount_ton: amountTon,
                    network_fee_ton: networkFeeTon,
                    status: 'requested',
                    payload: {
                        note: note || null,
                        available_ton_before: availableTon,
                        total_debit_ton: totalDebitTon,
                        source: 'project_admin_treasury_mvp'
                    }
                })
                .select('*')
                .single();

            if (error) throw error;

            res.json({
                success: true,
                withdrawal: data,
                treasury: await buildTreasurySummary(supabase)
            });
        } catch (error) {
            console.error('Ошибка создания project treasury withdrawal:', error);
            res.status(500).json({ error: 'Не удалось создать заявку на вывод.' });
        }
    });

    return router;
}
