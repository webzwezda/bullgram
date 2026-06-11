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
  const [selectedOfficialBotId, setSelectedOfficialBotId] = useState('');

  const officialBots = useMemo(() => {
    return (accounts || []).filter((account) => account.account_type === 'bot' && (account.bot_role || 'sales') !== 'ops');
  }, [accounts]);

  useEffect(() => {
    if (!officialBots.length) {
      setSelectedOfficialBotId('');
      return;
    }

    setSelectedOfficialBotId((prev) => {
      if (prev && officialBots.some((account) => String(account.id) === String(prev))) {
        return prev;
      }
      return String(officialBots[0].id);
    });
  }, [officialBots]);

  const selectedOfficialBot = useMemo(() => {
    if (!officialBots.length) return null;
    return officialBots.find((account) => String(account.id) === String(selectedOfficialBotId)) || officialBots[0];
  }, [officialBots, selectedOfficialBotId]);

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

  return {
    addOfficialBot,
    botAdminDrafts,
    botForm,
    officialBots,
    refreshOfficialBotWebhookStatus,
    saveBotAdmin,
    selectedOfficialBot,
    selectedOfficialBotId,
    setBotAdminDrafts,
    setBotForm,
    setSelectedOfficialBotId
  };
}
