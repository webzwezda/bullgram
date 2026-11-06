import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../../api/client.js';
import { loadHistory, syncIncomingToHistory } from '../centerStorage.js';

export function useCenterData({ accessToken, selectedLiveUserbot, selectedLiveUserbotId, initialThreadUserId, initialHandoff, manualCommonChatId, setManualCommonChatId }) {
  const [threadUserId, setThreadUserId] = useState(initialThreadUserId);
  const [chatHistory, setChatHistory] = useState(() => initialThreadUserId ? loadHistory(initialThreadUserId) : []);
  const [state, setState] = useState({
    loading: true,
    refreshing: false,
    scanRequired: false,
    error: '',
    data: null
  });
  const handoffLoadedBotRef = useRef('');
  // Гард от гонок: ответ старого запроса (бот переключили / запустили более свежий reload)
  // не должен перезаписывать центр — тот же reqId-паттерн, что в CustomersPage.loadCustomers.
  const centerReqIdRef = useRef(0);
  const selectedBotIdRef = useRef(selectedLiveUserbotId);
  const lastLoadKeyRef = useRef('');
  useEffect(() => {
    selectedBotIdRef.current = selectedLiveUserbotId;
  }, [selectedLiveUserbotId]);
  function applyCenterData(nextData, preferredUserbotId = selectedLiveUserbotId, preferredThreadUserId = threadUserId) {
    // Ответ чужого бота (запрос ушел до переключения) — игнорируем, диалоги выбранного бота не трогаем.
    if (String(preferredUserbotId || '') !== String(selectedBotIdRef.current || '')) return;
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
    const reqId = ++centerReqIdRef.current;
    if (!silent) {
      setState((prev) => ({
        ...prev,
        loading: !prev.data,
        refreshing: !!prev.data,
        error: ''
      }));
    }

    const params = new URLSearchParams();
    if (selectedLiveUserbotId) params.set('userbot_id', selectedLiveUserbotId);
    if (scan) params.set('scan', 'true');
    const query = params.toString() ? `?${params.toString()}` : '';
    try {
      const nextData = await apiRequest(`/api/userbot/ops-center${query}`, { accessToken });
      if (reqId !== centerReqIdRef.current) return null;
      applyCenterData(nextData, selectedLiveUserbotId, preferredThreadUserId);
      return nextData;
    } catch (error) {
      if (reqId !== centerReqIdRef.current) return null;
      setState((prev) => ({
        ...prev,
        loading: false,
        refreshing: false,
        error: error.message
      }));
      throw error;
    }
  }
  useEffect(() => {
    let cancelled = false;

    async function loadCenter() {
      const botIdStr = String(selectedLiveUserbotId || '');
      const loadKey = `${botIdStr}::${String(selectedLiveUserbot?.runtime_status || '')}`;
      // После handoff-загрузки не дергаем центр повторно для того же бота
      // в том же runtime-статусе, но смена бота или статуса (живая активация
      // safe-mode аккаунта) обязана перезагрузить центр — иначе остаются
      // чужие диалоги или пустой safe-mode ответ.
      if (initialHandoff && handoffLoadedBotRef.current === loadKey) return;

      // Активация только что сняла safe-mode: кэш диалогов этого аккаунта ещё
      // пуст, поэтому тянем центр живым сканом — иначе центр останется пустым
      // без видимой подсказки.
      const scanAfterActivation = lastLoadKeyRef.current === `${botIdStr}::pending_activation`;
      lastLoadKeyRef.current = loadKey;

      setState((prev) => ({
        ...prev,
        loading: !prev.data,
        refreshing: !!prev.data,
        error: ''
      }));

      const reqId = ++centerReqIdRef.current;
      try {
        const params = new URLSearchParams();
        if (selectedLiveUserbotId) params.set('userbot_id', selectedLiveUserbotId);
        if ((initialThreadUserId && !initialHandoff) || scanAfterActivation) params.set('scan', 'true');
        const query = params.toString() ? `?${params.toString()}` : '';
        const data = await apiRequest(`/api/userbot/ops-center${query}`, { accessToken });
        if (cancelled || reqId !== centerReqIdRef.current) return;
        applyCenterData(data, selectedLiveUserbotId, threadUserId || initialThreadUserId);
        if (initialHandoff) handoffLoadedBotRef.current = loadKey;
      } catch (error) {
        if (cancelled || reqId !== centerReqIdRef.current) return;
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
    // runtime_status в deps: после живой активации safe-mode аккаунта статус
    // меняется и центр перезагружается уже в боевом контуре (диалоги, группы),
    // без ручного переключения аккаунта.
  }, [accessToken, selectedLiveUserbotId, selectedLiveUserbot?.runtime_status]);
  return { state, setState, threadUserId, setThreadUserId, chatHistory, setChatHistory, reloadCenter };
}
