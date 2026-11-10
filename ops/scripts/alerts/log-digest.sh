#!/usr/bin/env bash
# Лог-дайджест (план 1.6, поправки Д-6 обязательны): cron 0 */4 * * *.
# pino-уровни СТРОКОВЫЕ ("level":"error"); фильтр шума: 404-скан /api/v1*, /api/config, /healthz.
# DMS: сообщение приходит всегда (даже «тихо») — тишина чата = скрипт не работает.
set -u
LOG=/srv/bullgram/backend/logs/app.out.jsonl
SINCE=$(date -u -d '4 hours ago' '+%Y-%m-%dT%H:%M:%S')
WINDOW="за 4ч (с ${SINCE}Z UTC)"
[ -f "$LOG" ] || { /opt/alerts/tg-send.sh "⚠️ Bullgram log-digest: лог-файл не найден: $LOG"; exit 0; }

LINES=$(mktemp)
jq -r --arg since "$SINCE" '
  select(.time > $since)
  | select(.level=="error" or .level=="warn" or .level=="fatal")
  | select((.req.url // "") | test("^/api/(v1|config)|^/healthz") | not)
  | [ .level,
      (.req.url // .job // .module // .web_app // "-"),
      ((.err.message // .msg) // "-") ]
  | @tsv' "$LOG" 2>/dev/null | cut -c1-80 > "$LINES"

ERR_N=$(grep -c $'^error\t' "$LINES" 2>/dev/null || true)
WARN_N=$(grep -c $'^warn\t' "$LINES" 2>/dev/null || true)

if [ "${ERR_N:-0}" -eq 0 ] && [ "${WARN_N:-0}" -eq 0 ]; then
  /opt/alerts/tg-send.sh "✅ Bullgram логи тихие ${WINDOW}: 0 error/warn (шум n8n-скана отфильтрован)"
curl -fsS -m 10 "http://100.127.7.20:3004/api/push/B7DA6B6CE797D3BC964F?status=up&msg=OK" >/dev/null 2>&1 || true
else
  TOP=$(sort "$LINES" 2>/dev/null | uniq -c | sort -rn | head -8 | sed 's/^ *//' || true)
  MSG="🩺 Bullgram логи ${WINDOW}: error=${ERR_N:-0} warn=${WARN_N:-0}
Top (частота × уровень × место × причина):
${TOP}
Реакции по сигнатурам: docs/dev/runbooks.md"
  /opt/alerts/tg-send.sh "$MSG"
  curl -fsS -m 10 "http://100.127.7.20:3004/api/push/B7DA6B6CE797D3BC964F?status=up&msg=OK" >/dev/null 2>&1 || true
fi
rm -f "$LINES"
