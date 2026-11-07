# Прокси Bullgram — как устроены, как диагностировать, что нельзя делать

Аудитория: агент/разработчик. Прокси — самая аварийная подсистема продукта
(«1 юзербот = 1 прокси»), поэтому здесь собраны: модель, инварианты, полный
каталог граблей (каждая — из реального инцидента) и чек-лист диагностики.
Диагностика по логам — [`runbooks.md`](runbooks.md); глубокая история — wiki
`infrastructure/managed-proxies-bullgram.md`; код —
`backend/services/managed-proxy.service.js` + `backend/services/userbot/proxy.mixin.js`.

## 1. Модель: три вида прокси

| Вид | Признак | Кто обслуживает | Замечания |
|---|---|---|---|
| **Managed IPv6-слоты** | `username` = `mp_<seq>`, host = `193.23.197.169` (доп. IPv4 НАШЕГО VPS), порт = 21080+seq | наш контейнер `bullgram-managed-3proxy` | каждый слот = слушатель на порту + выход через персональный IPv6 (`-e2a12:bec4:1bb0:b59::N`, /64 на VPS) |
| **IPv4-слоты** | тот же host, другие порты | тот же контейнер | выход через сам IPv4 |
| **Пользовательские** | любой внешний host:port, владелец строки — арендатор | никто (внешние) | пользователи подключают свои IPv6/IPv4 прокси; is_working обновляют наши проверки |

`proxies` в Supabase — источник правды для managed-слотов (хост/порт/креды/
ipv6-выход); `tg_accounts.proxy_id` → строка прокси. Порт НИКОГДА не хранится
в tg_accounts — только через proxy_id.

**Продуктовые правила**: заблокированные/мёртвые активы не остаются на витрине;
all userbot onboarding через прокси; пост-покупка = передача владения внутри
Bullgram, не сырой файл.

## 2. Архитектура managed-слоя (18 слотов, порты 21115-21145)

```
Supabase proxies (mp_*) ──рендер──> /var/lib/bullgram/managed-proxies/3proxy.cfg
                                        │ (docker -v dir:/etc/3proxy)
                                        ▼
            контейнер bullgram-managed-3proxy (host network, --ulimit nofile=65535)
            каждый слот: allow mp_N + socks -6 -n -a -p<порт> -i0.0.0.0 -e<IPv6>
```

- **Источник правды — строки БД.** Reconcile (`restore-managed-proxies.mjs`,
  hourly-таймер + при деплое) сверяет state.json/конфиг/слушателей/IPv6-адреса
  с БД и пересоздаёт контейнер только при расхождении.
- **`monitor /etc/3proxy/3proxy.cfg`** (первая строка конфига) — 3proxy сам
  перечитывает конфиг за <1 мин: добавление/удаление слотов БЕЗ рестарта.
  Рестарт обязателен только при ДОБАВЛЕНИИ новых IPv6-адресов: 3proxy кэширует
  доступность source-IPv6 при старте процесса (строка 555 сервиса).
- **ulimit nofile=65535 обязателен** (вшит в docker run; дефолт docker 1024 —
  потолок ~1000 слотов). Бенч 2026-11-07: 2000 слушателей = RSS ~93MB,
  подъём ~2 мин, handshake OK.
- **НЕ ЗАПУСКАТЬ `bullrun-managed-3proxy`** (братский проект bullrun.ru на том
  же хосте, тот же PORT_START → SO_REUSEPORT двойные бинды → лотерея процессов;
  остановлен 2026-11-07, откат `docker start bullrun-managed-3proxy` — только
  вместе с остановкой нашего).

## 3. Каталог граблей (все — из реальных инцидентов)

1. **SO_REUSEPORT лотерея**: два 3proxy-процесса на одном порту НЕ дают ошибки
   бинда — ядро молча балансирует соединения → «мерцающие» auth-ошибки.
   Диагностика: `ss -tlnp | grep <порт>` — два pid = беда. Исторически: соседний
   bullrun-контейнер. Правило: перед рендером убедиться, что чужих слушателей нет.
2. **`proxies.is_working=false` = короткое замыкание**: `checkUserbotHealth`
   возвращает dead_proxy БЕЗ попытки соединения. Отравленный флаг делает все
   последующие проверки холостыми. Лечится только осознанным `is_working=true`
   (+ причина флапа).
3. **IPv6→Telegram DC флапает** минутными окнами (прямые ETIMEDOUT
   2001:b28::). Все IPv6-слоты «умирают» разом. Анти-флап Bullgram держит
   витрину (см. §4); чинить надо среду, не слоты.
4. **3proxy кэширует source-IPv6 при старте** — потерянный адрес = мёртвый
   слот до рестарта контейнера (reconcile это делает сам при missingIpv6).
5. **teleproto: `_updateLoop` — ОБЪЕКТ UpdateLoop** (start/stop вызываются в
   connect-флоу), в gramjs — функция. Хак `client._updateLoop = async()=>{}`
   из gramjs-эпохи рвал КАЖДОЕ подключение («start is not a function»).
   Исправлено полиморфно в `prepareServiceClient` — не «упрощать» обратно.
6. **Family mismatch**: IPv6-exit слота (`-e`) + IPv4-цель = мгновенный
   «ConnectionRefused». Managed-слоты обязаны идти на IPv6-DC
   (`force_ipv6`/`useIPV6` + `session.setDC(dc, TELEGRAM_DC_IPV6[dc], 80)`).
   Тестовый скрипт без force_ipv6 сравнивает мусор (урок A/B 2026-11-07).
7. **`nc`/TCP снаружи «успешен»** — невалидный маркер: край хостинга может
   отвечать SYN-ACK'ом за несуществующие порты. Валиден только полный
   SOCKS5-хендшейк + выходной IP (`curl --socks5-hostname ... api64.ipify.org`).
8. **docker `-v файл:/путь`** при отсутствии файла-источника создаёт КАТАЛОГ
   (и 3proxy падает «Is a directory»). Маунтить каталог, как в проде.
9. **`SocksClientError.options` содержит пароль прокси** — в лог попадает
   только через `safeErr`-сериализатор (он это поля вырезает). Не логировать
   сырую ошибку прокси напрямую.
10. **Port 80 vs 443**: managed-сессия идёт на DC порт 80 (setDC port =
    useWSS ? 443 : 80; useWSS=false). При пробах «через слот до DC» проверять
    оба порта.

## 4. Карантин лотов и анти-флап (кто что пишет)

Путь: `listed-userbot-health.job.js` (тик каждые 6ч) → `checkUserbotHealth`:
- `is_working=false` → мгновенный `dead_proxy` «У юзербота мертвый прокси»
  (без соединения!) — caller пишет `runtime_status` + `last_checked_at`;
- соединение не удалось за таймаут (25с) / refused → `dead_proxy`
  («Telegram не ответил…»);
- `getMe` ок, но SpamBot/profile не успел → `online` (деградация ≠ смерть);
- `USER_DEACTIVATED`/`AUTH_KEY_INVALID` → `expired`;
- SpamBot-проверка → `restricted`/`frozen`.

Карантин витрины: `restricted`/`frozen`/`expired` — немедленно
(Telegram-авторитетные); `dead_proxy`/`error` — только при ВТОРОЙ подряд
неудаче (анти-флап: одиночный IPv6-флап лот не снимает). Авто-возврата на
витрину нет (BACKLOG §33) — восстановление вручную:
`shop_items status='published', visibility='public'` + `proxies.is_working=true`
+ сброс `last_checked_at` −2ч + прогон проверки.

## 5. Чек-лист диагностики «прокси не работает»

По порядку, останавливаясь на первом сломанном слое:

```bash
# 1. Слушатель жив? (два pid = чужой процесс, см. граблю 1)
ss -tlnp | grep <порт>
# 2. Полный SOCKS5 + выходной IP (креды из proxies/конфига, не из головы):
curl -s -m 12 --socks5-hostname "USER:PW@193.23.197.169:<порт>" https://api64.ipify.org
#    вернул IPv6 слота → транспорт и exit живы; пусто/реfuse → слой ниже
# 3. Через слот до Telegram (цель как у клиента):
curl -s -m 15 --socks5-hostname "USER:PW@..." -o /dev/null -w "%{http_code}\n" https://telegram.org/
# 4. Напрямую IPv6 → Telegram (среда): 200 = флап кончился; timeout = флап идёт
curl -s -m 10 -6 -o /dev/null -w "%{http_code}\n" https://telegram.org/
# 5. is_working строки: false = проверки короткозамкнуты (грабля 2)
```

Интерпретация: (2) fail + (4) ok → сломан слот/процесс → reconcile/рестарт;
(2) ok + (3) fail → IPv6→Telegram флап (ждать/probe-cron покажет);
(1) нет слушателя → reconcile: `systemctl restart bullgram-managed-proxies`.

## 6. Восстановление после сбоя (стандартная последовательность)

```bash
# на srv; креды слота — из proxies/3proxy.cfg
docker exec supabase-db psql -U postgres -d postgres -tAc \
  "UPDATE proxies SET is_working=true WHERE host='193.23.197.169' AND username LIKE 'mp_%';"
docker exec supabase-db psql -U postgres -d postgres -tAc \
  "UPDATE shop_items si SET status='published', visibility='public' \
   FROM shop_item_assets sia WHERE sia.shop_item_id=si.id \
   AND sia.asset_type='userbot' AND sia.asset_id IN (<id слотов>);"
docker exec supabase-db psql -U postgres -d postgres -tAc \
  "UPDATE tg_accounts SET last_checked_at = NOW() - INTERVAL '2 hours' \
   WHERE id IN (<id слотов>);"
# проверка — реальным кодом (вне pm2, но тем же деревом):
cd /srv/bullgram/backend && node -e "…"   # runListedHealthCheck; см. wiki
```

Триггер-probe сигнатуры флапа: `/opt/alerts/proxy-probe.sh` (cron */10, алерты
с dedup 1ч). Self-heal слушателей: `bullgram-managed-proxies-reconcile.timer`
(hourly) + TG-алерт на каждый факт восстановления.

## 7. Масштабирование (числа бенча 2026-11-07)

- 2000 слушателей: RSS ~93MB, время подъёма ~2 мин (порт за портом),
  handshake OK; ulimit nofile=65535 обязателен (дефолт 1024 — потолок).
- Рестарт 2k-конфига ≈ 2 мин поэтапного простоя → добавление слотов идёт
  через `monitor`-reload (без рестарта); рестарт — только при новых IPv6.
- Порог пересмотра архитектуры (кастомный SOCKS5 с per-user IPv6 bind,
  динамическая карта юзер→exit без рестартов): 2-3k слотов на инстанс.
- «Каждому новому пользователю — слот» (решение владельца): BACKLOG §32 —
  регистрационного хука пока нет, слоты выдаются интейк-батчами и ручкой
  админа (`proxies-crud`).

## 8. Связанные места

[`runbooks.md`](runbooks.md) · [`operations.md`](operations.md) ·
`ops/RESTORE.md` §3 · wiki `infrastructure/managed-proxies-bullgram.md` ·
план `docs/plans/2026-11-07-engineering-hardening.md` (прокси-аудит) ·
BACKLOG §27 (карантин без авто-возврата), §32-33.
