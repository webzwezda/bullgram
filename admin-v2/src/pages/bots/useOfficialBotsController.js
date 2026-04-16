import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../api/client.js';

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
    botRole: 'sales'
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
    if (botForm.botRole === 'placeholder') {
      showUiMessage('Заготовка пока не подключается. Выбери рабочую роль бота.', 'error');
      return;
    }

    setState((prev) => ({ ...prev, savingBot: true }));
    try {
      await apiRequest('/api/official-bot/add', {
        accessToken,
        method: 'POST',
        body: {
          botToken: botForm.botToken.trim(),
          botRole: botForm.botRole,
          admin_tg_id: paymentAdminTgId || ''
        }
      });
      setBotForm((prev) => ({ ...prev, botToken: '' }));
      await reloadAccounts();
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

  return {
    addOfficialBot,
    botAdminDrafts,
    botForm,
    officialBots,
    saveBotAdmin,
    selectedOfficialBot,
    selectedOfficialBotId,
    setBotAdminDrafts,
    setBotForm,
    setSelectedOfficialBotId
  };
}
