import { Bot } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { BotTariffsSection } from './BotTariffsSection.jsx';
import { BotConfigSection, BotRuntimeSection } from './sections/BotConfigSections.jsx';
import { BotAdminsSection } from './sections/BotAdminsSection.jsx';
import { FreePlacesSection } from './sections/SalesPlaces.jsx';

export function OfficialBotsSection({
  botForm,
  setBotForm,
  state,
  addOfficialBot,
  replaceOfficialBotToken,
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
  setNewAdminTgId,
  ownerId
}) {
  const isNew = selectedOfficialBotId === 'new';

  const contourDraft = salesContourSectionProps?.draft || {};
  const assignedIds = new Set(
    [
      contourDraft.publicChannelId,
      contourDraft.publicChatId,
      contourDraft.paidChannelId,
      contourDraft.paidChatId
    ]
      .filter(Boolean)
      .map((value) => String(value))
  );

  return (
    <div className="flex flex-col gap-6">
      {!isNew ? (
        <BotRuntimeSection
          selectedOfficialBot={selectedOfficialBot}
          refreshOfficialBotWebhookStatus={refreshOfficialBotWebhookStatus}
          reregisterWebhook={reregisterWebhook}
          state={state}
        />
      ) : null}

      <BotConfigSection
        selectedOfficialBot={selectedOfficialBot}
        selectedOfficialBotId={selectedOfficialBotId}
        setSelectedOfficialBotId={setSelectedOfficialBotId}
        officialBots={officialBots}
        botForm={botForm}
        setBotForm={setBotForm}
        addOfficialBot={addOfficialBot}
        replaceOfficialBotToken={replaceOfficialBotToken}
        deleteOfficialBot={deleteOfficialBot}
        state={state}
        salesContourSectionProps={salesContourSectionProps}
        channelsByBotId={channelsByBotId}
        deleteTelegramPlace={deleteTelegramPlace}
        refreshTelegramPlaceInfo={refreshTelegramPlaceInfo}
        refreshingTelegramPlaceId={refreshingTelegramPlaceId}
      />

      {isNew ? (
        <Card className="p-0 gap-0 border-0 shadow-sm ring-1 ring-slate-200/60 bg-white overflow-hidden rounded-2xl">
          <div className="p-5 sm:p-6 flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
              <Bot className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-bold text-slate-900">Что это за бот</h3>
              <p className="text-sm text-slate-600 mt-1 leading-relaxed max-w-2xl">
                Бот продаж принимает оплату и сам выдаёт доступ: приглашает покупателя
                в закрытый канал или чат, ведёт подписки и напоминания о продлении,
                а вам присылает уведомления о каждой продаже. Настраивается один раз — дальше работает сам.
              </p>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {['Выдача доступа после оплаты', 'Тарифы и подписки', 'Уведомления о продажах'].map((chip) => (
                  <span key={chip} className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 text-xs font-semibold">
                    {chip}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {!isNew ? (
        <BotAdminsSection
          selectedOfficialBot={selectedOfficialBot}
          botAdmins={botAdmins}
          botAdminsLoading={botAdminsLoading}
          inviteLink={inviteLink}
          addingBotAdmin={addingBotAdmin}
          newAdminTgId={newAdminTgId}
          setNewAdminTgId={setNewAdminTgId}
          handleAddBotAdmin={handleAddBotAdmin}
          handleRemoveBotAdmin={handleRemoveBotAdmin}
          handleRegenerateBotAdminInvite={handleRegenerateBotAdminInvite}
          regeneratingInvite={regeneratingInvite}
        />
      ) : null}

      {!isNew ? (
        <FreePlacesSection
          selectedOfficialBot={selectedOfficialBot}
          channelsByBotId={channelsByBotId}
          deleteTelegramPlace={deleteTelegramPlace}
          refreshTelegramPlaceInfo={refreshTelegramPlaceInfo}
          refreshingTelegramPlaceId={refreshingTelegramPlaceId}
          assignedIds={assignedIds}
        />
      ) : null}

      {!isNew && selectedOfficialBot ? (
        <BotTariffsSection
          selectedBot={selectedOfficialBot}
          ownerId={ownerId}
          channels={channelsByBotId[String(selectedOfficialBot.id)] || []}
        />
      ) : null}
    </div>
  );
}
