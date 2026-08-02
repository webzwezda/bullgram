-- Phase 4: rename customer_bases family → channel_audiences family.
-- Tables, constraints, and indexes get new names. The base_id column stays as-is
-- to minimize code churn (channel_audience_members.base_id → channel_audiences.id).
-- RLS is not enabled on these tables; nothing to migrate there.
-- Verified against production schema before writing (2026-08-02).

begin;

alter table public.customer_bases rename to channel_audiences;
alter table public.customer_base_members rename to channel_audience_members;
alter table public.customer_base_channels rename to channel_audience_channels;

alter table public.channel_audiences
    rename constraint customer_bases_pkey to channel_audiences_pkey;
alter table public.channel_audiences
    rename constraint customer_bases_contour_id_fkey to channel_audiences_contour_id_fkey;

alter table public.channel_audience_members
    rename constraint customer_base_members_pkey to channel_audience_members_pkey;
alter table public.channel_audience_members
    rename constraint customer_base_members_base_id_fkey to channel_audience_members_base_id_fkey;
alter table public.channel_audience_members
    rename constraint customer_base_members_base_id_tg_user_id_key to channel_audience_members_base_id_tg_user_id_key;

alter table public.channel_audience_channels
    rename constraint customer_base_channels_pkey to channel_audience_channels_pkey;
alter table public.channel_audience_channels
    rename constraint customer_base_channels_base_id_fkey to channel_audience_channels_base_id_fkey;
alter table public.channel_audience_channels
    rename constraint customer_base_channels_channel_id_fkey to channel_audience_channels_channel_id_fkey;
alter table public.channel_audience_channels
    rename constraint customer_base_channels_base_id_channel_id_key to channel_audience_channels_base_id_channel_id_key;

alter index if exists public.customer_bases_pkey rename to channel_audiences_pkey;
alter index if exists public.idx_customer_bases_contour_target rename to idx_channel_audiences_contour_target;
alter index if exists public.customer_base_members_pkey rename to channel_audience_members_pkey;
alter index if exists public.customer_base_members_base_id_tg_user_id_key rename to channel_audience_members_base_id_tg_user_id_key;
alter index if exists public.customer_base_channels_pkey rename to channel_audience_channels_pkey;
alter index if exists public.customer_base_channels_base_id_channel_id_key rename to channel_audience_channels_base_id_channel_id_key;

commit;
