#!/usr/bin/env bash
# Отправка сообщения платформенному админу в Telegram (алерты/дайджесты, волна 1).
# usage: tg-send.sh "text"
# Креды — из backend/.env (TG_BOT_TOKEN, TG_ADMIN_CHAT_ID), сами скрипты их не хранят.
set -euo pipefail
MSG="${1:?usage: tg-send.sh 'text'}"
ENVF=/srv/bullgram/backend/.env
TG_BOT_TOKEN=$(grep -E '^TG_BOT_TOKEN=' "$ENVF" | head -1 | cut -d= -f2-)
TG_ADMIN_CHAT_ID=$(grep -E '^TG_ADMIN_CHAT_ID=' "$ENVF" | head -1 | cut -d= -f2-)
[ -n "$TG_BOT_TOKEN" ] && [ -n "$TG_ADMIN_CHAT_ID" ] || { echo "tg-send: no creds in $ENVF" >&2; exit 1; }
curl -fsS -m 15 "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" \
  --data-urlencode "chat_id=${TG_ADMIN_CHAT_ID}" \
  --data-urlencode "text=${MSG}" >/dev/null
