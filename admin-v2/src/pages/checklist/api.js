import { apiRequest } from '../../api/client.js';

export async function listBots(accessToken) {
  return apiRequest('/api/checklist/bots', { accessToken });
}

export async function registerBot(accessToken, { bot_token, display_name }) {
  return apiRequest('/api/checklist/bots', {
    accessToken,
    method: 'POST',
    body: { bot_token, display_name }
  });
}

export async function getBot(accessToken, id) {
  return apiRequest(`/api/checklist/bots/${id}`, { accessToken });
}

export async function updateBot(accessToken, id, payload) {
  return apiRequest(`/api/checklist/bots/${id}`, {
    accessToken,
    method: 'PATCH',
    body: payload
  });
}

export async function deleteBot(accessToken, id) {
  return apiRequest(`/api/checklist/bots/${id}`, {
    accessToken,
    method: 'DELETE'
  });
}

export async function restartBot(accessToken, id) {
  return apiRequest(`/api/checklist/bots/${id}/restart`, {
    accessToken,
    method: 'POST'
  });
}

export async function listIntegrationTokens(accessToken, botId) {
  return apiRequest(`/api/checklist/bots/${botId}/integration-tokens`, { accessToken });
}

export async function createIntegrationToken(accessToken, botId, label = 'AI агент') {
  return apiRequest(`/api/checklist/bots/${botId}/integration-tokens`, {
    accessToken,
    method: 'POST',
    body: { label }
  });
}

export async function listLists(accessToken, botId, { status, limit = 50, offset = 0 } = {}) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  return apiRequest(`/api/checklist/bots/${botId}/lists?${params.toString()}`, { accessToken });
}

export async function deleteList(accessToken, listId) {
  return apiRequest(`/api/checklist/lists/${listId}`, {
    accessToken,
    method: 'DELETE'
  });
}

export async function retryList(accessToken, listId) {
  return apiRequest(`/api/checklist/lists/${listId}/retry`, {
    accessToken,
    method: 'POST'
  });
}

export async function pushFromUi(accessToken, botId, payload) {
  return apiRequest(`/api/checklist/bots/${botId}/push`, {
    accessToken,
    method: 'POST',
    body: payload
  });
}
