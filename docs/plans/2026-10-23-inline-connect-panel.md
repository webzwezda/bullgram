# Инлайн-панель подключения на /userbot

Дата: 2026-10-23. Статус: в работе.

## Задача (владелец, 2026-10-23)

Кнопка «Подключить аккаунт» на `/userbot` сейчас редиректит на `/userbot/connect`.
Нужно: по клику окно подключения появляется прямо в `<section id="userbot-center">`
в новом диве НАД карточкой аккаунта. Само окно — фронт со страницы `/connect`,
саму страницу `/connect` не редактировать.

## Решение

- Новый `UserbotConnectPanel.jsx` (pages/bots/): внутри вызывает `useUserbotOnboarding`
  и рендерит `UserbotOnboardingSection` КАК ЕСТЬ (тот самый блок «Подключение
  аккаунта» с шагами 1–4 и теми же `steps`). Обёртка: относительный див с
  плавным скроллом к себе и крестиком (ghost icon Button) для закрытия.
- Хук вызывает `reloadAccounts` только на успехе (импорт или QR-вход) →
  обёртка `reloadAccountsAndClose` даёт авто-закрытие панели после успешного
  подключения.
- `UserbotCenterSection`: состояние `connectPanelOpen` (до early-returns,
  правила хуков), новый див между trial-баннерами и карточкой аккаунта, обе
  CTA-кнопки («Подключить аккаунт» у селектора и в пустом состоянии) —
  `<button>` c `openConnectPanel()` вместо `<Link to="/connect">`. Повторный
  клик по кнопке при открытом окне скроллит к окну (не закрывает; закрытие —
  крестик). Ссылка «Перейти к подключению» в ошибочной ветке остаётся как есть.
- `UserbotsPage`: отдаёт в секцию три пропса — `availableOnboardingProxies`
  (уже считается в derived-state), `reloadAccounts`, `userbotCount`
  (`userbots.length` — семантика лимита тарифа как на /connect).
- Состояние панели собственное (QR, файлы, fingerprint) — независимо от
  /connect; закрытие в середине QR-логина чисто гасит поллинг (unmount-effect
  хука).

## Чек-лист

- [ ] `UserbotConnectPanel.jsx` создан
- [ ] `UserbotCenterSection.jsx`: пропсы, состояние, див, две кнопки
- [ ] `UserbotsPage.jsx`: три пропса
- [ ] `/connect` не тронут (ConnectPage.jsx, UserbotOnboardingSection.jsx — без правок)
- [ ] build + check:design зелёные
- [ ] Коммит + push → деплой
- [ ] Прод-верификация в Chrome владельца + критик
- [ ] Ревью здесь
