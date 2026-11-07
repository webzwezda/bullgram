/**
 * Unit tests for shared/ modules used by both MCP and REST transports.
 * Plan 01 Phase 7.
 *
 * Запуск: node test/test-mcp-shared.js
 *
 * Covers: errors, pagination, utils, rate-limiter, scope-guard, content-sanitizer.
 * Pure functions only — no Supabase, no network, no Telegram.
 *
 * Хост-файл: импортирует сценарные модули из mcp-shared/ и вызывает их run()
 * в исходном порядке выполнения — строго последовательно, чтобы порядок
 * проверок остался байт-в-байт (top-level await соседей порядок не держит).
 * Финальная сводка читает живые счётчики из mcp-shared/shared.js.
 * Разрезка под pre-commit лимит 20000 Б.
 */
import { counters } from './mcp-shared/shared.js';
import { run as run01 } from './mcp-shared/01-errors-pagination.js';
import { run as run02 } from './mcp-shared/02-utils.js';
import { run as run03 } from './mcp-shared/03-rate-scope.js';
import { run as run04 } from './mcp-shared/04-content-sanitizer.js';

await run01();
await run02();
await run03();
await run04();

console.log(`\n${counters.passes} passed, ${counters.failures} failed`);
process.exit(counters.failures > 0 ? 1 : 0);
