-- Migration: Add kick attempts and failure reasons to subscriptions table
alter table public.subscriptions
  add column if not exists kick_attempts integer not null default 0,
  add column if not exists kick_failed_reason text null;
