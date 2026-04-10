# Telegram MCP Reference

## Что это

Внешний reference repo: `archive/reference-repos/telegram-mcp/`.

Это не часть активного runtime `BullRun` и не источник технологий для прямого копирования. Репозиторий полезен как образец того, как можно оформлять MCP-server capabilities, tool surface и guardrails.

## Зачем держим reference

- иметь под рукой пример большого MCP tool-surface
- сверять naming и granularity tools при развитии `BullRun MCP`
- брать идеи по README-структуре, capability-подаче и ограничениям

## Что из него можно брать

- явные и узкие tool names вместо расплывчатых generic actions
- понятную группировку tools по доменам
- описание input validation и expected formats
- явные guardrails для file/path operations
- README-подачу: capabilities, security model, setup, examples

## Что не переносим напрямую

- Python/Telethon stack
- Telegram account control model как основу продуктового доступа
- прямое копирование tool contracts без адаптации под `BullRun` data model
- client/server assumptions, которые противоречат текущему `BullRun MCP` path через `POST /api/mcp`

## Как использовать этот reference в BullRun

- использовать как UX/API reference при проектировании новых MCP tools
- проверять, достаточно ли tool names конкретны для обычного админа
- заимствовать guardrail-подход раньше, чем добавлять write-capabilities
- не смешивать этот reference с active architecture decisions

## Связанные файлы

- `/archive/reference-repos/telegram-mcp/README.md`
- `/AGENTS.md`
