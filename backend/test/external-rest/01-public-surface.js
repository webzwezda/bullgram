/**
 * Сценарий: публичная поверхность REST — /health, /openapi.json, реестр
 * checklist-путей в OpenAPI, /docs (Scalar). Из test-external-rest.
 * Экспортирует run() — хост вызывает сценарии строго по порядку.
 */
import { assertEqual } from './shared.js';
import { makeMockSupabase, makeMockUserbotService, startApp, fetchJSON } from './shared.js';
import { buildOpenApiSpec } from '../../external/openapi.js';

export async function run() {

console.log('--- GET /health (public, no auth) ---');
{
  const supabase = makeMockSupabase();
  const userbotService = makeMockUserbotService();
  const { port, close } = await startApp({ supabase, userbotService });
  const { status, body } = await fetchJSON(port, '/api/external/v1/health');
  assertEqual(status, 200, 'HTTP 200');
  assertEqual(body.service, 'bullgram-external-api', 'service field');
  assertEqual(body.version, 'v1', 'version field');
  close();
}

console.log('--- GET /openapi.json (public) ---');
{
  const supabase = makeMockSupabase();
  const userbotService = makeMockUserbotService();
  const { port, close } = await startApp({ supabase, userbotService });
  const { status, body } = await fetchJSON(port, '/api/external/v1/openapi.json');
  assertEqual(status, 200, 'HTTP 200');
  assertEqual(body.openapi, '3.0.3', 'openapi version');
  // Реестр операций растёт (автопост-инструменты и дальше добавляются) —
  // проверяем нижнюю границу и ручные маршруты, а не точное число путей.
  const paths = Object.keys(body.paths);
  assertEqual(paths.includes('/health') && paths.includes('/me'), true, 'manual paths present');
  assertEqual(paths.length >= 12, true, 'paths count >= registry baseline');
  assertEqual(!!body.components.securitySchemes.BearerAuth, true, 'BearerAuth scheme present');
  assertEqual(Array.isArray(body.tags), true, 'tags array present');
  close();
}

console.log('--- OpenAPI registry: 5 checklist REST paths present ---');
{
  // Спек собираем так же, как генератор /openapi.json: реестр операций уже
  // зарегистрирован side-effect импортом '../mcp/tools/index.js' в хосте.
  const spec = buildOpenApiSpec();
  assertEqual(!!spec.paths['/autopost/bots/{bot_id}/checklists'], true, 'checklists collection path present');
  assertEqual(!!spec.paths['/autopost/bots/{bot_id}/checklists'].post, true, 'POST checklists (create)');
  assertEqual(!!spec.paths['/autopost/bots/{bot_id}/checklists'].get, true, 'GET checklists (list)');
  assertEqual(!!spec.paths['/autopost/bots/{bot_id}/checklists/{checklist_id}'], true, 'checklist item path present');
  assertEqual(!!spec.paths['/autopost/bots/{bot_id}/checklists/{checklist_id}'].get, true, 'GET checklist state');
  assertEqual(!!spec.paths['/autopost/bots/{bot_id}/checklists/{checklist_id}'].patch, true, 'PATCH checklist (update)');
  assertEqual(!!spec.paths['/autopost/bots/{bot_id}/checklists/{checklist_id}/cancel'], true, 'cancel path present');
  assertEqual(!!spec.paths['/autopost/bots/{bot_id}/checklists/{checklist_id}/cancel'].post, true, 'POST cancel');
}

console.log('--- GET /docs (Scalar HTML) ---');
{
  const supabase = makeMockSupabase();
  const userbotService = makeMockUserbotService();
  const { port, close } = await startApp({ supabase, userbotService });
  const res = await fetch(`http://127.0.0.1:${port}/api/external/v1/docs`);
  const text = await res.text();
  assertEqual(res.status, 200, 'HTTP 200');
  assertEqual(text.includes('<!doctype html>'), true, 'HTML doc returned');
  assertEqual(text.includes('api-reference'), true, 'Scalar api-reference div present');
  close();
}

}
