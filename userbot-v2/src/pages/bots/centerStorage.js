const draftStorageKey = 'bullgram_userbot_drafts';
const historyStorageKey = 'bullgram_userbot_history';

export   function loadDraft(key, fallback = '') {
    try {
      const raw = localStorage.getItem(draftStorageKey);
      if (raw) { const map = JSON.parse(raw); return map[key] || fallback; }
    } catch {}
    return fallback;
  }
export   function saveDraft(key, value) {
    try {
      const raw = localStorage.getItem(draftStorageKey);
      const map = raw ? JSON.parse(raw) : {};
      if (value) map[key] = value; else delete map[key];
      localStorage.setItem(draftStorageKey, JSON.stringify(map));
    } catch {}
  }
export   function loadHistory(tgUserId) {
    try {
      const raw = localStorage.getItem(historyStorageKey);
      if (raw) { const map = JSON.parse(raw); return map[tgUserId] || []; }
    } catch {}
    return [];
  }
export   function saveHistory(tgUserId, messages) {
    try {
      const raw = localStorage.getItem(historyStorageKey);
      const map = raw ? JSON.parse(raw) : {};
      map[tgUserId] = messages;
      localStorage.setItem(historyStorageKey, JSON.stringify(map));
    } catch {}
  }
export   function appendHistory(tgUserId, msg) {
    try {
      const raw = localStorage.getItem(historyStorageKey);
      const map = raw ? JSON.parse(raw) : {};
      const arr = map[tgUserId] || [];
      arr.push(msg);
      map[tgUserId] = arr;
      localStorage.setItem(historyStorageKey, JSON.stringify(map));
    } catch {}
  }
export   function syncIncomingToHistory(conversations) {
    if (!conversations?.length) return;
    try {
      const raw = localStorage.getItem(historyStorageKey);
      const map = raw ? JSON.parse(raw) : {};
      let changed = false;
      for (const conv of conversations) {
        if (!conv.last_message_preview || conv.last_outgoing) continue;
        const arr = map[conv.tg_user_id] || [];
        const last = arr[arr.length - 1];
        if (last && last.text === conv.last_message_preview && !last.outgoing) continue;
        arr.push({ text: conv.last_message_preview, outgoing: false, timestamp: conv.last_message_at || new Date().toISOString() });
        map[conv.tg_user_id] = arr;
        changed = true;
      }
      if (changed) localStorage.setItem(historyStorageKey, JSON.stringify(map));
    } catch {}
  }
