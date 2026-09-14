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

// Серверная константа комиссии сети для MVP-вывода из казны (ручная отправка).
// Клиентское network_fee_ton не принимаем: отрицательное значение уменьшало бы
// totalDebitTon и отравляло ledger. Когда появится автоматизация отправки,
// брать фактическую комиссию из результата sendTonFromReserve.
const NETWORK_FEE_TON = 0.05;

// «Таблицы нет» — единственная ошибка выборки, которую можно деградировать нулями
// (код 42P01, фолбэк для старых PostgREST-ответов — текст 'does not exist').
// Остальное пробрасывается: экран денег fail-closed, лимит не рисуется по частичным данным.
function isUndefinedTableError(error) {
    if (!error) return false;
    if (error.code === '42P01') return true;
    return String(error.message || '').includes('does not exist');
}

async function loadAdminOwnerIds(supabase) {
    const { data, error } = await supabase
        .from('profiles')
        .select('id')
        .eq('role', 'admin');

    if (error) throw error;
    return (data || []).map((row) => row.id).filter(Boolean);
}

const SHOP_CATEGORIES = ['proxy', 'userbot', 'bundle', 'other'];

function shopCategory(itemType) {
    const type = String(itemType || '').toLowerCase();
    if (SHOP_CATEGORIES.includes(type)) return type;
    return 'other';
}

function emptyCategorySums() {
    return SHOP_CATEGORIES.reduce((acc, key) => {
        acc[key] = 0;
        return acc;
    }, {});
}

async function loadShopRevenue(supabase, adminOwnerIds) {
    if (!adminOwnerIds.length) {
        return {
            paidTon: 0,
            pendingTon: 0,
            paidCount: 0,
            pendingCount: 0,
            paidByCategory: emptyCategorySums(),
            pendingByCategory: emptyCategorySums()
        };
    }

    const { data, error } = await supabase
        .from('shop_purchases')
        .select('id, seller_owner_id, status, amount_ton, ownership_transfer_status, payload, created_at, shop_items(item_type)')
        .in('seller_owner_id', adminOwnerIds)
        .in('status', ['pending', 'awaiting_receipt', 'paid'])
        .order('created_at', { ascending: false })
        .limit(2000);

    if (error) {
        if (!isUndefinedTableError(error)) throw error;
        return {
            paidTon: 0,
            pendingTon: 0,
            paidCount: 0,
            pendingCount: 0,
            paidByCategory: emptyCategorySums(),
            pendingByCategory: emptyCategorySums()
        };
    }

    const paid = (data || []).filter((row) => row.status === 'paid');
    const pending = (data || []).filter((row) => row.status !== 'paid');

    const paidByCategory = emptyCategorySums();
    const pendingByCategory = emptyCategorySums();
    for (const row of paid) {
        paidByCategory[shopCategory(row?.shop_items?.item_type)] += numberOrZero(row?.amount_ton);
    }
    for (const row of pending) {
        pendingByCategory[shopCategory(row?.shop_items?.item_type)] += numberOrZero(row?.amount_ton);
    }
    for (const key of SHOP_CATEGORIES) {
        paidByCategory[key] = roundTon(paidByCategory[key]);
        pendingByCategory[key] = roundTon(pendingByCategory[key]);
    }

    return {
        paidTon: sumRows(paid),
        pendingTon: sumRows(pending),
        paidCount: paid.length,
        pendingCount: pending.length,
        paidByCategory,
        pendingByCategory
    };
}

function nanoToTon(value) {
    try {
        return Number(BigInt(String(value || 0))) / 1e9;
    } catch {
        return numberOrZero(value) / 1e9;
    }
}

// Доход тарифов: только mainnet-платежи. TIER_REVENUE_SINCE (ISO) отсекает
// тестнет-фантомы phase 1 — на проде равен моменту включения mainnet-кошелька.
function tierRevenueCutoffMs() {
    const raw = String(process.env.TIER_REVENUE_SINCE || '').trim();
    if (!raw) return 0;
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : 0;
}

async function loadTierRevenue(supabase) {
    const { data, error } = await supabase
        .from('billing_orders')
        .select('id, status, payload, paid_at')
        .eq('status', 'paid')
        .order('paid_at', { ascending: false })
        .limit(1000);

    if (error) {
        if (!isUndefinedTableError(error)) throw error;
        return { tierPaidTon: 0, paidCount: 0 };
    }

    const cutoffMs = tierRevenueCutoffMs();
    let tierPaidTon = 0;
    let paidCount = 0;
    for (const row of data || []) {
        if (cutoffMs && row?.paid_at && Date.parse(row.paid_at) < cutoffMs) continue;
        const nano = String(row?.payload?.expected_nanoton || '').trim();
        if (!nano || !/^\d+$/.test(nano)) continue;
        tierPaidTon += nanoToTon(nano);
        paidCount += 1;
    }

    return { tierPaidTon: roundTon(tierPaidTon), paidCount };
}

async function loadReferralTreasury(supabase) {
    const { data: ledgerRows, error: ledgerError } = await supabase
        .from('referral_reserve_ledger')
        .select('entry_type, direction, amount_ton')
        .limit(5000);

    if (ledgerError) {
        if (!isUndefinedTableError(ledgerError)) throw ledgerError;
        return {
            bullgramFeeTon: 0,
            networkFeeTon: 0,
            partnerObligationTon: 0
        };
    }

    const summary = (ledgerRows || []).reduce((acc, row) => {
        const amount = numberOrZero(row.amount_ton);
        const type = String(row.entry_type || '');
        const direction = String(row.direction || '');

        if (type === 'bullgram_fee_created') acc.bullgramFeeTon += amount;
        if (type === 'reward_obligation_created') acc.partnerObligationTon += amount;
        if (type === 'network_fee_reserved' && direction === 'credit') acc.networkFeeTon -= amount;
        if (type === 'network_fee_reserved' && direction !== 'credit') acc.networkFeeTon += amount;
        return acc;
    }, {
        bullgramFeeTon: 0,
        networkFeeTon: 0,
        partnerObligationTon: 0
    });

    return {
        bullgramFeeTon: roundTon(summary.bullgramFeeTon),
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
        if (!isUndefinedTableError(profilesError)) throw profilesError;
    }

    const { data: payouts, error: payoutsError } = await supabase
        .from('referral_partner_payouts')
        .select('amount_ton, status')
        .in('status', ['requested', 'queued', 'sending', 'sent'])
        .limit(5000);

    if (payoutsError) {
        if (!isUndefinedTableError(payoutsError)) throw payoutsError;
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
        if (!isUndefinedTableError(error)) throw error;
        return {
            availableReserveTon: 0,
            reservedObligationsTon: 0,
            adminDebtTon: 0
        };
    }

    return {
        availableReserveTon: sumRows(data || [], 'available_reserve_ton'),
        reservedObligationsTon: sumRows(data || [], 'reserved_obligations_ton'),
        adminDebtTon: sumRows(data || [], 'admin_debt_ton')
    };
}

// Нижняя граница честнее полного count (прецедент «N+» из customers): сообщаем фронту,
// что список обрезан, когда вернулся полный лимит.
const WITHDRAWALS_LIST_LIMIT = 50;

async function loadWithdrawals(supabase) {
    const { data, error } = await supabase
        .from('project_treasury_withdrawals')
        .select('*')
        .order('requested_at', { ascending: false })
        .limit(WITHDRAWALS_LIST_LIMIT);

    if (error) {
        if (!isUndefinedTableError(error)) throw error;
        return [];
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
    const [shop, tier, referral, partnerLiability, reserveLiability, withdrawals, walletSnapshotResult] = await Promise.all([
        loadShopRevenue(supabase, adminOwnerIds),
        loadTierRevenue(supabase),
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
    const grossRevenueTon = roundTon(shop.paidTon + tier.tierPaidTon + referral.bullgramFeeTon);
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
            tierRevenueTon: tier.tierPaidTon,
            shopProxyTon: shop.paidByCategory.proxy,
            shopUserbotTon: shop.paidByCategory.userbot,
            shopBundleTon: shop.paidByCategory.bundle,
            shopOtherTon: shop.paidByCategory.other,
            referralFeeTon: referral.bullgramFeeTon,
            partnerLiabilityTon,
            adminReserveLiabilityTon,
            networkFeeReserveTon,
            pendingPaymentTon: shop.pendingTon
        },
        counters: {
            adminOwners: adminOwnerIds.length,
            paidShopPurchases: shop.paidCount,
            pendingShopPurchases: shop.pendingCount,
            paidTierOrders: tier.paidCount
        },
        withdrawals,
        withdrawalsTruncated: withdrawals.length >= WITHDRAWALS_LIST_LIMIT
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
        const toWallet = normalizeTonWallet(req.body?.to_wallet);
        const note = String(req.body?.note || '').trim().slice(0, 500);

        if (!looksLikeTonWallet(toWallet)) {
            return res.status(400).json({ error: 'Укажи корректный TON-кошелек для вывода.' });
        }

        if (!Number.isFinite(amountTon) || amountTon <= 0) {
            return res.status(400).json({ error: 'Сумма вывода должна быть больше нуля.' });
        }

        try {
            const treasury = await buildTreasurySummary(supabase);
            const availableTon = numberOrZero(treasury.summary.availableToWithdrawTon);
            const pendingTonSeen = numberOrZero(treasury.summary.pendingWithdrawalsTon);

            // Проверка лимита и вставка атомарны внутри RPC (advisory-блокировка):
            // параллельные POST не могут оба пройти по одному и тому же available.
            // p_available_ton уже очищен от pending (см. buildTreasurySummary), поэтому
            // RPC сравнивает ПРИРОСТ pending (текущий − seen) + дебет новой заявки.
            const { data, error } = await supabase.rpc('create_project_treasury_withdrawal', {
                p_available_ton: availableTon,
                p_pending_ton_seen: pendingTonSeen,
                p_amount_ton: amountTon,
                p_fee_ton: NETWORK_FEE_TON,
                p_wallet_address: toWallet,
                p_note: note,
                p_requested_by: req.user.id
            });

            if (error) throw error;

            const result = data || {};
            if (result.ok === false) {
                if (result.reason === 'insufficient') {
                    return res.status(400).json({ error: 'Недостаточно доступных средств.' });
                }
                if (result.reason === 'invalid_amount') {
                    return res.status(400).json({ error: 'Сумма вывода должна быть больше нуля.' });
                }
                return res.status(400).json({ error: 'Не удалось создать заявку на вывод.' });
            }

            res.json({
                success: true,
                withdrawal: result.withdrawal,
                treasury
            });
        } catch (error) {
            console.error('Ошибка создания project treasury withdrawal:', error);
            res.status(500).json({ error: 'Не удалось создать заявку на вывод.' });
        }
    });

    return router;
}
