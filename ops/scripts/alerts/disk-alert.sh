#!/usr/bin/env bash
# Диск-алерт (план 2026-11-07-engineering-hardening.md, 1.2): cron ежечасно.
# Пороги 80% (warn) / 90% (crit), дедуп: не чаще раза в 6ч на порог.
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
  notify "$ST90" "🔴 Bullgram VDS: диск ${USE}% (критично). Свободно: $(df -h / | awk 'NR==2{print $4}'). Чистка: см. план 1.1 (journal vacuum, docker prune) — решения по /home у владельца."
elif [ "$USE" -ge 80 ]; then
  notify "$ST80" "🟡 Bullgram VDS: диск ${USE}% (порог 80). Свободно: $(df -h / | awk 'NR==2{print $4}')."
fi
