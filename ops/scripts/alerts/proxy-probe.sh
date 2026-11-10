#!/usr/bin/env bash
# Проба managed-слота + IPv6 egress (инцидент 2026-11-07, cron */10).
# Различает два состояния: слот мёртв (🔴) vs IPv6→Telegram флап (🟡,
# сигнатура №5 из runbook — слот жив, но MTProto через IPv6 недоступен).
set -u
CFG=/var/lib/bullgram/managed-proxies/3proxy.cfg
U=$(grep -B1 " -p21143 " "$CFG" | grep allow | awk '{print $2}')
PW=$(grep "^users" "$CFG" | grep -oE "$U:CL:[A-Za-z0-9_-]+" | cut -d: -f3)
STATE=/var/lib/proxy-probe.state
DEDUP=3600
now=$(date +%s)

EXIT_IP=$(curl -s -m 12 --socks5-hostname "$U:$PW@193.23.197.169:21143" https://api64.ipify.org 2>/dev/null)
TG6=$(curl -s -m 10 -6 -o /dev/null -w "%{http_code}" https://telegram.org/ 2>/dev/null)

dedup_alert() {  # $1=ключ $2=текст
  local f="$STATE.$1"; local last=$(cat "$f" 2>/dev/null || echo 0)
  if [ $((now - last)) -ge $DEDUP ]; then
    /opt/alerts/tg-send.sh "$2" && date +%s > "$f"
  fi
}

if [ -z "$EXIT_IP" ]; then
  dedup_alert slot "🔴 Bullgram managed-слот 21143 не отвечает (SOCKS). Контейнер bullgram-managed-3proxy жив? → docker ps; reconcile: systemctl start bullgram-managed-proxies"
elif [ "$TG6" != "200" ]; then
  dedup_alert tg6 "🟡 Bullgram: IPv6→Telegram флап (сигнатура №5). Слот жив (exit $EXIT_IP), telegram.org IPv6 → HTTP $TG6. Health-check лотов будет падать до восстановления — анти-флап держит витрину."
fi
