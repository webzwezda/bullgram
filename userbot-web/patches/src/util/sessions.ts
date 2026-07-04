// Bullgram-patched sessions.ts.
//
// Upstream (Ajaxy/telegram-tt v10.9.51): persists GramJS sessionData to
// localStorage under `prod:session` keys. Persists across tabs, survives
// browser restarts, leaks account credentials to disk.
//
// Bullgram patch: zero persistence. Session bytes live only in JS memory for
// the lifetime of the tab. Source of truth is window.__BULLRUN_BRIDGE__
// injected by app entry (src/index.tsx) from the bridge token response.
// Tab close = full session wipe. No leakage to localStorage or IndexedDB.
//
// All upstream call-sites still work because we keep the function signatures:
//   - loadStoredSession() → returns bridge's sessionData
//   - hasStoredSession()  → returns Boolean(bridge.sessionData)
//   - storeSession()      → no-op (memory-only)
//   - clearStoredSession() → no-op (memory-only)
//   - loadSlotSession()   → returns bridge's sessionData for ACCOUNT_SLOT=1
//   - updateSessionUserId → no-op
//   - importTestSession   → no-op
//   - checkSessionLocked  → always false (no passcode in Bullgram Web)
//
// Bridge accessor: see bullrunBridge.ts.

import type { ApiSessionData } from '../api/types';
import type { DcId, SharedSessionData } from '../types';

import { SESSION_LEGACY_USER_KEY } from '../config';
import { getBridgeConfig } from './bullrunBridge';

export function hasStoredSession() {
  try {
    return Boolean(getBridgeConfig().sessionData?.mainDcId);
  } catch {
    return false;
  }
}

export function storeSession(_sessionData: ApiSessionData) {
  // No-op: Bullgram Web never persists session bytes.
  // The in-memory CallbackSession already holds the live key material.
}

export function clearStoredSession(_slot?: number) {
  // No-op: nothing to clear — we never wrote anything.
}

export function loadStoredSession(): ApiSessionData | undefined {
  try {
    const bridge = getBridgeConfig();
    if (!bridge.sessionData?.mainDcId) return undefined;
    return {
      mainDcId: bridge.sessionData.mainDcId,
      keys: bridge.sessionData.keys || {},
      isTest: bridge.sessionData.isTest || undefined,
    };
  } catch {
    return undefined;
  }
}

export function loadSlotSession(slot: number | undefined): SharedSessionData | undefined {
  // Bullgram always uses slot 1 (single-account). Bridge sessionData maps 1:1.
  if (slot && slot !== 1) return undefined;
  try {
    const bridge = getBridgeConfig();
    if (!bridge.sessionData?.mainDcId) return undefined;
    return {
      dcId: bridge.sessionData.mainDcId,
      isTest: bridge.sessionData.isTest,
    } as SharedSessionData;
  } catch {
    return undefined;
  }
}

export function updateSessionUserId(_currentUserId: string) {
  // No-op: Bullgram Web does not track per-slot userId.
}

export function importTestSession() {
  // No-op: Bullgram Web never imports test sessions.
}

export function checkSessionLocked() {
  // Bullgram Web has no passcode/lock screen — always returns false.
  return false;
}

// Re-exported for any code that still references SESSION_LEGACY_USER_KEY
// (keeps TypeScript happy without changing import sites).
export { SESSION_LEGACY_USER_KEY };
