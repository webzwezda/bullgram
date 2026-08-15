alter table channel_audience_members
  add column if not exists dm_blocked boolean default false,
  add column if not exists dm_last_error text,
  add column if not exists dm_failed_count int default 0,
  add column if not exists dm_last_sent_at timestamptz;
