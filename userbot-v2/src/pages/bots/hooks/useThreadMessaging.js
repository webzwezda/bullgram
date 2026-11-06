import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { apiRequest } from '../../../api/client.js';
import { appendHistory, loadDraft, loadHistory, saveDraft, saveHistory } from '../centerStorage.js';

export function useThreadMessaging({ accessToken, selectedLiveUserbotId, conversations, threadUserId, setThreadUserId, setChatHistory, setState, reloadCenter, manualCommonChatId, initialThreadUserId, initialDraftMessage }) {
  const [replyMessage, setReplyMessage] = useState(initialDraftMessage || loadDraft('reply'));
  const [manualInviteLink, setManualInviteLink] = useState('');
  const [manualTgUserId, setManualTgUserId] = useState(initialThreadUserId || loadDraft('manual_tg'));
  const [manualDirectMessage, setManualDirectMessage] = useState(initialDraftMessage || loadDraft('manual_msg'));
  const [actionState, setActionState] = useState({
    sendingReply: false,
    joiningInvite: false,
    sendingDirect: false,
    markingRead: false
  });
  const [loadingThread, setLoadingThread] = useState(false);
  const [threadUnavailable, setThreadUnavailable] = useState('');
  useEffect(() => {
    if (!initialThreadUserId) return;
    setManualTgUserId((prev) => prev || initialThreadUserId);
  }, [initialThreadUserId]);
  const selectedConversation = useMemo(
    () => conversations.find((item) => String(item.tg_user_id) === String(threadUserId)) || null,
    [conversations, threadUserId]
  );
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
      // Легкая перезагрузка кэша без живого скана: unread уже обновлен локально,
      // а полный getDialogs+админ-чеки на каждое «прочитано» — лишний груз.
      reloadCenter({ silent: true, preferredThreadUserId: threadUserId, scan: false }).catch(() => {});
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
  return {
    actionState,
    setActionState,
    replyMessage,
    setReplyMessage,
    manualInviteLink,
    setManualInviteLink,
    manualTgUserId,
    setManualTgUserId,
    manualDirectMessage,
    setManualDirectMessage,
    loadingThread,
    setLoadingThread,
    threadUnavailable,
    setThreadUnavailable,
    selectedConversation,
    loadThreadMessages,
    selectConversation,
    markConversationRead,
    sendReply,
    joinInviteLink,
    sendDirectMessage,
  };
}
