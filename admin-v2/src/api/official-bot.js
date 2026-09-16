import { apiRequest } from './client.js';

// Запуск join-all в фоне. 202 { success: true, status: 'running' }.
// 409 с code=join_all_already_running — фоновая задача уже выполняется.
export async function startContourJoinAll(accessToken, botId) {
  return apiRequest('/api/official-bot/contours/join-all', {
    accessToken,
    method: 'POST',
    body: { bot_id: botId }
  });
}

// GET статуса фоновой задачи join-all:
// { success: true, status: 'idle'|'running'|'done'|'error', result: null | { results, summary } | { message } }
export async function fetchContourJoinAllStatus(accessToken, botId) {
  const params = new URLSearchParams();
  params.set('bot_id', String(botId));
  return apiRequest(`/api/official-bot/contours/join-all/status?${params.toString()}`, { accessToken });
}

// Выдача/подтверждение прав админа актёрам контура (официальный бот + юзерботы).
// Синхронный ответ, серийные вызовы Telegram — может занять до ~60s, поллинг не нужен:
// { success: true, results: [{ target, actor_type, actor_id, actor_username, state, is_admin, flags, warnings, message }], summary }
export async function ensureContourAdminRights(accessToken, botId) {
  return apiRequest('/api/official-bot/contours/ensure-admin', {
    accessToken,
    method: 'POST',
    body: { bot_id: botId }
  });
}
