import { apiRequest } from './client.js';

export async function fetchClientBases(accessToken, signal) {
  return apiRequest('/api/client-bases', { accessToken, signal });
}

export async function createClientBase(accessToken, { name, description }) {
  return apiRequest('/api/client-bases', {
    accessToken,
    method: 'POST',
    body: { name, description: description || null }
  });
}

export async function updateClientBase(accessToken, id, patch) {
  return apiRequest(`/api/client-bases/${id}`, {
    accessToken,
    method: 'PATCH',
    body: patch
  });
}

export async function deleteClientBase(accessToken, id) {
  return apiRequest(`/api/client-bases/${id}`, {
    accessToken,
    method: 'DELETE'
  });
}

export async function fetchClientBaseMembers(accessToken, id, { limit = 500, offset = 0, search = '' } = {}, signal) {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  if (search) params.set('search', search);
  return apiRequest(`/api/client-bases/${id}/members?${params.toString()}`, { accessToken, signal });
}

export async function addClientBaseMembers(accessToken, id, entries) {
  return apiRequest(`/api/client-bases/${id}/members`, {
    accessToken,
    method: 'POST',
    body: { entries }
  });
}

export async function deleteClientBaseMember(accessToken, baseId, memberId) {
  return apiRequest(`/api/client-bases/${baseId}/members/${memberId}`, {
    accessToken,
    method: 'DELETE'
  });
}
