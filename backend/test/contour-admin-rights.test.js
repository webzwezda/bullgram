/**
 * Offline tests for the contour ensure-admin mechanism (ContourAdminRightsService).
 * Запуск: node test/test-contour-admin-rights.js
 *
 * Strategy: no network, no Supabase, no Telegraf traffic.
 *   - pure functions tested directly (ensureFlagsSufficient, classifyTelegramError)
 *   - orchestration tested with fake supabase (chained from()), fake botApi,
 *     fake userbot client (getInputEntity + invoke с реальными GramJS-классами
 *     запросов), instant sleep
 *
 * Covered scenarios:
 *   - flags sufficiency matrix (creator all-sufficient, missing can_restrict_members, empty desired)
 *   - telegram error classification matrix
 *   - userbot not member + autoJoin=false → missing_membership, no join attempted
 *   - userbot member, not admin, promote ok → promote with CONTOUR_USERBOT_MAX_RIGHTS,
 *     re-read confirms admin → state ok, upsert row written with flags
 *   - admin read shape: resolved peer + channels.GetParticipant(InputPeerSelf) для
 *     каналов; InputPeerChat → messages.GetFullChat (self ищется по userId) для базисных групп
 *   - promote throws CHAT_ADMIN_REQUIRED + re-read administrator:
 *     flags sufficient → ok («права достаточны»), flags insufficient → owner_appointed
 *   - official_bot actor with missing can_restrict_members → promote_forbidden + warning,
 *     no promote attempt
 *   - membership check failure (бот не видит состав) + autoJoin=false → error,
 *     НЕ missing_membership
 *   - flood_wait stops remaining targets for that actor
 *   - peer-invite (3-й способ): бот-инвайт падает → юзербот-сосед из подтверждённых
 *     ячеек прав (ok/owner_appointed) экспортирует инвайт, вступающий импортирует,
 *     ссылка отзывается, клиент соседа отключается
 *   - экспорт у соседа падает → предупреждение в ячейку, structured failure, не throw
 *   - вступающий исключён из кандидатов (нет self-invite); state=error и
 *     pending_activation не становятся кандидатами
 *
 * Разрезка под лимит pre-commit (20КБ): хост остался на исходном пути и
 * запускает сценарии из test/contour-admin-rights/ в исходном порядке; общие
 * фикстуры — test/contour-admin-rights/shared.js. Порядок проверок и сообщения
 * — как в оригинале.
 */
import { getPasses, getFailures } from './contour-admin-rights/shared.js';
import { runEnsureFlagsSufficient } from './contour-admin-rights/ensure-flags-sufficient.js';
import { runClassifyTelegramError } from './contour-admin-rights/classify-telegram-error.js';
import { runMissingMembership } from './contour-admin-rights/missing-membership-no-join.js';
import { runPromoteOkUpsert } from './contour-admin-rights/promote-ok-upsert.js';
import { runAdminReadShape } from './contour-admin-rights/admin-read-shape.js';
import { runOwnerAppointedPartialFlags } from './contour-admin-rights/chat-admin-required-owner-appointed.js';
import { runOwnerAppointedSufficientOk } from './contour-admin-rights/chat-admin-required-sufficient-ok.js';
import { runOfficialBotMissingFlag } from './contour-admin-rights/official-bot-missing-flag.js';
import { runMembershipCheckFailure } from './contour-admin-rights/membership-check-failure.js';
import { runFloodWaitStopsTargets } from './contour-admin-rights/flood-wait-stops-targets.js';
import { runBasicGroupGetFullChat } from './contour-admin-rights/basic-group-get-full-chat.js';
import { runPeerInviteJoinOk } from './contour-admin-rights/peer-invite-join-ok.js';
import { runPeerInviteExportFails } from './contour-admin-rights/peer-invite-export-fails.js';
import { runPeerInviteCandidates } from './contour-admin-rights/peer-invite-candidates.js';

await runEnsureFlagsSufficient();
await runClassifyTelegramError();
await runMissingMembership();
await runPromoteOkUpsert();
await runAdminReadShape();
await runOwnerAppointedPartialFlags();
await runOwnerAppointedSufficientOk();
await runOfficialBotMissingFlag();
await runMembershipCheckFailure();
await runFloodWaitStopsTargets();
await runBasicGroupGetFullChat();
await runPeerInviteJoinOk();
await runPeerInviteExportFails();
await runPeerInviteCandidates();

console.log(`\n=== contour-admin-rights: ${getPasses()} passed, ${getFailures()} failed ===`);
if (getFailures() > 0) process.exit(1);
