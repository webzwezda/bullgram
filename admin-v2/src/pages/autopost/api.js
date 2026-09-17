/**
 * API-клиент для автопостера.
 * Все fetch-вызовы к /api/autopost/* централизованы здесь.
 */

async function request(url, { method = 'GET', body, token } = {}) {
    const headers = { Authorization: `Bearer ${token}` };
    if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
}

export function fetchChannels(botId, token) {
    return request(`/api/autopost/bots/${botId}/channels`, { token });
}

export function fetchAdmins(botId, token) {
    return request(`/api/autopost/bots/${botId}/admins`, { token });
}

export function initBot({ botToken, adminTgId }, token) {
    return request('/api/autopost/bots/init', {
        method: 'POST',
        body: { botToken, adminTgId },
        token
    });
}

export function patchChannel(botId, channelId, payload, token) {
    return request(`/api/autopost/bots/${botId}/channels/${channelId}`, {
        method: 'PATCH',
        body: payload,
        token
    });
}

export function unlinkChannel(botId, channelId, token) {
    return request(`/api/autopost/bots/${botId}/channels/${channelId}`, {
        method: 'DELETE',
        token
    });
}

export function refreshChannel(botId, channelId, token) {
    return request(`/api/autopost/bots/${botId}/channels/${channelId}/refresh`, {
        method: 'POST',
        token
    });
}

export function addAdmin(botId, adminTgId, token) {
    return request(`/api/autopost/bots/${botId}/admins`, {
        method: 'POST',
        body: { adminTgId },
        token
    });
}

export function removeAdmin(botId, tgId, token) {
    return request(`/api/autopost/bots/${botId}/admins/${tgId}`, {
        method: 'DELETE',
        token
    });
}

export function deleteBot(botId, token) {
    return request(`/api/autopost/bots/${botId}`, {
        method: 'DELETE',
        token
    });
}

export function regenerateInvite(botId, token) {
    return request(`/api/autopost/bots/${botId}/admins/regenerate-invite`, {
        method: 'POST',
        token
    });
}

export function patchBot(botId, payload, token) {
    return request(`/api/autopost/bots/${botId}`, {
        method: 'PATCH',
        body: payload,
        token
    });
}

// --- Чек-листы автопостера ---

export function fetchChecklists(botId, { status } = {}, token) {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    const qs = params.toString();
    return request(`/api/autopost/bots/${botId}/checklists${qs ? `?${qs}` : ''}`, { token });
}

export function createChecklist(botId, { title, items, channelIds, expiresAt, dedupKey }, token) {
    return request(`/api/autopost/bots/${botId}/checklists`, {
        method: 'POST',
        body: { title, items, channelIds, expiresAt, dedupKey },
        token
    });
}

export function getChecklistState(botId, checklistId, token) {
    return request(`/api/autopost/bots/${botId}/checklists/${checklistId}`, { token });
}

export function updateChecklist(botId, checklistId, payload, token) {
    return request(`/api/autopost/bots/${botId}/checklists/${checklistId}`, {
        method: 'PATCH',
        body: payload,
        token
    });
}

export function cancelChecklist(botId, checklistId, token) {
    return request(`/api/autopost/bots/${botId}/checklists/${checklistId}/cancel`, {
        method: 'POST',
        token
    });
}
