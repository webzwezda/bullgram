import { apiRequest } from './client.js';

// GET /api/messaging/capacity — потянет ли пул юзерботов базу на N контактов.
// { audienceSize, poolSize, dailyCap, hourlyCap, botsNeeded, days }.
// days === null — пустой пул (разослать невозможно); botsNeeded — сколько юзерботов
// нужно, чтобы база разошлась за один день.
export async function fetchMessagingCapacity(accessToken, audienceSize, signal) {
  const params = new URLSearchParams();
  params.set('audience_size', String(Math.max(0, Math.trunc(Number(audienceSize) || 0))));
  return apiRequest(`/api/messaging/capacity?${params.toString()}`, { accessToken, signal });
}

// POST /api/broadcast/campaigns/:id/cancel — стоп кампании в статусе queued|sending.
// 200 { ok: true, status: 'cancelled', cancelled_at }.
// 404 — кампания не найдена или уже не активна.
export async function cancelBroadcastCampaign(accessToken, campaignId) {
  return apiRequest(`/api/broadcast/campaigns/${campaignId}/cancel`, {
    accessToken,
    method: 'POST'
  });
}
