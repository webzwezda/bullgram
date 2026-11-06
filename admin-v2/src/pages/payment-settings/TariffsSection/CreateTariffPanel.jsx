import { useState, useEffect } from 'react';
import { Plus, Loader2, Infinity as InfinityIcon, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/button.jsx';
import { Card } from '../../../components/ui/card.jsx';
import { Input } from '../../../components/ui/input.jsx';
import { FieldLabel, ErrorText, MoneyDestinationNote } from './shared.jsx';
import { CreateAccessSection } from './CreateAccessSection.jsx';

export function CreateTariffPanel({
  onClose, newTariff, setNewTariff, channels, onCreate, creating, bundleSupport,
  destWallet, destLoaded
}) {
  const [errors, setErrors] = useState({});

  const groupAccess = newTariff.access_methods?.group || { enabled: true };
  const chatAccess = newTariff.access_methods?.chat || { enabled: false, channel_id: '' };
  const resourceAccess = newTariff.access_methods?.resource || { enabled: false, title: '', text: '' };
  const tonPayment = newTariff.payment_methods?.ton || { enabled: false, price: '' };
  const isLifetime = newTariff.is_lifetime || false;
  const isFree = newTariff.is_free || false;
  const selectedBotId = newTariff.bot_id || '';

  const botChannels = selectedBotId
    ? channels.filter((channel) => channel.bot_id === selectedBotId)
    : channels;
  const isChannel = (channel) => !['group', 'supergroup'].includes(String(channel.chat_type || '').toLowerCase());
  const isChat = (channel) => ['group', 'supergroup'].includes(String(channel.chat_type || '').toLowerCase());
  // "Closed" = private (or unknown visibility — treat as private until Telegram tells us otherwise).
  // Public channels can be joined freely, so they shouldn't appear as "what buyer gets after paying".
  const isClosed = (channel) => String(channel.visibility || '').toLowerCase() !== 'public';

  const groupChannels = botChannels.filter((channel) => isChannel(channel) && isClosed(channel));
  const chatChannels = botChannels.filter((channel) => isChat(channel) && isClosed(channel));

  useEffect(() => {
    if (groupAccess.enabled && !newTariff.channel_id && groupChannels.length > 0) {
      setNewTariff((prev) => ({ ...prev, channel_id: groupChannels[0].id }));
    }
  }, [groupAccess.enabled, groupChannels.length]);

  useEffect(() => {
    if (chatAccess.enabled && !chatAccess.channel_id && chatChannels.length > 0) {
      updateAccessMethod('chat', { channel_id: chatChannels[0].id });
    }
  }, [chatAccess.enabled, chatChannels.length]);

  // On bot change: reset channel selection AND auto-enable "closed channel"
  // toggle only when the bot actually has closed channels. Empty bot → toggle off.
  useEffect(() => {
    setNewTariff((prev) => ({
      ...prev,
      channel_id: groupChannels.length > 0 ? groupChannels[0].id : '',
      access_methods: {
        ...prev.access_methods,
        group: { enabled: groupChannels.length > 0 }
      }
    }));
    updateAccessMethod('chat', { channel_id: chatChannels.length > 0 ? chatChannels[0].id : '' });
  }, [selectedBotId]);

  const updatePaymentMethod = (method, patch) => {
    setNewTariff((prev) => ({
      ...prev,
      payment_methods: {
        ...prev.payment_methods,
        [method]: { ...prev.payment_methods?.[method], ...patch }
      }
    }));
  };

  const updateAccessMethod = (method, patch) => {
    setNewTariff((prev) => ({
      ...prev,
      access_methods: {
        ...prev.access_methods,
        [method]: { ...prev.access_methods?.[method], ...patch }
      }
    }));
  };

  const handleCreate = () => {
    const nextErrors = {};
    if (!newTariff.title?.trim()) nextErrors.title = 'Укажи название тарифа';
    if (!isLifetime && (!newTariff.duration_days || Number(newTariff.duration_days) <= 0)) {
      nextErrors.duration_days = 'Укажи срок действия';
    }
    // Платный тариф без кошелька приёма — деньги физически некуда переводить.
    if (!isFree && destLoaded && !destWallet) {
      toast.error('Сначала задайте кошелёк для приёма оплат — Касса → Реквизиты');
      return;
    }
    const hasAnyAccess = groupAccess.enabled || chatAccess.enabled || resourceAccess.enabled;
    if (!hasAnyAccess) nextErrors.access = 'Выбери хотя бы один метод выдачи';
    if (groupAccess.enabled && !newTariff.channel_id) {
      nextErrors.group_channel = groupChannels.length === 0 ? 'У бота нет закрытых каналов' : 'Выбери закрытый канал';
    }
    if (chatAccess.enabled && !chatAccess.channel_id) {
      nextErrors.chat_channel = chatChannels.length === 0 ? 'У бота нет закрытых чатов' : 'Выбери закрытый чат';
    }
    if (resourceAccess.enabled && !resourceAccess.text?.trim()) {
      nextErrors.resource_text = 'Заполни ссылку или текст';
    }
    if (!isFree && (!tonPayment.price || Number(tonPayment.price) <= 0)) {
      nextErrors.ton_price = 'Укажи цену в TON';
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      toast.error('Заполни обязательные поля');
      return;
    }
    setErrors({});
    onCreate();
  };

  return (
    <Card className="border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
      <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
            <Plus className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900">Создать тариф</h2>
            <p className="text-xs text-slate-500 font-medium mt-0.5">Все поля на одном экране</p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          onClick={onClose}
          className="h-9 px-3 text-slate-500 hover:text-slate-900 font-bold shrink-0"
        >
          Отмена
        </Button>
      </div>

      <div className="p-5 sm:p-6 space-y-6">
        {/* Section: Basic */}
        <div className="space-y-4">
          <div>
            <FieldLabel required>Название тарифа</FieldLabel>
            <Input
              value={newTariff.title}
              onChange={(e) => setNewTariff((prev) => ({ ...prev, title: e.target.value }))}
              placeholder="VIP месяц"
              className={`h-11 ${errors.title ? 'border-rose-300 focus-visible:ring-rose-500' : ''}`}
            />
            <ErrorText>{errors.title}</ErrorText>
          </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {!isLifetime ? (
                  <div>
                    <FieldLabel required>Срок (дни)</FieldLabel>
                    <Input
                      type="number"
                      min="1"
                      value={newTariff.duration_days}
                      onChange={(e) => setNewTariff((prev) => ({ ...prev, duration_days: e.target.value }))}
                      placeholder="30"
                      className={`h-11 ${errors.duration_days ? 'border-rose-300 focus-visible:ring-rose-500' : ''}`}
                    />
                    <ErrorText>{errors.duration_days}</ErrorText>
                  </div>
                ) : (
                  <div>
                    <FieldLabel>Срок доступа</FieldLabel>
                    <div className="h-11 px-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center gap-2 text-emerald-700 font-bold text-sm">
                      <InfinityIcon className="w-4 h-4" />
                      Навсегда
                    </div>
                  </div>
                )}

                <div>
                  <FieldLabel>Тип срока</FieldLabel>
                  <div className="flex rounded-xl border border-slate-200 overflow-hidden h-11">
                    <button
                      type="button"
                      onClick={() => setNewTariff((prev) => ({ ...prev, is_lifetime: false }))}
                      className={`flex-1 text-sm font-bold transition-colors ${
                        !isLifetime ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      Ограниченный
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewTariff((prev) => ({ ...prev, is_lifetime: true }))}
                      className={`flex-1 text-sm font-bold transition-colors ${
                        isLifetime ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      Пожизненный
                    </button>
                  </div>
                </div>
              </div>
        </div>

        <div className="border-t border-slate-100" />

        {/* Section: Access */}
        <CreateAccessSection
          errors={errors}
          bundleSupport={bundleSupport}
          groupAccess={groupAccess}
          chatAccess={chatAccess}
          resourceAccess={resourceAccess}
          groupChannels={groupChannels}
          chatChannels={chatChannels}
          newTariff={newTariff}
          setNewTariff={setNewTariff}
          updateAccessMethod={updateAccessMethod}
        />

        <div className="border-t border-slate-100" />

        {/* Section: Payment */}
        <div className="space-y-3">
          <div>
            <FieldLabel>Тип тарифа</FieldLabel>
            <div className="flex rounded-xl border border-slate-200 overflow-hidden h-11">
              <button
                type="button"
                onClick={() => setNewTariff((prev) => ({ ...prev, is_free: false }))}
                className={`flex-1 text-sm font-bold transition-colors ${
                  !isFree ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                Платный
              </button>
              <button
                type="button"
                onClick={() => setNewTariff((prev) => ({ ...prev, is_free: true }))}
                className={`flex-1 text-sm font-bold transition-colors ${
                  isFree ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                Бесплатный
              </button>
            </div>
          </div>

          {isFree ? (
            <div className="flex items-start gap-2 text-[11px] font-bold text-emerald-700 bg-emerald-50 p-3 rounded-xl border border-emerald-200">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>Бесплатный тариф или товар — оплата не требуется, доступ выдаётся сразу.</span>
            </div>
          ) : (
            <div>
              <FieldLabel required>Цена товара в TON</FieldLabel>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={tonPayment.price}
                onChange={(e) => updatePaymentMethod('ton', { price: e.target.value })}
                placeholder="0.5"
                className={`h-11 ${errors.ton_price ? 'border-rose-300 focus-visible:ring-rose-500' : ''}`}
              />
              <ErrorText>{errors.ton_price}</ErrorText>
            </div>
          )}

          {!isFree && <MoneyDestinationNote wallet={destWallet} loaded={destLoaded} />}
        </div>

        <div className="flex justify-end pt-2">
          <Button
            type="button"
            onClick={handleCreate}
            disabled={creating || (!isFree && destLoaded && !destWallet)}
            title={(!isFree && destLoaded && !destWallet) ? 'Сначала задайте кошелёк для приёма оплат — Касса → Реквизиты' : undefined}
            className="h-11 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-md shadow-indigo-200"
          >
            {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
            {creating ? 'Создание...' : 'Создать тариф'}
          </Button>
        </div>
      </div>
      </Card>
  );
}
