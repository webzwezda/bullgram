// BullRun single-tab lock via BroadcastChannel.
//
// Why: opening two Telegram Web tabs for the same userbot under the same
// bridge token creates race conditions on the SOCKS5 bridge — both tabs
// would multiplex frames into one MTProto stream, corrupting request/response
// pairing. The bridge token is multi-use by design (GramJS opens several
// WS connections: main DC + file DCs), but those connections cooperate
// inside a single GramJS client instance. Two tabs = two GramJS clients
// fighting for the same auth_key = corruption.
//
// Strategy: per-userbot BroadcastChannel heartbeat. First tab to start
// becomes leader; subsequent tabs see a leader already exists and render
// a blocker overlay telling the user to switch to the existing tab.
//
// Heartbeat: leader pings every 2s, followers age out the leader if no
// ping seen in 6s (covers tab crash, browser kill, sleep).

const HEARTBEAT_INTERVAL_MS = 2000;
const LEADER_TIMEOUT_MS = 6000;

export interface TabLockResult {
  isLeader: boolean;
  release: () => void;
}

export function acquireBullrunTabLock(userbotId: string): TabLockResult {
  const channelName = `bullrun-telegram-web-${userbotId}`;
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(channelName);
  } catch {
    // BroadcastChannel unsupported (older Safari). Allow the tab to proceed —
    // multi-tab corruption is a known limitation, not a hard fail.
    return { isLeader: true, release: () => {} };
  }

  let isLeader = false;
  let lastSeenLeader = 0;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let leaderWatcher: ReturnType<typeof setInterval> | null = null;

  const becomeLeader = () => {
    isLeader = true;
    lastSeenLeader = Date.now();
  };

  channel.onmessage = (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.userbotId !== userbotId) return;
    if (msg.role === 'leader') {
      lastSeenLeader = Date.now();
      if (isLeader) {
        // Two leaders — tie-break by timestamp. Lower timestamp wins.
        // The other tab will see our ping and demote on the next tick.
        if (msg.startedAt > startedAt) {
          // We started later — we should demote.
          isLeader = false;
        }
      }
    }
  };

  const startedAt = Date.now();
  // Optimistically try to become leader immediately.
  becomeLeader();

  pingTimer = setInterval(() => {
    if (!channel) return;
    if (isLeader) {
      channel.postMessage({ userbotId, role: 'leader', startedAt });
    } else if (Date.now() - lastSeenLeader > LEADER_TIMEOUT_MS) {
      // Leader disappeared — promote ourselves.
      becomeLeader();
    }
  }, HEARTBEAT_INTERVAL_MS);

  leaderWatcher = setInterval(() => {
    if (!isLeader && Date.now() - lastSeenLeader > LEADER_TIMEOUT_MS) {
      becomeLeader();
    }
  }, HEARTBEAT_INTERVAL_MS);

  // Send an initial "hello" so existing leader marks us as a contender.
  channel.postMessage({ userbotId, role: 'contender', startedAt });

  // On the first 500ms, listen for an existing leader's response. If we
  // hear one with an earlier startedAt, demote.
  const demotionCheck = setTimeout(() => {
    if (lastSeenLeader > 0 && lastSeenLeader < startedAt + 500) {
      // Heard from an established leader — demote.
      isLeader = false;
    }
  }, 500);

  const release = () => {
    if (pingTimer) clearInterval(pingTimer);
    if (leaderWatcher) clearInterval(leaderWatcher);
    clearTimeout(demotionCheck);
    if (channel) {
      try {
        channel.postMessage({ userbotId, role: 'leaving', startedAt });
        channel.close();
      } catch {
        // Ignore.
      }
    }
  };

  // Beforeunload: notify peers.
  try {
    window.addEventListener('beforeunload', release);
  } catch {
    // Ignore.
  }

  return { isLeader, release };
}

// Render a full-page blocker for the loser tab. Called by index.tsx
// after the initial leadership probe (give it 600ms to settle).
export function renderTabLockBlocker(userbotId: string) {
  const root = document.getElementById('root');
  if (!root) return;
  root.innerHTML = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 48px 24px; max-width: 560px; margin: 0 auto; color: #1f2937;">
      <h1 style="margin: 0 0 16px; font-size: 22px;">Telegram Web уже открыт в другой вкладке</h1>
      <p style="margin: 0 0 12px; line-height: 1.5; color: #4b5563;">
        Один юзербот (<code style="background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:12px;">${escapeAttr(userbotId)}</code>)
        можно открывать в Telegram Web только в одной вкладке одновременно — иначе
        два GramJS-клиента подерутся за одну сессию и сломают bridge-соединение.
      </p>
      <p style="margin: 0; line-height: 1.5; color: #6b7280; font-size: 14px;">
        Перейдите в уже открытую вкладку или закройте её и обновите эту страницу.
      </p>
    </div>
  `;
}

function escapeAttr(s: string): string {
  return String(s || '').replace(/[<>&"']/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;',
  }[c] as string));
}
