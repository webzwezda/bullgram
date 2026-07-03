// BullRun bridge config accessor.
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
