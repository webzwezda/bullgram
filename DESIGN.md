# Bullgram Design System & UI Guidelines

This document outlines the core UI/UX principles and design system conventions for the Bullgram `admin-v2` application. 

Our goal is to maintain a premium, modern, and highly tactile interface (similar to Linear or Vercel) while keeping the application highly functional and fast.

## Core Technologies
- **UI Kit**: [shadcn/ui](https://ui.shadcn.com/) (Radix UI primitives).
- **Styling**: Tailwind CSS.
- **Icons**: Lucide React.

## 1. Layout & Structure

### Card-Based Interfaces
Avoid full-page monolithic gray backgrounds. Group related settings and actions into distinct **Cards**.

```jsx
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

// Standard card wrapper
<Card className="border-slate-200/60 shadow-sm mb-6">
  <CardHeader>...</CardHeader>
  <CardContent>...</CardContent>
</Card>
```

### Empty States
When there is no data (e.g., no proxies, no bots, no channels), show a beautiful empty state rather than just text.
- Use a muted icon wrapped in a circular background.
- Provide a clear, bold title and a muted description.

```jsx
<CardContent className="p-12 text-center flex flex-col items-center justify-center">
  <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mb-3">
    <Users className="w-6 h-6 text-slate-400" />
  </div>
  <p className="text-sm text-slate-500 font-semibold">Площадок пока нет</p>
  <p className="mt-1 text-xs text-slate-400">Назначьте бота админом в канале или чате.</p>
</CardContent>
```

## 2. Forms & Inputs

**Never use raw HTML `<select>`, `<input>`, or `<button>` tags.** Always use their `shadcn/ui` equivalents for accessibility, consistent focus states (`ring`), and unified styling.

- **Buttons**: `<Button>`
- **Text Fields**: `<Input className="h-11 bg-slate-50" />`
- **Dropdowns**: `<Select>`, `<SelectTrigger>`, `<SelectContent>`

*Note: Use `bg-slate-50` for inputs and select triggers to make them slightly inset compared to the white card backgrounds.*

## 3. Typography & Colors

### Text Colors
- Primary Text: `text-slate-900`
- Secondary / Muted Text: `text-slate-500`
- Micro / Helper Text: `text-slate-400`

### Semantic Colors (Badges & Dots)
Use semantic colors to communicate status clearly.
- **Success / OK**: `emerald` (`text-emerald-700`, `bg-emerald-50`, `border-emerald-200`)
- **Warning / Pending**: `amber` (`text-amber-800`, `bg-amber-50`, `border-amber-200`)
- **Error / Destructive**: `rose` (`text-rose-700`, `bg-rose-50`, `border-rose-200`)
- **Neutral / Draft**: `slate` (`text-slate-600`, `bg-slate-100`)

### Badges
Use the `<Badge>` component for tags and statuses.

```jsx
<Badge variant="secondary" className="bg-emerald-100 text-emerald-800 text-[10px] uppercase font-bold py-0.5 px-2">
  <CheckCircle2 className="w-3 h-3 mr-1" />
  Подключен
</Badge>
```

## 4. Visual Flourishes

### Gradient Section Icons
To anchor major sections and make the page look premium, use large gradient icons in `CardHeader`.

```jsx
<div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20 shrink-0">
  <Bot className="w-6 h-6" />
</div>
```
*Tip: Match the shadow color to the gradient (e.g., `shadow-blue-500/20` for a blue gradient, `shadow-indigo-500/20` for an indigo gradient).*

### Micro-interactions
- **Loading States**: Always replace the action icon with `<Loader2 className="w-4 h-4 mr-2 animate-spin" />` inside buttons when a mutation is happening. Disable the button.
- **Hover States**: Lists and rows should have a subtle hover effect: `hover:bg-slate-50 transition-colors`. Buttons should use the built-in shadcn variants (e.g., `variant="outline"`).

## 5. Cognitive Load & Progressive Disclosure
- Don't overwhelm the user with raw JSON, IDs, or excessive tags. 
- Format dates to readable strings (e.g., `ru-RU`).
- Group technical details together and use visual indicators (status dots) instead of long text strings whenever possible.
