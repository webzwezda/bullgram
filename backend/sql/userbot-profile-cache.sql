alter table public.tg_accounts
  add column if not exists tg_first_name text,
  add column if not exists tg_last_name text,
  add column if not exists tg_phone text,
  add column if not exists tg_about text,
  add column if not exists tg_photo_data_url text,
  add column if not exists tg_profile_synced_at timestamptz,
  add column if not exists tg_profile_sync_attempted_at timestamptz,
  add column if not exists tg_profile_sync_error text;
