alter table public.payment_settings
  add column if not exists referral_client_discount_percent numeric not null default 10;

alter table public.referral_attributions
  add column if not exists expires_at timestamp with time zone,
  add column if not exists reward_percent_snapshot numeric,
  add column if not exists client_discount_percent_snapshot numeric,
  add column if not exists terms_status character varying not null default 'active',
  add column if not exists discount_eligible boolean not null default true,
  add column if not exists reserve_status_snapshot character varying;

alter table public.referral_events
  alter column referred_tg_user_id drop not null,
  add column if not exists sale_original_amount numeric,
  add column if not exists sale_original_currency character varying,
  add column if not exists client_discount_percent numeric,
  add column if not exists client_discount_original_amount numeric,
  add column if not exists reward_original_amount numeric,
  add column if not exists reward_original_currency character varying,
  add column if not exists reward_ton_amount numeric,
  add column if not exists bullrun_fee_ton_amount numeric,
  add column if not exists network_fee_ton_amount numeric,
  add column if not exists exchange_rate_id uuid,
  add column if not exists reserve_account_id uuid,
  add column if not exists reserve_coverage_status character varying;

create unique index if not exists referral_events_reward_invoice_unique
  on public.referral_events (owner_id, invoice_id, event_type)
  where invoice_id is not null and event_type = 'reward_granted';

create table if not exists public.crypto_exchange_rates (
  id uuid primary key default gen_random_uuid(),
  base_currency character varying not null,
  quote_currency character varying not null,
  rate numeric not null,
  provider character varying not null default 'manual',
  fetched_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create index if not exists crypto_exchange_rates_lookup_idx
  on public.crypto_exchange_rates (base_currency, quote_currency, fetched_at desc);

create table if not exists public.referral_reserve_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique,
  deposit_address text,
  deposit_memo character varying,
  status character varying not null default 'deposit_required',
  minimum_deposit_ton numeric not null default 100,
  total_deposited_ton numeric not null default 0,
  locked_until timestamp with time zone,
  available_reserve_ton numeric not null default 0,
  reserved_obligations_ton numeric not null default 0,
  admin_debt_ton numeric not null default 0,
  bullrun_fee_accrued_ton numeric not null default 0,
  network_fee_accrued_ton numeric not null default 0,
  last_deposit_at timestamp with time zone,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists referral_reserve_accounts_owner_idx
  on public.referral_reserve_accounts (owner_id);

create table if not exists public.referral_reserve_ledger (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  reserve_account_id uuid references public.referral_reserve_accounts(id) on delete cascade,
  entry_type character varying not null,
  amount_ton numeric not null default 0,
  direction character varying not null,
  related_referral_event_id uuid,
  related_payout_id uuid,
  chain_tx_hash text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now()
);

create unique index if not exists referral_reserve_ledger_chain_tx_unique
  on public.referral_reserve_ledger (chain_tx_hash)
  where chain_tx_hash is not null;

create index if not exists referral_reserve_ledger_owner_created_idx
  on public.referral_reserve_ledger (owner_id, created_at desc);

create index if not exists referral_reserve_ledger_account_idx
  on public.referral_reserve_ledger (reserve_account_id);

create table if not exists public.referral_partner_payout_methods (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  tg_user_id character varying not null,
  ton_wallet text not null,
  status character varying not null default 'active',
  verified_at timestamp with time zone,
  last_changed_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (owner_id, tg_user_id)
);

create index if not exists referral_partner_payout_methods_owner_idx
  on public.referral_partner_payout_methods (owner_id, tg_user_id);

create table if not exists public.referral_partner_payouts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  tg_user_id character varying not null,
  amount_ton numeric not null,
  network_fee_ton numeric not null default 0,
  status character varying not null default 'requested',
  ton_wallet text not null,
  chain_tx_hash text,
  requested_at timestamp with time zone not null default now(),
  sent_at timestamp with time zone,
  failed_at timestamp with time zone,
  failure_reason text,
  payload jsonb not null default '{}'::jsonb
);

create unique index if not exists referral_partner_payouts_chain_tx_unique
  on public.referral_partner_payouts (chain_tx_hash)
  where chain_tx_hash is not null;

create index if not exists referral_partner_payouts_owner_status_idx
  on public.referral_partner_payouts (owner_id, status, requested_at desc);
