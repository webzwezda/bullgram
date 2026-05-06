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

    const nextBotKind = normalizeBotKind(botForm.botKind);

    setState((prev) => ({ ...prev, savingBot: true }));
    try {
      const addResponse = await apiRequest('/api/official-bot/add', {
        accessToken,
        method: 'POST',
        body: {
          botToken: botForm.botToken.trim(),
          botRole: 'sales',
          bot_kind: nextBotKind,
          admin_tg_id: paymentAdminTgId || ''
        }
      });
      const nextPayload = await reloadAccounts();
      const addedBotAccount = (nextPayload?.accounts || []).find((account) => (
        account.account_type === 'bot'
        && String(account.tg_account_id || '') === String(addResponse?.bot?.id || '')
      ));

      if (nextBotKind === 'template' && !addedBotAccount?.id) {
        showUiMessage('Бот подключен, но тип не подтвердился. Переключи его на "Заготовка" вручную ниже.', 'error');
        setBotForm({ botToken: '', botKind: 'sales' });
        return;
      }

      if (addedBotAccount?.id) {
        setSelectedOfficialBotId(String(addedBotAccount.id));
      }
      setBotForm({ botToken: '', botKind: 'sales' });
      showUiMessage(nextBotKind === 'template' ? 'Бот подключен как заготовка.' : 'Бот подключен.', 'success');
    } catch (error) {
      showUiMessage(error.message, 'error');
    } finally {
      setState((prev) => ({ ...prev, savingBot: false }));
    }
  }

  async function saveBotKind(account, botKind) {
    const accountId = String(account?.id || '');
    if (!accountId) return;

    const nextBotKind = normalizeBotKind(botKind);

    setState((prev) => ({ ...prev, savingBotKindId: accountId }));
    try {
      await apiRequest('/api/official-bot/type', {
        accessToken,
        method: 'POST',
        body: {
          account_id: account.id,
          bot_kind: nextBotKind
        }
      });
      await reloadAccounts();
      if (nextBotKind === 'template') {
        showUiMessage('Бот переведен в заготовку.', 'success');
      } else if (normalizeBotKind(account.bot_kind) === 'template') {
        showUiMessage('Бот переведен в продажи. Если ты уже назначал его админом в Telegram, перевесь права или синхронизируй группы, чтобы BullRun увидел места для контура.', 'success');
      } else {
        showUiMessage('Бот переведен в продажи.', 'success');
      }
    } catch (error) {
      showUiMessage(error.message, 'error');
    } finally {
      setState((prev) => ({ ...prev, savingBotKindId: '' }));
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
    saveBotKind,
    selectedOfficialBot,
    selectedOfficialBotId,
    setBotAdminDrafts,
    setBotForm,
    setSelectedOfficialBotId
  };
}
