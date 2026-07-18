-- Семейные чеклисты: боты (BYO token от BotFather) + списки + пункты
-- Multi-tenant: каждая семья (owner_id = auth.users.id) может зарегать
-- несколько ботов. Один бот работает во многих чатах — chat_id хранится
-- на уровне checklist_lists, не на боте.

create table if not exists public.checklist_bots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  bot_token text not null unique,
  bot_username text,
  bot_id_tg bigint,
  display_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.checklist_bots.bot_token is 'Telegram bot token from BotFather. Plaintext (consistent with autopost_bots). UNIQUE prevents double-launch 409 conflict.';
comment on column public.checklist_bots.bot_username is 'Auto-fetched via telegram.getMe() at registration time.';
comment on column public.checklist_bots.bot_id_tg is 'Numeric Telegram bot id, for logs/debug.';

create index if not exists checklist_bots_owner_idx
  on public.checklist_bots (owner_id, created_at desc);

create index if not exists checklist_bots_active_idx
  on public.checklist_bots (is_active)
  where is_active = true;


create table if not exists public.checklist_lists (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.checklist_bots(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  chat_id bigint not null,
  message_id bigint,
  source_message_id bigint,
  title text not null default 'Чеклист',
  source text not null default 'agent',
  status text not null default 'posting',
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint checklist_lists_source_check
    check (source in ('agent','web','telegram_dm','telegram_reply','telegram_mention','telegram_command')),
  constraint checklist_lists_status_check
    check (status in ('posting','posted','failed'))
);

comment on column public.checklist_lists.message_id is 'ID сообщения бота в чате — нужно для edit при toggle.';
comment on column public.checklist_lists.source_message_id is 'ID исходного сообщения юзера (для edit-trigger синхронизации).';
comment on column public.checklist_lists.status is 'posting=в процессе, posted=отправлен, failed=ошибка отправки (orphan rows оставляем для ретрая).';

create index if not exists checklist_lists_source_msg_idx
  on public.checklist_lists (chat_id, source_message_id)
  where source_message_id is not null;

create index if not exists checklist_lists_bot_idx
  on public.checklist_lists (bot_id, created_at desc);

create index if not exists checklist_lists_owner_idx
  on public.checklist_lists (owner_id, created_at desc);

create index if not exists checklist_lists_chat_idx
  on public.checklist_lists (chat_id, created_at desc);


create table if not exists public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.checklist_lists(id) on delete cascade,
  text text not null,
  checked boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

comment on column public.checklist_items.position is 'Порядок пункта в списке (для сортировки keyboard).';

create index if not exists checklist_items_list_idx
  on public.checklist_items (list_id, position);
