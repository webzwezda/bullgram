const DEFAULT_MINIMUM_DEPOSIT_TON = 100;
const DEFAULT_CLIENT_DISCOUNT_PERCENT = 10;
const DEFAULT_BULLRUN_FEE_PERCENT = 1;
const DEFAULT_MIN_PAYOUT_TON = 5;
const DEFAULT_DEPOSIT_LOCK_DAYS = 30;

function numberOrZero(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundTon(value) {
  return Number(numberOrZero(value).toFixed(6));
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function validDateOrNull(value) {
  const date = value ? new Date(value) : null;
  return date && date.toString() !== 'Invalid Date' ? date : null;
}

function getReserveDepositAddress() {
  return String(process.env.TON_RESERVE_DEPOSIT_ADDRESS || '').trim();
}

export function normalizeReferralDepositMemo(value) {
  return String(value || '').trim().toLowerCase();
}

function buildDepositMemo(ownerId) {
  return `br_${String(ownerId || '').replace(/-/g, '').slice(0, 24)}`;
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

    if (type === 'deposit_confirmed' && direction === 'credit') {
      acc.depositTon += amount;
      const createdAt = validDateOrNull(row.created_at);
      if (createdAt && (!acc.firstDepositAt || createdAt < acc.firstDepositAt)) {
        acc.firstDepositAt = createdAt;
      }
    }
    if (type === 'partner_payout_sent' && direction === 'debit') acc.partnerPayoutTon += amount;
    if (type === 'admin_refund_sent' && direction === 'debit') acc.adminRefundTon += amount;
    if (type === 'admin_refund_requested') acc.adminRefundRequestedTon += amount;
    if (type === 'reward_obligation_created') acc.rewardObligationTon += amount;
    if (type === 'bullrun_fee_created') acc.bullrunFeeTon += amount;
    if (type === 'network_fee_reserved') acc.networkFeeTon += amount;

    return acc;
  }, {
    depositTon: 0,
    partnerPayoutTon: 0,
    adminRefundTon: 0,
    adminRefundRequestedTon: 0,
    rewardObligationTon: 0,
    bullrunFeeTon: 0,
    networkFeeTon: 0,
    firstDepositAt: null
  });
}

export function getReferralEconomics() {
  return {
    minimumDepositTon: DEFAULT_MINIMUM_DEPOSIT_TON,
    clientDiscountPercent: DEFAULT_CLIENT_DISCOUNT_PERCENT,
    bullrunFeePercent: DEFAULT_BULLRUN_FEE_PERCENT,
    minPayoutTon: DEFAULT_MIN_PAYOUT_TON,
    depositLockDays: DEFAULT_DEPOSIT_LOCK_DAYS
  };
}

export async function reconcileReferralReserveAccount(supabase, reserveAccount, options = {}) {
  const { data: ledgerRows, error: ledgerError } = await supabase
    .from('referral_reserve_ledger')
    .select('entry_type, amount_ton, direction, created_at')
    .eq('owner_id', reserveAccount.owner_id)
    .eq('reserve_account_id', reserveAccount.id)
    .limit(2000);

  if (ledgerError) throw ledgerError;

  const now = new Date();
  const ledgerSummary = summarizeLedger(ledgerRows || []);
  const minimumDepositTon = numberOrZero(reserveAccount.minimum_deposit_ton || DEFAULT_MINIMUM_DEPOSIT_TON);
  const totalDepositedTon = roundTon(Math.max(numberOrZero(reserveAccount.total_deposited_ton), ledgerSummary.depositTon));
  const bullrunFeeTon = roundTon(Math.max(numberOrZero(reserveAccount.bullrun_fee_accrued_ton), ledgerSummary.bullrunFeeTon));
  const networkFeeTon = roundTon(Math.max(numberOrZero(reserveAccount.network_fee_accrued_ton), ledgerSummary.networkFeeTon));
  const reservedObligationsTon = roundTon(Math.max(
    numberOrZero(reserveAccount.reserved_obligations_ton),
    ledgerSummary.rewardObligationTon + bullrunFeeTon + networkFeeTon
  ));
  const availableReserveTon = roundTon(
    totalDepositedTon
    - reservedObligationsTon
    - ledgerSummary.partnerPayoutTon
    - ledgerSummary.adminRefundTon
  );
  const adminDebtTon = roundTon(Math.max(0, availableReserveTon < 0 ? Math.abs(availableReserveTon) : 0));
  const shouldCreateLock = totalDepositedTon > 0 && !reserveAccount.locked_until;
  const lockStart = ledgerSummary.firstDepositAt || now;
  const lockedUntil = shouldCreateLock
    ? addDays(lockStart, DEFAULT_DEPOSIT_LOCK_DAYS).toISOString()
    : reserveAccount.locked_until || null;
  const status = deriveStatus(
    { ...reserveAccount, locked_until: lockedUntil },
    {
      minimumDepositTon,
      totalDepositedTon,
      availableReserveTon,
      reservedObligationsTon,
      adminDebtTon,
      bullrunFeeTon,
      networkFeeTon
    }
  );

  const { data: updatedAccount, error: updateError } = await supabase
    .from('referral_reserve_accounts')
    .update({
      deposit_address: options.depositAddress || reserveAccount.deposit_address || null,
      total_deposited_ton: totalDepositedTon,
      available_reserve_ton: availableReserveTon,
      reserved_obligations_ton: reservedObligationsTon,
      admin_debt_ton: adminDebtTon,
      bullrun_fee_accrued_ton: bullrunFeeTon,
      network_fee_accrued_ton: networkFeeTon,
      locked_until: lockedUntil,
      last_deposit_at: options.lastDepositAt || reserveAccount.last_deposit_at || now.toISOString(),
      status,
      updated_at: now.toISOString()
    })
    .eq('id', reserveAccount.id)
    .select('*')
    .single();

  if (updateError) throw updateError;

  return {
    reserveAccount: updatedAccount,
    lockCreated: shouldCreateLock,
    previousStatus: reserveAccount.status || null,
    statusChanged: !!reserveAccount.status && reserveAccount.status !== status
  };
}

export async function recordReferralReserveDeposit(supabase, reserveAccount, deposit) {
  const amountTon = roundTon(deposit?.amountTon);
  const chainTxHash = String(deposit?.chainTxHash || '').trim();

  if (!reserveAccount?.id || !reserveAccount?.owner_id) {
    return { recorded: false, reason: 'reserve_account_missing' };
  }

  if (!chainTxHash) {
    return { recorded: false, reason: 'chain_tx_hash_missing' };
  }

  if (!Number.isFinite(amountTon) || amountTon <= 0) {
    return { recorded: false, reason: 'amount_invalid' };
  }

  const { error: ledgerError } = await supabase
    .from('referral_reserve_ledger')
    .insert({
      owner_id: reserveAccount.owner_id,
      reserve_account_id: reserveAccount.id,
      entry_type: 'deposit_confirmed',
      amount_ton: amountTon,
      direction: 'credit',
      chain_tx_hash: chainTxHash,
      payload: deposit?.payload || {}
    });

  if (ledgerError) {
    if (ledgerError.code === '23505' || (ledgerError.message || '').includes('duplicate key')) {
      const synced = await reconcileReferralReserveAccount(supabase, reserveAccount, {
        depositAddress: deposit?.depositAddress
      });
      return {
        recorded: false,
        duplicate: true,
        reason: 'duplicate_tx',
        reserveAccount: synced.reserveAccount
      };
    }
    throw ledgerError;
  }

  const synced = await reconcileReferralReserveAccount(supabase, reserveAccount, {
    depositAddress: deposit?.depositAddress,
    lastDepositAt: deposit?.createdAt || new Date().toISOString()
  });

  return {
    recorded: true,
    amountTon,
    chainTxHash,
    reserveAccount: synced.reserveAccount,
    lockCreated: synced.lockCreated
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
        deposit_memo: normalizeReferralDepositMemo(buildDepositMemo(ownerId)),
        minimum_deposit_ton: minimumDepositTon,
        status: 'deposit_required'
      })
      .select('*')
      .single();

    if (createError) throw createError;
    account = created;
  }

  if (account && ensure) {
    const nextDepositMemo = normalizeReferralDepositMemo(account.deposit_memo) || normalizeReferralDepositMemo(buildDepositMemo(ownerId));
    const nextDepositAddress = depositAddress || account.deposit_address || null;
    if (account.deposit_memo !== nextDepositMemo || account.deposit_address !== nextDepositAddress) {
      const { data: updatedAccount, error: memoUpdateError } = await supabase
        .from('referral_reserve_accounts')
        .update({
          deposit_memo: nextDepositMemo,
          deposit_address: nextDepositAddress,
          updated_at: new Date().toISOString()
        })
        .eq('id', account.id)
        .select('*')
        .single();

      if (memoUpdateError) throw memoUpdateError;
      account = updatedAccount;
    }
  }

  const reserveAccountId = account?.id || null;
  const { data: ledgerRows, error: ledgerError } = reserveAccountId
    ? await supabase
      .from('referral_reserve_ledger')
      .select('entry_type, amount_ton, direction, created_at')
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
  const refundRequestedTon = roundTon(Math.max(0, ledgerSummary.adminRefundRequestedTon - refundedTon));
  const availableReserveTon = roundTon(totalDepositedTon - reservedObligationsTon - paidOutTon - refundedTon);
  const adminDebtTon = roundTon(Math.max(numberOrZero(account?.admin_debt_ton), availableReserveTon < 0 ? Math.abs(availableReserveTon) : 0));
  let lockedUntil = account?.locked_until || null;

  if (account && ensure && totalDepositedTon > 0 && !lockedUntil) {
    lockedUntil = addDays(ledgerSummary.firstDepositAt || new Date(), DEFAULT_DEPOSIT_LOCK_DAYS).toISOString();
    const { data: lockAccount, error: lockError } = await supabase
      .from('referral_reserve_accounts')
      .update({
        locked_until: lockedUntil,
        updated_at: new Date().toISOString()
      })
      .eq('id', account.id)
      .select('*')
      .single();

    if (lockError) throw lockError;
    account = lockAccount;
  }

  const computed = {
    minimumDepositTon,
    totalDepositedTon,
    availableReserveTon,
    reservedObligationsTon,
    adminDebtTon,
    bullrunFeeTon,
    networkFeeTon,
    paidOutTon,
    refundedTon,
    refundRequestedTon
  };

  const status = deriveStatus(account, computed);
  const effectiveDepositAddress = depositAddress || account?.deposit_address || '';
  const depositConfigured = !!effectiveDepositAddress;
  const hasMinimumDeposit = totalDepositedTon >= minimumDepositTon;
  const isClosedForNewPartners = ['over_limit', 'closed_for_new_partners', 'refund_requested', 'refund_available', 'refund_completed', 'paused'].includes(status);
  const canEnableReferrals = depositConfigured && hasMinimumDeposit && !['refund_completed', 'paused'].includes(status);
  const canAcceptNewPartners = canEnableReferrals && !isClosedForNewPartners;
  const lockedUntilDate = validDateOrNull(lockedUntil);
  const lockExpired = !!lockedUntilDate && lockedUntilDate.toString() !== 'Invalid Date' && lockedUntilDate <= new Date();
  const refundableTon = lockExpired && !['refund_requested', 'refund_completed', 'paused'].includes(status)
    ? Math.max(0, availableReserveTon)
    : 0;

  return {
    supported: true,
    id: reserveAccountId,
    status,
    statusLabel: statusCopy(status),
    canEnableReferrals,
    canAcceptNewPartners,
    depositConfigured,
    depositAddress: effectiveDepositAddress,
    depositMemo: normalizeReferralDepositMemo(account?.deposit_memo) || normalizeReferralDepositMemo(buildDepositMemo(ownerId)),
    lockedUntil,
    lockExpired,
    refundableTon: roundTon(refundableTon),
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
