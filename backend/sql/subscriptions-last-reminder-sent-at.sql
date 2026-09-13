-- Retention: per-cycle reminder tracking (см. docs/plans/2026-09-14-retention-review-backlog.md).
-- Заменяет boolean expiry_reminder_sent: продление обновляет ту же строку in-place,
-- поэтому булев флаг переживал новый биллинг-цикл и молча убивал напоминания со 2-го цикла.
-- Джоба ставит last_reminder_sent_at только по финальному исходу (доставлено / дефинитивный скип),
-- транзиентные ошибки ретраятся следующим тиком. Условие отправки: expires_at в окне 24ч
-- И (last_reminder_sent_at IS NULL OR last_reminder_sent_at < now() - interval '24 hours').
alter table public.subscriptions
    add column if not exists last_reminder_sent_at timestamptz;

create index if not exists subscriptions_retention_scan
    on public.subscriptions (expires_at)
    where status = 'active';

-- expiry_reminder_sent дропается отдельной миграцией ПОСЛЕ депоя кода, который его больше не читает.
