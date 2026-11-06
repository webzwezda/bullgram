// Сценарий из test/test-contour-admin-rights.js (разрезка под лимит pre-commit; хост — test/test-contour-admin-rights.js).
import { CONTOUR_OFFICIAL_BOT_MAX_RIGHTS, CONTOUR_USERBOT_MAX_RIGHTS, ensureFlagsSufficient } from '../../services/contour-admin-rights.service.js';
import { assertEqual } from './shared.js';

export async function runEnsureFlagsSufficient() {
// ---------------------------------------------------------------------------
// 1. Pure: ensureFlagsSufficient
// ---------------------------------------------------------------------------
console.log('\n[ensureFlagsSufficient]');
{
  assertEqual(
    ensureFlagsSufficient({ status: 'creator' }, CONTOUR_USERBOT_MAX_RIGHTS),
    { sufficient: true, missing: [] },
    'creator with no flags object counts as all-sufficient'
  );
  assertEqual(
    ensureFlagsSufficient({
      status: 'administrator', is_admin: true,
      can_invite_users: true, can_restrict_members: false
    }, CONTOUR_USERBOT_MAX_RIGHTS),
    { sufficient: false, missing: ['can_restrict_members'] },
    'missing can_restrict_members detected'
  );
  assertEqual(
    ensureFlagsSufficient({ is_admin: false }, {}),
    { sufficient: true, missing: [] },
    'empty desired → sufficient'
  );
  assertEqual(
    ensureFlagsSufficient({
      status: 'administrator', is_admin: true,
      can_manage_chat: true, can_invite_users: true,
      can_restrict_members: true, can_promote_members: true
    }, CONTOUR_OFFICIAL_BOT_MAX_RIGHTS),
    { sufficient: true, missing: [] },
    'admin with all official-bot flags → sufficient'
  );
}
}
