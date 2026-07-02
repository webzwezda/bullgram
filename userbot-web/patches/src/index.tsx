// BullRun-patched index.tsx (app entry).
//
// Upstream (Ajaxy/telegram-tt v10.9.51): initializes GramJS via phone/QR
// auth flow, persists session to localStorage.
//
// BullRun patch: before any other init runs, bootstrap the bridge:
//   1) Extract `userbotId` from URL pathname `/app/telegram-web/:userbotId`.
//   2) Read admin's Supabase JWT from localStorage (same origin as admin-v2).
//   3) POST /api/userbot-web/web-session/:userbotId → bridge token +
//      decoded sessionData + device fingerprint.
//   4) setBridgeConfig() so other patches (sessions.ts, client.ts,
//      PromisedWebSockets.ts) can read window.__BULLRUN_BRIDGE__.
//   5) Nuke gramjs IndexedDB so no stale auth keys leak from prior builds.
//   6) Continue with the upstream init sequence (multitab, render).
//
// Auth UI bypass: when `getActions().init()` fires, the `initApi` action
// calls `loadStoredSession()` which our patched sessions.ts redirects to
// the bridge sessionData. GramJS sees a valid auth_key, skips phone/QR
// flow, and goes straight to `authorizationStateReady`. The auth UI
// components (Auth.tsx etc.) never render because App.tsx gates on
// `hasStoredSession()` (also bridge-aware).

import './util/handleError';
import './util/setupServiceWorker';
import './global/init';

import React from './lib/teact/teact';
import TeactDOM from './lib/teact/teact-dom';
import {
  getActions, getGlobal,
} from './global';

import {
  DEBUG, STRICTERDOM_ENABLED,
} from './config';
import { enableStrict, requestMutation } from './lib/fasterdom/fasterdom';
import { selectTabState } from './global/selectors';
import { selectSharedSettings } from './global/selectors/sharedState';
import { betterView } from './util/betterView';
import { requestGlobal, subscribeToMultitabBroadcastChannel } from './util/browser/multitab';
import { establishMultitabRole, subscribeToMasterChange } from './util/establishMultitabRole';
import { initGlobal } from './util/init';
import { initLocalization } from './util/localization';
import { MULTITAB_STORAGE_KEY } from './util/multiaccount';
import { checkAndAssignPermanentWebVersion } from './util/permanentWebVersion';
import { onBeforeUnload } from './util/schedulers';
import updateWebmanifest from './util/updateWebmanifest';
import { setBridgeConfig, type BullrunBridgeConfig } from './util/bullrunBridge';
import { installBullrunSafety } from './util/bullrunSafety';
import { acquireBullrunTabLock, renderTabLockBlocker } from './util/bullrunTabLock';

import App from './components/App';

import './assets/fonts/roboto.css';
import './styles/index.scss';

if (STRICTERDOM_ENABLED) {
  enableStrict();
}

void bootstrap();

async function bootstrap() {
  // Install runtime safety guards (WebRTC, push, media devices) BEFORE
  // any other module can construct an RTCPeerConnection or request
  // Notification permission.
  installBullrunSafety();

  // Phase 0: tab lock. Probe for ~600ms so any existing leader can claim.
  const userbotIdForLock = extractUserbotIdFromUrl();
  if (userbotIdForLock) {
    const lock = acquireBullrunTabLock(userbotIdForLock);
    // Give the leadership election 600ms to settle (heartbeat interval is 2s;
    // a contender who just started needs to wait for an existing leader's
    // response if one exists).
    await new Promise((r) => setTimeout(r, 600));
    if (!lock.isLeader) {
      lock.release();
      renderTabLockBlocker(userbotIdForLock);
      return;
    }
    // Keep `lock` alive for the lifetime of this tab — release fires on
    // beforeunload via the lock's own listener.
  }

  // Phase 1: resolve bridge token before anything else touches GramJS.
  let bridgeConfig: BullrunBridgeConfig | null = null;
  try {
    bridgeConfig = await fetchBridgeConfig();
  } catch (err) {
    renderBootstrapError(err);
    return;
  }

  // Phase 2: nuke any prior gramjs IDB (defense in depth — MemorySession
  // should be the only place auth_key lives, but stale IDB from older
  // builds could otherwise resurrect a different account).
  try {
    indexedDB.deleteDatabase('gramjs');
  } catch (err) {
    if (DEBUG) {
      // eslint-disable-next-line no-console
      console.warn('[bullrun-bridge] indexedDB.deleteDatabase("gramjs") failed', err);
    }
  }

  setBridgeConfig(bridgeConfig);

  // Phase 3: upstream init sequence.
  await init();
}

async function fetchBridgeConfig(): Promise<BullrunBridgeConfig> {
  const userbotId = extractUserbotIdFromUrl();
  if (!userbotId) {
    throw new Error('В URL не указан id юзербота. Откройте Telegram Web из админки BullRun.');
  }

  const accessToken = readAdminAccessToken();
  if (!accessToken) {
    throw new Error('Не найдена сессия администратора. Откройте Telegram Web из авторизованной админки BullRun в том же браузере.');
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
    throw new Error(`Админ-доступ отсутствует (${resp.status}): ${reason}. Перевойдите в админку BullRun.`);
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
  // Backend returns snake_case `bridge_token` etc; normalize.
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

function extractUserbotIdFromUrl(): string | null {
  // Expected path shape: /app/telegram-web/<userbotId>(/...)?
  const m = window.location.pathname.match(/\/app\/telegram-web\/([^/]+)/);
  if (!m) return null;
  const id = decodeURIComponent(m[1]);
  // Filter out obvious non-ids (index.html, static assets handled by nginx before reaching here).
  if (id === 'index.html' || id.startsWith('static') || id.startsWith('assets')) return null;
  return id;
}

function readAdminAccessToken(): string | null {
  // Supabase stores session under `sb-<host-first-segment>-auth-token`.
  // We scan for matching keys rather than hardcode the hostname so the
  // same code works on bullgram.xyz (production) and localhost (dev).
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
    // localStorage not available (SSR / sandboxed) — no fallback.
  }
  return null;
}

function renderBootstrapError(err: unknown) {
  // eslint-disable-next-line no-console
  console.error('[bullrun-bridge] bootstrap failed', err);
  const root = document.getElementById('root');
  if (!root) return;
  const message = err instanceof Error ? err.message : String(err);
  root.innerHTML = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 48px 24px; max-width: 560px; margin: 0 auto; color: #1f2937;">
      <h1 style="margin: 0 0 16px; font-size: 22px;">Telegram Web недоступен</h1>
      <p style="margin: 0 0 12px; line-height: 1.5; color: #4b5563;">${escapeHtml(message)}</p>
      <p style="margin: 0; line-height: 1.5; color: #6b7280; font-size: 14px;">
        Закройте эту вкладку и откройте Telegram Web заново из раздела
        <em>Центр юзерботов</em> в админке BullRun.
      </p>
    </div>
  `;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function init() {
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log('>>> INIT');
  }

  if (!(window as any).isCompatTestPassed) return;

  checkAndAssignPermanentWebVersion();

  await window.electron?.restoreLocalStorage();

  subscribeToMultitabBroadcastChannel();
  await requestGlobal(APP_VERSION);
  localStorage.setItem(MULTITAB_STORAGE_KEY, '1');
  onBeforeUnload(() => {
    const global = getGlobal();
    if (Object.keys(global.byTabId).length === 1) {
      localStorage.removeItem(MULTITAB_STORAGE_KEY);
    }
  });

  await initGlobal();
  getActions().init();

  getActions().updateShouldEnableDebugLog();
  getActions().updateShouldDebugExportedSenders();

  const global = getGlobal();

  initLocalization(selectSharedSettings(global).language, true);

  subscribeToMasterChange((isMasterTab) => {
    getActions()
      .switchMultitabRole({ isMasterTab }, { forceSyncOnIOs: true });
  });
  const shouldReestablishMasterToSelf = getGlobal().authState !== 'authorizationStateReady';
  establishMultitabRole(shouldReestablishMasterToSelf);

  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log('>>> START INITIAL RENDER');
  }

  requestMutation(() => {
    updateWebmanifest();

    TeactDOM.render(
      <App />,
      document.getElementById('root')!,
    );

    betterView();
  });

  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log('>>> FINISH INITIAL RENDER');
  }

  if (DEBUG) {
    document.addEventListener('dblclick', () => {
      // eslint-disable-next-line no-console
      console.warn('TAB STATE', selectTabState(getGlobal()));
      // eslint-disable-next-line no-console
      console.warn('GLOBAL STATE', getGlobal());
    });
  }
}

onBeforeUnload(() => {
  const actions = getActions();
  actions.leaveGroupCall?.({ isPageUnload: true });
  actions.hangUp?.({ isPageUnload: true });
});
