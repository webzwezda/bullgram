/**
 * Offline tests for broadcast delivery on the messaging router.
 * Запуск: node test/test-broadcast-router.js
 *
 * Strategy: no network, no Supabase, no Telegram traffic.
 *   - pure helpers tested directly (isActorPermanentlyUnavailable, hasDeliverableActor,
 *     isPureUserbotSenderType, isDeliverableCampaignStatus, planCampaignFinalization)
 *   - recipient outcome mapping via createBroadcastDeliverySender with a fake router
 *   - end-to-end mapping through the REAL MessagingRouter with fake supabase +
 *     fake sendUserbot (ledger inference for blocked-by-user, quota wait)
 *
 * Covered scenarios:
 *   - router result 'sent' → delivered, actualSenderUserbot берётся из actorId
 *   - router result failed(user_blocked) → blockedByUser
 *   - router result failed(flood_wait) → failed без blockedByUser
 *   - pool_exhausted + весь пул на квоте/паузе → quotaWait (строка остаётся pending)
 *   - pool_exhausted + попытки были + леджер без privacy → failed без blockedByUser
 *   - REAL router: privacy-ошибка юзербота → pool_exhausted → леджер → blockedByUser
 *   - REAL router: flood_wait → пауза актёра → quotaWait pending
 *   - REAL router: flood-пауза зеркалится на in-memory пул (P1-1) → quotaWait вместо failed,
 *     повторная доставка в том же тике без новых попыток
 *   - REAL router: дневная квота исчерпана → quotaWait без попыток
 *   - touchpoint-приоритет: pool порядок, touchpointActorId, commonChatId, campaignId, ownerId, baseDelayMs
 *   - official_only: ошибка бота классифицируется как раньше (blockedByUser)
 *   - dead-pool helper: пустой пул / все restricted / длинная пауза → нет живых; flood-пауза → жив
 *   - planCampaignFinalization: finalize sent/completed_with_errors, wait с heartbeat, wait без вставок
 *   - isDeliverableCampaignStatus: отменённая кампания не финализируется
 *
 * Сценарии живут в test/broadcast-router/<scenario>.js; общие фикстуры —
 * test/broadcast-router/shared.js. Хост импортирует их в исходном порядке,
 * проверки выполняются на импорте модуля.
 */

// Пинним капы: тесты не должны зависеть от амбиентного .env
process.env.USERBOT_DM_HOURLY_CAP = '20';
process.env.USERBOT_DM_DAILY_CAP = '50';
process.env.USERBOT_DM_JITTER_PERCENT = '20';

const { state } = await import('./broadcast-router/shared.js');

// Сценарии в исходном порядке.
await import('./broadcast-router/pure-helpers.js');
await import('./broadcast-router/outcome-mapping.js');
await import('./broadcast-router/real-router-blocked.js');
await import('./broadcast-router/real-router-quota-happy.js');

console.log(`\n=== broadcast-router: ${state.passes} passed, ${state.failures} failed ===`);
if (state.failures > 0) process.exit(1);
