#!/usr/bin/env bash
# Метрики-дайджест (план 1.8): cron 0 9 * * * — одна строка-сводка в Telegram.
set -euo pipefail
DISK=$(df -h / | awk 'NR==2{print $3" / "$2" ("$5")"}')
MEM=$(free -m | awk '/Mem:/{print $7"MB avail"}')
LOAD=$(cut -d' ' -f1-3 /proc/loadavg)
UP=$(uptime -p 2>/dev/null || true)
DBSZ=$(docker exec supabase-db psql -U postgres -tAc "SELECT pg_size_pretty(pg_database_size('postgres'))" 2>/dev/null || echo "?")
PM2=$(pm2 jlist 2>/dev/null | jq -r '[.[] | "\(.name):\(.pm2_env.status)\(if .pm2_env.restart_time > 3 then " (рестартов за всё время: \(.pm2_env.restart_time))" else "" end)"] | join(", ")' 2>/dev/null || echo "pm2 ?")
MSG="📊 Bullgram $(date '+%F') ${UP}
диск: ${DISK} | mem: ${MEM} | load: ${LOAD}
БД: ${DBSZ} | pm2: ${PM2}"
/opt/alerts/tg-send.sh "$MSG"
curl -fsS -m 10 "http://100.127.7.20:3004/api/push/FAB38358EF1C5C6BEB66?status=up&msg=OK" >/dev/null 2>&1 || true
