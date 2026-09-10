# Trial — бессрочный (2026-09-10)

Задача: «Триал говорит что на 14 дней — сделай бессрочным».

## Контекст

Профильный Trial (`profiles.product_tier = 'trial'`) нигде не enforced бэкендом: ни один job
не читает `profiles.trial_ends_at`. Срок был только в копирайте («на 14 дней» на сайте) и в
выдаче из Shop, которая реально писала 7 дней. Канальные «пробники» (`tariffs.is_trial` +
`subscriptions.expires_at`, auto-kick) — другое понятие, их не трогали.

## Изменения

- [x] `backend/routes/shop.routes.js` — выдача Trial из Shop пишет `trial_ends_at: null` (сроков больше нет; повторная выдача чистит старую дату)
- [x] `site-v2/src/pages/HomePage.jsx` — карточка Trial: «на 14 дней» → «бессрочно»
- [x] `site-v2/src/ui/UserProfileCard.jsx` — пилюля тарифа: Trial всегда «Бессрочно», состояние «Trial истек» удалено
- [x] `admin-v2/src/ui/OpsRail.jsx` — то же
- [x] `admin-v2/src/features/profile/ProfileIdentityCard.jsx` — то же
- [x] `admin-v2/src/pages/bots/UserbotCenterSection.jsx` — убраны `trialHoursLeft`/`trialUpgradeUrgent` и срочный вариант баннера (остался info-баннер)
- [x] `admin-v2/src/pages/BroadcastPage.jsx` — убраны «Trial скоро сгорит» и таймер; статичный блок «отправка рассылок закрыта на Trial» оставлен
- [x] `docs-site/content/quick-start.md` — «free for 14 days» → «free indefinitely»

Не тронуто (намеренно): канальные пробники (retention/abandoned DM, auto-kick, Customers/Abandoned),
месячная квота `TRIAL_API_REQUESTS_PER_MONTH`, лимиты tier'а (`product-tier.js`).

## Проверка

- `node --check backend/routes/shop.routes.js` — OK
- `npm run build` в site-v2 и admin-v2 — зелёные

## Review

- Ревью-пасс (subagent, reviewer framing): см. итоги в сессии; старые профили с прошедшей
  `trial_ends_at` больше не покажут «Trial истек» нигде — дата инертна.
- Опционально, не блокирует: backfill в БД `update profiles set trial_ends_at = null where product_tier = 'trial'`
  через Supabase MCP для чистоты данных (UI на него уже не завязан).
