import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
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

function buildAppUserbotCenterLink(userbotId, tgUserId = '') {
  const params = new URLSearchParams();
  if (userbotId) params.set('userbot_id', userbotId);
  if (tgUserId) params.set('tg_user_id', tgUserId);
  const query = params.toString();
  return `/app/userbot-center${query ? `?${query}` : ''}`;
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

function ConversationBadge({ conversation }) {
  let className = 'pill';
  let text = 'Спокойно';

  if (conversation.sales_signal) {
    className += ' pill--warning';
    text = 'Пахнет покупкой';
  } else if (conversation.signal_notified_at) {
    className += ' pill--ok';
    text = 'Уже пинганули';
  } else if ((conversation.unread_count || 0) > 0) {
    className += ' pill--info';
    text = `Непрочитано: ${conversation.unread_count}`;
  }

  return <span className={className}>{text}</span>;
}

export function UserbotCenterPage() {
  const location = useLocation();
  const { accessToken, profilePlan, trialEndsAt } = useAuth();
  const [initialHandoff] = useState(() => consumeUserbotCenterHandoff());
  const initialParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const initialThreadUserId = String(initialParams.get('tg_user_id') || initialHandoff?.tg_user_id || '').trim();
  const initialCommonChatId = String(initialHandoff?.common_chat_id || '').trim();
  const initialDraftMessage = String(initialHandoff?.draft_message || '').trim();
  const [selectedUserbotId, setSelectedUserbotId] = useState('');
  const [threadUserId, setThreadUserId] = useState(initialThreadUserId);
  const [replyMessage, setReplyMessage] = useState(initialDraftMessage);
  const [manualInviteLink, setManualInviteLink] = useState('');
  const [manualTgUserId, setManualTgUserId] = useState(initialThreadUserId);
  const [manualCommonChatId, setManualCommonChatId] = useState(initialCommonChatId);
  const [manualDirectMessage, setManualDirectMessage] = useState(initialDraftMessage);
  const [state, setState] = useState({
    loading: true,
    refreshing: false,
    scanRequired: false,
    error: '',
    data: null
  });
  const [threadState, setThreadState] = useState({
    loading: false,
    error: '',
    messages: [],
    unavailableReason: ''
  });
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
  const trialHoursLeft = useMemo(() => {
    if (!trialEndsAt) return null;
    const diffMs = new Date(trialEndsAt).getTime() - Date.now();
    if (diffMs <= 0) return 0;
    return Math.ceil(diffMs / (1000 * 60 * 60));
  }, [trialEndsAt]);
  const trialUpgradeUrgent = profilePlan === 'trial' && trialHoursLeft !== null && trialHoursLeft > 0 && trialHoursLeft <= 72;

  function applyCenterData(nextData, preferredUserbotId = selectedUserbotId, preferredThreadUserId = threadUserId) {
    const nextUserbotId = String(nextData.selected_userbot_id || preferredUserbotId || '');
    const nextConversations = nextData.conversations || [];
    const nextThreadUserId = nextConversations.some((item) => String(item.tg_user_id) === String(preferredThreadUserId))
      ? String(preferredThreadUserId)
      : '';

    setSelectedUserbotId(nextUserbotId);
    setThreadUserId(nextThreadUserId);
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
    if (!silent) {
      setState((prev) => ({
        ...prev,
        loading: !prev.data,
        refreshing: !!prev.data,
        error: ''
      }));
    }

    const params = new URLSearchParams();
    if (selectedUserbotId) params.set('userbot_id', selectedUserbotId);
    if (scan) params.set('scan', 'true');
    const query = params.toString() ? `?${params.toString()}` : '';
    const nextData = await apiRequest(`/api/userbot/ops-center${query}`, { accessToken });
    applyCenterData(nextData, selectedUserbotId, preferredThreadUserId);
    return nextData;
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

    setProfileSyncState({ pulling: true, saving: false, tone: 'default', text: '' });
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
        tone: result.cached ? 'warning' : 'success',
        text: result.message || (result.cached ? 'Показываем сохраненный профиль.' : 'Профиль обновлен.')
      });
    } catch (error) {
      setProfileSyncState({
        pulling: false,
        saving: false,
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
        tone: 'error',
        text: 'Имя Telegram-аккаунта не может быть пустым.'
      });
      return;
    }

    if (!window.confirm('Сохранить эти имя, фамилию и описание в реальный Telegram-профиль выбранного юзербота?')) {
      return;
    }

    setProfileSyncState({ pulling: false, saving: true, tone: 'default', text: '' });
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
        tone: 'success',
        text: result.message || 'Профиль сохранен в Telegram и Supabase.'
      });
    } catch (error) {
      setProfileSyncState({
        pulling: false,
        saving: false,
        tone: 'error',
        text: error.message
      });
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadCenter() {
      setState((prev) => ({
        ...prev,
        loading: !prev.data,
        refreshing: !!prev.data,
        error: ''
      }));

      try {
        const params = new URLSearchParams();
        if (selectedUserbotId) params.set('userbot_id', selectedUserbotId);
        if (initialThreadUserId) params.set('scan', 'true');
        const query = params.toString() ? `?${params.toString()}` : '';
        const data = await apiRequest(`/api/userbot/ops-center${query}`, { accessToken });
        if (cancelled) return;
        applyCenterData(data, selectedUserbotId, threadUserId || initialThreadUserId);
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
    let cancelled = false;

    async function loadThread() {
      if (!accessToken || !selectedUserbotId || !threadUserId) {
        setThreadState({ loading: false, error: '', messages: [], unavailableReason: '' });
        return;
      }

      setThreadState((prev) => ({ ...prev, loading: true, error: '' }));

      try {
        const query = new URLSearchParams({
          userbot_id: selectedUserbotId,
          tg_user_id: threadUserId
        });
        const data = await apiRequest(`/api/userbot/ops-center/thread?${query.toString()}`, { accessToken });
        if (!cancelled) {
          setThreadState({
            loading: false,
            error: '',
            messages: data.messages || [],
            unavailableReason: data.unavailable_reason || ''
          });
        }
      } catch (error) {
        if (!cancelled) {
          setThreadState({
            loading: false,
            error: error.message,
            messages: [],
            unavailableReason: ''
          });
        }
      }
    }

    loadThread();

    return () => {
      cancelled = true;
    };
  }, [accessToken, selectedUserbotId, threadUserId]);

  useEffect(() => {
    setAuthorizationsState({ loading: false, error: '', rows: [] });
    setProfileSyncState({ pulling: false, saving: false, tone: 'default', text: '' });
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
  const profileDirty = !!selectedUserbot && (
    selectedDraftFirstName !== (selectedUserbot.tg_first_name || '') ||
    selectedDraftLastName !== (selectedUserbot.tg_last_name || '') ||
    selectedDraftAbout !== (selectedUserbot.tg_about || '')
  );

  const selectedConversation = useMemo(
    () => conversations.find((item) => String(item.tg_user_id) === String(threadUserId)) || null,
    [conversations, threadUserId]
  );

  const hotConversations = useMemo(
    () => conversations.filter((item) => item.sales_signal || item.unread_count > 0).slice(0, 8),
    [conversations]
  );

  const adminGroups = useMemo(
    () => groups.filter((item) => item.userbot_admin),
    [groups]
  );

  const prioritySignals = useMemo(() => ([
    {
      title: 'Горячие входящие',
      value: summary.sales_signals || 0,
      tone: (summary.sales_signals || 0) > 0 ? 'warning' : 'ok',
      hint: `Непрочитанных диалогов: ${summary.unread_dialogs || 0}`
    },
    {
      title: 'Админские группы',
      value: summary.groups_admin || 0,
      tone: (summary.groups_admin || 0) > 0 ? 'ok' : 'warning',
      hint: `Всего групп в контуре: ${summary.groups_total || 0}`
    },
    {
      title: 'Ops-сигналы',
      value: summary.signaled_dialogs || 0,
      tone: signalConfig.ready ? 'ok' : 'danger',
      hint: signalConfig.ready
        ? `Контур собран, admin_tg_id ${signalConfig.admin_tg_id || 'задан'}`
        : 'Ops-контур не собран: нет admin_tg_id или ops-бота'
    },
    {
      title: 'Личка живая',
      value: summary.open_dialogs || 0,
      tone: (summary.open_dialogs || 0) > 0 ? 'ok' : 'default',
      hint: 'Чем больше живых диалогов, тем выше шанс быстро дожать человека в личке'
    }
  ]), [signalConfig, summary]);

  function useReplyTemplate(type) {
    const templates = {
      sales_intro: 'Привет. Да, все актуально. Напиши, что именно хочешь взять, и я быстро сориентирую по цене и оплате.',
      ton_payment: 'Оплата у нас идет в TON. Напиши, что именно хочешь купить, и я скину точные условия и дальнейшие шаги.',
      qualify_need: 'Напиши коротко, что тебе нужно: доступ, товар, продление или комплект. Так я быстрее дам точный ответ без воды.',
      warm_close: 'Да, можем быстро закрыть. Если готов, я сразу сориентирую по оплате и что получишь после нее.'
    };

    setReplyMessage(templates[type] || '');
  }

  async function markConversationRead(tgUserId) {
    if (!tgUserId || !selectedUserbotId) return;

    setActionState((prev) => ({ ...prev, markingRead: true }));
    try {
      await apiRequest('/api/userbot/ops-center/mark-read', {
        accessToken,
        method: 'POST',
        body: {
          tg_user_id: String(tgUserId),
          userbot_id: selectedUserbotId
        }
      });

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
    } catch (error) {
      window.alert(`Не получилось отметить диалог как прочитанный: ${error.message}`);
    } finally {
      setActionState((prev) => ({ ...prev, markingRead: false }));
    }
  }

  async function selectConversation(conversation) {
    const nextThreadUserId = String(conversation.tg_user_id);
    setThreadUserId(nextThreadUserId);
    setManualTgUserId(nextThreadUserId);
    if (!replyMessage.trim() && conversation.sales_signal) {
      setReplyMessage('Привет. Вижу твое сообщение. Напиши, что именно хочешь взять, и я быстро сориентирую по оплате и доступу.');
    }
  }

  async function sendReply() {
    if (!selectedConversation?.tg_user_id) {
      window.alert('Сначала выбери диалог, кому отвечать.');
      return;
    }
    if (!replyMessage.trim()) {
      window.alert('Напиши текст ответа.');
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
          message: replyMessage,
          userbot_id: selectedUserbotId || null,
          known_dialog: true,
          manual_confirmed: true
        }
      });
      setReplyMessage('');
      await reloadCenter({ preferredThreadUserId: String(selectedConversation.tg_user_id) });
      window.alert('Ответ улетел.');
    } catch (error) {
      window.alert(`Ошибка ответа: ${error.message}`);
    } finally {
      setActionState((prev) => ({ ...prev, sendingReply: false }));
    }
  }

  async function joinInviteLink() {
    if (!selectedUserbotId) {
      window.alert('Сначала выбери юзербота, который будет заходить по ссылке.');
      return;
    }
    if (!manualInviteLink.trim()) {
      window.alert('Вставь ссылку-приглашение.');
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
      window.alert(`Юзербот зашел в: ${data.title || 'группу/чат'}`);
    } catch (error) {
      window.alert(`Ошибка входа по ссылке: ${error.message}`);
    } finally {
      setActionState((prev) => ({ ...prev, joiningInvite: false }));
    }
  }

  async function sendDirectMessage() {
    const tgUserId = String(manualTgUserId || '').trim();
    const message = String(manualDirectMessage || '').trim();

    if (!selectedUserbotId) {
      window.alert('Сначала выбери юзербота, который будет писать.');
      return;
    }
    if (!/^\d+$/.test(tgUserId)) {
      window.alert('Нужен нормальный Telegram ID цифрами.');
      return;
    }
    if (!message) {
      window.alert('Напиши текст сообщения.');
      return;
    }
    if (!manualCommonChatId) {
      window.alert('Сначала выбери общий чат. Холодный поиск по TG ID без общей группы больше не даем.');
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
      await reloadCenter({ preferredThreadUserId: tgUserId });
      window.alert('Сообщение улетело.');
    } catch (error) {
      window.alert(`Ошибка отправки: ${error.message}`);
    } finally {
      setActionState((prev) => ({ ...prev, sendingDirect: false }));
    }
  }

  async function resetOtherSessions() {
    if (!selectedUserbotId) {
      window.alert('Сначала выбери юзербота.');
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
      window.alert(data.message || 'Остальные устройства разлогинены.');
    } catch (error) {
      window.alert(`Не получилось разлогинить остальные устройства: ${error.message}`);
    } finally {
      setActionState((prev) => ({ ...prev, resettingAuthorizations: false }));
    }
  }

  if (state.loading) {
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

  return (
    <section className="page">
      <div className="page__header">
        <h1>Центр юзербота</h1>
        <p>
          Первый перенос этого экрана в `admin-v2`: видно, где аккаунт админ, кто пишет в личку и какие
          входящие уже пахнут продажей. Ручные действия уже вынесены сюда: можно отвечать, отмечать прочитанным,
          загонять юзербота по инвайту и писать по TG ID через общую группу.
        </p>
        <div className="page__meta">
          <span>{state.refreshing ? 'Обновляем вручную...' : 'Ничего не дергаем в фоне. Telegram трогаем только по явному действию админа.'}</span>
          <span>
            Ops-сигналы: {signalConfig.ready ? 'собраны' : 'не собраны'}
            {signalConfig.admin_tg_id ? ` • admin_tg_id ${signalConfig.admin_tg_id}` : ' • admin_tg_id нет'}
          </span>
          <span>{userbots.length} юзерботов доступно для triage</span>
        </div>
      </div>
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

      <div className="hero-panel">
        <div className="hero-panel__body">
          <div className="hero-panel__eyebrow">Лички и группы</div>
          <div className="hero-panel__title">Здесь разбираешь, кто пишет, кто уже теплый и где юзербот реально может дожать человека.</div>
          <div className="hero-panel__text">
            Это оперативный экран по входящим: видно, где аккаунт админ, кто уже пахнет покупкой, кого отпинганул ops-бот
            и кому можно быстро ответить прямо отсюда.
          </div>
          <div className="hero-panel__actions">
            <a className="hero-link" href="/app/userbots">Чинить аккаунты</a>
            <a className="hero-link" href="/app/customers?tab=customers">Открыть клиентов</a>
            <a className="hero-link" href="/app/customers?tab=orders">Разобрать деньги</a>
            <a className="hero-link" href="/app/customers?tab=access">Разобрать доступ</a>
          </div>
        </div>
        <div className="hero-panel__grid">
          {prioritySignals.map((item) => (
            <div key={item.title} className={`priority-chip priority-chip--${item.tone}`}>
              <div className="priority-chip__title">{item.title}</div>
              <div className="priority-chip__value">{item.value}</div>
              <div className="priority-chip__hint">{item.hint}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="toolbar-card">
        <div className="toolbar-card__title">Какой аккаунт сейчас под лупой</div>
        <div className="toolbar-card__body">
          <select
            className="field"
            value={selectedUserbotId}
            onChange={(event) => setSelectedUserbotId(event.target.value)}
          >
            {userbots.map((userbot) => (
              <option key={userbot.id} value={userbot.id}>
                {userbot.tg_username ? `@${userbot.tg_username}` : `ID ${userbot.tg_account_id}`}
                {userbot.proxy_name ? ` • ${userbot.proxy_name}` : ''}
                {userbot.proxy_country ? ` • ${userbot.proxy_country}` : ''}
              </option>
            ))}
          </select>
          <a className="ghost-button" href="/app/userbots">
            Юзерботы
          </a>
          <button className="ghost-button ghost-button--primary" onClick={() => reloadCenter({ scan: true })} disabled={state.refreshing}>
            {state.refreshing ? 'Проверяем входящие...' : 'Проверить входящие сейчас'}
          </button>
        </div>
        <div className="toolbar-card__hint">Авто-refresh убран. Этот экран больше не ползает в Telegram сам по таймеру.</div>
        {selectedUserbot ? (
          <div className="mt-4 rounded-[18px] border border-slate-200 bg-slate-50/70 p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex min-w-0 items-start gap-4">
                {selectedUserbot.tg_photo_data_url ? (
                  <img
                    src={selectedUserbot.tg_photo_data_url}
                    alt=""
                    className="size-16 shrink-0 rounded-[18px] object-cover ring-1 ring-slate-200"
                  />
                ) : (
                  <div className="flex size-16 shrink-0 items-center justify-center rounded-[18px] bg-slate-900 text-[22px] font-black text-white ring-1 ring-slate-200">
                    {selectedProfileInitial}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-[14px] font-bold text-slate-900">Профиль аккаунта</div>
                  <div className="mt-1 truncate text-[20px] font-black tracking-tight text-slate-950">
                    {selectedProfileTitle}
                  </div>
                  <div className="mt-1 text-[12px] font-medium text-slate-500">
                    Последнее обновление: {selectedProfileSyncedAt}
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="ghost-button"
                onClick={syncSelectedUserbotProfile}
                disabled={profileSyncState.pulling || profileSyncState.saving || !selectedUserbotId}
              >
                {profileSyncState.pulling ? 'Тянем из Telegram...' : 'Стянуть из Telegram'}
              </button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="block">
                <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">Имя</div>
                <input
                  className="field"
                  value={selectedDraftFirstName}
                  maxLength={64}
                  onChange={(event) => setProfileDraft((prev) => ({ ...prev, firstName: event.target.value }))}
                  placeholder="Имя аккаунта"
                />
              </label>
              <label className="block">
                <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">Фамилия</div>
                <input
                  className="field"
                  value={selectedDraftLastName}
                  maxLength={64}
                  onChange={(event) => setProfileDraft((prev) => ({ ...prev, lastName: event.target.value }))}
                  placeholder="Фамилия аккаунта"
                />
              </label>
              <div className="rounded-[14px] bg-white px-3 py-2.5">
                <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">Username</div>
                <div className="mt-1 truncate text-[13px] font-semibold text-slate-800">
                  {selectedUserbot.tg_username ? `@${selectedUserbot.tg_username}` : '—'}
                </div>
              </div>
              <div className="rounded-[14px] bg-white px-3 py-2.5">
                <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">Телефон / TG ID</div>
                <div className="mt-1 truncate text-[13px] font-semibold text-slate-800">
                  {[selectedUserbot.tg_phone, selectedUserbot.tg_account_id ? `ID ${selectedUserbot.tg_account_id}` : ''].filter(Boolean).join(' • ') || '—'}
                </div>
              </div>
            </div>

            <label className="mt-3 block">
              <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">Описание</div>
              <textarea
                className="field"
                rows="3"
                value={selectedDraftAbout}
                maxLength={70}
                onChange={(event) => setProfileDraft((prev) => ({ ...prev, about: event.target.value }))}
                placeholder="Описание профиля"
              />
              <div className="mt-1 text-[12px] font-medium text-slate-500">{selectedDraftAbout.length}/70</div>
            </label>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="ghost-button ghost-button--primary"
                onClick={saveSelectedUserbotProfile}
                disabled={profileSyncState.pulling || profileSyncState.saving || !profileDirty}
              >
                {profileSyncState.saving ? 'Сохраняем в Telegram...' : 'Сохранить в Telegram'}
              </button>
              {profileDirty ? (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setProfileDraft({
                    accountId: String(selectedUserbot.id),
                    firstName: selectedUserbot.tg_first_name || '',
                    lastName: selectedUserbot.tg_last_name || '',
                    about: selectedUserbot.tg_about || ''
                  })}
                  disabled={profileSyncState.pulling || profileSyncState.saving}
                >
                  Отменить правки
                </button>
              ) : null}
            </div>

            {selectedUserbot.tg_profile_sync_error ? (
              <div className="mt-3 rounded-[14px] border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] font-medium text-rose-700">
                Последняя ошибка обновления профиля{selectedProfileAttemptedAt ? ` (${selectedProfileAttemptedAt})` : ''}: {selectedUserbot.tg_profile_sync_error}
              </div>
            ) : null}

            {profileSyncState.text ? (
              <div className={`userbots-status-note userbots-status-note--${profileSyncState.tone || 'default'}`}>
                {profileSyncState.text}
              </div>
            ) : null}

            <div className="mt-3 text-[12px] font-medium text-slate-500">
              При загрузке страницы показываем сохраненные данные из БД. `Стянуть из Telegram` обновляет кэш, `Сохранить в Telegram` меняет реальный профиль и затем сохраняет тот же профиль в Supabase.
            </div>
          </div>
        ) : null}
      </div>

      {state.scanRequired ? (
        <div className="warning-card section">
          Экран открылся в safe-preview режиме. Живые диалоги и группы Telegram подтягиваются только после кнопки
          «Проверить входящие сейчас».
        </div>
      ) : null}

      <div className="toolbar-card">
        <div className="toolbar-card__title">Активные Telegram-сессии аккаунта</div>
        <div className="list-stack">
          <div className="list-item">
            <div className="list-item__title">Зачем это нужно</div>
            <div className="list-item__meta">
              Если хочешь, чтобы этим аккаунтом пользовался только сервис, здесь можно разлогинить все остальные устройства и оставить текущую серверную сессию.
            </div>
          </div>
          <div className="list-item">
            <div className="list-item__title">Что останется после чистки</div>
            <div className="list-item__meta">
              Строка с меткой <strong>Сессия BullRun</strong> — это текущая серверная авторизация. Кнопка ниже выкинет все остальные устройства и оставит только ее.
            </div>
          </div>
        </div>
        <div className="toolbar-card__body">
          <button className="ghost-button" onClick={loadAuthorizations} disabled={authorizationsState.loading || !selectedUserbotId}>
            {authorizationsState.loading ? 'Тянем сессии...' : 'Показать активные сессии'}
          </button>
          <button className="ghost-button ghost-button--primary" onClick={resetOtherSessions} disabled={actionState.resettingAuthorizations || !selectedUserbotId}>
            {actionState.resettingAuthorizations ? 'Чистим сессии...' : 'Разлогинить все остальные устройства'}
          </button>
        </div>
        {authorizationsState.error ? (
          <div className="empty-inline">{authorizationsState.error}</div>
        ) : authorizationsState.loading ? (
          <div className="empty-inline">Тянем активные авторизации...</div>
        ) : authorizationsState.rows.length === 0 ? (
          <div className="empty-inline">Telegram не отдал список сессий для этого аккаунта.</div>
        ) : (
          <table className="table" style={{ marginTop: 16 }}>
            <thead>
              <tr>
                <th>Устройство</th>
                <th>Приложение</th>
                <th>Где</th>
                <th>Последний движ</th>
              </tr>
            </thead>
            <tbody>
              {authorizationsState.rows.map((item) => (
                <tr key={item.hash || `${item.app_name}-${item.date_active}`}>
                  <td>
                    <div>
                      {item.current ? 'Текущая серверная сессия' : (item.device_model || item.platform || 'Устройство')}
                      {item.current ? <span className="pill pill--ok" style={{ marginLeft: 8 }}>Сессия BullRun</span> : null}
                    </div>
                    <div className="table-subtext">
                      {item.current ? 'Эту сессию сервис держит сейчас.' : `${item.platform || 'Платформа'} ${item.system_version || ''}`.trim()}
                    </div>
                  </td>
                  <td>
                    <div>{item.app_name || 'Telegram'}</div>
                    <div className="table-subtext">{item.app_version || 'Версия не пришла'}{item.official_app ? ' • official app' : ''}</div>
                  </td>
                  <td>
                    <div>{item.country || 'Страна не пришла'}</div>
                    <div className="table-subtext">{item.ip || 'IP не пришел'}{item.region ? ` • ${item.region}` : ''}</div>
                  </td>
                  <td>{formatDate(item.date_active || item.date_created)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="grid">
        <StatCard title="Всего групп" value={summary.groups_total || 0} hint="Куда этот юзербот реально дотягивается." />
        <StatCard title="Где админ" value={summary.groups_admin || 0} hint="Это самые полезные группы для лички и контроля." />
        <StatCard title="Диалогов в личке" value={summary.open_dialogs || 0} hint={`Непрочитанных: ${summary.unread_dialogs || 0}.`} />
        <StatCard title="Пахнет покупкой" value={summary.sales_signals || 0} hint={`Уже отпинганы ops-ботом: ${summary.signaled_dialogs || 0}.`} />
      </div>

      <div className="table-card" style={{ marginTop: 16 }}>
        <div className="table-card__title">Последние Telegram-ошибки этого аккаунта</div>
        {errorEventsState.error ? (
          <div className="empty-inline">{errorEventsState.error}</div>
        ) : errorEventsState.loading ? (
          <div className="empty-inline">Тянем журнал Telegram-ошибок...</div>
        ) : errorEventsState.rows.length === 0 ? (
          <div className="empty-inline">Свежих flood/restricted/session ошибок по этому аккаунту не видно.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Что случилось</th>
                <th>Кому</th>
                <th>Откуда</th>
                <th>Когда</th>
              </tr>
            </thead>
            <tbody>
              {errorEventsState.rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div>{row.restriction_kind || row.event_type}</div>
                    <div className="table-subtext">{row.error_message || 'Без текста ошибки'}</div>
                  </td>
                  <td>{row.tg_user_id || '—'}</td>
                  <td>{row.event_source || 'telegram'}</td>
                  <td>{formatDate(row.happened_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="grid grid--double">
        <div className="table-card">
          <div className="table-card__title">Горячие входящие</div>
          {hotConversations.length === 0 ? (
            <div className="empty-inline">Пока тихо. Живых горячих личек нет.</div>
          ) : (
            <div className="list-stack">
              {hotConversations.map((conversation) => (
                <button
                  key={conversation.tg_user_id}
                  className={`list-item${String(threadUserId) === String(conversation.tg_user_id) ? ' list-item--active' : ''}`}
                  onClick={() => selectConversation(conversation)}
                >
                  <div className="list-item__head">
                    <div>
                      <div className="list-item__title">
                        {conversation.display_name || conversation.username || conversation.tg_user_id}
                      </div>
                      <div className="list-item__meta">{conversation.tg_user_id}</div>
                    </div>
                    <ConversationBadge conversation={conversation} />
                  </div>
                  <div className="list-item__body">{conversation.last_message_preview || 'Telegram не отдал текст последнего сообщения.'}</div>
                  <div className="list-item__footer">
                    <span>{formatDate(conversation.last_message_at)}</span>
                    <span>{conversation.unread_count > 0 ? `Непрочитано: ${conversation.unread_count}` : 'Без непрочитанного'}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="table-card">
          <div className="table-card__title">Где этот юзербот админ</div>
          {adminGroups.length === 0 ? (
            <div className="empty-inline">Пока нет групп, где этот юзербот подтвержден как админ.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Группа / чат</th>
                  <th>В системе</th>
                  <th>Непрочитанных</th>
                  <th>Дальше</th>
                </tr>
              </thead>
              <tbody>
                {adminGroups.map((group) => (
                  <tr key={group.chat_id}>
                    <td>
                      <div>{group.title}</div>
                      <div className="table-subtext">{group.chat_id}</div>
                    </td>
                    <td>{group.linked_channel_title || 'Пока не привязано'}</td>
                    <td>{group.unread_count || 0}</td>
                    <td>
                      {group.linked_channel_id ? (
                        <a href={`/app/customers?tab=customers&channel=${encodeURIComponent(group.linked_channel_id)}`} target="_blank" rel="noreferrer">
                          Клиенты
                        </a>
                      ) : (
                        <span className="table-subtext">Сначала завести в систему</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="grid grid--double">
        <div className="table-card">
          <div className="table-card__title">Все диалоги</div>
          {conversations.length === 0 ? (
            <div className="empty-inline">Личка пока пустая или Telegram ничего не отдал.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Кто</th>
                  <th>Статус</th>
                  <th>Последний движ</th>
                  <th>Дальше</th>
                </tr>
              </thead>
              <tbody>
                {conversations.slice(0, 20).map((conversation) => (
                  <tr key={conversation.tg_user_id}>
                    <td>
                      <div>{conversation.display_name || conversation.username || conversation.tg_user_id}</div>
                      <div className="table-subtext">{conversation.tg_user_id}</div>
                    </td>
                    <td>
                      <ConversationBadge conversation={conversation} />
                    </td>
                    <td>{formatDate(conversation.last_message_at)}</td>
                    <td>
                      <div className="table-actions">
                        <button className="inline-action" onClick={() => selectConversation(conversation)}>
                          Тред
                        </button>
                        <a
                          href={buildAppUserbotCenterLink(selectedUserbotId, conversation.tg_user_id)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Отдельно
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="table-card">
          <div className="table-card__title">Последние сообщения по диалогу</div>
          {!selectedConversation ? (
            <div className="empty-inline">Слева выбери горячий диалог или строку из таблицы.</div>
          ) : threadState.loading ? (
            <LoadingState text="Тянем переписку..." />
          ) : threadState.error ? (
            <div className="empty-inline">{threadState.error}</div>
          ) : (
            <>
              <div className="thread-card__header">
                <div>
                  <div className="thread-card__title">
                    {selectedConversation.display_name || selectedConversation.username || selectedConversation.tg_user_id}
                  </div>
                  <div className="thread-card__meta">{selectedConversation.tg_user_id}</div>
                </div>
                <a
                  className="ghost-button"
                  href={buildAppUserbotCenterLink(selectedUserbotId, selectedConversation.tg_user_id)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Открыть отдельно
                </a>
              </div>

              <div className="toolbar-card" style={{ marginTop: 16 }}>
                <div className="toolbar-card__title">Быстрый ответ</div>
                <div className="toolbar-card__hint">
                  Ответ уходит только после явного подтверждения. Выбор треда больше не помечает диалог прочитанным сам.
                </div>
                <div className="filter-strip">
                  <button className="filter-chip" onClick={() => useReplyTemplate('sales_intro')}>Да, актуально</button>
                  <button className="filter-chip" onClick={() => useReplyTemplate('ton_payment')}>Оплата в TON</button>
                  <button className="filter-chip" onClick={() => useReplyTemplate('qualify_need')}>Уточнить, что нужно</button>
                  <button className="filter-chip" onClick={() => useReplyTemplate('warm_close')}>Быстро закрыть</button>
                </div>
                <div className="toolbar-card__body">
                  <textarea
                    className="field"
                    rows="5"
                    value={replyMessage}
                    onChange={(event) => setReplyMessage(event.target.value)}
                    placeholder="Ответ человеку"
                  />
                  <button className="ghost-button ghost-button--primary" onClick={sendReply} disabled={actionState.sendingReply}>
                    {actionState.sendingReply ? 'Шлем...' : 'Ответить'}
                  </button>
                  <button className="ghost-button" onClick={() => markConversationRead(selectedConversation.tg_user_id)} disabled={actionState.markingRead}>
                    {actionState.markingRead ? 'Помечаем...' : 'Прочитано'}
                  </button>
                </div>
              </div>

              {threadState.messages.length === 0 ? (
                <div className="empty-inline">
                  {threadState.unavailableReason || 'Telegram не отдал историю или диалог пустой. Шумный поиск вынесем в отдельную явную кнопку.'}
                </div>
              ) : (
                <div className="thread-stack">
                  {threadState.messages.map((message) => (
                    <div
                      key={message.id}
                      className={`thread-message${message.outgoing ? ' thread-message--outgoing' : ''}`}
                    >
                      <div>{message.text || '—'}</div>
                      <div className="thread-message__meta">{formatDate(message.date)}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="grid grid--double">
        <div className="toolbar-card">
          <div className="toolbar-card__title">Загнать юзербота по инвайту</div>
          <p className="toolbar-card__hint">
            Вставь invite-ссылку. Это полезно, когда надо быстро завести аккаунт в рабочую группу или чат под дожим.
          </p>
          <div className="toolbar-card__body">
            <input
              className="field"
              type="text"
              value={manualInviteLink}
              onChange={(event) => setManualInviteLink(event.target.value)}
              placeholder="https://t.me/+..."
            />
            <button className="ghost-button ghost-button--primary" onClick={joinInviteLink} disabled={actionState.joiningInvite}>
              {actionState.joiningInvite ? 'Заходим...' : 'Зайти по ссылке'}
            </button>
          </div>
        </div>

        <div className="toolbar-card">
          <div className="toolbar-card__title">Написать человеку по TG ID</div>
          <p className="toolbar-card__hint">
            Холодный поиск по TG ID больше не даем. Для ручной отправки выбери общий чат, где этот юзербот реально админит или видит человека.
          </p>
          <div className="toolbar-card__body">
            <input
              className="field"
              type="text"
              value={manualTgUserId}
              onChange={(event) => setManualTgUserId(event.target.value)}
              placeholder="TG ID цифрами"
            />
            <select
              className="field"
              value={manualCommonChatId}
              onChange={(event) => setManualCommonChatId(event.target.value)}
            >
              <option value="">Сначала выбери общий чат</option>
              {adminGroups.map((group) => (
                <option key={group.chat_id} value={group.chat_id}>
                  {group.title} • {group.chat_id}
                </option>
              ))}
            </select>
            <textarea
              className="field"
              rows="4"
              value={manualDirectMessage}
              onChange={(event) => setManualDirectMessage(event.target.value)}
              placeholder="Текст сообщения"
            />
            <button className="ghost-button ghost-button--primary" onClick={sendDirectMessage} disabled={actionState.sendingDirect}>
              {actionState.sendingDirect ? 'Шлем...' : 'Отправить по TG ID'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
