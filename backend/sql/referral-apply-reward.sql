-- Атомарное начисление реферальной награды (закрывает двойное начисление из код-ревью P1-1).
-- Раньше processReferralReward кредитовал баланс referral_profiles ДО вставки идемпотентного
-- маркера в referral_events, и live-путь (activateSubscription) гонял вместе с
-- referral-settlement-retry.job.js по одному инвойсу — при гонке награда начислялась дважды.
-- Теперь всё ядро живет в одном RPC: маркер (unique index referral_events_reward_invoice_unique)
-- -> инкремент баланса -> ledger-проводки -> converted_at, либо {granted:false} без единой записи.
--
-- Вызывается только из бэкенда с service-ключом (supabase.rpc('referral_apply_reward', {...})).
-- Применять до деплоя бэкенда, который переводит processReferralReward на этот RPC.

drop function if exists public.referral_apply_reward(
  p_owner_id uuid,
  p_attribution_id uuid,
  p_referrer_profile_id uuid,
  p_referrer_tg_user_id character varying,
  p_referred_tg_user_id character varying,
  p_invoice_id uuid,
  p_tariff_id uuid,
  p_reserve_account_id uuid,
  p_reserve_coverage_status character varying,
  p_reward_ton_amount numeric,
  p_bullgram_fee_ton_amount numeric,
  p_bullgram_fee_percent numeric,
  p_reward_base_amount numeric,
  p_reward_amount numeric,
  p_currency character varying,
  p_client_discount_percent numeric,
  p_client_discount_amount numeric,
  p_exchange_rate_id uuid,
  p_payload jsonb
);

create function public.referral_apply_reward(
  p_owner_id uuid,
  p_attribution_id uuid,
  p_referrer_profile_id uuid,
  p_referrer_tg_user_id character varying,
  p_referred_tg_user_id character varying,
  p_invoice_id uuid,
  p_tariff_id uuid,
  p_reserve_account_id uuid,
  p_reserve_coverage_status character varying,
  p_reward_ton_amount numeric,
  p_bullgram_fee_ton_amount numeric,
  p_bullgram_fee_percent numeric,
  p_reward_base_amount numeric,
  p_reward_amount numeric,
  p_currency character varying,
  p_client_discount_percent numeric,
  p_client_discount_amount numeric,
  p_exchange_rate_id uuid,
  p_payload jsonb
)
returns json
language plpgsql
set search_path = public
as $$
declare
  v_event_id uuid;
  v_new_balance_ton numeric;
begin
  -- (1) Идемпотентный маркер награды. Частичный уникальный индекс
  -- referral_events_reward_invoice_unique (owner_id, invoice_id, event_type)
  -- делает вставку атомарной блокировкой: второй вызов по тому же инвойсу
  -- ловит unique_violation и выходит, не тронув ни баланс, ни ledger.
  begin
    insert into public.referral_events (
      owner_id,
      referrer_tg_user_id,
      referred_tg_user_id,
      invoice_id,
      tariff_id,
      event_type,
      status,
      reward_amount,
      reward_currency,
      sale_original_amount,
      sale_original_currency,
      client_discount_percent,
      client_discount_original_amount,
      reward_original_amount,
      reward_original_currency,
      reward_ton_amount,
      bullgram_fee_ton_amount,
      network_fee_ton_amount,
      exchange_rate_id,
      reserve_account_id,
      reserve_coverage_status,
      payload
    ) values (
      p_owner_id,
      p_referrer_tg_user_id,
      p_referred_tg_user_id,
      p_invoice_id,
      p_tariff_id,
      'reward_granted',
      'completed',
      p_reward_ton_amount,
      'TON',
      p_reward_base_amount,
      p_currency,
      p_client_discount_percent,
      p_client_discount_amount,
      p_reward_amount,
      p_currency,
      p_reward_ton_amount,
      p_bullgram_fee_ton_amount,
      0,
      p_exchange_rate_id,
      p_reserve_account_id,
      p_reserve_coverage_status,
      p_payload
    )
    returning id into v_event_id;
  exception when unique_violation then
    -- Награда по этому инвойсу уже начислена (в т.ч. легаси-путем). Ничего не пишем.
    return json_build_object(
      'granted', false,
      'reason', 'duplicate',
      'reward_event_id', null
    );
  end;

  -- (2) Атомарный инкремент баланса партнера. Награда всегда конвертирована в TON
  -- на стороне JS (whitelist TON/USDT -> convertAmountToTon), поэтому пишем в
  -- balance_ton/total_earned_ton, как и раньше. Никаких read-before-write из JS.
  update public.referral_profiles
    set balance_ton = balance_ton + p_reward_ton_amount,
        total_earned_ton = total_earned_ton + p_reward_ton_amount
    where id = p_referrer_profile_id
    returning balance_ton into v_new_balance_ton;

  if v_new_balance_ton is null then
    raise exception 'referral_apply_reward: referral_profiles % not found', p_referrer_profile_id;
  end if;

  -- (3) Обязательства резерва (только когда известен резерв-аккаунт).
  if p_reserve_account_id is not null then
    insert into public.referral_reserve_ledger (
      owner_id,
      reserve_account_id,
      entry_type,
      amount_ton,
      direction,
      related_referral_event_id,
      payload
    ) values
      (
        p_owner_id,
        p_reserve_account_id,
        'reward_obligation_created',
        p_reward_ton_amount,
        'debit',
        v_event_id,
        jsonb_build_object(
          'invoice_id', p_invoice_id,
          'referred_tg_user_id', p_referred_tg_user_id,
          'reward_original_amount', p_reward_amount,
          'reward_original_currency', p_currency,
          'exchange_rate_id', p_exchange_rate_id
        )
      ),
      (
        p_owner_id,
        p_reserve_account_id,
        'bullgram_fee_created',
        p_bullgram_fee_ton_amount,
        'debit',
        v_event_id,
        jsonb_build_object(
          'invoice_id', p_invoice_id,
          'fee_percent', p_bullgram_fee_percent
        )
      );
  end if;

  -- (4) Атрибуция сконвертирована — закрывает ее в retry-очереди.
  update public.referral_attributions
    set converted_at = now(),
        paid_invoice_id = p_invoice_id
    where id = p_attribution_id;

  return json_build_object(
    'granted', true,
    'reason', null,
    'reward_event_id', v_event_id,
    'previous_balance_ton', v_new_balance_ton - p_reward_ton_amount,
    'new_balance_ton', v_new_balance_ton
  );
end;
$$;

-- Деньги: функцию зовёт только backend с service-ключа. PostgREST экспонирует
-- public-функции — без revoke anon-ключом можно сминтить баланс (урок 2026-09-14).
revoke execute on function public.referral_apply_reward(
  p_owner_id uuid, p_attribution_id uuid, p_referrer_profile_id uuid,
  p_referrer_tg_user_id character varying, p_referred_tg_user_id character varying,
  p_invoice_id uuid, p_tariff_id uuid, p_reserve_account_id uuid,
  p_reserve_coverage_status character varying, p_reward_ton_amount numeric,
  p_bullgram_fee_ton_amount numeric, p_bullgram_fee_percent numeric,
  p_reward_base_amount numeric, p_reward_amount numeric, p_currency character varying,
  p_client_discount_percent numeric, p_client_discount_amount numeric,
  p_exchange_rate_id uuid, p_payload jsonb
) from public, anon, authenticated;
grant execute on function public.referral_apply_reward(
  p_owner_id uuid, p_attribution_id uuid, p_referrer_profile_id uuid,
  p_referrer_tg_user_id character varying, p_referred_tg_user_id character varying,
  p_invoice_id uuid, p_tariff_id uuid, p_reserve_account_id uuid,
  p_reserve_coverage_status character varying, p_reward_ton_amount numeric,
  p_bullgram_fee_ton_amount numeric, p_bullgram_fee_percent numeric,
  p_reward_base_amount numeric, p_reward_amount numeric, p_currency character varying,
  p_client_discount_percent numeric, p_client_discount_amount numeric,
  p_exchange_rate_id uuid, p_payload jsonb
) to service_role;
