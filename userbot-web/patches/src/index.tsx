// Bullgram-patched index.tsx (app entry).
//
// Upstream (Ajaxy/telegram-tt v10.9.51): initializes GramJS via phone/QR
// auth flow, persists session to localStorage.
//
// Bullgram patch: before any other init runs, bootstrap the bridge:
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
import {
  loadBridgeConfigFromSession,
  saveBridgeConfigToSession,
  setBridgeConfig,
  fetchBridgeConfigFromNetwork,
  extractUserbotIdFromUrl,
  type BullrunBridgeConfig,
} from './util/bullrunBridge';
import { installBullrunSafety } from './util/bullrunSafety';
import { acquireBullrunTabLock, renderTabLockBlocker } from './util/bullrunTabLock';

import App from './components/App';

import './assets/fonts/roboto.css';
import './styles/index.scss';

if (STRICTERDOM_ENABLED) {
  enableStrict();
}

// L2.1: phase timings. Exposed on window.__bullrunTimings for inspection
// via DevTools console. Logged live when DEBUG.
// NOTE: must be declared before `void bootstrap()` below — async functions
// start executing synchronously until first await, so bootstrap() would
// hit the temporal dead zone on `bootstrapT0`/`timings` otherwise.
const bootstrapT0 = performance.now();
const timings: Array<[string, number]> = [];
(window as any).__bullrunTimings = timings;
function mark(name: string) {
  const ms = performance.now() - bootstrapT0;
  timings.push([name, ms]);
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log(`[bullrun-timing] +${ms.toFixed(0)}ms ${name}`);
  }
}

void bootstrap();

async function bootstrap() {
  mark('bootstrap-start');

  // Install runtime safety guards (WebRTC, push, media devices) BEFORE
  // any other module can construct an RTCPeerConnection or request
  // Notification permission.
  installBullrunSafety();
  mark('safety-installed');

  // Run tab-lock probe and bridge token fetch in parallel. Lock probe
  // needs ~600ms to settle (heartbeat interval is 2s); fetch typically
  // takes 100-300ms. Sequential cost ~900ms; parallel cost ~600ms.
  const userbotIdForLock = extractUserbotIdFromUrl();

  const lockProbe: Promise<{ isLeader: boolean; release: () => void } | null> = userbotIdForLock
    ? (async () => {
      const lock = acquireBullrunTabLock(userbotIdForLock);
      await new Promise((r) => setTimeout(r, 600));
      return lock;
    })()
    : Promise.resolve(null);

  const bridgeConfigPromise = fetchBridgeConfig();

  let lockResult: { isLeader: boolean; release: () => void } | null;
  let bridgeConfig: BullrunBridgeConfig;
  try {
    [lockResult, bridgeConfig] = await Promise.all([
      lockProbe,
      bridgeConfigPromise,
    ]);
  } catch (err) {
    // Fetch (or lock) failed. Drain lockProbe to avoid unhandled rejection,
    // then surface the bootstrap error.
    try {
      const drain = await lockProbe.catch(() => null);
      drain?.release();
    } catch {
      // ignore
    }
    renderBootstrapError(err);
    return;
  }

  if (lockResult && !lockResult.isLeader) {
    lockResult.release();
    renderTabLockBlocker(userbotIdForLock!);
    return;
  }
  mark('lock-resolved');

  // Keep `lockResult` alive for the lifetime of this tab — release fires
  // on beforeunload via the lock's own listener.

  // Nuke any prior gramjs IDB. Must complete before init() runs: GramJS
  // opens its own IDB during init, and an in-flight deleteDatabase would
  // block that open indefinitely (this was the root cause of the
  // "first load hangs, works on reload" bug).
  await nukeGramjsIdb();
  mark('idb-nuked');

  setBridgeConfig(bridgeConfig);
  mark('bridge-set');

  await init();
  mark('init-done');
}

async function nukeGramjsIdb(): Promise<void> {
  const DB_NAME = 'gramjs';

  // Skip if no such DB exists (avoids the open-request-blocked-by-delete
  // quirk). `databases()` is supported in Chrome/Edge/FF but not Safari;
  // on Safari we fall through and attempt the delete unconditionally.
  try {
    if (typeof (indexedDB as any).databases === 'function') {
      const dbs = await (indexedDB as any).databases();
      if (!Array.isArray(dbs) || !dbs.some((db) => db?.name === DB_NAME)) {
        return;
      }
    }
  } catch {
    // Best-effort — fall through to attempt delete anyway.
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve();
      }
    };
    const timeout = setTimeout(finish, 2000);

    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.deleteDatabase(DB_NAME);
    } catch {
      finish();
      return;
    }

    req.onsuccess = finish;
    req.onerror = () => {
      if (DEBUG) {
        // eslint-disable-next-line no-console
        console.warn('[bullrun-bridge] indexedDB.deleteDatabase("gramjs") errored', req.error);
      }
      finish();
    };
    req.onblocked = () => {
      if (DEBUG) {
        // eslint-disable-next-line no-console
        console.warn('[bullrun-bridge] indexedDB.deleteDatabase("gramjs") blocked — waiting up to 2s');
      }
    };
  });
}

async function fetchBridgeConfig(): Promise<BullrunBridgeConfig> {
  const userbotId = extractUserbotIdFromUrl();
  if (!userbotId) {
    throw new Error('В URL не указан id юзербота. Откройте Telegram Web из админки Bullgram.');
  }

  // L1.3: bridge tokens are multi-use for 5 minutes. On tab reload within
  // that window, reuse the cached token from sessionStorage instead of
  // round-tripping to the backend. Saves 100-300ms on the critical path.
  const cached = loadBridgeConfigFromSession(userbotId);
  if (cached) {
    mark('bridge-resolved:cache');
    return cached;
  }

  const cfg = await fetchBridgeConfigFromNetwork(userbotId);
  saveBridgeConfigToSession(cfg);
  mark('bridge-resolved:network');
  return cfg;
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
        <em>Центр юзерботов</em> в админке Bullgram.
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
