import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { apiRequest } from '../../api/client.js';
import { useAuth } from '../../app/providers/AuthProvider.jsx';
import { LoadingState } from '../../ui/LoadingState.jsx';
import { OfficialBotsSection } from './OfficialBotsSection.jsx';
import { useOfficialAccountsData } from './useOfficialAccountsData.js';
import { useOfficialBotsController } from './useOfficialBotsController.js';
import { useSalesContourController } from './useSalesContourController.js';

// Самостоятельный контейнер страницы «Бот продаж» (/app/sales-bot).
//
// Вынесен из BotsAccountsPage (план docs/plans/2026-09-26-userbot-product-split.md,
// Фаза 3): тянет только свой срез данных через useOfficialAccountsData —
// боты + контуры + каналы + payment_settings, плюс юзерботные данные для
// контурной ротации (accounts/proxies/reservedUserbotIds). Не использует
// общий useBotsAccountsData и витрину магазина — поллинг 60с не дублируется
// со страницей юзерботов.

function showUiMessage(text, tone = 'default') {
  if (tone === 'success') return toast.success(text);
  if (tone === 'error') return toast.error(text);
  return toast(text);
}

const CONTOUR_ROLE_LABELS = {
  public_channel_id: 'Открытый канал',
  paid_channel_id: 'Закрытый канал',
  public_chat_id: 'Открытый чат',
  paid_chat_id: 'Закрытый чат'
};

export function OfficialBotsPage() {
  const { accessToken, user } = useAuth();
  const [refreshingTelegramPlaceId, setRefreshingTelegramPlaceId] = useState('');
  const { state, setState, reloadAccounts } = useOfficialAccountsData({
    accessToken,
    ownerId: user?.id
  });

  // Каналы по ботам — локальный аналог channelsByBotId из
  // useBotsAccountsDerivedState (тот хук уезжает с юзербот-режимом в /userbot).
  const channelsByBotId = useMemo(() => {
    return (state.channels || []).reduce((acc, channel) => {
      const key = String(channel.bot_id || '').trim();
      if (!key) return acc;
      if (!acc[key]) acc[key] = [];
      acc[key].push(channel);
      return acc;
    }, {});
  }, [state.channels]);

  const {
    addOfficialBot,
    addingBotAdmin,
    botAdmins,
    botAdminsLoading,
    botForm,
    deleteOfficialBot,
    handleAddBotAdmin,
    handleRemoveBotAdmin,
    handleRegenerateBotAdminInvite,
    inviteLink,
    newAdminTgId,
    officialBots,
    refreshOfficialBotWebhookStatus,
    regeneratingInvite,
    replaceOfficialBotToken,
    reregisterWebhook,
    selectedOfficialBot,
    selectedOfficialBotId,
    setBotForm,
    setNewAdminTgId,
    setSelectedOfficialBotId
  } = useOfficialBotsController({
    accessToken,
    accounts: state.accounts,
    paymentAdminTgId: state.paymentAdminTgId,
    reloadAccounts,
    setState,
    showUiMessage
  });

  const salesContourSectionProps = useSalesContourController({
    accessToken,
    accounts: state.accounts,
    proxies: state.proxies,
    reservedUserbotIds: state.reservedUserbotIds,
    channelsByBotId,
    officialBotContoursPayload: state.officialBotContoursPayload,
    officialBotContoursError: state.officialBotContoursError,
    reloadAccounts,
    selectedOfficialBot,
    state,
    setState,
    showUiMessage
  });

  async function deleteTelegramPlace(place) {
    const placeId = String(place?.id || '').trim();
    if (!placeId) return;
    const placeTitle = String(place?.title || place?.tg_chat_id || 'Telegram-площадку');
    if (!window.confirm(`Удалить ${placeTitle} из Bullgram? В Telegram это ничего не удалит.`)) return;

    try {
      await apiRequest(`/api/official-bot/channels/${placeId}`, {
        accessToken,
        method: 'DELETE'
      });
      await reloadAccounts();
    } catch (error) {
      showUiMessage(error.message, 'error');
    }
  }

  async function refreshTelegramPlaceInfo(place) {
    const placeId = String(place?.id || '').trim();
    if (!placeId) return;

    setRefreshingTelegramPlaceId(placeId);
    try {
      const data = await apiRequest(`/api/official-bot/channels/${placeId}/refresh`, {
        accessToken,
        method: 'POST'
      });
      await reloadAccounts();
      const change = data?.contourChange;
      if (change && change.from && change.to) {
        const from = CONTOUR_ROLE_LABELS[change.from] || change.from;
        const to = CONTOUR_ROLE_LABELS[change.to] || change.to;
        if (change.displacedChannelId) {
          showUiMessage(`Канал перенесён из «${from}» в «${to}». Предыдущий канал из «${to}» перемещён в свободные площадки.`, 'success');
        } else {
          showUiMessage(`Канал автоматически перенесён из «${from}» в «${to}».`, 'success');
        }
      } else {
        showUiMessage('Информация о Telegram-площадке обновлена.', 'success');
      }
    } catch (error) {
      showUiMessage(error.message, 'error');
    } finally {
      setRefreshingTelegramPlaceId('');
    }
  }

  const officialBotsSectionProps = {
    botForm,
    setBotForm,
    state,
    addOfficialBot,
    deleteOfficialBot,
    selectedOfficialBot,
    selectedOfficialBotId,
    setSelectedOfficialBotId,
    officialBots,
    refreshOfficialBotWebhookStatus,
    reregisterWebhook,
    channelsByBotId,
    deleteTelegramPlace,
    refreshTelegramPlaceInfo,
    refreshingTelegramPlaceId,
    salesContourSectionProps,
    addingBotAdmin,
    botAdmins,
    botAdminsLoading,
    handleAddBotAdmin,
    handleRemoveBotAdmin,
    handleRegenerateBotAdminInvite,
    inviteLink,
    newAdminTgId,
    regeneratingInvite,
    replaceOfficialBotToken,
    setNewAdminTgId,
    ownerId: user?.id
  };

  if (state.loading) {
    return <LoadingState text="Тянем ботов, прокси и контуры продаж..." />;
  }

  if (state.error) {
    return (
      <section className="page page--flush">
        <div className="page__header">
          <h1>Бот продаж</h1>
          <p>Загрузка ботов и контуров вернула ошибку.</p>
        </div>
        <div className="error-card">{state.error}</div>
      </section>
    );
  }

  return (
    <section className="page page--flush">
      <OfficialBotsSection {...officialBotsSectionProps} />
    </section>
  );
}
