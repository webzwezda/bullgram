# План: сабагент код-ревью (code-review skill + code-reviewer subagent)

Дата: 2026-09-13. Статус: реализовано (скилл + сабагент), ожидает проверки
в живой сессии.

## Добор после правки владельца

Владелец не увидел ревьюера в Settings → Subagents (там был только
design-critic). Причина: скилл и сабагент — разные ресурсы ZCode; скилл
попадает в Settings → Skills, сабагенты — файлы в `~/.zcode/agents/`
(формат: frontmatter name/description/tools/model + системный промпт).
Создан `~/.zcode/agents/code-reviewer.md` в формате design-critic:
staff-ревьюер, fresh eyes, только read-only (Read/Grep/Glob/Bash — Agent
tool отсутствует, анти-рекурсия обеспечена самим набором инструментов),
вердикт block/fix-first/proceed, находки с цитатами, severity P0/P1/P2,
формат возврата по контракту AGENTS.md (Scope/Changed/Findings/Validated/
Risks/Needs). Итоговая связка: быстрое ревью — сабагент `code-reviewer`,
глубокое — скилл `code-review` (параллельные линзы); fast-path скилла
может делегировать всё одному сабагенту.

## Задача

Создать сабагента для код-ревью, взяв готовое решение с минимальными
переделками. Источники (запрос владельца):

1. https://www.aihero.dev/skills-code-review
2. https://mcpmarket.com/tools/skills/subagent-code-reviewer-4
3. https://hamy.xyz/blog/2026-02_code-reviews-claude-subagents

## Исследование

- **aihero.dev** — методология двух осей: Standards («правильно ли построено»)
  vs Spec («то ли построено»), оси не смешиваются и не сводятся к одному
  «победителю»; каждое замечание обязано иметь цитату (правило / строка
  спеки / кусок диффа). Готового файла скилла в статье нет. Уроки:
  валидировать дифф до спавна агентов; находки — гипотезы, не факты;
  не зацикливать ревью до «чисто».
- **mcpmarket subagent-code-reviewer-4** — скилл из Galyarder Framework
  (github.com/galyarderlabs/galyarder-framework). Жёстко связан со своей
  инфраструктурой: Linear как IssueTracker, ExecutionProxy `rtk`,
  MCP context7/sequentialthinking, Obsidian MemoryStore, TDD-гейты.
  Адаптация была бы большой — отклонён.
- **hamy.xyz** — полный готовый артефакт: команда `/code-review`, где
  оркестратор порождает ~9 параллельных сабагентов-ревьюеров
  (архитектура, мёртвый код, конфликты, читаемость, нейминг,
  эффективность, тесты, безопасность, документация), каждый с готовым
  промптом + формат синтеза. **Взят за основу.**

Дополнительные находки (не использованы, задел): obra/superpowers
requesting-code-review, VoltAgent awesome-claude-code-subagents
code-reviewer.md, addyosmani/agent-skills code-review-and-quality.

## Решение

В ZCode нет файловых кастомных агентов (AGENTS.md это фиксирует) —
механизм «сабагента» здесь это воркспейс-скилл, который оркестратор
запускает (в т.ч. вручную как `/code-review`) и который порождает
реальных сабагентов через Agent tool. Прецедент формата —
`.agents/skills/modern-web-guidance/`.

Взята команда hamy.xyz, переделки минимальные и целевые:

1. портирование на ZCode: Task tool → Agent tool, одна панель
   инструментов; сабагенты `general-purpose`, read-only по инструкции;
2. анти-рекурсия: в конец каждого промпта вшит guard «не вызывай
   code-review skill и не порождай агентов» (урок aihero про fan-out
   на 50+ агентов);
3. добавлена ось Spec (spec-линза: «то ли построено») из aihero;
4. синтез: не сводить линзы в один ранжированный список, находки без
   цитаты отбрасываются, заявленные «поломки» проверяются оркестратором
   до подачи как факта;
5. линза тестов адаптирована под реалии репо (тестов нет → проверяется
   ближайшая осмысленная валидация: build / curl / test:autopost);
6. добавлены пакеты правил Bullgram по рантаймам (owner_id, userbot
   manual-by-default, GramJS lifecycle, shop ownership-transfer,
   `/app` без legacy `/admin`, hero продаёт один исход и т.д.);
7. fast-path для малых диффов (< ~200 строк): линзы сливаются в 4 группы.

## Реализовано

- [x] `.agents/skills/code-review/SKILL.md` — скилл-оркестратор
  (10 линз, шаблон промпта сабагента, формат синтеза, guardrails,
  пакеты правил по рантаймам)
- [x] `AGENTS.md` — одна строка в «Bullgram-specific delegation
  defaults»: close-out/pre-push/on-demand ревью идут через сабагент
  `code-reviewer` (быстрое) или скилл `code-review` (глубокое)
- [x] `~/.zcode/agents/code-reviewer.md` — настоящий сабагент в
  Settings → Subagents, формат design-critic
- [x] настоящая план-нота

## Проверка

- Фронтматтер — валидный YAML, имя `code-review` не конфликтует
  с существующими скиллами сессии (проверено по списку доступных скиллов).
- `.agents/` лежит в `.gitignore` (строка 55) — скилл локальный для
  воркспейса, как и modern-web-guidance. В git не попадает; переносить
  в `~/.zcode/skills/` не нужно, пока ревью нужно только в этом репо.
- Скилл подхватится ZCode в новой сессии (как modern-web-guidance);
  в текущей сессии список скиллов уже зафиксирован.
- Живая проверка: после следующего нетривиального изменения попросить
  «сделай ревью» — оркестратор должен вызвать скилл, породить
  параллельных ревьюеров и выдать отчёт в формате Step 4.

## Уроки

1. Скиллы mcpmarket часто являются витринами фреймворков — перед
   адаптацией смотреть исходник на GitHub и оценивать связность
   (Galyarder = Linear + rtk + Obsidian, отброшен).
2. Готовая команда hamy.xyz переносится на ZCode почти без изменений:
   вся «магия» — в промптах линз, они рантайм-агностичны.
3. (уточнено после добора) У ZCode ЕСТЬ файловые субагенты:
   `~/.zcode/agents/*.md` (user scope), формат frontmatter
   name/description/tools/model + системный промпт. Утверждение
   AGENTS.md «no file-based custom agent definitions» верно лишь
   для workspace-скопа внутри репо — исправлено в AGENTS.md.
4. Скилл ≠ сабагент в UI ZCode: скиллы видны в Settings → Skills и
   в `/`-меню, сабагенты — в Settings → Subagents. Если владелец
   ожидает увидеть агента в настройках — файл должен лежать в
   `~/.zcode/agents/`. Правка набора tools (без Agent tool) сама
   гарантирует анти-рекурсию субагента.
