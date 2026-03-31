import { APP_CONFIG } from '../config.js';

export async function apiRequest(path, { accessToken, method = 'GET', body } = {}) {
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const response = await fetch(`${APP_CONFIG.backendUrl}${path}`, {
    method,
    cache: 'no-store',
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
      ,
      ...(!isFormData ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: isFormData ? body : JSON.stringify(body) } : {})
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok || data?.error) {
    throw new Error(data?.error || `HTTP ${response.status}`);
  }

  return data;
}
