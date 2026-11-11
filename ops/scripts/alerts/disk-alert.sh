#!/usr/bin/env bash
# Диск-алерт (план 2026-11-07-engineering-hardening.md, 1.2): cron ежечасно.
# Пороги 80% (warn) / 90% (crit), дедуп: не чаще раза в 6ч на порог.
# Читатель — дежурный ИИ-агент (владелец с логами не работает, 2026-11-11):
# текст = факт → действие, команды чистки вшиты в алерт.
# Тест: FAKE_USE=85 /opt/alerts/disk-alert.sh
set -u
TTL=21600  # 6ч
USE="${FAKE_USE:-$(df -P / | awk 'NR==2{gsub("%","");print $5}')}"
NOW=$(date +%s)
ST80=/var/lib/disk-alert.state80
ST90=/var/lib/disk-alert.state90
last() { cat "$1" 2>/dev/null || echo 0; }
notify() {  # $1=state-file $2=text
  if [ $((NOW - $(last "$1"))) -ge "$TTL" ]; then
    if /opt/alerts/tg-send.sh "$2"; then date +%s > "$1"; fi
  fi
}
if [ "$USE" -ge 90 ]; then
  notify "$ST90" "🔴 [disk] ${USE}% — критично, свободно $(df -h / | awk 'NR==2{print $4}').
Действие (срочно): docker image prune -f; journalctl --vacuum-size=200M; find /backups/postgres -name '*.dump' -mtime +3 -delete; кэши /home/*/.hermes — спросить владельца (anna НЕ трогать). После: df -h / и доложить. План: docs/plans/2026-11-07-engineering-hardening.md §1.1."
elif [ "$USE" -ge 80 ]; then
  notify "$ST80" "⚠️ [disk] ${USE}% занято, свободно $(df -h / | awk 'NR==2{print $4}').
Действие: docker image prune -f (только dangling); journalctl --vacuum-size=200M; find /backups/postgres -name '*.dump' -mtime +3 -delete (ротация); кэши /home/*/.hermes — только после подтверждения владельца (anna НЕ трогать). После: df -h / и доложить. Контекст: docs/dev/runbooks.md, operations.md §3."
fi
