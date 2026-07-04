// Bullgram bridge config accessor.
//
// Single source of truth for the data injected by app entry (src/index.tsx)
// before GramJS initializes. Other patches (sessions.ts, client.ts) call
// getBridgeConfig() to read the bridge token, decoded sessionData, and
// device fingerprint that the backend returned from
// POST /api/userbot-web/web-session/:userbotId.
//
// Shape (set by src/index.tsx):
//   window.__BULLRUN_BRIDGE__ = {
//     wsUrl: '/api/mtproto-bridge',
//     bridgeToken: '<hex>',
//     sessionData: { mainDcId, keys: { dcId: hex }, isTest },
//     fingerprint: {
//       api_id, api_hash,
//       deviceModel, systemVersion, appVersion,
//       systemLangCode, langCode,
//     },
//     expiresAt: number,
//     userbotId: string,
//   }

export interface BullrunBridgeFingerprint {
  api_id: number;
  api_hash: string;
  deviceModel?: string;
  systemVersion?: string;
  appVersion?: string;
  systemLangCode?: string;
  langCode?: string;
}

export interface BullrunBridgeSessionData {
  mainDcId: number;
  keys: Record<number, string>;
  isTest?: boolean;
}

export interface BullrunBridgeConfig {
  wsUrl: string;
  bridgeToken: string;
  sessionData: BullrunBridgeSessionData;
  fingerprint: BullrunBridgeFingerprint;
  expiresAt: number;
  userbotId: string;
}

let cachedConfig: BullrunBridgeConfig | null = null;

// Module-level dedup. When multiple PromisedWebSockets instances try to
// refresh the token in parallel (GramJS opens 1 main DC + 2-3 file DC WS
// near-simultaneously on reconnect), they all share one fetch.
let refreshInFlight: Promise<BullrunBridgeConfig> | null = null;

// Refresh if token expires within next 60s. GramJS reconnects within
// seconds, so a 60s buffer covers any in-flight operation. Backend TTL
// is 5 min, so on the very first connect after tab open we won't refresh
// (cache is fresh from bootstrap).
const REFRESH_BUFFER_MS = 60_000;

export function setBridgeConfig(config: BullrunBridgeConfig) {
  cachedConfig = config;
  (globalThis as any).__BULLRUN_BRIDGE__ = config;
}

export function getBridgeConfig(): BullrunBridgeConfig {
  if (cachedConfig) return cachedConfig;
  const fromWindow = (globalThis as any).__BULLRUN_BRIDGE__ as BullrunBridgeConfig | undefined;
  if (fromWindow && fromWindow.bridgeToken && fromWindow.sessionData && fromWindow.fingerprint) {
    cachedConfig = fromWindow;
    return cachedConfig;
  }
  throw new Error(
    '[bullrun-bridge] getBridgeConfig() called before setBridgeConfig(). '
    + 'App entry (src/index.tsx) must bootstrap the bridge token before initializing GramJS.',
  );
}

export function hasBridgeConfig(): boolean {
  try {
    getBridgeConfig();
    return true;
  } catch {
    return false;
  }
}

// Ensure the bridge token has at least REFRESH_BUFFER_MS left before
// expiry. If not, refetch via POST /web-session and update the cache.
//
// Called from PromisedWebSockets.connect() on every reconnect attempt.
// Without this, after the 5-minute TTL expires, every reconnect silently
// fails with 4401 INVALID_OR_EXPIRED_TOKEN — the admin sees a frozen UI
// with no indication of what went wrong.
export async function ensureFreshBridgeConfig(): Promise<BullrunBridgeConfig> {
  const current = cachedConfig;
  if (current && current.expiresAt - Date.now() > REFRESH_BUFFER_MS) {
    return current;
  }

  // Stale or missing — refresh with dedup.
  const userbotId = current?.userbotId ?? extractUserbotIdFromUrl();
  if (!userbotId) {
    throw new Error('[bullrun-bridge] cannot refresh: no userbotId in cached config or URL.');
  }

  if (!refreshInFlight) {
    refreshInFlight = fetchBridgeConfigFromNetwork(userbotId)
      .finally(() => { refreshInFlight = null; });
  }

  const fresh = await refreshInFlight;
  setBridgeConfig(fresh);
  saveBridgeConfigToSession(fresh);
  return fresh;
}

// sessionStorage cache for bridge tokens. Bridge tokens are multi-use with
// a 5-minute TTL (backend). On tab reload within that window we can skip
// the POST /web-session round-trip and reuse the same token — saves
// 100-300ms on the critical path. sessionStorage auto-clears on tab close,
// so we never leak stale tokens across sessions.

const SESSION_STORAGE_PREFIX = 'bullrun-bridge-';

export function saveBridgeConfigToSession(config: BullrunBridgeConfig): void {
  try {
    sessionStorage.setItem(
      SESSION_STORAGE_PREFIX + config.userbotId,
      JSON.stringify(config),
    );
  } catch {
    // sessionStorage unavailable (private mode, sandboxed iframe, quota).
    // Bridge config stays in-memory only; reload will refetch. Acceptable.
  }
}

export function loadBridgeConfigFromSession(userbotId: string): BullrunBridgeConfig | null {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_PREFIX + userbotId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isValidCachedConfig(parsed, userbotId)) return null;
    return parsed as BullrunBridgeConfig;
  } catch {
    return null;
  }
}

export function clearBridgeConfigFromSession(userbotId: string): void {
  try {
    sessionStorage.removeItem(SESSION_STORAGE_PREFIX + userbotId);
  } catch {
    // ignore
  }
}

function isValidCachedConfig(
  cfg: unknown,
  expectedUserbotId: string,
): cfg is BullrunBridgeConfig {
  if (!cfg || typeof cfg !== 'object') return false;
  const c = cfg as BullrunBridgeConfig;
  if (c.userbotId !== expectedUserbotId) return false;
  if (typeof c.bridgeToken !== 'string' || !c.bridgeToken) return false;
  if (typeof c.wsUrl !== 'string' || !c.wsUrl) return false;
  if (typeof c.expiresAt !== 'number') return false;
  // 30s buffer so a token that's about to expire doesn't get reused.
  if (c.expiresAt <= Date.now() + 30_000) return false;
  if (!c.sessionData || typeof c.sessionData.mainDcId !== 'number') return false;
  if (!c.sessionData.keys || typeof c.sessionData.keys !== 'object') return false;
  if (!c.fingerprint || typeof c.fingerprint.api_id !== 'number') return false;
  if (!c.fingerprint.api_hash || typeof c.fingerprint.api_hash !== 'string') return false;
  return true;
}

// Network fetch + response normalization. Shared between bootstrap
// (initial load) and ensureFreshBridgeConfig (reconnect-time refresh).
export async function fetchBridgeConfigFromNetwork(
  userbotId: string,
): Promise<BullrunBridgeConfig> {
  const accessToken = readAdminAccessToken();
  if (!accessToken) {
    throw new Error(
      'Не найдена сессия администратора. Откройте Telegram Web из авторизованной админки Bullgram в том же браузере.',
    );
  }

  const endpoint = `/api/userbot-web/web-session/${encodeURIComponent(userbotId)}`;
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  });

  if (resp.status === 403 || resp.status === 401) {
    let body: any = null;
    try { body = await resp.json(); } catch {}
    const reason = body?.error || body?.message || 'доступ запрещён';
    throw new Error(`Админ-доступ отсутствует (${resp.status}): ${reason}. Перевойдите в админку Bullgram.`);
  }
  if (resp.status === 503) {
    throw new Error('Telegram Web отключён фича-флагом TELEGRAM_WEB_ENABLED на сервере.');
  }
  if (!resp.ok) {
    let body: any = null;
    try { body = await resp.json(); } catch {}
    const reason = body?.error || body?.message || resp.statusText;
    throw new Error(`Не удалось получить bridge-токен (${resp.status}): ${reason}`);
  }

  const payload = await resp.json();
  const cfg: BullrunBridgeConfig = {
    wsUrl: payload.wsUrl || payload.ws_url || '/api/mtproto-bridge',
    bridgeToken: payload.bridgeToken || payload.bridge_token,
    sessionData: payload.sessionData || payload.session_data,
    fingerprint: payload.fingerprint,
    expiresAt: payload.expiresAt || payload.expires_at,
    userbotId,
  };

  if (!cfg.bridgeToken || !cfg.sessionData?.mainDcId || !cfg.fingerprint?.api_id) {
    throw new Error('Некорректный ответ сервера: отсутствует bridge_token / sessionData / fingerprint.');
  }

  return cfg;
}

export function extractUserbotIdFromUrl(): string | null {
  // Expected path shape: /app/telegram-web/<userbotId>(/...)?
  const m = window.location.pathname.match(/\/app\/telegram-web\/([^/]+)/);
  if (!m) return null;
  const id = decodeURIComponent(m[1]);
  if (id === 'index.html' || id.startsWith('static') || id.startsWith('assets')) return null;
  return id;
}

function readAdminAccessToken(): string | null {
  // Supabase stores session under `sb-<host-first-segment>-auth-token`.
  try {
    const keys = Object.keys(localStorage).filter((k) => /^sb-[\w.-]+-auth-token$/.test(k));
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        const token = parsed?.access_token || parsed?.provider_token;
        if (typeof token === 'string' && token.length > 20) return token;
      } catch {
        // Not JSON — try next key.
      }
    }
  } catch {
    // localStorage not available.
  }
  return null;
}
