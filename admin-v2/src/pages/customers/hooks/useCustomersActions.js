import { useCallback, useMemo } from 'react';
import { apiRequest } from '../../../api/client.js';
import { canManageRow, closeAllRowMenus, getClientDisplayName } from '../utils/customersRows.js';

export function useCustomersActions({
  accessToken,
  selectedBotId,
  state,
  loadCustomers,
  setMutatingRowId
}) {
  const selectableChannels = useMemo(
    () => (state.channels || []).filter((channel) => !selectedBotId || String(channel.bot_id || '') === String(selectedBotId)),
    [state.channels, selectedBotId]
  );

  const resolveActionChannelId = useCallback((row) => {
    if (row.channel_id) return String(row.channel_id);

    if (selectableChannels.length === 1) {
      return String(selectableChannels[0].id);
    }

    if (!selectableChannels.length) {
      window.alert('Для этого бота нет доступных каналов. Сначала подключи канал в BotFather.');
      return null;
    }

    const optionsText = selectableChannels
      .map((channel, index) => `${index + 1}. ${channel.title || `Канал ${index + 1}`}`)
      .join('\n');
    const input = window.prompt(`Выбери канал для выдачи доступа:\n${optionsText}\n\nВведи номер канала.`);
    if (!input) return null;

    const pickedIndex = Number(input) - 1;
    if (!Number.isInteger(pickedIndex) || pickedIndex < 0 || pickedIndex >= selectableChannels.length) {
      window.alert('Некорректный номер канала.');
      return null;
    }

    return String(selectableChannels[pickedIndex].id);
  }, [selectableChannels]);

  const runSubscriptionAction = useCallback(async (row, action) => {
    if (!canManageRow(row)) return;

    const rowId = row.id ? String(row.id) : null;
    const clientLabel = getClientDisplayName(row) || (row.tg_username ? `@${row.tg_username}` : `TG ${row.tg_user_id}`);
    const contextLabel = row.channel_title || row.title || '';

    closeAllRowMenus();
    setMutatingRowId(rowId);

    try {
      const channelId = resolveActionChannelId(row);
      if (!channelId) {
        setMutatingRowId(null);
        return;
      }

      if (action === 'extend-5' || action === 'extend-30' || action === 'extend-forever') {
        const days = action === 'extend-5' ? 5 : action === 'extend-30' ? 30 : 'forever';

        // CRM-действия только для строк-подписок (id = id подписки); funnel-строки осознанно идут в direct-access
        const hasCrmSub = !!row.id && !!row._crmSubscription;

        if (hasCrmSub) {
          await apiRequest('/api/userbot/crm/subscribers/batch-add-days', {
            accessToken,
            method: 'POST',
            body: {
              subscription_ids: [rowId],
              days
            }
          });
        } else {
          const result = await apiRequest('/api/customers/direct-access', {
            accessToken,
            method: 'POST',
            body: {
              tg_user_id: String(row.tg_user_id),
              channel_id: channelId,
              duration_days: days
            }
          });

          if (result.dm_sent) {
            window.alert(
              action === 'extend-forever'
                ? 'Доступ выдан навсегда. Бот уже отправил человеку ссылку в личку.'
                : `Доступ выдан на ${days} дней. Бот уже отправил человеку ссылку в личку.`
            );
          } else if (result.invite_link) {
            window.prompt(
              'Доступ создан, но бот не смог отправить ссылку в личку. Скопируй и перешли ее вручную:',
              result.invite_link
            );
          } else {
            window.alert('Доступ создан, но бот не смог отправить ссылку в личку.');
          }
        }

        if (hasCrmSub) {
          window.alert(
            action === 'extend-forever'
              ? 'Доступ выдан навсегда. Таблица обновится.'
              : `Доступ продлен на ${days} дней. Таблица обновится.`
          );
        }
      }

      if (action === 'kick') {
        if (!rowId || !row._crmSubscription) {
          window.alert('Эту строку нельзя удалить из группы, потому что подписка еще не создана.');
          setMutatingRowId(null);
          return;
        }
        const prompt = contextLabel
          ? `Удалить ${clientLabel} из «${contextLabel}»?`
          : `Удалить ${clientLabel} из группы?`;
        if (!window.confirm(prompt)) {
          setMutatingRowId(null);
          return;
        }

        const result = await apiRequest('/api/userbot/crm/subscribers/batch-kick', {
          accessToken,
          method: 'POST',
          body: {
            subscription_ids: [rowId],
            action_source: 'customers'
          }
        });

        window.alert(`Удаление завершено. Кикнули: ${result.kicked || 0}.`);
      }

      await loadCustomers();
    } catch (error) {
      window.alert(error.message);
    } finally {
      setMutatingRowId(null);
    }
  }, [accessToken, loadCustomers, resolveActionChannelId]);

  return { runSubscriptionAction };
}
