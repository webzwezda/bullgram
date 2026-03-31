create table if not exists public.userbot_fingerprint_presets (
    id text primary key,
    owner_id uuid null references public.profiles(id) on delete cascade,
    label text not null,
    note text null,
    api_id integer not null,
    api_hash text not null,
    device_model text not null,
    system_version text not null,
    app_version text not null,
    system_lang_code text not null,
    lang_code text not null,
    sort_order integer not null default 100,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists userbot_fingerprint_presets_owner_sort_idx
    on public.userbot_fingerprint_presets (owner_id, sort_order, created_at);

create unique index if not exists userbot_fingerprint_presets_owner_label_idx
    on public.userbot_fingerprint_presets (owner_id, lower(label));

alter table public.userbot_fingerprint_presets enable row level security;

drop policy if exists "fingerprint presets select own and system" on public.userbot_fingerprint_presets;
create policy "fingerprint presets select own and system"
    on public.userbot_fingerprint_presets
    for select
    to authenticated
    using (owner_id is null or owner_id = auth.uid());

drop policy if exists "fingerprint presets insert own" on public.userbot_fingerprint_presets;
create policy "fingerprint presets insert own"
    on public.userbot_fingerprint_presets
    for insert
    to authenticated
    with check (owner_id = auth.uid());

drop policy if exists "fingerprint presets update own" on public.userbot_fingerprint_presets;
create policy "fingerprint presets update own"
    on public.userbot_fingerprint_presets
    for update
    to authenticated
    using (owner_id = auth.uid())
    with check (owner_id = auth.uid());

drop policy if exists "fingerprint presets delete own" on public.userbot_fingerprint_presets;
create policy "fingerprint presets delete own"
    on public.userbot_fingerprint_presets
    for delete
    to authenticated
    using (owner_id = auth.uid());

insert into public.userbot_fingerprint_presets (
    id,
    owner_id,
    label,
    note,
    api_id,
    api_hash,
    device_model,
    system_version,
    app_version,
    system_lang_code,
    lang_code,
    sort_order
)
values
    (
        'bullrun_android_a52',
        null,
        'Samsung Galaxy A52',
        'Рекомендуемый Android-профиль для QR-логина. Быстрый безопасный старт без родного .json.',
        4,
        '014b35b6184100b085b0d0572f9b5103',
        'Samsung SM-A525F',
        'SDK 33',
        '12.3.0 (63772)',
        'en-us',
        'en',
        10
    ),
    (
        'bullrun_android_redmi_note_11',
        null,
        'Xiaomi Redmi Note 11',
        'Альтернативный Android-профиль с русской локалью.',
        4,
        '014b35b6184100b085b0d0572f9b5103',
        'Redmi Note 11',
        'SDK 32',
        '12.3.0 (63772)',
        'ru-ru',
        'ru',
        20
    ),
    (
        'bullrun_android_a34',
        null,
        'Samsung Galaxy A34',
        'Запасной Android-профиль для QR-логина.',
        4,
        '014b35b6184100b085b0d0572f9b5103',
        'Samsung SM-A346B',
        'SDK 34',
        '12.3.0 (63772)',
        'en-gb',
        'en',
        30
    ),
    (
        'bullrun_iphone_13',
        null,
        'iPhone 13',
        'Стабильный iPhone-профиль для QR-логина.',
        4,
        '014b35b6184100b085b0d0572f9b5103',
        'iPhone 13',
        'iOS 17.4',
        '12.3 (30231)',
        'en-us',
        'en',
        40
    ),
    (
        'bullrun_iphone_15_pro',
        null,
        'iPhone 15 Pro',
        'Свежий iPhone-профиль для QR-логина.',
        4,
        '014b35b6184100b085b0d0572f9b5103',
        'iPhone 15 Pro',
        'iOS 17.5',
        '12.3 (30231)',
        'en-us',
        'en',
        50
    )
on conflict (id) do update
set
    label = excluded.label,
    note = excluded.note,
    api_id = excluded.api_id,
    api_hash = excluded.api_hash,
    device_model = excluded.device_model,
    system_version = excluded.system_version,
    app_version = excluded.app_version,
    system_lang_code = excluded.system_lang_code,
    lang_code = excluded.lang_code,
    sort_order = excluded.sort_order,
    updated_at = now();
