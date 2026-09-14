-- Атомарное создание заявки на вывод из казны проекта (закрывает гонку параллельных
-- POST /treasury/withdrawals из код-ревью). Раньше роут читал available
-- (buildTreasurySummary) и вставлял строку двумя отдельными запросами: два параллельных
-- POST оба видели один и тот же available X и оба вставлялись, расходуя лимит дважды.
-- Теперь проверка лимита и вставка живут в одном RPC: pg_advisory_xact_lock
-- сериализует создание заявок, pending пересчитывается уже под блокировкой.
--
-- Вызывается только из бэкенда с service-ключом
-- (supabase.rpc('create_project_treasury_withdrawal', {...})).
-- Применять до деплоя бэкенда, который переводит POST-роут на этот RPC.
--
-- p_available_ton — доступный лимит, посчитанный бэкендом из ledger + кошелька
-- (buildTreasurySummary); p_fee_ton — серверная константа комиссии (NETWORK_FEE_TON),
-- клиентское значение комиссии не принимается вовсе.

drop function if exists public.create_project_treasury_withdrawal(
  p_available_ton numeric,
  p_pending_ton_seen numeric,
  p_amount_ton numeric,
  p_fee_ton numeric,
  p_wallet_address text,
  p_note text,
  p_requested_by uuid
);

create function public.create_project_treasury_withdrawal(
  p_available_ton numeric,
  p_pending_ton_seen numeric,
  p_amount_ton numeric,
  p_fee_ton numeric,
  p_wallet_address text,
  p_note text,
  p_requested_by uuid
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pending_ton numeric;
  v_total_debit_ton numeric;
  v_withdrawal public.project_treasury_withdrawals%rowtype;
begin
  -- (1) Сериализуем создание заявок: параллельные вызовы видят pending друг друга.
  perform pg_advisory_xact_lock(hashtext('project_treasury_withdrawals'));

  -- (2) Defense-in-depth: валидация на стороне БД, а не только в роуте.
  if p_amount_ton is null or p_amount_ton <= 0 then
    return json_build_object('ok', false, 'reason', 'invalid_amount', 'withdrawal', null);
  end if;
  if p_fee_ton is null or p_fee_ton < 0 then
    return json_build_object('ok', false, 'reason', 'invalid_fee', 'withdrawal', null);
  end if;

  -- (3) Незавершённые заявки держат лимит (requested/queued/sending — как в
  -- summarizeWithdrawals на бэке); failed/cancelled лимит не держат.
  select coalesce(sum(amount_ton + network_fee_ton), 0)
    into v_pending_ton
    from public.project_treasury_withdrawals
    where status in ('requested', 'queued', 'sending');

  v_total_debit_ton := p_amount_ton + p_fee_ton;

  -- (4) Лимит: p_available_ton приходит от роута УЖЕ очищенным от pending
  -- (buildTreasurySummary вычитает pendingTon). Поэтому сравниваем прирост
  -- pending (v_pending_ton − p_pending_ton_seen) + дебет новой заявки против
  -- available. Гонка закрыта: параллельная вставка раздувает v_pending_ton
  -- сверх seen, и вторая заявка честно отклоняется.
  if v_pending_ton - coalesce(p_pending_ton_seen, 0) + v_total_debit_ton > p_available_ton then
    return json_build_object('ok', false, 'reason', 'insufficient', 'withdrawal', null);
  end if;

  -- (5) Вставка заявки.
  insert into public.project_treasury_withdrawals (
    requested_by,
    to_wallet,
    amount_ton,
    network_fee_ton,
    status,
    payload
  ) values (
    p_requested_by,
    p_wallet_address,
    p_amount_ton,
    p_fee_ton,
    'requested',
    jsonb_build_object(
      'note', nullif(p_note, ''),
      'available_ton_before', p_available_ton,
      'pending_ton_before', v_pending_ton,
      'total_debit_ton', v_total_debit_ton,
      'source', 'project_admin_treasury_mvp'
    )
  )
  returning * into v_withdrawal;

  return json_build_object(
    'ok', true,
    'reason', null,
    'withdrawal', to_jsonb(v_withdrawal)
  );
end;
$$;

-- Деньги: функцию зовёт только backend с service-ключа. PostgREST экспонирует
-- public-функции — без revoke аутентифицированный клиент мог бы вызвать RPC
-- с любым p_available_ton, минуя лимиты бэкенда (урок 2026-09-14).
revoke execute on function public.create_project_treasury_withdrawal(
  p_available_ton numeric, p_pending_ton_seen numeric, p_amount_ton numeric,
  p_fee_ton numeric, p_wallet_address text, p_note text, p_requested_by uuid
) from public, anon, authenticated;
grant execute on function public.create_project_treasury_withdrawal(
  p_available_ton numeric, p_pending_ton_seen numeric, p_amount_ton numeric,
  p_fee_ton numeric, p_wallet_address text, p_note text, p_requested_by uuid
) to service_role;
