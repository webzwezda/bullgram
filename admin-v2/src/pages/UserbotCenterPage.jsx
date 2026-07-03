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
  const [activeTab, setActiveTab] = useState('profile');
  const [chatHistory, setChatHistory] = useState(() => initialThreadUserId ? loadHistory(initialThreadUserId) : []);
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
  const [telegramWebEnabled, setTelegramWebEnabled] = useState(true);
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
    fetch('/api/userbot-web/status', { method: 'GET' })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (cancelled || !data) return;
        setTelegramWebEnabled(Boolean(data.enabled));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

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
      toast.error('Вставь ссылку на группу или чат.');
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
    { id: 'groups', label: 'Вступить' }
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
      </>
    );
  }

  function renderGroupsTab() {
    return (
      <div className="p-6 md:p-8">
        <div className="text-[15px] font-bold text-slate-900 mb-0.5">Вступить в группу или чат</div>
        <div className="text-sm text-slate-500 mb-4">
          Любая ссылка: публичная (t.me/groupname, @groupname), приватная (t.me/+hash, t.me/joinchat/hash) или s/-превью (t.me/s/groupname).
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            className="h-11 flex-1 px-4 rounded-[14px] border border-slate-200 bg-slate-50 text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
            type="text"
            value={manualInviteLink}
            onChange={(event) => setManualInviteLink(event.target.value)}
            placeholder="t.me/groupname, @groupname или t.me/+hash"
          />
          <button
            className="h-11 px-5 rounded-[14px] bg-blue-600 text-[14px] font-bold text-white hover:bg-blue-700 transition-all disabled:opacity-50"
            onClick={joinInviteLink}
            disabled={actionState.joiningInvite}
          >
            {actionState.joiningInvite ? 'Заходим...' : 'Вступить'}
          </button>
        </div>
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
              {telegramWebEnabled ? (
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
              ) : null}
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
      </div>

      {selectedUserbotId ? (
        <div className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden mt-6">
          <div className="p-6 md:p-8 border-b border-slate-100">
            <div className="text-[15px] font-bold text-slate-900">Активные сессии</div>
            <div className="text-sm text-slate-500 mt-1">
              Залогиненные устройства. Можно выкинуть все, кроме серверной сессии BullRun.
            </div>
          </div>

          <div className="p-6 md:p-8">
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
        </div>
      ) : null}
    </section>
  );
}
