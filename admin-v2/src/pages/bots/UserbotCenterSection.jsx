import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import {
  UserPlus, Smartphone, RefreshCw, ExternalLink, User, LogOut, Loader2,
  Network, Activity, KeyRound, AlertCircle, Settings2, Trash2, Tag
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UserbotCombobox } from '@/components/bots/UserbotCombobox';
import { apiRequest } from '../../api/client.js';
import { useAuth } from '../../app/providers/AuthProvider.jsx';
import { LoadingState } from '../../ui/LoadingState.jsx';
import { PlanBanner } from '../../ui/PlanBanner.jsx';
import { StatCard } from '../../ui/StatCard.jsx';
import { UpgradeCallout } from '../../ui/UpgradeCallout.jsx';
import { UserbotSaleComposer } from './UserbotSaleComposer.jsx';

function formatDate(value) {
  if (!value) return 'Нет данных';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
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

function StatusBadge({ tone, children, className = '' }) {
  const colorMap = {
    success: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    warning: 'bg-amber-100 text-amber-800 border-amber-200',
    error: 'bg-rose-100 text-rose-800 border-rose-200',
    danger: 'bg-rose-100 text-rose-800 border-rose-200',
    ok: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    default: 'bg-slate-100 text-slate-700 border-slate-200'
  };
  return (
    <span className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold tracking-wide transition-colors ${colorMap[tone] || colorMap.default} ${className}`}>
      {children}
    </span>
  );
}

function ModernSwitch({ checked, onChange, disabled, activeColor = 'bg-indigo-600' }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? activeColor : 'bg-slate-200'
      }`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

export function UserbotCenterSection({
  selectedLiveUserbot,
  selectedLiveUserbotId,
  binding,
  recovery,
  accountCheckReport,
  accountBindingFeedback,
  accountRestoreFeedback,
  bindingAccountId,
  checkingAccountId,
  togglingSafeModeId,
  restoringAccountId,
  saveBinding,
  updateBinding,
  checkAccount,
  toggleSafeMode,
  restoreAccount,
  patchLiveUserbot,
  proxyLabel,
  availableBindingProxiesForAccount,
  availableFailoverProxiesForAccount,
  canRestoreFromFiles,
  defaultCheckLines,
  formatWhen,
  liveUserbots,
  setSelectedLiveUserbotId,
  deleteAccount,
  deletingAccountId,
  restrictedMarker,
  recoveryStatusBadge,
  canSellUserbotAssets,
  saleComposer,
  setSaleComposer,
  saveUserbotSaleLot,
  toggleSalePaymentMethod,
  openSaleComposer
}) {
  const location = useLocation();
  const sectionRef = useRef(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const hasDeep = params.get('userbot_id') || params.get('tg_user_id');
    if (hasDeep && sectionRef.current) {
      const timer = setTimeout(() => {
        sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [location.search]);
  const { accessToken, profilePlan, trialEndsAt } = useAuth();
  const [initialHandoff] = useState(() => consumeUserbotCenterHandoff());
  const handoffLoadDoneRef = useRef(false);
  const initialParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const initialThreadUserId = String(initialParams.get('tg_user_id') || initialHandoff?.tg_user_id || '').trim();
  const initialCommonChatId = String(initialHandoff?.common_chat_id || '').trim();
  const initialDraftMessage = String(initialHandoff?.draft_message || '').trim();
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
  const [actionState, setActionState] = useState({
    sendingReply: false,
    joiningInvite: false,
    sendingDirect: false,
    markingRead: false,
    loadingAuthorizations: false,
    resettingAuthorizations: false,
    resettingAuthorizationHash: ''
  });
  const [authorizationsState, setAuthorizationsState] = useState({
    loading: false,
    error: '',
    rows: []
  });
  const [profileSyncState, setProfileSyncState] = useState({
    pulling: false,
    saving: false,
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
  const [labelDraft, setLabelDraft] = useState('');
  const [labelAccountId, setLabelAccountId] = useState('');
  const [labelSaving, setLabelSaving] = useState(false);
  const trialHoursLeft = useMemo(() => {
    if (!trialEndsAt) return null;
    const diffMs = new Date(trialEndsAt).getTime() - Date.now();
    if (diffMs <= 0) return 0;
    return Math.ceil(diffMs / (1000 * 60 * 60));
  }, [trialEndsAt]);
  const trialUpgradeUrgent = profilePlan === 'trial' && trialHoursLeft !== null && trialHoursLeft > 0 && trialHoursLeft <= 72;

  function applyCenterData(nextData, preferredUserbotId = selectedLiveUserbotId, preferredThreadUserId = threadUserId) {
    const nextConversations = nextData.conversations || [];
    const nextThreadUserId = nextConversations.some((item) => String(item.tg_user_id) === String(preferredThreadUserId))
      ? String(preferredThreadUserId)
      : '';

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
    if (selectedLiveUserbotId) params.set('userbot_id', selectedLiveUserbotId);
    if (scan) params.set('scan', 'true');
    const query = params.toString() ? `?${params.toString()}` : '';
    try {
      const nextData = await apiRequest(`/api/userbot/ops-center${query}`, { accessToken });
      applyCenterData(nextData, selectedLiveUserbotId, preferredThreadUserId);
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

  async function loadAuthorizations() {
    if (!accessToken || !selectedLiveUserbotId) {
      setAuthorizationsState({ loading: false, error: '', rows: [] });
      return;
    }

    setAuthorizationsState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const query = new URLSearchParams({ userbot_id: selectedLiveUserbotId });
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

  async function syncSelectedUserbotProfile() {
    if (!accessToken || !selectedLiveUserbotId) return;

    setProfileSyncState({ pulling: true, saving: false, tone: 'default', text: '' });
    try {
      const result = await apiRequest(`/api/userbot/profile/${selectedLiveUserbotId}/sync`, {
        accessToken,
        method: 'POST'
      });

      if (result.account) {
        patchLiveUserbot(result.account.id, result.account);
      }

      const message = result.message || (result.cached ? 'Показываем сохраненный профиль.' : 'Профиль стянут из Telegram.');
      if (result.cached) {
        toast.warning(message);
      } else {
        toast.success(message);
      }
      setProfileSyncState({ pulling: false, saving: false, tone: 'default', text: '' });
    } catch (error) {
      toast.error(`Не получилось стянуть профиль: ${error.message}`);
      setProfileSyncState({ pulling: false, saving: false, tone: 'error', text: error.message });
    }
  }

  async function saveSelectedUserbotProfile() {
    if (!accessToken || !selectedLiveUserbotId) return;
    const firstName = String(profileDraft.firstName || '').trim();
    const lastName = String(profileDraft.lastName || '').trim();
    const about = String(profileDraft.about || '').trim();

    if (!firstName) {
      setProfileSyncState({
        pulling: false,
        saving: false,
        tone: 'error',
        text: 'Имя Telegram-аккаунта не может быть пустым.'
      });
      return;
    }

    setProfileSyncState({ pulling: false, saving: true, tone: 'default', text: '' });
    try {
      const result = await apiRequest(`/api/userbot/profile/${selectedLiveUserbotId}/update`, {
        accessToken,
        method: 'POST',
        body: {
          first_name: firstName,
          last_name: lastName,
          about
        }
      });

      if (result.account) {
        patchLiveUserbot(result.account.id, result.account);
      }

      setProfileSyncState({
        pulling: false,
        saving: false,
        tone: 'success',
        text: result.message || 'Профиль сохранен в Telegram и Supabase.'
      });
      toast.success(result.message || 'Профиль сохранен в Telegram.');
    } catch (error) {
      setProfileSyncState({
        pulling: false,
        saving: false,
        tone: 'error',
        text: error.message
      });
      toast.error(`Не получилось сохранить: ${error.message}`);
    }
  }

  async function saveAllChanges() {
    if (!accessToken || !selectedLiveUserbotId || !selectedLiveUserbot) return;
    if (!hasUnsavedChanges) return;

    const parts = [];
    if (profileDirty) parts.push('профиль');
    if (bindingDirty) parts.push('настройки прокси');

    if (!window.confirm(`Сохранить ${parts.join(' и ')} в Telegram?`)) return;

    if (profileDirty) {
      await saveSelectedUserbotProfile();
    }
    if (bindingDirty) {
      await saveBinding(selectedLiveUserbotId);
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
        if (selectedLiveUserbotId) params.set('userbot_id', selectedLiveUserbotId);
        if (initialThreadUserId && !initialHandoff) params.set('scan', 'true');
        const query = params.toString() ? `?${params.toString()}` : '';
        const data = await apiRequest(`/api/userbot/ops-center${query}`, { accessToken });
        if (cancelled) return;
        applyCenterData(data, selectedLiveUserbotId, threadUserId || initialThreadUserId);
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
  }, [accessToken, selectedLiveUserbotId]);

  useEffect(() => {
    if (!initialThreadUserId) return;
    setManualTgUserId((prev) => prev || initialThreadUserId);
  }, [initialThreadUserId]);

  useEffect(() => {
    setAuthorizationsState({ loading: false, error: '', rows: [] });
    setProfileSyncState({ pulling: false, saving: false, tone: 'default', text: '' });
  }, [accessToken, selectedLiveUserbotId]);

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
  const selectedUserbot = selectedLiveUserbot;
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

  useEffect(() => {
    if (!selectedUserbot?.id) {
      setLabelDraft('');
      setLabelAccountId('');
      return;
    }
    setLabelDraft(selectedUserbot.custom_label || '');
    setLabelAccountId(String(selectedUserbot.id));
  }, [selectedUserbot?.id, selectedUserbot?.custom_label]);

  const labelDirty = labelAccountId === String(selectedUserbot?.id || '') && labelDraft.trim() !== (selectedUserbot?.custom_label || '').trim();

  async function saveCustomLabel() {
    if (!accessToken || !selectedUserbot?.id || !labelDirty) return;
    const trimmed = labelDraft.trim().slice(0, 100);
    setLabelSaving(true);
    try {
      const result = await apiRequest(`/api/userbot/custom-label/${selectedUserbot.id}`, {
        accessToken,
        method: 'PATCH',
        body: { custom_label: trimmed }
      });
      patchLiveUserbot(selectedUserbot.id, { custom_label: result.custom_label || '' });
    } catch (error) {
      toast.error(`Не удалось сохранить метку: ${error.message}`);
    } finally {
      setLabelSaving(false);
    }
  }

  useEffect(() => {
    if (activeTab !== 'sale') return;
    if (!selectedLiveUserbot) return;
    if (saleComposer.accountId === String(selectedLiveUserbot.id)) return;
    openSaleComposer(selectedLiveUserbot);
  }, [activeTab, selectedLiveUserbot, saleComposer.accountId, openSaleComposer]);

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
  const bindingDirty = !!selectedUserbot && !!binding && (
    String(binding.proxy_id || '') !== String(selectedUserbot.proxy_id || '') ||
    !!binding.allow_proxy_failover !== !!selectedUserbot.allow_proxy_failover ||
    (binding.failover_proxy_ids || []).slice().sort().join('|') !==
      (Array.isArray(selectedUserbot.failover_proxy_ids) ? selectedUserbot.failover_proxy_ids.map(String) : []).slice().sort().join('|')
  );
  const hasUnsavedChanges = profileDirty || bindingDirty;

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
    if (!accessToken || !selectedLiveUserbotId) {
      setThreadUnavailable('Выберите юзербота');
      return;
    }
    setLoadingThread(true);
    setThreadUnavailable('');
    try {
      const params = new URLSearchParams({ tg_user_id: tgUserId, userbot_id: selectedLiveUserbotId });
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
    if (!tgUserId || !selectedLiveUserbotId) return;

    setActionState((prev) => ({ ...prev, markingRead: true }));
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      await apiRequest('/api/userbot/ops-center/mark-read', {
        accessToken,
        method: 'POST',
        body: {
          tg_user_id: String(tgUserId),
          userbot_id: selectedLiveUserbotId
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
          userbot_id: selectedLiveUserbotId || null,
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
    if (!selectedLiveUserbotId) {
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
          userbot_id: selectedLiveUserbotId,
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

    if (!selectedLiveUserbotId) {
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
          userbot_id: selectedLiveUserbotId,
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
    if (!selectedLiveUserbotId) {
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
          userbot_id: selectedLiveUserbotId
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

  async function resetOneSession(row) {
    if (!selectedLiveUserbotId) {
      toast.error('Сначала выбери юзербота.');
      return;
    }
    if (!row?.hash) {
      toast.error('У этой сессии нет hash — её нельзя разлогинить точечно.');
      return;
    }
    if (row.current) {
      toast.error('Текущую серверную сессию нельзя разлогинить.');
      return;
    }
    const label = row.device_model || row.app_name || row.platform || 'устройство';
    if (!window.confirm(`Разлогинить «${label}»? На этом устройстве придётся заново входить в Telegram.`)) {
      return;
    }

    setActionState((prev) => ({ ...prev, resettingAuthorizationHash: row.hash }));
    try {
      const data = await apiRequest('/api/userbot/ops-center/authorizations/reset-one', {
        accessToken,
        method: 'POST',
        body: {
          userbot_id: selectedLiveUserbotId,
          hash: row.hash
        }
      });
      setAuthorizationsState({
        loading: false,
        error: '',
        rows: data.authorizations || []
      });
      toast.success(data.message || 'Устройство разлогинено.');
    } catch (error) {
      toast.error(`Не получилось разлогинить устройство: ${error.message}`);
    } finally {
      setActionState((prev) => ({ ...prev, resettingAuthorizationHash: '' }));
    }
  }

  if (state.loading && !initialHandoff) {
    return <LoadingState text="Тянем живой Центр юзербота..." />;
  }

  if (state.error) {
    return (
      <section ref={sectionRef} id="userbot-center" className="scroll-mt-4">
        <div className="error-card">{state.error}</div>
        {needsBotsRecovery(state.error) ? (
          <div className="toolbar-card" style={{ marginTop: 16 }}>
            <div className="toolbar-card__title">Что делать дальше</div>
            <div className="list-stack">
              <div className="list-item">
                <div className="list-item__title">Проверь onboarding выше на этой же странице</div>
                <div className="list-item__meta">
                  Там живой onboarding: QR, импорт `.session/.json`, смена прокси и удаление мертвого аккаунта. Попробуй обновить страницу или заново выбрать юзербота.
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    );
  }

  const TAB_OPTIONS = [
    {
      id: 'profile',
      label: 'Профиль',
      icon: User,
      title: 'Профиль',
      subtitle: 'Аккаунт, прокси, аватар, описание',
    },
    {
      id: 'groups',
      label: 'Вступить',
      icon: UserPlus,
      title: 'Вступить в группу или чат',
      subtitle: 'По ссылке t.me/groupname, @username или +hash',
    },
    ...(canSellUserbotAssets ? [{
      id: 'sale',
      label: 'Продать',
      icon: Tag,
      title: 'Продать',
      subtitle: 'Выставить лот в Shop за TON',
    }] : [])
  ];

  function renderProfileTab() {
    if (!selectedLiveUserbot) return null;
    const runtimeStatus = String(selectedLiveUserbot.runtime_status || '');
    const isSafeMode = runtimeStatus === 'pending_activation';
    const isCombatMode = !isSafeMode;
    const hasRecoveryInfo = !!(recovery?.last_restored_at || recovery?.last_restore_error);
    const showRecoveryNextStep = !recovery && ['expired', 'error'].includes(runtimeStatus);

    return (
      <>
        <div className="p-6 md:p-8">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-2 h-2 rounded-full bg-indigo-400" />
              <div className="text-[15px] font-bold text-slate-900">Профиль аккаунта</div>
            </div>
            <div className="mb-6 rounded-2xl bg-indigo-50/40 border border-indigo-100 p-4">
              <label className="block text-[11px] font-bold uppercase tracking-[0.1em] text-indigo-500 mb-2">Название аккаунта</label>
              <div className="flex gap-2">
                <input
                  className="h-11 flex-1 px-4 rounded-xl border border-slate-200 bg-white text-[14px] font-medium text-slate-950 outline-none transition shadow-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
                  value={labelDraft}
                  maxLength={100}
                  onChange={(event) => setLabelDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && labelDirty && !labelSaving) saveCustomLabel();
                  }}
                  placeholder="Например: Вася, Админ группы, Основной аккаунт"
                />
                {labelDirty ? (
                  <button
                    type="button"
                    className="h-11 px-5 rounded-xl bg-indigo-600 text-white text-[13px] font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 shadow-sm whitespace-nowrap"
                    onClick={saveCustomLabel}
                    disabled={labelSaving}
                  >
                    {labelSaving ? '...' : 'Сохранить'}
                  </button>
                ) : null}
              </div>
            </div>
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex min-w-0 items-start gap-4">
                <div className="size-16 shrink-0 overflow-hidden rounded-2xl ring-1 ring-slate-200">
                  {selectedProfilePhotoSrc ? (
                    <img src={selectedProfilePhotoSrc} alt="" className="size-16 object-cover" />
                  ) : (
                    <span className="flex size-16 items-center justify-center bg-slate-900 text-[22px] font-black text-white">
                      {selectedProfileInitial}
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[20px] font-black tracking-tight text-slate-950">
                    {selectedProfileName || 'Имя пока не подтянуто'}
                  </div>
                  {(() => {
                    const parts = [
                      selectedUserbot.tg_username ? `@${selectedUserbot.tg_username}` : '',
                      selectedUserbot.tg_phone || '',
                      selectedUserbot.tg_account_id ? `ID ${selectedUserbot.tg_account_id}` : ''
                    ].filter(Boolean);
                    if (!parts.length) return null;
                    return (
                      <div className="mt-1 text-[13px] font-medium text-slate-500 truncate">
                        {parts.join(' • ')}
                      </div>
                    );
                  })()}
                  <div className="mt-1 text-[12px] font-medium text-slate-400">
                    Последнее обновление: {selectedProfileSyncedAt}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="h-10 px-4 rounded-xl border border-slate-200 bg-white text-slate-700 text-[13px] font-bold hover:bg-slate-50 transition-all disabled:opacity-50 shadow-sm"
                  onClick={syncSelectedUserbotProfile}
                  disabled={profileSyncState.pulling || profileSyncState.saving || !selectedLiveUserbotId}
                >
                  {profileSyncState.pulling ? 'Тянем из Telegram...' : 'Стянуть из Telegram'}
                </button>
                {telegramWebEnabled ? (
                  <button
                    type="button"
                    className="h-10 px-4 rounded-xl bg-slate-900 text-white text-[13px] font-bold hover:bg-slate-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2 shadow-sm"
                    onClick={() => {
                      if (!selectedLiveUserbotId) return;
                      window.open(`/app/telegram-web/${selectedLiveUserbotId}`, '_blank', 'noopener');
                    }}
                    disabled={!selectedLiveUserbotId}
                    title={selectedLiveUserbotId ? 'Открыть полноценный Telegram Web для этого юзербота' : 'Сначала выбери юзербота'}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Telegram Web
                  </button>
                ) : null}
              </div>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2 md:items-start">
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">Имя</label>
                  <input
                    className="h-11 w-full px-4 rounded-xl border border-slate-200 bg-white text-[14px] font-medium text-slate-950 outline-none transition shadow-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
                    value={selectedDraftFirstName}
                    maxLength={64}
                    onChange={(event) => setProfileDraft((prev) => ({ ...prev, firstName: event.target.value }))}
                    placeholder="Имя аккаунта"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">Фамилия</label>
                  <input
                    className="h-11 w-full px-4 rounded-xl border border-slate-200 bg-white text-[14px] font-medium text-slate-950 outline-none transition shadow-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
                    value={selectedDraftLastName}
                    maxLength={64}
                    onChange={(event) => setProfileDraft((prev) => ({ ...prev, lastName: event.target.value }))}
                    placeholder="Фамилия аккаунта"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">Описание</label>
                <textarea
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-[14px] font-medium text-slate-950 outline-none transition shadow-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 resize-none"
                  rows={4}
                  value={selectedDraftAbout}
                  maxLength={70}
                  onChange={(event) => setProfileDraft((prev) => ({ ...prev, about: event.target.value }))}
                  placeholder="Описание профиля"
                />
                <div className="text-[12px] font-medium text-slate-500">{selectedDraftAbout.length}/70</div>
              </div>
            </div>

            {profileDirty ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="h-10 px-4 rounded-xl border border-slate-200 bg-white text-slate-700 text-[13px] font-bold hover:bg-slate-50 transition-all disabled:opacity-50 shadow-sm"
                  onClick={() => setProfileDraft({
                    accountId: String(selectedUserbot.id),
                    firstName: selectedUserbot.tg_first_name || '',
                    lastName: selectedUserbot.tg_last_name || '',
                    about: selectedUserbot.tg_about || ''
                  })}
                  disabled={profileSyncState.pulling || profileSyncState.saving}
                >
                  Отменить
                </button>
              </div>
            ) : null}

            {selectedUserbot.tg_profile_sync_error ? (
              <div className="mt-4 p-3 rounded-[14px] bg-red-50 border border-red-200 text-[13px] font-medium text-red-700">
                Ошибка профиля{selectedProfileAttemptedAt ? ` (${selectedProfileAttemptedAt})` : ''}: {selectedUserbot.tg_profile_sync_error}
              </div>
            ) : null}
          </div>

          <div className="p-6 md:p-8 border-t border-slate-100 grid gap-6 lg:grid-cols-2">
            <div>
              <div className="flex items-center gap-2 mb-3 px-1">
                <Network className="w-4 h-4 text-indigo-500" />
                <h3 className="text-sm font-bold text-slate-900">Соединение</h3>
              </div>

              <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 space-y-4 shadow-sm">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Основной прокси</label>
                  <Select
                    value={binding?.proxy_id || ''}
                    onValueChange={(value) => updateBinding(selectedLiveUserbot.id, { proxy_id: value })}
                  >
                    <SelectTrigger className={`w-full rounded-xl shadow-sm ${binding?.proxy_id ? 'bg-white border-slate-200' : 'border-rose-300 bg-rose-50/40'}`}>
                      {binding?.proxy_id ? (
                        <span className="size-2 rounded-full bg-emerald-500 shrink-0" />
                      ) : (
                        <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                      )}
                      <SelectValue placeholder="Не назначен — выбрать..." />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      {availableBindingProxiesForAccount(selectedLiveUserbot).map((item) => (
                        <SelectItem key={item.id} value={item.id} className="rounded-lg">
                          {proxyLabel(item)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="h-px w-full bg-slate-200/60 my-2"></div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Автозамена прокси</label>
                      <p className="text-[11px] text-slate-400 mt-0.5">Переезд при падении основного</p>
                    </div>
                    <ModernSwitch
                      checked={!!binding?.allow_proxy_failover}
                      onChange={() => updateBinding(selectedLiveUserbot.id, { allow_proxy_failover: !binding?.allow_proxy_failover })}
                      activeColor="bg-emerald-500"
                    />
                  </div>

                  {binding?.allow_proxy_failover && (
                    <div className="pt-2 animate-in fade-in slide-in-from-top-1">
                      {(() => {
                        const failoverOptions = availableFailoverProxiesForAccount(selectedLiveUserbot);
                        return failoverOptions.length ? (
                          <select
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-shadow min-h-[100px]"
                            multiple
                            value={(binding?.failover_proxy_ids || []).filter((id) =>
                              failoverOptions.some((item) => String(item.id) === String(id))
                            )}
                            onChange={(event) => updateBinding(selectedLiveUserbot.id, {
                              failover_proxy_ids: Array.from(event.target.selectedOptions).map((option) => option.value)
                            })}
                          >
                            {failoverOptions.map((item) => (
                              <option key={item.id} value={item.id} className="py-1">{proxyLabel(item)}</option>
                            ))}
                          </select>
                        ) : (
                          <div className="text-sm text-slate-500 bg-slate-100/50 rounded-xl p-3 border border-dashed border-slate-200 text-center">
                            Нет доступных прокси
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-3 px-1">
                <Activity className="w-4 h-4 text-emerald-500" />
                <h3 className="text-sm font-bold text-slate-900">Состояние сессии</h3>
              </div>

              <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 space-y-4 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Боевой режим</p>
                    <p className="text-xs text-slate-500 mt-0.5">Выключите для перевода в Safe Mode</p>
                  </div>
                  <ModernSwitch
                    checked={isCombatMode}
                    onChange={() => toggleSafeMode(selectedLiveUserbot)}
                    disabled={checkingAccountId === String(selectedLiveUserbot.id) || togglingSafeModeId === String(selectedLiveUserbot.id)}
                    activeColor="bg-emerald-500"
                  />
                </div>

                <Button
                  className="w-full rounded-xl shadow-sm"
                  size="lg"
                  onClick={() => checkAccount(selectedLiveUserbot)}
                  disabled={checkingAccountId === String(selectedLiveUserbot.id) || togglingSafeModeId === String(selectedLiveUserbot.id)}
                  variant={isSafeMode ? "default" : "secondary"}
                >
                  {checkingAccountId === String(selectedLiveUserbot.id) || togglingSafeModeId === String(selectedLiveUserbot.id) ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {isSafeMode ? 'Активация...' : 'Проверка...'}</>
                  ) : (
                    isSafeMode ? 'Выполнить активацию' : 'Проверить Telegram'
                  )}
                </Button>

                <div className="flex flex-wrap gap-2 pt-1">
                  {(accountCheckReport.accountId === String(selectedLiveUserbot.id) && accountCheckReport.lines.length
                    ? accountCheckReport.lines
                    : defaultCheckLines()
                  ).map((line, index) => (
                    <StatusBadge key={`${line.label}-${index}`} tone={line.tone}>
                      {line.label}
                    </StatusBadge>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {(hasRecoveryInfo || showRecoveryNextStep) && (
            <div className="p-6 md:p-8 border-t border-slate-100">
              <div className="flex items-center gap-2 mb-3 px-1">
                <KeyRound className="w-4 h-4 text-slate-500" />
                <h3 className="text-sm font-bold text-slate-900">Восстановление</h3>
              </div>
              <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 shadow-sm space-y-3">
                {recovery?.last_restored_at && (
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-500">Последний подъем:</span>
                    <span className="font-medium text-slate-900">{formatWhen(recovery.last_restored_at)}</span>
                  </div>
                )}
                {recovery?.last_restore_error && (
                  <p className="text-sm text-rose-600 bg-rose-50 p-2 rounded-lg">
                    Ошибка: {recovery.last_restore_error}
                  </p>
                )}
                {showRecoveryNextStep && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    Для подъема нужен импорт <code className="font-mono bg-white px-1 py-0.5 rounded text-xs">.session</code> и <code className="font-mono bg-white px-1 py-0.5 rounded text-xs">.json</code>.
                  </div>
                )}
                {canRestoreFromFiles(selectedLiveUserbot, recovery) && (
                  <Button
                    variant="outline"
                    size="lg"
                    className="w-full rounded-xl border-slate-200 hover:bg-slate-50"
                    onClick={() => restoreAccount(selectedLiveUserbot)}
                    disabled={restoringAccountId === String(selectedLiveUserbot.id)}
                  >
                    {restoringAccountId === String(selectedLiveUserbot.id) ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    {restoringAccountId === String(selectedLiveUserbot.id) ? 'Поднимаем...' : 'Восстановить'}
                  </Button>
                )}
                {accountRestoreFeedback.accountId === String(selectedLiveUserbot.id) && accountRestoreFeedback.text && (
                  <div className="p-3 rounded-xl bg-indigo-50 text-indigo-800 border border-indigo-100 text-sm font-medium animate-in slide-in-from-bottom-2">
                    {accountRestoreFeedback.text}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="p-6 md:p-8 border-t border-slate-100 sticky bottom-0 bg-white/95 backdrop-blur-sm z-10">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3">
              {(profileSyncState.text || (accountBindingFeedback.accountId === String(selectedLiveUserbot.id) && accountBindingFeedback.text)) ? (
                <div className={`flex-1 p-3 rounded-xl border text-sm font-medium animate-in slide-in-from-bottom-2 ${
                  profileSyncState.tone === 'error' || accountBindingFeedback.tone === 'error'
                    ? 'bg-rose-50 border-rose-100 text-rose-800'
                    : profileSyncState.tone === 'success' || accountBindingFeedback.tone === 'success'
                      ? 'bg-emerald-50 border-emerald-100 text-emerald-800'
                      : 'bg-slate-50 border-slate-100 text-slate-700'
                }`}>
                  {profileSyncState.text || accountBindingFeedback.text}
                </div>
              ) : null}
              <button
                type="button"
                className={`h-11 px-6 rounded-xl text-[14px] font-bold transition-all shadow-sm inline-flex items-center justify-center gap-2 whitespace-nowrap ${
                  hasUnsavedChanges
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-200/50'
                    : 'bg-slate-100 text-slate-400 cursor-not-allowed shadow-none'
                }`}
                onClick={saveAllChanges}
                disabled={!hasUnsavedChanges || profileSyncState.saving || bindingAccountId === String(selectedLiveUserbot.id)}
              >
                {profileSyncState.saving || bindingAccountId === String(selectedLiveUserbot.id) ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Сохраняем...
                  </>
                ) : (
                  <>
                    <Settings2 className="w-4 h-4" />
                    Сохранить
                  </>
                )}
              </button>
            </div>
          </div>
        </>
    );
  }

  function renderGroupsTab() {
    return (
      <div className="p-5 sm:p-6 space-y-5 animate-fade-in">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
            <UserPlus className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-900">Вступить в группу или чат</h3>
            <p className="text-xs font-medium text-slate-500 mt-0.5">
              Любая ссылка: t.me/groupname, @groupname, t.me/+hash, t.me/joinchat/hash или t.me/s/groupname.
            </p>
          </div>
        </div>

        <div className="bg-slate-50/60 rounded-xl border border-slate-100 p-4 space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              className="h-11 flex-1 px-4 rounded-xl border border-slate-200 bg-white text-[14px] font-medium text-slate-950 outline-none transition shadow-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
              type="text"
              value={manualInviteLink}
              onChange={(event) => setManualInviteLink(event.target.value)}
              placeholder="t.me/groupname, @groupname или t.me/+hash"
            />
            <button
              className="h-11 px-5 rounded-xl bg-indigo-600 text-[14px] font-bold text-white hover:bg-indigo-700 transition-all disabled:opacity-50 shadow-sm shadow-indigo-200/50 inline-flex items-center justify-center gap-2 whitespace-nowrap"
              onClick={joinInviteLink}
              disabled={actionState.joiningInvite}
            >
              {actionState.joiningInvite ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Заходим...
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4" />
                  Вступить
                </>
              )}
            </button>
          </div>
          <div className="text-xs text-slate-500">
            Для приватного канала нужна пригласительная ссылка (t.me/+hash), не permalink (t.me/c/&lt;id&gt;).
          </div>
        </div>
      </div>
    );
  }

  function renderSaleTab() {
    if (!selectedLiveUserbot) return null;
    return (
      <div className="p-5 sm:p-6 animate-fade-in">
        <UserbotSaleComposer
          account={selectedLiveUserbot}
          saleComposer={saleComposer}
          setSaleComposer={setSaleComposer}
          toggleSalePaymentMethod={toggleSalePaymentMethod}
          saveUserbotSaleLot={saveUserbotSaleLot}
        />
      </div>
    );
  }

  return (
    <section ref={sectionRef} id="userbot-center" className="scroll-mt-4">
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
        <div className="mb-4 p-3 rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-800 font-medium text-sm flex items-center gap-2">
          <span className="inline-block size-3 animate-spin rounded-full border-2 border-indigo-400 border-t-indigo-700" />
          Подтягиваем данные юзербота...
        </div>
      ) : null}

      {selectedLiveUserbot ? (
        <div className="bg-white border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 rounded-2xl overflow-hidden">
        <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <UserbotCombobox
              accounts={liveUserbots}
              value={String(selectedLiveUserbot.id)}
              onValueChange={(value) => setSelectedLiveUserbotId(value)}
              triggerVariant="avatar"
              className="h-12 bg-white border-slate-200 shadow-sm rounded-xl gap-2.5 min-w-0 flex-1 sm:flex-initial sm:w-auto"
              align="start"
              sideOffset={4}
            />

            {(() => {
              const restrictedBadge = restrictedMarker(selectedLiveUserbot);
              const recoveryBadge = recoveryStatusBadge(recovery);
              const runtimeStatus = String(selectedLiveUserbot.runtime_status || '');
              const isSafeMode = runtimeStatus === 'pending_activation';
              if (!restrictedBadge && !recoveryBadge && !isSafeMode) return null;
              return (
                <div className="flex flex-wrap items-center gap-1.5 min-w-0 flex-1 justify-center">
                  {restrictedBadge && <StatusBadge tone="error">{restrictedBadge.text}</StatusBadge>}
                  {recoveryBadge && <StatusBadge tone={recoveryBadge.tone || 'default'}>{recoveryBadge.text}</StatusBadge>}
                  {isSafeMode && <StatusBadge tone="warning">Safe mode</StatusBadge>}
                </div>
              );
            })()}

            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 text-rose-600 hover:text-rose-700 hover:bg-rose-50 border border-rose-200 rounded-xl"
              onClick={() => deleteAccount(selectedLiveUserbot)}
              disabled={deletingAccountId === String(selectedLiveUserbot.id)}
              title="Удалить аккаунт"
            >
              {deletingAccountId === String(selectedLiveUserbot.id)
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Trash2 className="w-4 h-4" />}
            </Button>
          </div>

          {(() => {
            const runtimeStatus = String(selectedLiveUserbot.runtime_status || '');
            const isSafeMode = runtimeStatus === 'pending_activation';
            const restrictedBadge = restrictedMarker(selectedLiveUserbot);
            const hasRuntimeError = selectedLiveUserbot.runtime_error
              && ['restricted', 'dead_proxy', 'expired', 'error'].includes(runtimeStatus);

            if (isSafeMode) {
              return (
                <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
                  <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
                  <div>
                    <h4 className="text-sm font-semibold text-amber-900">Режим Safe Mode</h4>
                    <p className="text-sm text-amber-800 mt-0.5">Аккаунт ожидает живой активации перед входом в боевой контур.</p>
                  </div>
                </div>
              );
            }
            if (restrictedBadge?.detail) {
              return (
                <div className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 shadow-sm">
                  <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />
                  <div>
                    <h4 className="text-sm font-semibold text-rose-900">Ограничения</h4>
                    <p className="text-sm text-rose-800 mt-0.5">{restrictedBadge.detail}</p>
                  </div>
                </div>
              );
            }
            if (hasRuntimeError) {
              return (
                <div className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 shadow-sm">
                  <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />
                  <div>
                    <h4 className="text-sm font-semibold text-rose-900">Ошибка выполнения</h4>
                    <p className="text-sm text-rose-800 mt-0.5">{selectedLiveUserbot.runtime_error}</p>
                  </div>
                </div>
              );
            }
            return null;
          })()}

          <div className={`grid grid-cols-1 sm:grid-cols-2 ${TAB_OPTIONS.length > 2 ? 'lg:grid-cols-3' : ''} gap-3`}>
            {TAB_OPTIONS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`p-4 rounded-2xl border text-left transition-all duration-200 hover:scale-[1.01] active:scale-[0.99] cursor-pointer flex items-center gap-3 ${
                    isActive
                      ? 'border-indigo-600 bg-white ring-1 ring-indigo-600 shadow-md shadow-indigo-100/55'
                      : 'border-slate-200 bg-white/60 hover:border-slate-300 hover:bg-white/80 shadow-sm'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all shrink-0 ${
                    isActive ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-500'
                  }`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="font-bold text-sm text-slate-900">{tab.title}</h4>
                    <p className="text-xs text-slate-400 font-medium mt-0.5 truncate">{tab.subtitle}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {activeTab === 'profile' ? renderProfileTab() : null}
        {activeTab === 'groups' ? renderGroupsTab() : null}
        {activeTab === 'sale' ? renderSaleTab() : null}
        </div>
      ) : (
        <div className="bg-white border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 rounded-2xl overflow-hidden">
          <div className="p-12 text-center flex flex-col items-center justify-center">
            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4 ring-1 ring-slate-100">
              <User className="w-8 h-8 text-slate-300" />
            </div>
            <h3 className="text-base font-semibold text-slate-900">Боевых аккаунтов пока нет</h3>
            <p className="mt-1 text-sm text-slate-500 max-w-sm">
              Подключи аккаунт выше в onboarding, и его профиль, прокси и проверка сессии появятся здесь.
            </p>
          </div>
        </div>
      )}

      {selectedLiveUserbotId ? (
        <div className="bg-white border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 rounded-2xl overflow-hidden mt-6">
          <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
                <Smartphone className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-slate-900">Активные сессии</h3>
                <p className="text-xs font-medium text-slate-500 mt-0.5">
                  Залогиненные устройства. Можно выкинуть все, кроме серверной сессии Bullgram.
                </p>
              </div>
            </div>
          </div>

          <div className="p-5 sm:p-6 space-y-4">
            <div className="flex flex-wrap gap-2">
              <button
                className="h-10 px-4 rounded-xl border border-slate-200 bg-white text-slate-700 text-[13px] font-bold hover:bg-slate-50 transition-all disabled:opacity-50 inline-flex items-center gap-2 shadow-sm"
                onClick={loadAuthorizations}
                disabled={authorizationsState.loading || !selectedLiveUserbotId}
              >
                {authorizationsState.loading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                {authorizationsState.loading ? 'Тянем сессии...' : 'Показать сессии'}
              </button>
              <button
                className="h-10 px-4 rounded-xl border border-rose-200 bg-white text-rose-600 text-[13px] font-bold hover:bg-rose-50 transition-all disabled:opacity-50 inline-flex items-center gap-2 shadow-sm"
                onClick={resetOtherSessions}
                disabled={actionState.resettingAuthorizations || !selectedLiveUserbotId}
              >
                {actionState.resettingAuthorizations ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <LogOut className="w-3.5 h-3.5" />
                )}
                {actionState.resettingAuthorizations ? 'Чистим...' : 'Разлогинить остальные'}
              </button>
            </div>
            {authorizationsState.error ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 font-medium">
                {authorizationsState.error}
              </div>
            ) : authorizationsState.loading ? (
              <div className="text-sm text-slate-500 font-medium">Тянем авторизации...</div>
            ) : authorizationsState.rows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 px-4 py-8 text-center">
                <div className="mx-auto w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-2">
                  <Smartphone className="w-5 h-5" />
                </div>
                <p className="text-sm font-medium text-slate-500">Нажми «Показать сессии», чтобы загрузить список.</p>
              </div>
            ) : (
              <div className="overflow-x-auto -mx-2 rounded-xl border border-slate-100">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Устройство</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Приложение</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Где</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Последний движ</th>
                      <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">Действие</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {authorizationsState.rows.map((item) => {
                      const isResetting = actionState.resettingAuthorizationHash === item.hash;
                      const canReset = !item.current && !!item.hash;
                      return (
                        <tr key={item.hash || `${item.app_name}-${item.date_active}`} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3">
                            <div className="font-bold text-slate-900 flex items-center gap-2 flex-wrap">
                              {item.current ? 'Серверная сессия' : (item.device_model || item.platform || 'Устройство')}
                              {item.current ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1 animate-pulse" />
                                  Bullgram
                                </span>
                              ) : null}
                            </div>
                            <div className="text-xs text-slate-500 mt-0.5">
                              {item.current ? 'Текущая серверная сессия' : `${item.platform || ''} ${item.system_version || ''}`.trim()}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-slate-800">{item.app_name || 'Telegram'}</div>
                            <div className="text-xs text-slate-500">{item.app_version || '—'}{item.official_app ? ' • official' : ''}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-slate-800">{item.country || '—'}</div>
                            <div className="text-xs text-slate-500 font-mono">{item.ip || '—'}{item.region ? ` • ${item.region}` : ''}</div>
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-600">{formatDate(item.date_active || item.date_created)}</td>
                          <td className="px-4 py-3 text-right">
                            {item.current ? (
                              <span className="text-xs text-slate-400 font-medium">нельзя</span>
                            ) : (
                              <button
                                type="button"
                                className="h-8 px-3 rounded-lg border border-rose-200 bg-white text-rose-600 text-[12px] font-bold hover:bg-rose-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                                onClick={() => resetOneSession(item)}
                                disabled={!canReset || isResetting || actionState.resettingAuthorizationHash !== ''}
                                title={!canReset ? 'Эту сессию нельзя разлогинить отсюда' : ''}
                              >
                                {isResetting ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <LogOut className="w-3.5 h-3.5" />
                                )}
                                {isResetting ? '...' : 'Разлогинить'}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
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
