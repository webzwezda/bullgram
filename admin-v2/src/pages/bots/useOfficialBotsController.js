import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../api/client.js';

function normalizeBotKind(value) {
  return value === 'template' ? 'template' : 'sales';
}

export function useOfficialBotsController({
  accessToken,
  accounts,
  paymentAdminTgId,
  reloadAccounts,
  setState,
  showUiMessage
}) {
  const [botForm, setBotForm] = useState({
    botToken: '',
    botKind: 'sales'
  });
  const [botAdminDrafts, setBotAdminDrafts] = useState({});
  // 'new' = sentinel для "создание нового бота" в верхнем селекторе (как в /app/autopost).
  // '' = ещё не инициализировано, ниже подставится первое значение.
  const [selectedOfficialBotId, setSelectedOfficialBotId] = useState('');

  // Multi-admin state (как в /app/autopost → "Администраторы бота").
  const [botAdmins, setBotAdmins] = useState([]);
  const [botAdminsLoading, setBotAdminsLoading] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [addingBotAdmin, setAddingBotAdmin] = useState(false);
  const [newAdminTgId, setNewAdminTgId] = useState('');
  const [regeneratingInvite, setRegeneratingInvite] = useState(false);

  const officialBots = useMemo(() => {
    return (accounts || []).filter((account) => account.account_type === 'bot' && (account.bot_role || 'sales') !== 'ops');
  }, [accounts]);

  useEffect(() => {
    setSelectedOfficialBotId((prev) => {
      // Если юзер явно выбрал "создать нового" — не сбрасываем выбор при reloads.
      if (prev === 'new') return 'new';
      // Уже выбранный бот всё ещё валиден — оставляем.
      if (prev && officialBots.some((account) => String(account.id) === String(prev))) {
        return prev;
      }
      // Иначе: первый существующий бот, или 'new' если их ещё нет.
      return officialBots.length ? String(officialBots[0].id) : 'new';
    });
  }, [officialBots]);

  const selectedOfficialBot = useMemo(() => {
    if (selectedOfficialBotId === 'new') return null;
    if (!officialBots.length) return null;
    return officialBots.find((account) => String(account.id) === String(selectedOfficialBotId)) || null;
  }, [officialBots, selectedOfficialBotId]);

  // Загружаем список админов выбранного бота (и инвайт-ссылку).
  useEffect(() => {
    if (selectedOfficialBotId === 'new' || !selectedOfficialBotId) {
      setBotAdmins([]);
      setInviteLink('');
      return;
    }
    let cancelled = false;
    setBotAdminsLoading(true);
    apiRequest(`/api/official-bot/${selectedOfficialBotId}/admins`, { accessToken })
      .then((data) => {
        if (cancelled) return;
        setBotAdmins(Array.isArray(data?.admin_tg_ids) ? data.admin_tg_ids : []);
        setInviteLink(data?.invite_link || '');
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to load bot admins:', err.message);
        setBotAdmins([]);
        setInviteLink('');
      })
      .finally(() => {
        if (!cancelled) setBotAdminsLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedOfficialBotId, accessToken]);

  async function handleAddBotAdmin() {
    const trimmed = newAdminTgId.trim();
    if (!trimmed || !selectedOfficialBotId) return;
    setAddingBotAdmin(true);
    try {
      const data = await apiRequest(`/api/official-bot/${selectedOfficialBotId}/admins`, {
        accessToken,
        method: 'POST',
        body: { adminTgId: trimmed }
      });
      setBotAdmins(Array.isArray(data?.admin_tg_ids) ? data.admin_tg_ids : []);
      setNewAdminTgId('');
      showUiMessage('Администратор добавлен.', 'success');
    } catch (err) {
      showUiMessage(err.message, 'error');
    } finally {
      setAddingBotAdmin(false);
    }
  }

  async function handleRemoveBotAdmin(tgId) {
    if (!selectedOfficialBotId || tgId == null) return;
    if (!window.confirm(`Удалить администратора ${tgId}?`)) return;
    try {
      const data = await apiRequest(`/api/official-bot/${selectedOfficialBotId}/admins/${tgId}`, {
        accessToken,
        method: 'DELETE'
      });
      setBotAdmins(Array.isArray(data?.admin_tg_ids) ? data.admin_tg_ids : []);
      showUiMessage('Администратор удалён.', 'success');
    } catch (err) {
      showUiMessage(err.message, 'error');
    }
  }

  async function handleRegenerateBotAdminInvite() {
    if (!selectedOfficialBotId) return;
    if (!window.confirm('Сгенерировать новую ссылку-приглашение? Старая перестанет работать.')) return;
    setRegeneratingInvite(true);
    try {
      const data = await apiRequest(`/api/official-bot/${selectedOfficialBotId}/admins/regenerate-invite`, {
        accessToken,
        method: 'POST'
      });
      setInviteLink(data?.invite_link || '');
      showUiMessage('Ссылка-приглашение обновлена.', 'success');
    } catch (err) {
      showUiMessage(err.message, 'error');
    } finally {
      setRegeneratingInvite(false);
    }
  }

  async function addOfficialBot() {
    if (!botForm.botToken.trim()) {
      showUiMessage('Вставь токен бота.', 'error');
      return;
    }

    setState((prev) => ({ ...prev, savingBot: true }));
    try {
      const addResponse = await apiRequest('/api/official-bot/add', {
        accessToken,
        method: 'POST',
        body: {
          botToken: botForm.botToken.trim(),
          botRole: 'sales',
          bot_kind: 'sales',
          admin_tg_id: paymentAdminTgId || ''
        }
      });
      const nextPayload = await reloadAccounts();
      const addedBotAccount = (nextPayload?.accounts || []).find((account) => (
        account.account_type === 'bot'
        && String(account.tg_account_id || '') === String(addResponse?.bot?.id || '')
      ));

      if (addedBotAccount?.id) {
        setSelectedOfficialBotId(String(addedBotAccount.id));
      }
      setBotForm({ botToken: '', botKind: 'sales' });
      showUiMessage('Бот подключен.', 'success');
    } catch (error) {
      showUiMessage(error.message, 'error');
    } finally {
      setState((prev) => ({ ...prev, savingBot: false }));
    }
  }

  async function saveBotAdmin(account) {
    const accountId = String(account?.id || '');
    if (!accountId) return;

    const adminTgId = String(
      Object.prototype.hasOwnProperty.call(botAdminDrafts, accountId)
        ? botAdminDrafts[accountId]
        : account.admin_tg_id || ''
    ).trim();

    setState((prev) => ({ ...prev, savingBotAdminId: accountId }));
    try {
      await apiRequest('/api/official-bot/admin', {
        accessToken,
        method: 'POST',
        body: {
          account_id: account.id,
          admin_tg_id: adminTgId
        }
      });
      await reloadAccounts();
      showUiMessage(adminTgId ? 'Telegram ID админа бота сохранен.' : 'Telegram ID админа у бота очищен.', 'success');
    } catch (error) {
      showUiMessage(error.message, 'error');
    } finally {
      setState((prev) => ({ ...prev, savingBotAdminId: '' }));
    }
  }

  async function refreshOfficialBotWebhookStatus(account) {
    const accountId = String(account?.id || '');
    if (!accountId) return;

    setState((prev) => ({ ...prev, webhookRuntimeActionId: accountId }));
    try {
      const result = await apiRequest(`/api/official-bot/webhook-runtime/${accountId}/status`, {
        accessToken
      });
      await reloadAccounts();
      if (result?.webhook?.last_error_message) {
        showUiMessage(`Webhook проверен: ${result.webhook.last_error_message}`, 'error');
      } else {
        showUiMessage('Webhook проверен.', 'success');
      }
    } catch (error) {
      showUiMessage(error.message, 'error');
    } finally {
      setState((prev) => ({ ...prev, webhookRuntimeActionId: '' }));
    }
  }

  async function reregisterWebhook(account) {
    const accountId = String(account?.id || '');
    if (!accountId) return;

    if (!window.confirm('Перерегистрировать webhook у Telegram? Старый URL будет заменён.')) return;

    setState((prev) => ({ ...prev, webhookRuntimeActionId: accountId }));
    try {
      const result = await apiRequest(`/api/official-bot/webhook-runtime/${accountId}/enable`, {
        accessToken,
        method: 'POST',
        body: { rotate_secret: true }
      });
      await reloadAccounts();
      if (result?.webhook?.last_error_message) {
        showUiMessage(`Webhook обновлён, но Telegram сообщает ошибку: ${result.webhook.last_error_message}`, 'error');
      } else {
        const url = String(result?.webhook?.url || '').replace(/\/[^/]+$/, '/...');
        showUiMessage(`Webhook переподключён: ${url}`, 'success');
      }
    } catch (error) {
      showUiMessage(error.message, 'error');
    } finally {
      setState((prev) => ({ ...prev, webhookRuntimeActionId: '' }));
    }
  }

  return {
    addOfficialBot,
    addingBotAdmin,
    botAdminDrafts,
    botAdmins,
    botAdminsLoading,
    botForm,
    handleAddBotAdmin,
    handleRemoveBotAdmin,
    handleRegenerateBotAdminInvite,
    inviteLink,
    newAdminTgId,
    officialBots,
    refreshOfficialBotWebhookStatus,
    regeneratingInvite,
    reregisterWebhook,
    saveBotAdmin,
    selectedOfficialBot,
    selectedOfficialBotId,
    setBotAdminDrafts,
    setBotForm,
    setNewAdminTgId,
    setSelectedOfficialBotId
  };
}
