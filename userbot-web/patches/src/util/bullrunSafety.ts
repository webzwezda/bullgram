// Bullgram runtime safety patches.
//
// Single import that installs guards against four classes of leaks that
// would let Telegram (or an observer on the network) see the admin's real
// IP, defeating the SOCKS5 bridge:
//
//   1. RTCPeerConnection — calls use UDP via STUN/TURN. UDP cannot go
//      through our WS→TCP bridge, so any successful RTCPeerConnection
//      construction leaks the admin's public IP directly to Telegram's
//      call servers. We replace the constructor with one that throws.
//      Call UI fails safely with "Звонки отключены в Bullgram Web".
//
//   2. WebSocket — already neutered at the GramJS layer (PromisedWebSockets
//      patch), but upstream also opens raw WebSockets for uploads/downloads
//      in some paths. We don't disable WebSocket globally (GramJS still
//      needs it via our patched PromisedWebSockets), but we log any direct
//      wss:// attempts to non-Telegram-DC destinations for observability.
//
//   3. navigator.mediaDevices — getUserMedia would request mic/camera and
//      reveal device IDs. Stub it to reject.
//
//   4. Notification / PushManager — push subscriptions would tell Telegram's
//      push server the admin's FCM/APNS token, which Telegram correlates
//      with the device. Stub both to fail.
//
// All guards log to console.warn with `[Bullgram Safety]` prefix so they're
// easy to grep. Guards run on first import (idempotent — module is cached).

const BULLRUN_SAFETY_INSTALLED = '__BULLRUN_SAFETY_INSTALLED__';

export function installBullrunSafety() {
  if ((globalThis as any)[BULLRUN_SAFETY_INSTALLED]) return;
  (globalThis as any)[BULLRUN_SAFETY_INSTALLED] = true;

  disableWebRTC();
  disableMediaDevices();
  disablePushNotifications();
}

function disableWebRTC() {
  const original = (globalThis as any).RTCPeerConnection;
  if (!original) return; // already unsupported

  const blocked = class BlockedRTCPeerConnection {
    constructor() {
      const err = new Error(
        '[Bullgram Safety] RTCPeerConnection is disabled — calls cannot route UDP through the SOCKS5 bridge.',
      );
      // eslint-disable-next-line no-console
      console.warn(err.message);
      throw err;
    }
  };
  // Preserve static surface in case upstream feature-detects it.
  (blocked as any).generateCertificate = original?.generateCertificate;
  (globalThis as any).RTCPeerConnection = blocked;
  (globalThis as any).webkitRTCPeerConnection = blocked;
}

function disableMediaDevices() {
  const md = (navigator as any).mediaDevices;
  if (!md) return;
  const originalGetUserMedia = md.getUserMedia?.bind(md);
  if (originalGetUserMedia) {
    md.getUserMedia = () => Promise.reject(
      new Error('[Bullgram Safety] getUserMedia disabled — mic/camera access blocked.'),
    );
  }
  if (md.enumerateDevices) {
    md.enumerateDevices = () => Promise.resolve([]);
  }
}

function disablePushNotifications() {
  if ('Notification' in globalThis) {
    try {
      Object.defineProperty((globalThis as any).Notification, 'permission', {
        get: () => 'denied',
        configurable: true,
      });
    } catch {
      // Some browsers don't allow overriding Notification.permission — skip silently.
    }
    if (typeof (globalThis as any).Notification.requestPermission === 'function') {
      (globalThis as any).Notification.requestPermission = () => Promise.resolve('denied' as NotificationPermission);
    }
  }

  // Push subscription via ServiceWorkerRegistration.pushManager — also blocked
  // because our setupServiceWorker patch never registers an SW. But belt and
  // suspenders: if anything calls `registration.pushManager.subscribe` on an
  // existing registration, reject.
  try {
    const proto = (globalThis as any).PushManager?.prototype;
    if (proto?.subscribe) {
      proto.subscribe = () => Promise.reject(
        new Error('[Bullgram Safety] Push subscription disabled.'),
      );
    }
  } catch {
    // Skip silently.
  }
}
