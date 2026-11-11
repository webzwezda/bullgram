#!/usr/bin/env bash
# Лог-дайджест (план 1.6, поправки Д-6 обязательны): cron 0 */4 * * *.
# pino-уровни СТРОКОВЫЕ ("level":"error"); фильтр шума: 404-скан /api/v1*, /api/config, /healthz.
# DMS: сообщение приходит всегда (даже «тихо») — тишина чата = скрипт не работает.
# Тексты человеческие (решение владельца 2026-11-11): без «request completed»
# и сырых сигнатур; расшифровки известных причин — словарь в блоке HINTS.
set -u
LOG=/srv/bullgram/backend/logs/app.out.jsonl
SINCE=$(date -u -d '4 hours ago' '+%Y-%m-%dT%H:%M:%S')
[ -f "$LOG" ] || { /opt/alerts/tg-send.sh "⚠️ Логи Bullgram: дайджест не нашёл файл $LOG"; exit 0; }

LINES=$(mktemp)
jq -r --arg since "$SINCE" '
  select(.time > $since)
  | select(.level=="error" or .level=="warn" or .level=="fatal")
  | select((.req.url // "") | test("^/api/(v1|config)|^/healthz") | not)
  | [ .level,
      (.req.url // .job // .module // .web_app // "-"),
      ((.err.message // .msg) // "-") ]
  | @tsv' "$LOG" 2>/dev/null | cut -c1-80 > "$LINES"

# Человекочитаемая строка: уровень по-русски; «request completed» — это pino-msg
# успешного ЛОГ-вызова для HTTP >=400, на деле «запросы с ошибками 4xx/5xx».
pretty() {
  awk -F'\t' '{
    lvl = ($1=="error") ? "ошибки" : (($1=="warn") ? "предупр." : "фатальные")
    what = $3
    if (what=="request completed" || what=="request errored") what = "запросы с ошибками (4xx/5xx)"
    print lvl" | "$2" | "what
  }'
}

ERR_N=$(grep -c $'^error\t' "$LINES" 2>/dev/null || true)
WARN_N=$(grep -c $'^warn\t' "$LINES" 2>/dev/null || true)
KUMA_PUSH='curl -fsS -m 10 "http://100.127.7.20:3004/api/push/B7DA6B6CE797D3BC964F?status=up&msg=OK" >/dev/null 2>&1 || true'

if [ "${ERR_N:-0}" -eq 0 ] && [ "${WARN_N:-0}" -eq 0 ]; then
  /opt/alerts/tg-send.sh "✅ [log-digest] за 4ч: тихо — ни ошибок, ни предупреждений"
  eval "$KUMA_PUSH"
else
  TOP=$(pretty < "$LINES" | sort | uniq -c | sort -rn | head -8 | sed 's/^ *//')

  # Расшифровки известных сигнатур (runbooks.md §1-7) с реакцией дежурного
  # агента — читатель дайджеста агент, не человек (решение владельца 2026-11-11).
  HINTS=$(mktemp)
  {
    grep -q "Proxy connection timed out" "$LINES" && echo "• «Proxy connection timed out» — юзерботы не достучались через прокси (деплой-окно или флап). Реакция: сопровождать; эскалировать владельцу при >200/ч."
    grep -qE "Connection to .* timed out" "$LINES" && echo "• «Connection … timed out» — IPv6 до Telegram флапает (хостер). Реакция: ждать, витрина защищена; хроника >12ч — доложить владельцу."
    grep -q "Socks5 proxy rejected" "$LINES" && echo "• «Socks5 rejected» — слот отверг соединение. Реакция: ничего, reconcile поднимает сам (hourly)."
    grep -qE "401: Unauthorized|Error checking rights" "$LINES" && echo "• «401 Unauthorized» у бота — мёртвый токен. Реакция: найти бота по uuid в autopost_bots, проверить getMe, уведомить владельца о перевыпуске в BotFather (runbooks §1)."
    grep -q "bot_launch_failed" "$LINES" && echo "• «bot_launch_failed» — бот не запустился, чаще мёртвый токен. Реакция: как у 401."
    grep -qE "\.env|phpinfo|config\.php" "$LINES" && echo "• Строки с .env/phpinfo — сканеры, 404. Реакция: ничего, фон."
    grep -q "job failed" "$LINES" && echo "• «job failed» — упала фоновая задача. Реакция: вытащить контекст из лога по job+runId (logging.md), runbooks §6."
  } > "$HINTS" 2>/dev/null
  HINT_BLOCK=""
  [ -s "$HINTS" ] && HINT_BLOCK="
Расшифровка и реакции:
$(cat "$HINTS")"

  MSG="🩺 [log-digest] за 4ч: ошибок ${ERR_N:-0}, предупреждений ${WARN_N:-0}
Чаще всего (раз × что):
${TOP}${HINT_BLOCK}
Полный гайд дежурного: docs/dev/runbooks.md."
  /opt/alerts/tg-send.sh "$MSG"
  eval "$KUMA_PUSH"
fi
rm -f "$LINES" "$HINTS" 2>/dev/null
