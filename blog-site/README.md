# Bullgram Блог

Блог на Eleventy 3, живёт на `bullgram.xyz/blog`.

## Фронтенд

Тема собрана на базе [pepelsbey.dev](https://github.com/pepelsbey/pepelsbey.dev)
(код — MIT, спасибо Вадиму). Дизайн-система, стили, трансформеры и сборка — его;
контент, тексты и логотип — наши. Шрифт Neue Machina (проприетарный) удалён,
заголовки — Inter.

## Как написать пост

1. Создай папку `src/articles/<slug>/`
2. `index.md` — чистый Markdown, только текст (пишется в Obsidian)
3. `index.yml` рядом — метаданные:

```yaml
title: Заголовок поста
desc: Описание для ленты и соцсетей.
date: 2026-01-15
tags:
  - Крипта
layout: article.njk
```

4. Картинки — в ту же папку, `images/…`; обложка — `cover.png` (+ `cover: true` в yml)
5. `git push` → CI соберёт и выкатит на `bullgram.xyz/blog` через минуту

## Команды

- `npm run dev` — локальный сервер (по договорённости не используем)
- `npm run build` — сборка в `dist/`
- `npm test` — editorconfig + stylelint + eslint
