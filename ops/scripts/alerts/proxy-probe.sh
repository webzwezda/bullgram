#!/usr/bin/env bash
# Проба managed-слота + IPv6 egress (инцидент 2026-11-07, cron */10).
# Слот мёртв (🔴) — как раньше, дедуп 1ч.
# IPv6→Telegram флап — режим «начался/кончился» (решение владельца 2026-11-11):
# алерт только на переход нет→да, «кончился, длился Xч» на да→нет,
# при хронике >12ч — одна сводка в сутки. Было: дедуп 1ч → ~10 алертов/день.
set -u
CFG=/var/lib/bullgram/managed-proxies/3proxy.cfg
U=$(grep -B1 " -p21143 " "$CFG" | grep allow | awk '{print $2}')
PW=$(grep "^users" "$CFG" | grep -oE "$U:CL:[A-Za-z0-9_-]+" | cut -d: -f3)
STATE=/var/lib/proxy-probe.state
DEDUP=3600
FLAP=/var/lib/proxy-probe.tg6flap    # ts начала флапа; нет файла = флапа нет
DAILY=/var/lib/proxy-probe.tg6daily  # дата последней сводки хроники
CHRONIC_S=43200                      # 12ч
now=$(date +%s)

EXIT_IP=$(curl -s -m 12 --socks5-hostname "$U:$PW@193.23.197.169:21143" https://api64.ipify.org 2>/dev/null)
TG6=$(curl -s -m 10 -6 -o /dev/null -w "%{http_code}" https://telegram.org/ 2>/dev/null)

dedup_alert() {  # $1=ключ $2=текст
  local f="$STATE.$1"; local last=$(cat "$f" 2>/dev/null || echo 0)
  if [ $((now - last)) -ge "$DEDUP" ]; then
    /opt/alerts/tg-send.sh "$2" && date +%s > "$f"
  fi
}

if [ -z "$EXIT_IP" ]; then
  dedup_alert slot "🔴 Прокси-слот платформы (21143) не отвечает — юзерботы без выхода. Контейнер bullgram-managed-3proxy жив? → docker ps; reconcile: systemctl start bullgram-managed-proxies"
elif [ "$TG6" != "200" ]; then
  started=$(cat "$FLAP" 2>/dev/null)
  if [ -z "$started" ]; then
    /opt/alerts/tg-send.sh "🟡 Сеть: IPv6 до Telegram флапает. Проверки лотов будут падать, витрина магазина защищена. Сообщу, когда кончится." && date +%s > "$FLAP"
  else
    dur=$((now - started))
    today=$(date +%F)
    if [ "$dur" -ge "$CHRONIC_S" ] && [ "$(cat "$DAILY" 2>/dev/null)" != "$today" ]; then
      hrs=$((dur / 3600))
      /opt/alerts/tg-send.sh "🟡 Сеть: IPv6-флап продолжается уже ~${hrs}ч (хроника, кратится раз в сутки). Витрина защищена." && echo "$today" > "$DAILY"
    fi
  fi
else
  started=$(cat "$FLAP" 2>/dev/null)
  if [ -n "$started" ]; then
    hrs=$(( (now - started) / 3600 ))
    mins=$(( ((now - started) % 3600) / 60 ))
    /opt/alerts/tg-send.sh "🟢 Сеть: IPv6-флап кончился, длился ~${hrs}ч ${mins}м. Проверки лотов снова в норме."
    rm -f "$FLAP" "$DAILY"
  fi
fi
