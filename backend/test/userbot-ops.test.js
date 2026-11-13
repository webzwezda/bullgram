/**
 * Юнит-тесты userbot-ops (план 2026-09-17): Волна 1 (group_create / member_invite /
 * member_promote / group_invite_link / botfather_create_bot / bot_init + фикс leave-chat)
 * и Волна 2 (message_edit / message_delete / message_forward / message_pin /
 * chat_read / user_resolve + фикс addAdmins в chat-admin-rights.service).
 * Офлайн, детерминированные: сервисные методы гоняем на замоканном клиенте
 * (createAuthorizedClient подменён), bot_init — на моке supabase + стабе
 * validateAndCreateBot (стиль test-autopost-checklist-ops.js).
 *
 * Покрывает: флаг-гейты TOOL_DISABLED, валидации аргументов, happy-path каждого
 * метода, per-member результаты приглашения (включая already-participant),
 * FORBIDDEN без addAdmins, «taken» от BotFather, таймаут ответа BotFather,
 * incoming-фильтр и in-flight гард BotFather (RATE_LIMITED), redaction токена
 * из raw_reply, отзыв инвайт-ссылки (по link и текущей без link), ветку
 * basic-группы в leaveChat (DeleteChatUser + InputUserSelf), маппинг ошибок
 * bot_init (квота / неверный токен) и sanitizeBot (без bot_token/invite_secret),
 * confirm-гейт delete, peer-ветки markChatRead, обе ветки user_resolve,
 * «ровно один аргумент», валидацию формата username, username-скан участника
 * и фикс canPromoteMembers→addAdmins (не ALL-false adminRights).
 *
 * Хост-файл: сценарные модули userbot-ops/ вызываются строго по порядку через
 * run() — последовательность секций сохраняется байт-в-байт (тесты зависимы
 * по флагам-kill-switch и сайд-эффектам). Мок-клиент/флаги/фикстуры — в
 * userbot-ops/shared.js (живые биндинги счётчиков и savedFlags).
 * Разрезка под pre-commit лимит 20000 Б.
 */
import { counters, savedFlags, setFlags } from './userbot-ops/shared.js';
import { run as run01 } from './userbot-ops/01-group-admin.js';
import { run as run02 } from './userbot-ops/02-botfather-leave.js';
import { run as run03 } from './userbot-ops/03-messages-admin-rights.js';
import { run as run04 } from './userbot-ops/04-bot-init.js';
import { runRestoreArchive } from './userbot-ops/05-restore-archive.js';

await run01();
await run02();
await run03();
await run04();
// Сценарий роутовый (свой мок supabase из shop-delivery/shared.js), флаги
// не трогает — падение бросает исключение и валит хост с ненулевым кодом.
await runRestoreArchive();

// --- Восстановление окружения ---
setFlags({});
for (const [key, value] of Object.entries(savedFlags)) {
    if (value !== undefined) process.env[key] = value;
}

if (counters.failures > 0) {
    console.error(`\n❌ ${counters.failures} test(s) failed`);
    process.exit(1);
}
console.log('\n✅ All userbot ops tests passed');
