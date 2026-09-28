# profile-v2 — Профиль Bullgram

Страница профиля администратора: идентичность (Supabase-аккаунт), кошелёк TON
(TonConnect), привязка Telegram, история покупок и апгрейд тарифа.

- URL на проде: `/profile` (vite `base: '/profile/'`, basename `/profile`)
- Вынесено из userbot-v2 (2026-09-28); источник страницы — `src/pages/ProfilePage.jsx`
  и `src/features/profile/` + `src/features/billing/` (без изменений логики)
- `features/ton-checkout/TonConnectPayButton|TonWalletChip|useTonCheckout` — копии
  из userbot-v2 (там остаются в использовании); правки синхронизировать вручную
- Дизайн: общий источник токенов `design/tokens` + канонический кит (гейт ui-sync)

```bash
npm install
npm run dev     # локально (порт 4574)
npm run build
```
