// Сценарий из test/test-contour-admin-rights.js (разрезка под лимит pre-commit; хост — test/test-contour-admin-rights.js).
import { classifyTelegramError } from '../../services/contour-admin-rights.service.js';
import { assertEqual } from './shared.js';

export async function runClassifyTelegramError() {
// ---------------------------------------------------------------------------
// 2. Pure: classifyTelegramError
// ---------------------------------------------------------------------------
console.log('\n[classifyTelegramError]');
{
  assertEqual(
    classifyTelegramError(new Error('Bad Request: CHAT_ADMIN_REQUIRED'), 'administrator'),
    'owner_appointed',
    'CHAT_ADMIN_REQUIRED + administrator → owner_appointed'
  );
  assertEqual(
    classifyTelegramError({ errorMessage: 'CHAT_ADMIN_REQUIRED' }, 'member'),
    'promote_forbidden',
    'CHAT_ADMIN_REQUIRED + member → promote_forbidden'
  );
  assertEqual(
    classifyTelegramError(new Error('Bad Request: not enough rights to restrict/unrestrict chat member'), 'member'),
    'promote_forbidden',
    '"not enough rights" + member → promote_forbidden'
  );
  const floodErr = new Error('FLOOD_WAIT_42');
  assertEqual(classifyTelegramError(floodErr, 'member'), 'flood_wait', 'FLOOD_WAIT → flood_wait');
  assertEqual(floodErr.retry_after, 42, 'FLOOD_WAIT extracts retry_after');
  assertEqual(
    classifyTelegramError({ errorMessage: 'USER_ALREADY_PARTICIPANT' }, 'member'),
    'already_member',
    'USER_ALREADY_PARTICIPANT → already_member'
  );
  assertEqual(
    classifyTelegramError(new Error('Something else happened'), 'administrator'),
    'unknown',
    'unrelated error → unknown'
  );
}
}
