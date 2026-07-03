import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';
import { PlanBanner } from '../ui/PlanBanner.jsx';
import { StatCard } from '../ui/StatCard.jsx';
import { UpgradeCallout } from '../ui/UpgradeCallout.jsx';

function formatDate(value) {
  if (!value) return 'Нет данных';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function formatBytes(n) {
  const v = Number(n || 0);
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  if (v < 1024 * 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(2)} MB`;
  return `${(v / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDurationMs(ms) {
  const v = Math.max(0, Number(ms || 0));
  if (v < 1000) return `${Math.round(v)} мс`;
  const s = v / 1000;
  if (s < 60) return `${s.toFixed(1)} с`;
  const m = Math.floor(s / 60);
  const rest = Math.round(s % 60);
  return `${m}м ${rest}с`;
}

function formatElapsed(seconds) {
  const value = Math.max(0, Number(seconds || 0));
  const minutes = Math.floor(value / 60);
  const rest = value % 60;
  if (minutes <= 0) return `${rest} с`;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

const USERBOT_CENTER_HANDOFF_KEY = 'bullrun_userbot_center_handoff';

function consumeUserbotCenterHandoff() {
  try {
    const raw = window.localStorage.getItem(USERBOT_CENTER_HANDOFF_KEY);
    if (!raw) return null;
    window.localStorage.removeItem(USERBOT_CENTER_HANDOFF_KEY);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function needsBotsRecovery(message = '') {
  const value = String(message || '').toLowerCase();
  return value.includes('сессия') ||
    value.includes('подключите юзербота') ||
    value.includes('неактивным') ||
    value.includes('прокси') ||
    value.includes('expired') ||
    value.includes('auth_key_unregistered');
}

export function UserbotCenterPage() {
  const location = useLocation();
  const { accessToken, profilePlan, trialEndsAt } = useAuth();
  const [initialHandoff] = useState(() => consumeUserbotCenterHandoff());
  const handoffLoadDoneRef = useRef(false);
  const initialParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const initialThreadUserId = String(initialParams.get('tg_user_id') || initialHandoff?.tg_user_id || '').trim();
  const initialCommonChatId = String(initialHandoff?.common_chat_id || '').trim();
  const initialDraftMessage = String(initialHandoff?.draft_message || '').trim();
  const avatarInputRef = useRef(null);
  const [selectedUserbotId, setSelectedUserbotId] = useState('');
  const [threadUserId, setThreadUserId] = useState(initialThreadUserId);

  const draftStorageKey = 'bullrun_userbot_drafts';
  const historyStorageKey = 'bullrun_userbot_history';
  function loadDraft(key, fallback = '') {
    try {
      const raw = localStorage.getItem(draftStorageKey);
      if (raw) { const map = JSON.parse(raw); return map[key] || fallback; }
    } catch {}
    return fallback;
  }
  function saveDraft(key, value) {
    try {
      const raw = localStorage.getItem(draftStorageKey);
      const map = raw ? JSON.parse(raw) : {};
      if (value) map[key] = value; else delete map[key];
      localStorage.setItem(draftStorageKey, JSON.stringify(map));
    } catch {}
  }
  function loadHistory(tgUserId) {
    try {
      const raw = localStorage.getItem(historyStorageKey);
      if (raw) { const map = JSON.parse(raw); return map[tgUserId] || []; }
    } catch {}
    return [];
  }
  function saveHistory(tgUserId, messages) {
    try {
      const raw = localStorage.getItem(historyStorageKey);
      const map = raw ? JSON.parse(raw) : {};
      map[tgUserId] = messages;
      localStorage.setItem(historyStorageKey, JSON.stringify(map));
    } catch {}
  }
  function appendHistory(tgUserId, msg) {
    try {
      const raw = localStorage.getItem(historyStorageKey);
      const map = raw ? JSON.parse(raw) : {};
      const arr = map[tgUserId] || [];
      arr.push(msg);
      map[tgUserId] = arr;
      localStorage.setItem(historyStorageKey, JSON.stringify(map));
    } catch {}
  }
  function syncIncomingToHistory(conversations) {
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

  const [replyMessage, setReplyMessage] = useState(initialDraftMessage || loadDraft('reply'));
  const [manualInviteLink, setManualInviteLink] = useState('');
  const [manualTgUserId, setManualTgUserId] = useState(initialThreadUserId || loadDraft('manual_tg'));
  const [manualCommonChatId, setManualCommonChatId] = useState(initialCommonChatId || loadDraft('manual_chat'));
  const [manualDirectMessage, setManualDirectMessage] = useState(initialDraftMessage || loadDraft('manual_msg'));
  const [activeTab, setActiveTab] = useState(initialThreadUserId ? 'messages' : 'profile');
  const [chatHistory, setChatHistory] = useState(() => initialThreadUserId ? loadHistory(initialThreadUserId) : []);
  const [groupFilter, setGroupFilter] = useState('all');
  const [state, setState] = useState({
    loading: true,
    refreshing: false,
    scanRequired: false,
    error: '',
    data: null
  });
  const [scanStartedAt, setScanStartedAt] = useState(null);
  const [scanElapsedSeconds, setScanElapsedSeconds] = useState(0);
  const [actionState, setActionState] = useState({
    sendingReply: false,
    joiningInvite: false,
    sendingDirect: false,
    markingRead: false,
    loadingAuthorizations: false,
    resettingAuthorizations: false
  });
  const [authorizationsState, setAuthorizationsState] = useState({
    loading: false,
    error: '',
    rows: []
  });
  const [profileSyncState, setProfileSyncState] = useState({
    pulling: false,
    saving: false,
    uploadingAvatar: false,
    tone: 'default',
    text: ''
  });
  const [profileDraft, setProfileDraft] = useState({
    accountId: '',
    firstName: '',
    lastName: '',
    about: ''
  });
  const [errorEventsState, setErrorEventsState] = useState({
    loading: false,
    error: '',
    rows: []
  });
  const [webAuditState, setWebAuditState] = useState({
    loading: false,
    error: '',
    rows: [],
    activeBridges: 0,
    total: 0
  });
  const trialHoursLeft = useMemo(() => {
    if (!trialEndsAt) return null;
    const diffMs = new Date(trialEndsAt).getTime() - Date.now();
    if (diffMs <= 0) return 0;
    return Math.ceil(diffMs / (1000 * 60 * 60));
  }, [trialEndsAt]);
  const trialUpgradeUrgent = profilePlan === 'trial' && trialHoursLeft !== null && trialHoursLeft > 0 && trialHoursLeft <= 72;

  useEffect(() => {
    if (!scanStartedAt || !state.refreshing) {
      setScanElapsedSeconds(0);
      return undefined;
    }

    const tick = () => {
      setScanElapsedSeconds(Math.floor((Date.now() - scanStartedAt) / 1000));
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [scanStartedAt, state.refreshing]);

  function applyCenterData(nextData, preferredUserbotId = selectedUserbotId, preferredThreadUserId = threadUserId) {
    const nextUserbotId = String(nextData.selected_userbot_id || preferredUserbotId || '');
    const nextConversations = nextData.conversations || [];
    const nextThreadUserId = nextConversations.some((item) => String(item.tg_user_id) === String(preferredThreadUserId))
      ? String(preferredThreadUserId)
      : '';

    setSelectedUserbotId(nextUserbotId);
    setThreadUserId(nextThreadUserId);
    syncIncomingToHistory(nextConversations);
    if (nextThreadUserId) setChatHistory(loadHistory(nextThreadUserId));
    setState((prev) => ({
      ...prev,
      loading: false,
      refreshing: false,
      scanRequired: nextData.scan_required === true,
      error: '',
      data: nextData
    }));

    if (manualCommonChatId && !(nextData.groups || []).find((group) => String(group.chat_id || '') === String(manualCommonChatId))) {
      setManualCommonChatId('');
    }
  }

  async function reloadCenter({ silent = false, preferredThreadUserId = threadUserId, scan = true } = {}) {
    const trackScanWait = scan && !silent;
    if (!silent) {
      setState((prev) => ({
        ...prev,
        loading: !prev.data,
        refreshing: !!prev.data,
        error: ''
      }));
    }
    if (trackScanWait) {
      setScanStartedAt(Date.now());
      setScanElapsedSeconds(0);
    }

    const params = new URLSearchParams();
    if (selectedUserbotId) params.set('userbot_id', selectedUserbotId);
    if (scan) params.set('scan', 'true');
    const query = params.toString() ? `?${params.toString()}` : '';
    try {
      const nextData = await apiRequest(`/api/userbot/ops-center${query}`, { accessToken });
      applyCenterData(nextData, selectedUserbotId, preferredThreadUserId);
      return nextData;
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        refreshing: false,
        error: error.message
      }));
      throw error;
    } finally {
      if (trackScanWait) {
        setScanStartedAt(null);
      }
    }
  }

  async function refreshCenterNow() {
    try {
      await reloadCenter({ scan: true });
    } catch {
      // Ошибка уже записана в состояние страницы.
    }
  }

  async function loadAuthorizations() {
    if (!accessToken || !selectedUserbotId) {
      setAuthorizationsState({ loading: false, error: '', rows: [] });
      return;
    }

    setAuthorizationsState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const query = new URLSearchParams({ userbot_id: selectedUserbotId });
      const data = await apiRequest(`/api/userbot/ops-center/authorizations?${query.toString()}`, { accessToken });
      setAuthorizationsState({
        loading: false,
        error: '',
        rows: data.authorizations || []
      });
    } catch (error) {
      setAuthorizationsState({
        loading: false,
        error: error.message,
        rows: []
      });
    }
  }

  function applyProfileAccount(account) {
    if (!account?.id) return;
    setState((prev) => ({
      ...prev,
      data: prev.data ? {
        ...prev.data,
        userbots: (prev.data.userbots || []).map((userbot) => (
          String(userbot.id) === String(account.id)
            ? { ...userbot, ...account }
            : userbot
        ))
      } : prev.data
    }));
    setProfileDraft({
      accountId: String(account.id),
      firstName: account.tg_first_name || '',
      lastName: account.tg_last_name || '',
      about: account.tg_about || ''
    });
  }

  async function syncSelectedUserbotProfile() {
    if (!accessToken || !selectedUserbotId) return;
    if (!window.confirm('Обновить профиль юзербота из Telegram? Это живой запрос к аккаунту. Подтянем аватарку, имя, фамилию, username, телефон и описание. Группы сканировать не будем.')) {
      return;
    }

    setProfileSyncState({ pulling: true, saving: false, uploadingAvatar: false, tone: 'default', text: '' });
    try {
      const result = await apiRequest(`/api/userbot/profile/${selectedUserbotId}/sync`, {
        accessToken,
        method: 'POST'
      });

      if (result.account) {
        applyProfileAccount(result.account);
      }

      setProfileSyncState({
        pulling: false,
        saving: false,
        uploadingAvatar: false,
        tone: result.cached ? 'warning' : 'success',
        text: result.message || (result.cached ? 'Показываем сохраненный профиль.' : 'Профиль обновлен.')
      });
    } catch (error) {
      setProfileSyncState({
        pulling: false,
        saving: false,
        uploadingAvatar: false,
        tone: 'error',
        text: error.message
      });
    }
  }

  async function saveSelectedUserbotProfile() {
    if (!accessToken || !selectedUserbotId) return;
    const firstName = String(profileDraft.firstName || '').trim();
    const lastName = String(profileDraft.lastName || '').trim();
    const about = String(profileDraft.about || '').trim();

    if (!firstName) {
      setProfileSyncState({
        pulling: false,
        saving: false,
        uploadingAvatar: false,
        tone: 'error',
        text: 'Имя Telegram-аккаунта не может быть пустым.'
      });
      return;
    }

    if (!window.confirm('Сохранить эти имя, фамилию и описание в реальный Telegram-профиль выбранного юзербота?')) {
      return;
    }

    setProfileSyncState({ pulling: false, saving: true, uploadingAvatar: false, tone: 'default', text: '' });
    try {
      const result = await apiRequest(`/api/userbot/profile/${selectedUserbotId}/update`, {
        accessToken,
        method: 'POST',
        body: {
          first_name: firstName,
          last_name: lastName,
          about
        }
      });

      if (result.account) {
        applyProfileAccount(result.account);
      }

      setProfileSyncState({
        pulling: false,
        saving: false,
        uploadingAvatar: false,
        tone: 'success',
        text: result.message || 'Профиль сохранен в Telegram и Supabase.'
      });
    } catch (error) {
      setProfileSyncState({
        pulling: false,
        saving: false,
        uploadingAvatar: false,
        tone: 'error',
        text: error.message
      });
    }
  }

  async function uploadSelectedUserbotAvatar(file) {
    if (!accessToken || !selectedUserbotId || !file) return;

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      setProfileSyncState({
        pulling: false,
        saving: false,
        uploadingAvatar: false,
        tone: 'error',
        text: 'Загрузи JPG, PNG или WEBP до 5 МБ.'
      });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setProfileSyncState({
        pulling: false,
        saving: false,
        uploadingAvatar: false,
        tone: 'error',
        text: 'Файл слишком тяжелый. Максимум 5 МБ.'
      });
      return;
    }

    if (!window.confirm('Поставить эту картинку аватаркой реального Telegram-аккаунта?')) {
      return;
    }

    const formData = new FormData();
    formData.append('avatar', file);

    setProfileSyncState({ pulling: false, saving: false, uploadingAvatar: true, tone: 'default', text: '' });
    try {
      const result = await apiRequest(`/api/userbot/profile/${selectedUserbotId}/avatar`, {
        accessToken,
        method: 'POST',
        body: formData
      });

      if (result.account) {
        applyProfileAccount(result.account);
      }

      setProfileSyncState({
        pulling: false,
        saving: false,
        uploadingAvatar: false,
        tone: 'success',
        text: result.message || 'Аватарка сохранена в Telegram и на сервере.'
      });
    } catch (error) {
      setProfileSyncState({
        pulling: false,
        saving: false,
        uploadingAvatar: false,
        tone: 'error',
        text: error.message
      });
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadCenter() {
      if (initialHandoff && handoffLoadDoneRef.current) return;

      setState((prev) => ({
        ...prev,
        loading: !prev.data,
        refreshing: !!prev.data,
        error: ''
      }));

      try {
        const params = new URLSearchParams();
        if (selectedUserbotId) params.set('userbot_id', selectedUserbotId);
        if (initialThreadUserId && !initialHandoff) params.set('scan', 'true');
        const query = params.toString() ? `?${params.toString()}` : '';
        const data = await apiRequest(`/api/userbot/ops-center${query}`, { accessToken });
        if (cancelled) return;
        applyCenterData(data, selectedUserbotId, threadUserId || initialThreadUserId);
        if (initialHandoff) handoffLoadDoneRef.current = true;
      } catch (error) {
        if (cancelled) return;
        setState({
          loading: false,
          refreshing: false,
          scanRequired: false,
          error: error.message,
          data: null
        });
      }
    }

    if (accessToken) {
      loadCenter();
    }

    return () => {
      cancelled = true;
    };
  }, [accessToken, selectedUserbotId]);

  useEffect(() => {
    if (!initialThreadUserId) return;
    setManualTgUserId((prev) => prev || initialThreadUserId);
  }, [initialThreadUserId]);

  useEffect(() => {
    setAuthorizationsState({ loading: false, error: '', rows: [] });
    setProfileSyncState({ pulling: false, saving: false, uploadingAvatar: false, tone: 'default', text: '' });
  }, [accessToken, selectedUserbotId]);

  useEffect(() => {
    let cancelled = false;

    async function loadErrorEvents() {
      if (!accessToken || !selectedUserbotId) {
        setErrorEventsState({ loading: false, error: '', rows: [] });
        return;
      }

      setErrorEventsState((prev) => ({ ...prev, loading: true, error: '' }));
      try {
        const query = new URLSearchParams({
          userbot_id: selectedUserbotId,
          limit: '20'
        });
        const data = await apiRequest(`/api/userbot/error-events?${query.toString()}`, { accessToken });
        if (cancelled) return;
        setErrorEventsState({
          loading: false,
          error: '',
          rows: data.events || []
        });
      } catch (error) {
        if (cancelled) return;
        setErrorEventsState({
          loading: false,
          error: error.message,
          rows: []
        });
      }
    }

    loadErrorEvents();
    return () => {
      cancelled = true;
    };
  }, [accessToken, selectedUserbotId]);

  useEffect(() => {
    let cancelled = false;

    async function loadWebAudit() {
      if (!accessToken || !selectedUserbotId) {
        setWebAuditState({ loading: false, error: '', rows: [], activeBridges: 0, total: 0 });
        return;
      }

      setWebAuditState((prev) => ({ ...prev, loading: true, error: '' }));
      try {
        const query = new URLSearchParams({
          userbot_id: selectedUserbotId,
          limit: '20'
        });
        const data = await apiRequest(`/api/userbot-web/audit?${query.toString()}`, { accessToken });
        if (cancelled) return;
        setWebAuditState({
          loading: false,
          error: '',
          rows: data.events || [],
          activeBridges: data.active_bridges || 0,
          total: data.total || 0
        });
      } catch (error) {
        if (cancelled) return;
        setWebAuditState({
          loading: false,
          error: error.message,
          rows: [],
          activeBridges: 0,
          total: 0
        });
      }
    }

    loadWebAudit();
    return () => {
      cancelled = true;
    };
  }, [accessToken, selectedUserbotId]);

  const data = state.data || {};
  const userbots = data.userbots || [];
  const groups = data.groups || [];
  const conversations = data.conversations || [];
  const summary = data.summary || {};
  const signalConfig = data.signal_config || {};
  const selectedUserbot = useMemo(
    () => userbots.find((item) => String(item.id) === String(selectedUserbotId)) || null,
    [selectedUserbotId, userbots]
  );
  useEffect(() => {
    if (!selectedUserbot?.id) {
      setProfileDraft({ accountId: '', firstName: '', lastName: '', about: '' });
      return;
    }
    setProfileDraft({
      accountId: String(selectedUserbot.id),
      firstName: selectedUserbot.tg_first_name || '',
      lastName: selectedUserbot.tg_last_name || '',
      about: selectedUserbot.tg_about || ''
    });
  }, [
    selectedUserbot?.id,
    selectedUserbot?.tg_first_name,
    selectedUserbot?.tg_last_name,
    selectedUserbot?.tg_about
  ]);

  const selectedDraftFirstName = profileDraft.accountId === String(selectedUserbot?.id || '') ? profileDraft.firstName : '';
  const selectedDraftLastName = profileDraft.accountId === String(selectedUserbot?.id || '') ? profileDraft.lastName : '';
  const selectedDraftAbout = profileDraft.accountId === String(selectedUserbot?.id || '') ? profileDraft.about : '';
  const selectedProfileName = selectedUserbot
    ? [selectedDraftFirstName || selectedUserbot.tg_first_name, selectedDraftLastName || selectedUserbot.tg_last_name].filter(Boolean).join(' ').trim()
    : '';
  const selectedProfileTitle = selectedProfileName || (
    selectedUserbot?.tg_username ? `@${selectedUserbot.tg_username}` : 'Имя пока не подтянуто'
  );
  const selectedProfileInitial = (
    selectedProfileName ||
    selectedUserbot?.tg_username ||
    String(selectedUserbot?.tg_account_id || '?')
  ).slice(0, 1).toUpperCase();
  const selectedProfileSyncedAt = selectedUserbot?.tg_profile_synced_at
    ? formatDate(selectedUserbot.tg_profile_synced_at)
    : 'еще не обновляли';
  const selectedProfileAttemptedAt = selectedUserbot?.tg_profile_sync_attempted_at
    ? formatDate(selectedUserbot.tg_profile_sync_attempted_at)
    : '';
  const selectedProfilePhotoSrc = selectedUserbot?.tg_photo_url
    ? `${selectedUserbot.tg_photo_url}${selectedUserbot.tg_photo_synced_at ? `?v=${encodeURIComponent(selectedUserbot.tg_photo_synced_at)}` : ''}`
    : (selectedUserbot?.tg_photo_data_url || '');
  const profileDirty = !!selectedUserbot && (
    selectedDraftFirstName !== (selectedUserbot.tg_first_name || '') ||
    selectedDraftLastName !== (selectedUserbot.tg_last_name || '') ||
    selectedDraftAbout !== (selectedUserbot.tg_about || '')
  );

  const selectedConversation = useMemo(
    () => conversations.find((item) => String(item.tg_user_id) === String(threadUserId)) || null,
    [conversations, threadUserId]
  );

  const sortedConversations = useMemo(
    () => [...conversations].sort((a, b) => {
      if ((b.unread_count || 0) !== (a.unread_count || 0)) return (b.unread_count || 0) - (a.unread_count || 0);
      return String(b.last_message_at || '').localeCompare(String(a.last_message_at || ''));
    }),
    [conversations]
  );

  const commonChatGroups = useMemo(
    () => groups.filter((item) => item.chat_id),
    [groups]
  );

  const [loadingThread, setLoadingThread] = useState(false);
  const [threadUnavailable, setThreadUnavailable] = useState('');

  async function loadThreadMessages(tgUserId) {
    if (!accessToken || !selectedUserbotId) {
      setThreadUnavailable('Выберите юзербота');
      return;
    }
    setLoadingThread(true);
    setThreadUnavailable('');
    try {
      const params = new URLSearchParams({ tg_user_id: tgUserId, userbot_id: selectedUserbotId });
      const result = await apiRequest(`/api/userbot/ops-center/thread?${params.toString()}`, { accessToken });
      const apiMessages = result.messages || [];

      if (result.unavailable_reason && !apiMessages.length) {
        setThreadUnavailable(result.unavailable_reason);
        return;
      }

      const merged = apiMessages.map((m) => ({ text: m.text, outgoing: m.outgoing, timestamp: m.date }));
      saveHistory(tgUserId, merged);
      setChatHistory(merged);
    } catch (error) {
      console.error('Ошибка загрузки переписки:', error);
      setThreadUnavailable(error.message || 'Не удалось загрузить переписку');
    } finally {
      setLoadingThread(false);
    }
  }

  async function selectConversation(conversation) {
    const nextThreadUserId = String(conversation.tg_user_id);
    setThreadUserId(nextThreadUserId);
    setManualTgUserId(nextThreadUserId);
    setReplyMessage('');
    setChatHistory(loadHistory(nextThreadUserId));
    setThreadUnavailable('');
  }

  async function markConversationRead(tgUserId) {
    if (!tgUserId || !selectedUserbotId) return;

    setActionState((prev) => ({ ...prev, markingRead: true }));
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      await apiRequest('/api/userbot/ops-center/mark-read', {
        accessToken,
        method: 'POST',
        body: {
          tg_user_id: String(tgUserId),
          userbot_id: selectedUserbotId
        },
        signal: controller.signal
      });
      clearTimeout(timeout);

      setState((prev) => ({
        ...prev,
        data: prev.data ? {
          ...prev.data,
          conversations: (prev.data.conversations || []).map((item) => (
            String(item.tg_user_id) === String(tgUserId)
              ? { ...item, unread_count: 0 }
              : item
          )),
          summary: prev.data.summary ? {
            ...prev.data.summary,
            unread_dialogs: (prev.data.conversations || []).filter((item) => (
              String(item.tg_user_id) === String(tgUserId)
                ? false
                : (item.unread_count || 0) > 0
            )).length
          } : prev.data.summary
        } : prev.data
      }));
      reloadCenter({ silent: true, preferredThreadUserId: threadUserId }).catch(() => {});
    } catch (error) {
      toast.error(`Не получилось отметить диалог как прочитанный: ${error.message}`);
    } finally {
      setActionState((prev) => ({ ...prev, markingRead: false }));
    }
  }

  async function sendReply() {
    const message = String(replyMessage || '').trim();
    if (!selectedConversation?.tg_user_id) {
      toast.error('Сначала выбери диалог, кому отвечать.');
      return;
    }
    if (!message) {
      toast.error('Напиши текст ответа.');
      return;
    }
    if (!window.confirm('Отправить этот ответ через юзербота вручную? Telegram может ограничить аккаунт, если диалог холодный.')) {
      return;
    }

    setActionState((prev) => ({ ...prev, sendingReply: true }));
    try {
      await apiRequest('/api/userbot/send-message', {
        accessToken,
        method: 'POST',
        body: {
          tg_user_id: selectedConversation.tg_user_id,
          message,
          userbot_id: selectedUserbotId || null,
          known_dialog: true,
          manual_confirmed: true
        }
      });
      setReplyMessage('');
      saveDraft('reply', '');
      const sentAt = new Date().toISOString();
      const historyMsg = { text: message, outgoing: true, timestamp: sentAt };
      appendHistory(String(selectedConversation.tg_user_id), historyMsg);
      setChatHistory((prev) => [...prev, historyMsg]);
      setState((prev) => ({
        ...prev,
        data: prev.data ? {
          ...prev.data,
          conversations: (prev.data.conversations || []).map((item) => (
            String(item.tg_user_id) === String(selectedConversation.tg_user_id)
              ? {
                ...item,
                last_message_preview: message,
                last_message_at: sentAt,
                last_outgoing: true,
                unread_count: 0
              }
              : item
          ))
        } : prev.data
      }));
      toast.success('Ответ улетел.');
    } catch (error) {
      toast.error(`Ошибка ответа: ${error.message}`);
    } finally {
      setActionState((prev) => ({ ...prev, sendingReply: false }));
    }
  }

  async function joinInviteLink() {
    if (!selectedUserbotId) {
      toast.error('Сначала выбери юзербота, который будет заходить по ссылке.');
      return;
    }
    if (!manualInviteLink.trim()) {
      toast.error('Вставь ссылку-приглашение.');
      return;
    }

    setActionState((prev) => ({ ...prev, joiningInvite: true }));
    try {
      const data = await apiRequest('/api/userbot/ops-center/join-invite', {
        accessToken,
        method: 'POST',
        body: {
          userbot_id: selectedUserbotId,
          invite_link: manualInviteLink.trim()
        }
      });
      setManualInviteLink('');
      await reloadCenter();
      toast.success(`Юзербот зашел в: ${data.title || 'группу/чат'}`);
    } catch (error) {
      toast.error(`Ошибка входа по ссылке: ${error.message}`);
    } finally {
      setActionState((prev) => ({ ...prev, joiningInvite: false }));
    }
  }

  async function sendDirectMessage() {
    const tgUserId = String(manualTgUserId || '').trim();
    const message = String(manualDirectMessage || '').trim();

    if (!selectedUserbotId) {
      toast.error('Сначала выбери юзербота, который будет писать.');
      return;
    }
    if (!/^\d+$/.test(tgUserId)) {
      toast.error('Нужен нормальный Telegram ID цифрами.');
      return;
    }
    if (!message) {
      toast.error('Напиши текст сообщения.');
      return;
    }
    if (!manualCommonChatId) {
      toast.error('Сначала выбери общий чат. Холодный поиск по TG ID без общей группы больше не даем.');
      return;
    }
    if (!window.confirm('Отправить ЛС по TG ID через юзербота вручную? Делай это только если аккаунт уже знает человека или есть общий чат.')) {
      return;
    }

    setActionState((prev) => ({ ...prev, sendingDirect: true }));
    try {
      await apiRequest('/api/userbot/send-message', {
        accessToken,
        method: 'POST',
        body: {
          tg_user_id: tgUserId,
          message,
          userbot_id: selectedUserbotId,
          common_chat_id: manualCommonChatId,
          manual_confirmed: true
        }
      });
      setManualTgUserId('');
      setManualDirectMessage('');
      saveDraft('manual_msg', '');
      saveDraft('manual_tg', '');
      const sentAt = new Date().toISOString();
      const historyMsg = { text: message, outgoing: true, timestamp: sentAt };
      appendHistory(tgUserId, historyMsg);
      setChatHistory([historyMsg]);
      setThreadUserId(tgUserId);
      setState((prev) => {
        if (!prev.data) return prev;
        const existing = prev.data.conversations || [];
        const hasConversation = existing.some((item) => String(item.tg_user_id) === tgUserId);
        const nextConversation = {
          tg_user_id: tgUserId,
          username: null,
          display_name: `ID ${tgUserId}`,
          unread_count: 0,
          last_message_preview: message,
          last_message_at: sentAt,
          last_outgoing: true,
          sales_signal: false
        };
        return {
          ...prev,
          data: {
            ...prev.data,
            conversations: hasConversation
              ? existing.map((item) => String(item.tg_user_id) === tgUserId ? { ...item, ...nextConversation } : item)
              : [nextConversation, ...existing],
            summary: prev.data.summary ? {
              ...prev.data.summary,
              open_dialogs: hasConversation ? prev.data.summary.open_dialogs : (prev.data.summary.open_dialogs || 0) + 1
            } : prev.data.summary
          }
        };
      });
      toast.success('Сообщение улетело.');
    } catch (error) {
      toast.error(`Ошибка отправки: ${error.message}`);
    } finally {
      setActionState((prev) => ({ ...prev, sendingDirect: false }));
    }
  }

  async function resetOtherSessions() {
    if (!selectedUserbotId) {
      toast.error('Сначала выбери юзербота.');
      return;
    }
    if (!window.confirm('Разлогинить все остальные устройства этого Telegram-аккаунта и оставить только текущую серверную сессию?')) {
      return;
    }

    setActionState((prev) => ({ ...prev, resettingAuthorizations: true }));
    try {
      const data = await apiRequest('/api/userbot/ops-center/authorizations/reset-others', {
        accessToken,
        method: 'POST',
        body: {
          userbot_id: selectedUserbotId
        }
      });
      setAuthorizationsState({
        loading: false,
        error: '',
        rows: data.authorizations || []
      });
      toast.success(data.message || 'Остальные устройства разлогинены.');
    } catch (error) {
      toast.error(`Не получилось разлогинить остальные устройства: ${error.message}`);
    } finally {
      setActionState((prev) => ({ ...prev, resettingAuthorizations: false }));
    }
  }

  if (state.loading && !initialHandoff) {
    return <LoadingState text="Тянем живой Центр юзербота..." />;
  }

  if (state.error) {
    return (
      <section className="page">
        <div className="page__header">
          <h1>Центр юзербота</h1>
          <p>Здесь уже должен быть живой triage по личкам и группам. Пока backend вернул ошибку.</p>
        </div>
        <div className="error-card">{state.error}</div>
        {needsBotsRecovery(state.error) ? (
          <div className="toolbar-card" style={{ marginTop: 16 }}>
            <div className="toolbar-card__title">Что делать дальше</div>
            <div className="list-stack">
              <div className="list-item">
                <div className="list-item__title">Открой Боты и аккаунты</div>
                <div className="list-item__meta">
                  Там теперь есть живой onboarding: QR, импорт `.session/.json`, смена прокси и удаление мертвого аккаунта.
                </div>
              </div>
            </div>
            <div className="toolbar-card__body">
              <a className="ghost-button ghost-button--primary" href="/app/userbots">
                Открыть Юзерботы
              </a>
            </div>
          </div>
        ) : null}
      </section>
    );
  }

  const TAB_OPTIONS = [
    { id: 'profile', label: 'Профиль' },
    { id: 'groups', label: 'Группы' },
    { id: 'messages', label: 'Сообщения' }
  ];

  function renderProfileTab() {
    return (
      <>
        {selectedUserbot ? (
          <div className="p-6 md:p-8">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#818cf8' }} />
              <div className="text-[15px] font-bold text-slate-900">Профиль аккаунта</div>
            </div>
            <div className="text-sm text-slate-500 mb-6">Редактируй имя, описание и аватарку. Изменения улетают прямо в Telegram.</div>
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex min-w-0 items-start gap-4">
                <button
                  type="button"
                  className="group relative size-16 shrink-0 overflow-hidden rounded-[18px] text-left ring-1 ring-slate-200 transition hover:ring-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={profileSyncState.pulling || profileSyncState.saving || profileSyncState.uploadingAvatar}
                  title="Загрузить аватарку"
                >
                  {selectedProfilePhotoSrc ? (
                    <img src={selectedProfilePhotoSrc} alt="" className="size-16 object-cover" />
                  ) : (
                    <span className="flex size-16 items-center justify-center bg-slate-900 text-[22px] font-black text-white">
                      {selectedProfileInitial}
                    </span>
                  )}
                  <span className="absolute inset-x-0 bottom-0 bg-slate-950/75 px-1.5 py-1 text-center text-[10px] font-bold text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
                    {profileSyncState.uploadingAvatar ? '...' : 'Сменить'}
                  </span>
                </button>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0] || null;
                    event.target.value = '';
                    if (file) uploadSelectedUserbotAvatar(file);
                  }}
                />
                <div className="min-w-0">
                  <div className="truncate text-[20px] font-black tracking-tight text-slate-950">
                    {selectedProfileTitle}
                  </div>
                  <div className="mt-1 text-[12px] font-medium text-slate-500">
                    Последнее обновление: {selectedProfileSyncedAt}
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="h-9 px-4 rounded-xl border border-slate-200 text-slate-700 text-[13px] font-bold hover:bg-slate-50 transition-all disabled:opacity-50"
                onClick={syncSelectedUserbotProfile}
                disabled={profileSyncState.pulling || profileSyncState.saving || profileSyncState.uploadingAvatar || !selectedUserbotId}
              >
                {profileSyncState.pulling ? 'Тянем из Telegram...' : 'Стянуть из Telegram'}
              </button>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">Имя</label>
                <input
                  className="h-11 w-full px-4 rounded-[14px] border border-slate-200 bg-slate-50 text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
                  value={selectedDraftFirstName}
                  maxLength={64}
                  onChange={(event) => setProfileDraft((prev) => ({ ...prev, firstName: event.target.value }))}
                  placeholder="Имя аккаунта"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">Фамилия</label>
                <input
                  className="h-11 w-full px-4 rounded-[14px] border border-slate-200 bg-slate-50 text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
                  value={selectedDraftLastName}
                  maxLength={64}
                  onChange={(event) => setProfileDraft((prev) => ({ ...prev, lastName: event.target.value }))}
                  placeholder="Фамилия аккаунта"
                />
              </div>
              <div className="rounded-[14px] bg-slate-50 px-4 py-3 border border-slate-100">
                <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">Username</div>
                <div className="mt-1 truncate text-[13px] font-semibold text-slate-800">
                  {selectedUserbot.tg_username ? `@${selectedUserbot.tg_username}` : '—'}
                </div>
              </div>
              <div className="rounded-[14px] bg-slate-50 px-4 py-3 border border-slate-100">
                <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">Телефон / TG ID</div>
                <div className="mt-1 truncate text-[13px] font-semibold text-slate-800">
                  {[selectedUserbot.tg_phone, selectedUserbot.tg_account_id ? `ID ${selectedUserbot.tg_account_id}` : ''].filter(Boolean).join(' • ') || '—'}
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">Описание</label>
              <textarea
                className="w-full px-4 py-3 rounded-[14px] border border-slate-200 bg-slate-50 text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 resize-none"
                rows={3}
                value={selectedDraftAbout}
                maxLength={70}
                onChange={(event) => setProfileDraft((prev) => ({ ...prev, about: event.target.value }))}
                placeholder="Описание профиля"
              />
              <div className="text-[12px] font-medium text-slate-500">{selectedDraftAbout.length}/70</div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="h-9 px-4 rounded-xl bg-blue-600 text-white text-[13px] font-bold hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={saveSelectedUserbotProfile}
                disabled={profileSyncState.pulling || profileSyncState.saving || profileSyncState.uploadingAvatar || !profileDirty}
              >
                {profileSyncState.saving ? 'Сохраняем...' : 'Сохранить в Telegram'}
              </button>
              <button
                type="button"
                className="h-9 px-4 rounded-xl border border-slate-200 text-slate-700 text-[13px] font-bold hover:bg-slate-50 transition-all disabled:opacity-50"
                onClick={() => avatarInputRef.current?.click()}
                disabled={profileSyncState.pulling || profileSyncState.saving || profileSyncState.uploadingAvatar}
              >
                {profileSyncState.uploadingAvatar ? 'Загружаем...' : 'Загрузить аватарку'}
              </button>
              {profileDirty ? (
                <button
                  type="button"
                  className="h-9 px-4 rounded-xl border border-slate-200 text-slate-700 text-[13px] font-bold hover:bg-slate-50 transition-all disabled:opacity-50"
                  onClick={() => setProfileDraft({
                    accountId: String(selectedUserbot.id),
                    firstName: selectedUserbot.tg_first_name || '',
                    lastName: selectedUserbot.tg_last_name || '',
                    about: selectedUserbot.tg_about || ''
                  })}
                  disabled={profileSyncState.pulling || profileSyncState.saving || profileSyncState.uploadingAvatar}
                >
                  Отменить
                </button>
              ) : null}
            </div>

            {selectedUserbot.tg_profile_sync_error ? (
              <div className="mt-4 p-3 rounded-[14px] bg-red-50 border border-red-200 text-[13px] font-medium text-red-700">
                Ошибка профиля{selectedProfileAttemptedAt ? ` (${selectedProfileAttemptedAt})` : ''}: {selectedUserbot.tg_profile_sync_error}
              </div>
            ) : null}

            {profileSyncState.text ? (
              <div className="mt-3 text-[13px] font-medium text-slate-600">
                {profileSyncState.text}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="border-t border-slate-100 p-6 md:p-8">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#f59e0b' }} />
            <div className="text-[15px] font-bold text-slate-900">Активные сессии</div>
          </div>
          <div className="text-sm text-slate-500 mb-4">Залогиненные устройства. Можно выкинуть все, кроме серверной сессии BullRun.</div>
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              className="h-9 px-4 rounded-xl border border-slate-200 text-slate-700 text-[13px] font-bold hover:bg-slate-50 transition-all disabled:opacity-50"
              onClick={loadAuthorizations}
              disabled={authorizationsState.loading || !selectedUserbotId}
            >
              {authorizationsState.loading ? 'Тянем сессии...' : 'Показать сессии'}
            </button>
            <button
              className="h-9 px-4 rounded-xl border border-red-200 text-red-600 text-[13px] font-bold hover:bg-red-50 transition-all disabled:opacity-50"
              onClick={resetOtherSessions}
              disabled={actionState.resettingAuthorizations || !selectedUserbotId}
            >
              {actionState.resettingAuthorizations ? 'Чистим...' : 'Разлогинить остальные'}
            </button>
          </div>

          {authorizationsState.error ? (
            <div className="text-sm text-slate-500">{authorizationsState.error}</div>
          ) : authorizationsState.loading ? (
            <div className="text-sm text-slate-500">Тянем авторизации...</div>
          ) : authorizationsState.rows.length === 0 ? (
            <div className="text-sm text-slate-500">Нажми «Показать сессии», чтобы загрузить список.</div>
          ) : (
            <div className="overflow-x-auto -mx-2">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Устройство</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Приложение</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Где</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Последний движ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {authorizationsState.rows.map((item) => (
                    <tr key={item.hash || `${item.app_name}-${item.date_active}`} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-900">
                          {item.current ? 'Серверная сессия' : (item.device_model || item.platform || 'Устройство')}
                          {item.current ? <span className="ml-2 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-[10px] font-black uppercase">BullRun</span> : null}
                        </div>
                        <div className="text-xs text-slate-500">
                          {item.current ? 'Текущая серверная сессия' : `${item.platform || ''} ${item.system_version || ''}`.trim()}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{item.app_name || 'Telegram'}</div>
                        <div className="text-xs text-slate-500">{item.app_version || '—'}{item.official_app ? ' • official' : ''}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{item.country || '—'}</div>
                        <div className="text-xs text-slate-500">{item.ip || '—'}{item.region ? ` • ${item.region}` : ''}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">{formatDate(item.date_active || item.date_created)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="border-t border-slate-100 p-6 md:p-8">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#ef4444' }} />
            <div className="text-[15px] font-bold text-slate-900">Telegram-ошибки</div>
          </div>
          <div className="text-sm text-slate-500 mb-4">Последние flood/restricted/session ошибки по этому аккаунту.</div>
          {errorEventsState.error ? (
            <div className="text-sm text-slate-500">{errorEventsState.error}</div>
          ) : errorEventsState.loading ? (
            <div className="text-sm text-slate-500">Загружаем журнал ошибок...</div>
          ) : errorEventsState.rows.length === 0 ? (
            <div className="text-sm text-slate-500">Свежих ошибок по этому аккаунту нет.</div>
          ) : (
            <div className="overflow-x-auto -mx-2">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Что случилось</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Кому</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Откуда</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Когда</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {errorEventsState.rows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-900">{row.restriction_kind || row.event_type}</div>
                        <div className="text-xs text-slate-500">{row.error_message || 'Без текста ошибки'}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">{row.tg_user_id || '—'}</td>
                      <td className="px-4 py-3 text-sm text-slate-700">{row.event_source || 'telegram'}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">{formatDate(row.happened_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="border-t border-slate-100 p-6 md:p-8">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#8b5cf6' }} />
              <div className="text-[15px] font-bold text-slate-900">Telegram Web — мосты</div>
            </div>
            {webAuditState.activeBridges > 0 && (
              <div className="px-3 py-1.5 rounded-lg bg-violet-50 text-violet-700 text-xs font-bold flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />
                Активных мостов: {webAuditState.activeBridges}
              </div>
            )}
          </div>
          <div className="text-sm text-slate-500 mb-4">
            Кто и когда открывал этот юзербот в Telegram Web, сколько трафика прошло через мост, какие ошибки.
            <span className="block mt-1 text-xs text-slate-400">
              Зеленая точка в колонке «Прокси» = соединение шло через привязанный прокси юзербота (безопасно).
              Красная надпись «НЕТ ПРОКСИ» = мост пошёл напрямую с сервера — это риск бана аккаунта.
            </span>
          </div>
          {webAuditState.error ? (
            <div className="text-sm text-slate-500">{webAuditState.error}</div>
          ) : webAuditState.loading ? (
            <div className="text-sm text-slate-500">Загружаем журнал мостов...</div>
          ) : webAuditState.rows.length === 0 ? (
            <div className="text-sm text-slate-500">Этот аккаунт ещё не открывали в Telegram Web.</div>
          ) : (
            <div className="overflow-x-auto -mx-2">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Событие</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">DC</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Трафик ↓/↑</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Длина</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Прокси</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">IP админа</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Когда</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {webAuditState.rows.map((row) => {
                    const tone = row.action === 'bridge_error' || row.action === 'token_expired'
                      ? 'text-rose-700 bg-rose-50'
                      : row.action === 'session_issued'
                        ? 'text-violet-700 bg-violet-50'
                        : 'text-slate-600 bg-slate-50';
                    const label = {
                      session_issued: 'Сессия выдана',
                      bridge_opened: 'Мост открыт',
                      bridge_closed: 'Мост закрыт',
                      bridge_error: 'Ошибка моста',
                      token_expired: 'Токен истёк'
                    }[row.action] || row.action;
                    return (
                      <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-bold ${tone}`}>{label}</span>
                          {row.error_message && (
                            <div className="text-xs text-rose-600 mt-1">{row.error_message}</div>
                          )}
                          {row.user_agent && (
                            <div className="text-xs text-slate-400 mt-1 truncate max-w-[280px]" title={row.user_agent}>{row.user_agent}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700">{row.dc_id || '—'}</td>
                        <td className="px-4 py-3 text-sm text-slate-700 font-mono">
                          {row.bytes_in ? formatBytes(row.bytes_in) : '—'}
                          <span className="text-slate-400 mx-1">/</span>
                          {row.bytes_out ? formatBytes(row.bytes_out) : '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700">{row.duration_ms ? formatDurationMs(row.duration_ms) : '—'}</td>
                        <td className="px-4 py-3 text-sm text-slate-700 font-mono">
                          {row.proxy_used ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" title="Соединение через прокси юзербота" />
                              {row.proxy_used}
                            </span>
                          ) : (
                            <span className="text-rose-600 font-bold" title="Прямое соединение без прокси — критично для аккаунта!">
                              НЕТ ПРОКСИ
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600 font-mono">{row.admin_ip || '—'}</td>
                        <td className="px-4 py-3 text-sm text-slate-600">{formatDate(row.created_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </>
    );
  }

  function renderGroupsTab() {
    const GROUP_FILTERS = [
      { id: 'all', label: 'Все' },
      { id: 'admin', label: 'Админ' },
      { id: 'linked', label: 'Привязанные' },
      { id: 'unlinked', label: 'Не привязанные' }
    ];

    const filteredGroups = groups.filter((group) => {
      if (groupFilter === 'admin') return group.userbot_admin;
      if (groupFilter === 'linked') return !!group.linked_channel_id;
      if (groupFilter === 'unlinked') return !group.linked_channel_id;
      return true;
    });

    return (
      <>
        <div className="p-6 md:p-8 border-b border-slate-100">
          <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
            <div>
              <div className="text-[15px] font-bold text-slate-900">Группы и каналы</div>
              <div className="text-sm text-slate-500 mt-0.5">Все чаты где юзербот состоит.</div>
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-slate-100 text-sm font-bold text-slate-600">
              {filteredGroups.length}
            </div>
          </div>
          <div className="flex gap-2 p-1.5 bg-slate-100 rounded-2xl overflow-x-auto">
            {GROUP_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`px-4 py-2 text-[12px] font-black uppercase tracking-wider rounded-xl transition-all whitespace-nowrap ${
                  groupFilter === f.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
                onClick={() => setGroupFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {filteredGroups.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400 font-bold">Нет групп с этим фильтром.</div>
        ) : (
          <div className="divide-y divide-slate-100 border-b border-slate-100">
            {filteredGroups.map((group) => (
              <div key={group.chat_id} className="p-5 md:px-8 md:py-5 hover:bg-slate-50/50 transition-colors">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="text-[14px] font-bold text-slate-900 truncate">{group.title}</div>
                      <span className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-black uppercase ${
                        group.type === 'channel' ? 'bg-violet-50 text-violet-600 border border-violet-200' : 'bg-blue-50 text-blue-600 border border-blue-200'
                      }`}>
                        {group.type === 'channel' ? 'Канал' : 'Группа'}
                      </span>
                      {group.userbot_admin ? (
                        <span className="inline-flex px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-black uppercase">Админ</span>
                      ) : null}
                      {group.admin_check_skipped ? (
                        <span className="inline-flex px-2 py-0.5 rounded-md bg-amber-50 text-amber-600 border border-amber-200 text-[10px] font-black uppercase">Не проверено</span>
                      ) : null}
                      {group.admin_error ? (
                        <span className="text-[10px] text-red-500 font-medium">{group.admin_error}</span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-slate-500">
                      <span className="font-mono">{group.chat_id}</span>
                      {(group.unread_count || 0) > 0 ? (
                        <span className="font-bold text-blue-600">{group.unread_count} непрочитанных</span>
                      ) : null}
                      <span>В системе: {group.linked_channel_title || '—'}</span>
                    </div>
                    {group.last_message_preview ? (
                      <div className="mt-1.5 text-[13px] text-slate-600 truncate">{group.last_message_preview}</div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {group.linked_channel_id ? (
                      <a
                        className="h-8 px-3 rounded-lg bg-blue-600 text-white text-[12px] font-bold hover:bg-blue-700 transition-all inline-flex items-center"
                        href={`/app/customers?tab=customers&channel=${encodeURIComponent(group.linked_channel_id)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Клиенты
                      </a>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="p-6 md:p-8">
          <div className="text-[15px] font-bold text-slate-900 mb-0.5">Загнать по инвайту</div>
          <div className="text-sm text-slate-500 mb-4">Заведи юзербота в группу или чат по invite-ссылке.</div>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              className="h-11 flex-1 px-4 rounded-[14px] border border-slate-200 bg-slate-50 text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
              type="text"
              value={manualInviteLink}
              onChange={(event) => setManualInviteLink(event.target.value)}
              placeholder="https://t.me/+..."
            />
            <button
              className="h-11 px-5 rounded-[14px] bg-blue-600 text-[14px] font-bold text-white hover:bg-blue-700 transition-all disabled:opacity-50"
              onClick={joinInviteLink}
              disabled={actionState.joiningInvite}
            >
              {actionState.joiningInvite ? 'Заходим...' : 'Зайти'}
            </button>
          </div>
        </div>
      </>
    );
  }

  function renderMessagesTab() {
    const hasSelectedConversation = !!selectedConversation;
    const selectedTitle = selectedConversation
      ? (selectedConversation.display_name || selectedConversation.username || selectedConversation.tg_user_id)
      : '';
    const selectedInitial = (selectedTitle || '?').slice(0, 1).toUpperCase();
    const activeMessage = String(hasSelectedConversation ? replyMessage : manualDirectMessage);

    return (
      <div className="grid min-h-[640px] grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="border-b border-slate-100 bg-slate-50/60 lg:border-b-0 lg:border-r">
          <div className="border-b border-slate-100 p-5">
            <div className="text-[15px] font-bold text-slate-900">Чаты</div>
            <div className="mt-1 text-sm text-slate-500">
              {data.cache_scanned_at ? `Снимок: ${formatDate(data.cache_scanned_at)}` : 'Нажми «Проверить сейчас», чтобы собрать список.'}
            </div>
            <button
              type="button"
              className="mt-4 h-9 w-full rounded-xl border border-slate-200 bg-white text-[13px] font-bold text-slate-700 transition-all hover:bg-slate-50"
              onClick={() => {
                setThreadUserId('');
                setReplyMessage('');
              }}
            >
              Новое сообщение
            </button>
          </div>

          {sortedConversations.length === 0 ? (
            <div className="p-5 text-sm text-slate-500">Пока нет сохраненных диалогов.</div>
          ) : (
            <div className="max-h-[560px] overflow-y-auto">
              {sortedConversations.map((conversation) => {
                const title = conversation.display_name || conversation.username || conversation.tg_user_id;
                const isActive = String(threadUserId) === String(conversation.tg_user_id);
                return (
                  <button
                    key={conversation.tg_user_id}
                    type="button"
                    className={`flex w-full gap-3 border-b border-slate-100 p-4 text-left transition-colors hover:bg-white ${isActive ? 'bg-white' : ''}`}
                    onClick={() => selectConversation(conversation)}
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-sm font-black text-white">
                      {String(title || '?').slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-[14px] font-bold text-slate-900">{title}</span>
                        <span className="shrink-0 text-[11px] font-medium text-slate-400">{conversation.last_message_at ? formatDate(conversation.last_message_at) : ''}</span>
                      </span>
                      <span className="mt-1 block truncate text-[13px] text-slate-500">
                        {conversation.last_message_preview || 'Нет текста'}
                      </span>
                      <span className="mt-1 flex items-center gap-2 text-[11px] font-medium text-slate-400">
                        <span>{conversation.tg_user_id}</span>
                        {(conversation.unread_count || 0) > 0 ? (
                          <span className="rounded-full bg-blue-600 px-2 py-0.5 text-white">{conversation.unread_count}</span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        <section className="flex min-h-[640px] flex-col bg-white">
          <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
            {hasSelectedConversation ? (
              <>
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-sm font-black text-white">
                    {selectedInitial}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-bold text-slate-900">{selectedTitle}</div>
                    <div className="text-xs text-slate-500">TG ID {selectedConversation.tg_user_id}</div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="h-9 shrink-0 rounded-xl border border-slate-200 bg-white px-4 text-[13px] font-bold text-slate-700 transition-all hover:bg-slate-50 disabled:opacity-50"
                    onClick={() => loadThreadMessages(selectedConversation.tg_user_id)}
                    disabled={loadingThread}
                  >
                    {loadingThread ? 'Тянем...' : 'Обновить'}
                  </button>
                  <button
                    type="button"
                    className="h-9 shrink-0 rounded-xl border border-slate-200 bg-white px-4 text-[13px] font-bold text-slate-700 transition-all hover:bg-slate-50 disabled:opacity-50"
                    onClick={() => markConversationRead(selectedConversation.tg_user_id)}
                    disabled={actionState.markingRead || (selectedConversation.unread_count || 0) === 0}
                  >
                    {actionState.markingRead ? 'Отмечаем...' : 'Прочитано'}
                  </button>
                </div>
              </>
            ) : (
              <div>
                <div className="text-[15px] font-bold text-slate-900">Новое сообщение</div>
                <div className="text-xs text-slate-500">Нужен TG ID и общий чат, где юзербот видит человека.</div>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto bg-slate-50/40 p-5">
            {hasSelectedConversation ? (
              loadingThread ? (
                <div className="flex items-center justify-center h-full text-sm text-slate-400">
                  <span className="inline-block size-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600 mr-2" />
                  Подтягиваем переписку...
                </div>
              ) : threadUnavailable ? (
                <div className="flex flex-col items-center justify-center h-full text-center gap-2">
                  <div className="text-sm text-amber-600 font-medium">{threadUnavailable}</div>
                  <button
                    type="button"
                    className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 transition-all"
                    onClick={() => loadThreadMessages(selectedConversation.tg_user_id)}
                  >
                    Попробовать снова
                  </button>
                </div>
              ) : chatHistory.length > 0 ? (
                <div className="flex flex-col gap-3">
                  {chatHistory.map((msg, i) => (
                    <div key={i} className={`flex ${msg.outgoing ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[78%] rounded-2xl px-4 py-3 text-[14px] shadow-sm ${
                        msg.outgoing
                          ? 'bg-blue-600 text-white'
                          : 'border border-slate-200 bg-white text-slate-900'
                      }`}>
                        <div>{msg.text}</div>
                        <div className={`mt-1 text-[11px] ${msg.outgoing ? 'text-blue-100' : 'text-slate-400'}`}>
                          {msg.timestamp ? formatDate(msg.timestamp) : ''}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-center text-sm text-slate-500">
                  История сообщений пуста. Отправьте первое сообщение.
                </div>
              )
            ) : (
              <div className="flex h-full items-center justify-center text-center text-sm text-slate-500">
                Выбери чат слева или отправь новое сообщение по TG ID.
              </div>
            )}
          </div>

          <div className="border-t border-slate-100 bg-white p-4">
            {!hasSelectedConversation ? (
              <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <input
                  className="h-11 w-full px-4 rounded-[14px] border border-slate-200 bg-slate-50 text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
                  type="text"
                  value={manualTgUserId}
                  onChange={(event) => { setManualTgUserId(event.target.value); saveDraft('manual_tg', event.target.value); }}
                  placeholder="TG ID цифрами"
                />
                <select
                  className="h-11 w-full px-4 rounded-[14px] border border-slate-200 bg-slate-50 text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
                  value={manualCommonChatId}
                  onChange={(event) => { setManualCommonChatId(event.target.value); saveDraft('manual_chat', event.target.value); }}
                >
                  <option value="">Выбери общий чат</option>
                  {commonChatGroups.map((group) => (
                    <option key={group.chat_id} value={group.chat_id}>
                      {group.title} • {group.userbot_admin ? 'админ' : (group.admin_check_skipped ? 'видит чат' : 'участник')} • {group.chat_id}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="flex items-end gap-3">
              <textarea
                className="min-h-[48px] flex-1 resize-none rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3 text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
                rows={2}
                value={activeMessage}
                onChange={(event) => {
                  if (hasSelectedConversation) {
                    setReplyMessage(event.target.value);
                    saveDraft('reply', event.target.value);
                  } else {
                    setManualDirectMessage(event.target.value);
                    saveDraft('manual_msg', event.target.value);
                  }
                }}
                placeholder={hasSelectedConversation ? 'Сообщение в этот чат' : 'Текст сообщения'}
              />
              <button
                className="h-11 shrink-0 rounded-[14px] bg-blue-600 px-5 text-[14px] font-bold text-white transition-all hover:bg-blue-700 disabled:opacity-50"
                onClick={hasSelectedConversation ? sendReply : sendDirectMessage}
                disabled={hasSelectedConversation ? actionState.sendingReply : actionState.sendingDirect}
              >
                {(hasSelectedConversation ? actionState.sendingReply : actionState.sendingDirect) ? 'Шлем...' : 'Отправить'}
              </button>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <section className="page">
      {profilePlan === 'trial' ? (
        <>
          <PlanBanner
            tone={trialUpgradeUrgent ? 'warning' : 'info'}
            title={trialUpgradeUrgent ? 'Trial скоро закончится: userbot center пора вести на Normal' : 'Userbot Center на Trial — это быстрый пробный контур'}
            text={trialUpgradeUrgent
              ? `До конца trial осталось около ${trialHoursLeft} ч. Если уже работаешь с личками, сигналами и ручным дожимом, не тяни с апгрейдом: Normal нужен для стабильного рабочего ритма.`
              : 'На Trial можно собрать первый живой triage по входящим. Но как только userbot становится рабочим closеr-инструментом, переводи кабинет на Normal.'}
          />
          <UpgradeCallout
            compact
            title="Userbot уже приносит входящие — не держи этот контур в trial."
            text="Если здесь уже есть лички, сигналы покупки и ручной дожим, это основной рабочий экран. Normal нужен, чтобы дальше жить без ознакомительных стопоров."
          />
        </>
      ) : null}

      {state.loading && initialHandoff ? (
        <div className="mb-4 p-3 rounded-2xl bg-blue-50 border border-blue-200 text-blue-800 font-medium text-sm flex items-center gap-2">
          <span className="inline-block size-3 animate-spin rounded-full border-2 border-blue-400 border-t-blue-700" />
          Подтягиваем данные юзербота...
        </div>
      ) : null}

      {state.scanRequired ? (
        <div className="mb-4 p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 font-medium text-sm">
          Экран открылся в safe-preview режиме. Нажми «Проверить сейчас» чтобы подтянуть живые данные из Telegram.
        </div>
      ) : null}

      <div className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
        <div className="p-6 md:p-8 border-b border-slate-100">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-3">
              <select
                className="h-11 px-4 rounded-[14px] border border-slate-200 bg-slate-50 text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
                value={selectedUserbotId}
                onChange={(event) => setSelectedUserbotId(event.target.value)}
              >
                <option value="">Выбери юзербота</option>
                {userbots.map((userbot) => (
                  <option key={userbot.id} value={userbot.id}>
                    {userbot.tg_username ? `@${userbot.tg_username}` : `ID ${userbot.tg_account_id}`}
                    {userbot.proxy_name ? ` • ${userbot.proxy_name}` : ''}
                    {userbot.proxy_country ? ` • ${userbot.proxy_country}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button
                className="inline-flex h-9 items-center justify-center gap-2 px-4 rounded-xl bg-blue-600 text-white text-[13px] font-bold hover:bg-blue-700 transition-all disabled:opacity-50"
                onClick={refreshCenterNow}
                disabled={state.refreshing}
              >
                {state.refreshing ? (
                  <>
                    <span className="inline-block size-3 animate-spin rounded-full border-2 border-white/50 border-t-white" />
                    <span>Проверяем {formatElapsed(scanElapsedSeconds)}</span>
                  </>
                ) : 'Проверить сейчас'}
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center gap-2 px-4 rounded-xl bg-slate-900 text-white text-[13px] font-bold hover:bg-slate-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={() => {
                  if (!selectedUserbotId) return;
                  window.open(`/app/telegram-web/${selectedUserbotId}`, '_blank', 'noopener');
                }}
                disabled={!selectedUserbotId}
                title={selectedUserbotId ? 'Открыть полноценный Telegram Web для этого юзербота' : 'Сначала выбери юзербота'}
              >
                Telegram Web
              </button>
            </div>
          </div>

          <div className="flex gap-2 p-1.5 bg-slate-100 rounded-2xl overflow-x-auto">
            {TAB_OPTIONS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`flex-1 px-4 py-2.5 text-[13px] font-black uppercase tracking-wider rounded-xl transition-all whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {activeTab === 'profile' ? renderProfileTab() : null}
        {activeTab === 'groups' ? renderGroupsTab() : null}
        {activeTab === 'messages' ? renderMessagesTab() : null}
      </div>
    </section>
  );
}
