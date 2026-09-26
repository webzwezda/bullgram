# treasury-v2 — Казна платформы Bullgram

Внутренний инструмент платформы: учёт TON (балансы, резервы, доход по направлениям, выводы).
Доступ — только у платформенного админа (`profiles.role = 'admin'`), гейт внутри App.

- URL на проде: `/treasury` (vite `base: '/treasury/'`, basename `/treasury`)
- Вынесено из admin-v2 (2026-09-27); источник страницы — `src/pages/treasury/` (без изменений логики)
- API: те же backend-эндпоинты, что использовала админка; изоляция по owner_id/роли — на бэкенде
- Дизайн: общий источник токенов `design/tokens` + канонический кит (гейт ui-sync)

```bash
npm install
npm run dev     # локально
npm run build
```
