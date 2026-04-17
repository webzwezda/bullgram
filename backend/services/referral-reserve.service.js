const DEFAULT_MINIMUM_DEPOSIT_TON = 100;
const DEFAULT_CLIENT_DISCOUNT_PERCENT = 10;
const DEFAULT_BULLRUN_FEE_PERCENT = 1;
const DEFAULT_MIN_PAYOUT_TON = 5;

function numberOrZero(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundTon(value) {
  return Number(numberOrZero(value).toFixed(6));
}

function getReserveDepositAddress() {
  return String(process.env.TON_RESERVE_DEPOSIT_ADDRESS || '').trim();
}

function buildDepositMemo(ownerId) {
  return `br_${String(ownerId || '').replace(/-/g, '').slice(0, 12)}`;
}

function statusCopy(status) {
  const labels = {
    deposit_required: 'Нужен депозит',
    locked_active: 'Депозит заблокирован, партнерку можно включать',
    active: 'Резерв готов',
    reserve_low: 'Резерв на исходе',
    over_limit: 'Резерв не покрывает обязательства',
    closed_for_new_partners: 'Новые партнеры закрыты',
    refund_requested: 'Возврат запрошен',
    refund_available: 'Можно вернуть остаток',
    refund_completed: 'Возврат завершен',
    paused: 'Пауза'
  };

  return labels[status] || 'Статус резерва';
}

function deriveStatus(account, computed) {
  if (account?.status && ['refund_requested', 'refund_available', 'refund_completed', 'paused'].includes(account.status)) {
    return account.status;
  }

  if (computed.availableReserveTon < 0 || computed.adminDebtTon > 0) return 'over_limit';
  if (computed.totalDepositedTon < computed.minimumDepositTon) return 'deposit_required';
  if (computed.availableReserveTon > 0 && computed.availableReserveTon < 20) return 'reserve_low';

  const lockedUntil = account?.locked_until ? new Date(account.locked_until) : null;
  if (lockedUntil && lockedUntil.toString() !== 'Invalid Date' && lockedUntil > new Date()) {
    return 'locked_active';
  }

  return 'active';
}

function summarizeLedger(rows = []) {
  return rows.reduce((acc, row) => {
    const amount = numberOrZero(row.amount_ton);
    const type = String(row.entry_type || '');
    const direction = String(row.direction || '');

    if (type === 'deposit_confirmed' && direction === 'credit') acc.depositTon += amount;
    if (type === 'partner_payout_sent' && direction === 'debit') acc.partnerPayoutTon += amount;
    if (type === 'admin_refund_sent' && direction === 'debit') acc.adminRefundTon += amount;
    if (type === 'reward_obligation_created') acc.rewardObligationTon += amount;
    if (type === 'bullrun_fee_created') acc.bullrunFeeTon += amount;
    if (type === 'network_fee_reserved') acc.networkFeeTon += amount;

    return acc;
  }, {
    depositTon: 0,
    partnerPayoutTon: 0,
    adminRefundTon: 0,
    rewardObligationTon: 0,
    bullrunFeeTon: 0,
    networkFeeTon: 0
  });
}

export function getReferralEconomics() {
  return {
    minimumDepositTon: DEFAULT_MINIMUM_DEPOSIT_TON,
    clientDiscountPercent: DEFAULT_CLIENT_DISCOUNT_PERCENT,
    bullrunFeePercent: DEFAULT_BULLRUN_FEE_PERCENT,
    minPayoutTon: DEFAULT_MIN_PAYOUT_TON
  };
}

export async function loadReferralReserveState(supabase, ownerId, options = {}) {
  const ensure = !!options.ensure;
  const depositAddress = getReserveDepositAddress();
  const minimumDepositTon = DEFAULT_MINIMUM_DEPOSIT_TON;

  let { data: account, error: accountError } = await supabase
    .from('referral_reserve_accounts')
    .select('*')
    .eq('owner_id', ownerId)
    .maybeSingle();

  if (accountError) {
    if ((accountError.message || '').includes('referral_reserve_accounts')) {
      return {
        supported: false,
        canEnableReferrals: false,
        canAcceptNewPartners: false,
        status: 'schema_missing',
        statusLabel: 'SQL под резерв еще не применен',
        reason: 'Сначала нужна миграция защищенной партнерки.',
        economics: getReferralEconomics()
      };
    }
    throw accountError;
  }

  if (!account && ensure) {
    const { data: created, error: createError } = await supabase
      .from('referral_reserve_accounts')
      .insert({
        owner_id: ownerId,
        deposit_address: depositAddress || null,
        deposit_memo: buildDepositMemo(ownerId),
        minimum_deposit_ton: minimumDepositTon,
        status: 'deposit_required'
      })
      .select('*')
      .single();

    if (createError) throw createError;
    account = created;
  }

  const reserveAccountId = account?.id || null;
  const { data: ledgerRows, error: ledgerError } = reserveAccountId
    ? await supabase
      .from('referral_reserve_ledger')
      .select('entry_type, amount_ton, direction')
      .eq('owner_id', ownerId)
      .eq('reserve_account_id', reserveAccountId)
      .order('created_at', { ascending: false })
      .limit(500)
    : { data: [], error: null };

  if (ledgerError) throw ledgerError;

  const ledgerSummary = summarizeLedger(ledgerRows || []);
  const accountTotalDepositedTon = numberOrZero(account?.total_deposited_ton);
  const totalDepositedTon = roundTon(Math.max(accountTotalDepositedTon, ledgerSummary.depositTon));
  const bullrunFeeTon = roundTon(Math.max(numberOrZero(account?.bullrun_fee_accrued_ton), ledgerSummary.bullrunFeeTon));
  const networkFeeTon = roundTon(Math.max(numberOrZero(account?.network_fee_accrued_ton), ledgerSummary.networkFeeTon));
  const reservedObligationsTon = roundTon(Math.max(
    numberOrZero(account?.reserved_obligations_ton),
    ledgerSummary.rewardObligationTon + bullrunFeeTon + networkFeeTon
  ));
  const paidOutTon = roundTon(ledgerSummary.partnerPayoutTon);
  const refundedTon = roundTon(ledgerSummary.adminRefundTon);
  const availableReserveTon = roundTon(totalDepositedTon - reservedObligationsTon - paidOutTon - refundedTon);
  const adminDebtTon = roundTon(Math.max(numberOrZero(account?.admin_debt_ton), availableReserveTon < 0 ? Math.abs(availableReserveTon) : 0));

  const computed = {
    minimumDepositTon,
    totalDepositedTon,
    availableReserveTon,
    reservedObligationsTon,
    adminDebtTon,
    bullrunFeeTon,
    networkFeeTon,
    paidOutTon,
    refundedTon
  };

  const status = deriveStatus(account, computed);
  const depositConfigured = !!(account?.deposit_address || depositAddress);
  const hasMinimumDeposit = totalDepositedTon >= minimumDepositTon;
  const isClosedForNewPartners = ['over_limit', 'closed_for_new_partners', 'refund_requested', 'refund_available', 'refund_completed', 'paused'].includes(status);
  const canEnableReferrals = depositConfigured && hasMinimumDeposit && !['refund_completed', 'paused'].includes(status);
  const canAcceptNewPartners = canEnableReferrals && !isClosedForNewPartners;

  return {
    supported: true,
    id: reserveAccountId,
    status,
    statusLabel: statusCopy(status),
    canEnableReferrals,
    canAcceptNewPartners,
    depositConfigured,
    depositAddress: account?.deposit_address || depositAddress || '',
    depositMemo: account?.deposit_memo || buildDepositMemo(ownerId),
    lockedUntil: account?.locked_until || null,
    lastDepositAt: account?.last_deposit_at || null,
    reason: !depositConfigured
      ? 'TON-кошелек резерва еще не подключен на сервере.'
      : !hasMinimumDeposit
        ? `Нужно пополнить резерв минимум на ${minimumDepositTon} TON.`
        : isClosedForNewPartners
          ? 'Резерв не принимает новых партнеров, старые условия продолжают жить.'
          : 'Резерв готов для MVP-партнерки.',
    ...computed,
    economics: getReferralEconomics()
  };
}
