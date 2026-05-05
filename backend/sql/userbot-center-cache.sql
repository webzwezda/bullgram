create table if not exists public.userbot_center_group_cache (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    userbot_id uuid not null references public.tg_accounts(id) on delete cascade,
    chat_id text not null,
    title text,
    chat_type text not null default 'group',
    unread_count integer not null default 0,
    last_message_preview text,
    last_message_at timestamptz,
    userbot_admin boolean not null default false,
    admin_check_skipped boolean not null default false,
    linked_channel_id uuid references public.channels(id) on delete set null,
    linked_channel_title text,
    admin_error text,
    scanned_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique(owner_id, userbot_id, chat_id)
);

create index if not exists idx_userbot_center_group_cache_owner_userbot
    on public.userbot_center_group_cache(owner_id, userbot_id, scanned_at desc);

create index if not exists idx_userbot_center_group_cache_userbot
    on public.userbot_center_group_cache(userbot_id);

create index if not exists idx_userbot_center_group_cache_linked_channel
    on public.userbot_center_group_cache(linked_channel_id)
    where linked_channel_id is not null;

create table if not exists public.userbot_center_conversation_cache (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    userbot_id uuid not null references public.tg_accounts(id) on delete cascade,
    tg_user_id text not null,
    username text,
    display_name text,
    unread_count integer not null default 0,
    last_message_preview text,
    last_message_at timestamptz,
    last_outgoing boolean not null default false,
    sales_signal boolean not null default false,
    signal_notified_at timestamptz,
    signal_last_message_id text,
    scanned_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique(owner_id, userbot_id, tg_user_id)
);

create index if not exists idx_userbot_center_conversation_cache_owner_userbot
    on public.userbot_center_conversation_cache(owner_id, userbot_id, scanned_at desc);

create index if not exists idx_userbot_center_conversation_cache_last_message
    on public.userbot_center_conversation_cache(owner_id, userbot_id, last_message_at desc);

create index if not exists idx_userbot_center_conversation_cache_userbot
    on public.userbot_center_conversation_cache(userbot_id);
