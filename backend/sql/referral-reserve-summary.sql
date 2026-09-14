-- SQL-суммы ledger резерва без лимитов выборки (закрывает P2-4 код-ревью).
-- Раньше loadReferralReserveState (limit 500) и reconcileReferralReserveAccount (limit 2000)
-- суммировали referral_reserve_ledger по ограниченным выборкам в JS — при переполнении лимита
-- резерв-математика молча врала. Теперь агрегаты считает Postgres одним проходом по всем строкам.
--
-- Возвращает ровно те агрегаты, которые раньше считал summarizeLedger в
-- backend/services/referral-reserve.service.js (snake_case версии):
--   deposit_ton                = deposit_confirmed + credit
--   partner_payout_ton         = partner_payout_sent + debit
--   admin_refund_ton           = admin_refund_sent + debit
--   admin_refund_requested_ton = admin_refund_requested (любой direction)
--   admin_refund_cancelled_ton = admin_refund_cancelled (любой direction)
--   reward_obligation_ton      = reward_obligation_created (любой direction)
--   bullgram_fee_ton           = bullgram_fee_created (любой direction)
--   network_fee_ton            = network_fee_reserved: credit вычитает, остальное прибавляет
--   first_deposit_at           = min(created_at) среди deposit_confirmed + credit (null при 0 строк)
-- Поведение при 0 строк — нули и first_deposit_at = null, как раньше в JS.
--
-- Вызывается из бэкенда с service-ключом (supabase.rpc('referral_reserve_summary', {...})).
-- Применять до деплоя бэкенда, который переводит referral-reserve.service.js на этот RPC.

drop function if exists public.referral_reserve_summary(p_owner_id uuid);

create function public.referral_reserve_summary(p_owner_id uuid)
returns json
language sql
set search_path = public
as $$
  select json_build_object(
    'deposit_ton', coalesce(sum(
      case when entry_type = 'deposit_confirmed' and direction = 'credit'
        then amount_ton end
    ), 0),
    'partner_payout_ton', coalesce(sum(
      case when entry_type = 'partner_payout_sent' and direction = 'debit'
        then amount_ton end
    ), 0),
    'admin_refund_ton', coalesce(sum(
      case when entry_type = 'admin_refund_sent' and direction = 'debit'
        then amount_ton end
    ), 0),
    'admin_refund_requested_ton', coalesce(sum(
      case when entry_type = 'admin_refund_requested'
        then amount_ton end
    ), 0),
    'admin_refund_cancelled_ton', coalesce(sum(
      case when entry_type = 'admin_refund_cancelled'
        then amount_ton end
    ), 0),
    'reward_obligation_ton', coalesce(sum(
      case when entry_type = 'reward_obligation_created'
        then amount_ton end
    ), 0),
    'bullgram_fee_ton', coalesce(sum(
      case when entry_type = 'bullgram_fee_created'
        then amount_ton end
    ), 0),
    'network_fee_ton', coalesce(sum(
      case
        when entry_type = 'network_fee_reserved' and direction = 'credit' then -amount_ton
        when entry_type = 'network_fee_reserved' then amount_ton
      end
    ), 0),
    'first_deposit_at', min(
      case when entry_type = 'deposit_confirmed' and direction = 'credit'
        then created_at end
    )
  )
  from public.referral_reserve_ledger
  where owner_id = p_owner_id;
$$;

-- Только backend (service-ключ) читает агрегаты резерва; anon/authenticated — никак.
revoke execute on function public.referral_reserve_summary(p_owner_id uuid) from public, anon, authenticated;
grant execute on function public.referral_reserve_summary(p_owner_id uuid) to service_role;
