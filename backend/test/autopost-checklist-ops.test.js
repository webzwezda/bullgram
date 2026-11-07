/**
 * Юнит-тесты MCP-операций чек-листов автопостера (Фаза 2, офлайн, детерминированные).
 * Запуск: node test/test-autopost-checklist-ops.js
 *
 * Хендлеры checklist-* гоняются напрямую ({ supabase, req, args }) на моке supabase
 * (in-memory таблицы — стиль test-autopost-tier.js / test-autopost-bestof.js).
 *
 * Покрывает: чужой tg_chat_id → INVALID_PARAMS; чужой checklist_id под своим ботом →
 * NOT_FOUND (IDOR-гейт); dedup-повтор → already_exists без второй вставки;
 * unique-violation гонка (23505) → существующий возвращён; ветки публикации
 * publish_now / scheduled_at / queued; non-fatal pin; маппинг ошибок update
 * (NOT_FOUND / ITEM_NOT_FOUND / CHECKLIST_CANCELLED / TOO_MANY_ITEMS) и cancel.
 * Плюс agent_note (посты: batch fan-out; чек-листы: create/update/''-очистка,
 * читается через state/list), posts_list (фильтр статуса, курсор created_at|id,
 * чужой бот) и channel_update (таймзона, слоты, collapseQueue, чужой канал).
 *
 * Хост-файл: сценарные модули autopost-checklist-ops/ вызываются строго по
 * порядку через run() — последовательность секций сохраняется байт-в-байт
 * (тесты зависимы: сценарии создают данные для следующих). Фикстуры и мок —
 * в autopost-checklist-ops/shared.js (живые биндинги счётчиков).
 * Разрезка под pre-commit лимит 20000 Б.
 */
import { stopAutopostBot } from '../services/autopost/bot-lifecycle.js';
import { counters, BOT_ID } from './autopost-checklist-ops/shared.js';
import { run as run01 } from './autopost-checklist-ops/01-create-state.js';
import { run as run02 } from './autopost-checklist-ops/02-update-list-cancel.js';
import { run as run03 } from './autopost-checklist-ops/03-posts-agent-note.js';
import { run as run04 } from './autopost-checklist-ops/04-channel-update.js';

await run01();
await run02();
await run03();
await run04();

// --- Cleanup: не оставляем офлайн-бота в lifecycle-реестре процесса.
stopAutopostBot(BOT_ID);

if (counters.failures > 0) {
    console.error(`\n❌ ${counters.failures} test(s) failed`);
    process.exit(1);
}
console.log('\n✅ All checklist ops tests passed');
