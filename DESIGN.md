# Bullgram Design System & UI Guidelines

Документ фиксирует UI/UX-правила и дизайн-систему для `admin-v2`.

Словарь цвета — **семантические токены** из `design/tokens/`. Источник значений и студийных правил — [`design/README.md`](design/README.md). Железное правило оттуда: **примитив неприкосновенен — изменение значения примитива = изменение визуала всего продукта**; новые значения вводятся только алиасом на существующий шаг рампы.

Цель прежняя: премиальный, современный, тактильный интерфейс (уровень Linear/Vercel), при этом быстрый и функциональный.

## Статус миграции цвета

- Канон — семантика: `text.ink.*`, `surface.*`, `border.*`, `feedback.*`, `action.*`, `component.*` (см. `design/tokens/color.semantic.json`).
- Утилиты вида `text-ink-*` появляются в ките после волн 4/5. До этого — и до поэтапной миграции страниц — классы `slate-*`/`indigo-*` в `pages/` остаются де-факто рабочими.
- **Новые экраны пишутся сразу на семантических утилитах.**
- В примерах ниже — рабочие классы текущего кита; рядом каждый раз указан токен.

## Core Technologies
- **UI Kit**: [shadcn/ui](https://ui.shadcn.com/) (Radix UI primitives).
- **Styling**: Tailwind CSS.
- **Icons**: Lucide React.

## 1. Layout & Structure

### Card-Based Interfaces
Не делаем монолитный серый фон на всю страницу. Связанные настройки и действия группируем в отдельные **Card**.

```jsx
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

// Стандартная обёртка карточки (граница — border.default)
<Card className="border-slate-200/60 shadow-sm mb-6">
  <CardHeader>...</CardHeader>
  <CardContent>...</CardContent>
</Card>
```

### Empty States
Когда данных нет (нет прокси, ботов, каналов) — показываем красивый empty state, а не голый текст.
- Приглушённая иконка на круглом фоне.
- Чёткий жирный заголовок + приглушённое описание.

```jsx
<CardContent className="p-12 text-center flex flex-col items-center justify-center">
  {/* иконка — декоративная: text.ink.faint */}
  <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mb-3">
    <Users className="w-6 h-6 text-slate-400" />
  </div>
  <p className="text-sm text-slate-500 font-semibold">Площадок пока нет</p>
  {/* описание — контентный текст: floor text.ink.muted, не светлее */}
  <p className="mt-1 text-xs text-slate-500">Назначьте бота админом в канале или чате.</p>
</CardContent>
```

## 2. Forms & Inputs

**Никогда не используем сырые HTML `<select>`, `<input>`, `<button>`.** Только эквиваленты из `shadcn/ui` — ради доступности, единых focus-состояний (`ring`) и единого стиля.

- **Кнопки**: `<Button>`
- **Текстовые поля**: `<Input className="h-11 bg-slate-50" />` (заливка — `surface.subtle`)
- **Дропдауны**: `<Select>`, `<SelectTrigger>`, `<SelectContent>`

*Note: `bg-slate-50` (`surface.subtle`) у инпутов и триггеров селектов — чтобы они выглядели слегка «утопленными» относительно белых карточек (`surface.card`).*

## 3. Typography & Colors

### Text (чернила)

| Роль | Токен | Де-факто класс |
|---|---|---|
| Заголовки, ключевые числа, деньги | `ink.strong` | `text-slate-900` |
| Основной контент: параграфы, ячейки | `ink.body` | `text-slate-700` |
| Вторичный текст, хинты, helper-текст | `ink.muted` | `text-slate-500` |
| Только декоративное | `ink.faint` | `text-slate-400` |

**Floor контентного текста — `ink.muted` (slate-500).** Правило ужесточено: helper-текст, который раньше писали `text-slate-400`, теперь минимум `text.ink.muted`. `ink.faint` (slate-400) — только watermark-иконки и disabled-намёки, для чтения не предназначен.

### Feedback (статусы)
Статусные цвета живём **только парами фон+текст из одного набора** — шаги из разных пар не смешивать; текст-шаг каждой пары проходит AA на своём фоне.

- **Success / OK**: `feedback.success` = emerald-50 + emerald-700 (emerald на светлом фоне не светлее 700)
- **Warning / Pending**: `feedback.warning` = amber-50 + amber-700 (более светлый amber контраст не проходит)
- **Error**: `feedback.error` = red-50 + red-700 (исторически встречался rose — канон теперь red-пара)
- **Info**: `feedback.info` = sky-50 + sky-700

Для деструктивных **кнопок** (удалить, отозвать, кик) — `action.destructive` (red-600), не error-пара.

**Neutral / Draft**: заливка `surface.subtle-strong` (slate-100) + `text-slate-600`. Отдельной neutral-пары в токенах пока нет — классы де-факто.

### Actions
- **Основное действие**: `action.primary` = indigo-600, hover — indigo-700. Ссылки и focus-акценты — в том же индиго.
- **TON-экраны** (оплата, кошелёк): `action.ton` = sky-700, hover — sky-800. Утверждённое решение — **не менять на indigo**.

### Деньги и числа
- **Правило нулей** (`component.money-zero`): денежные нули тёмные (`ink.strong`) — ноль в балансе это число, а не отсутствие данных. Приглушаются только «деятельные» нули — нулевые счётчики действий/событий.
- Числа и суммы — `tabular-nums`.

### Микро-лейблы
`component.micro-label`: 11px, uppercase, `tracking-widest`, `ink.muted`. Единый паттерн надсеточных подписей и мелких рубрикаторов.

### Badges
Теги и статусы — через `<Badge>`. Цвет — фоном и текстом из одной feedback-пары.

```jsx
<Badge variant="secondary" className="bg-emerald-50 text-emerald-700 text-[10px] uppercase font-bold py-0.5 px-2">
  <CheckCircle2 className="w-3 h-3 mr-1" />
  Подключен
</Badge>
```

## 4. Visual Flourishes

### Gradient Section Icons
Чтобы якорить крупные секции и держать премиальный вид — большие градиентные иконки в `CardHeader`.

```jsx
<div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20 shrink-0">
  <Bot className="w-6 h-6" />
</div>
```
*Tip: тень совпадает по цвету с градиентом (`shadow-blue-500/20` под синий градиент, `shadow-indigo-500/20` под индиго). Паттерн сознательно не токенизирован: градиент — два шага одной рампы, тень — `shadow-lg` с цветом шага и прозрачностью.*

### Micro-interactions
- **Loading States**: при мутации заменяем иконку действия на `<Loader2 className="w-4 h-4 mr-2 animate-spin" />` внутри кнопки и дисейблим её.
- **Hover States**: списки и строки — лёгкий hover: `hover:bg-slate-50 transition-colors` (заливка — `surface.subtle`). Кнопки используют встроенные shadcn-варианты (например, `variant="outline"`).

## 5. Cognitive Load & Progressive Disclosure
- Не заваливаем пользователя сырым JSON, ID и лишними тегами.
- Даты форматируем в читаемые строки (например, `ru-RU`).
- Технические детали группируем; где можно — визуальные индикаторы (статус-точки) вместо длинных текстовых строк.
