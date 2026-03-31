# admin-v2

Основной кабинет BullRun на React/Vite поверх текущего backend API.

## Принцип
- `admin-v2` является основным рабочим кабинетом
- backend переиспользуется
- legacy больше не является частью runtime и отключен в nginx (`/admin/*` -> `410 Gone`)

## Старт
```bash
cd admin-v2
npm install
npm run dev
```

## Контур
- Command Center
- Userbot Center
- CRM
- Orders
- Access
- Payments
- Shop admin
- Observer

## Зачем это отдельно
BullRun уже вырос в полноценное приложение с тяжелым state, triage-потоками и операционными экранами. Этот app нужен, чтобы:
- держать основной кабинет отдельно от старого 11ty-слоя
- развивать UX без оглядки на legacy reserve
- жить в нормальном shell, а не в наборе связанных шаблонов
