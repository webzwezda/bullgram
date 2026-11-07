/**
 * Integration tests for the external REST API.
 * Plan 02 Phase 4.
 *
 * Запуск: node test/test-external-rest.js
 *
 * Strategy: spin up a fresh Express app per test fixture, inject a mock Supabase
 * that routes table queries by name + first eq() value, mock userbotService.
 * Real HTTP requests via global fetch. Realistic end-to-end coverage including
 * OpenAPI generation, auth middleware, scope enforcement, dispatcher chain,
 * argument coercion, error envelope formatting.
 *
 * Хост-файл: side-effect импорт реестра операций (как в оригинале — до всего
 * остального), затем сценарные модули external-rest/ вызываются строго по
 * порядку через run() — последовательность проверок сохраняется байт-в-байт.
 * Финальная сводка читает живые счётчики из external-rest/shared.js.
 * Разрезка под pre-commit лимит 20000 Б.
 */
import '../mcp/tools/index.js'; // side-effect register operations
import { counters } from './external-rest/shared.js';
import { run as run01 } from './external-rest/01-public-surface.js';
import { run as run02 } from './external-rest/02-auth.js';
import { run as run03 } from './external-rest/03-ops-errors.js';

await run01();
await run02();
await run03();

console.log(`\n${counters.passes} passed, ${counters.failures} failed`);
process.exit(counters.failures > 0 ? 1 : 0);
