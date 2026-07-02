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
