// BullRun-patched setupServiceWorker.ts.
//
// Upstream (Ajaxy/telegram-tt v10.9.51): registers a Service Worker at
// `serviceWorker.js` to handle push notifications, push-induced message
// loads, share intents, and tab focus. Without SW, upstream shows a
// "SERVICE_WORKER_DISABLED" error dialog to desktop users.
//
// BullRun patch: zero SW registration.
//   - Same origin (bullgram.xyz) already has admin-v2's SW. A second SW
//     with overlapping scope would race for `fetch` events on /app/* and
//     /app/telegram-web/*, breaking both apps.
//   - SW caches (Cache API) are a leak vector for session bytes — any
//     cached /api response with bridgeToken in headers could survive tab
//     close. With SW disabled, only MemorySession holds keys.
//   - Web Push is also disabled (see notifications.tsx patch), so there's
//     nothing for the SW to do anyway.
//
// We no-op the entire module. handleWorkerMessage / subscribeToWorker are
// kept as no-ops in case anything else imports them, but they are never
// attached.

import { DEBUG } from '../config';

type WorkerAction = {
  type: string;
  payload: Record<string, any>;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function handleWorkerMessage(_e: MessageEvent) {
  // No-op — SW never registers, no messages arrive.
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function subscribeToWorker() {
  // No-op — see handleWorkerMessage above.
}

if (DEBUG) {
  // eslint-disable-next-line no-console
  console.log('[BullRun] Service Worker registration skipped (BullRun Web = memory-only, no SW).');
}
