import { useMemo, useState, useEffect } from 'react';
import {
  Package, Plus, Trash2, Clock, Bot as BotIcon,
  Users, MessageCircle, Link2, Loader2, Check, Infinity as InfinityIcon,
  AlertCircle, Search
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button.jsx';
import { Card } from '../../components/ui/card.jsx';
import { Input } from '../../components/ui/input.jsx';
import { Textarea } from '../../components/ui/textarea.jsx';
import { Badge } from '../../components/ui/badge.jsx';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '../../components/ui/select.jsx';

/* ---------------- data helpers (unchanged) ---------------- */

function getTariffPaymentGroupKey(tariff) {
  return [
    tariff?.owner_id || '',
    tariff?.channel_id || '',
    String(tariff?.title || '').trim().toLowerCase(),
    String(tariff?.duration_days || '')
  ].join('|');
}

function sortTariffPaymentVariants(variants = []) {
  const currencyOrder = { TON: 1, RUB: 2, USDT: 3 };
  return [...variants].sort((left, right) => {
    const byCurrency = (currencyOrder[left.currency] || 99) - (currencyOrder[right.currency] || 99);
    if (byCurrency !== 0) return byCurrency;
    return Number(left.price || 0) - Number(right.price || 0);
  });
}

function buildTariffGroups(tariffs = []) {
  const groupsByKey = new Map();
  tariffs.forEach((tariff) => {
    const key = getTariffPaymentGroupKey(tariff);
    if (!groupsByKey.has(key)) groupsByKey.set(key, { key, variants: [] });
    groupsByKey.get(key).variants.push(tariff);
  });

  return Array.from(groupsByKey.values())
    .map((group) => {
      const variants = sortTariffPaymentVariants(group.variants);
      return {
        ...group,
        lead: variants[0],
        variants,
        tariffIds: variants.map((variant) => variant.id)
      };
    })
    .sort((left, right) => Number(left.lead?.price || 0) - Number(right.lead?.price || 0));
}

function dedupeBundleItems(items = []) {
  const byKey = new Map();
  items.forEach((item) => {
    const key = [item.item_type, item.channel_id || '', item.resource_title || '', item.resource_url || ''].join('|');
    if (!byKey.has(key)) byKey.set(key, { ...item, itemIds: [item.id] });
    else byKey.get(key).itemIds.push(item.id);
  });
  return Array.from(byKey.values());
}

/* ---------------- small UI primitives ---------------- */

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        checked ? 'bg-indigo-600' : 'bg-slate-200'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

function FieldLabel({ children, required }) {
  return (
    <label className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5 mb-1.5">
      {children}
      {required && <span className="text-rose-500">*</span>}
    </label>
  );
}

function ErrorText({ children }) {
  if (!children) return null;
  return <div className="text-xs text-rose-600 font-semibold mt-1">{children}</div>;
}

function priceBadgeClass(currency) {
  if (currency === 'TON') return 'bg-slate-900 text-white border-0';
  if (currency === 'RUB') return 'bg-emerald-600 text-white border-0';
  return 'bg-slate-100 text-slate-700 border border-slate-200';
}

function currencyGlyph(currency) {
  if (currency === 'TON') return 'TON';
  if (currency === 'RUB') return '₽';
  return currency;
}

/* ---------------- tariff row ---------------- */

function AccessChip({ icon: Icon, label }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-600 bg-slate-100 px-2 py-1 rounded-md">
      <Icon className="w-3 h-3 text-slate-400" />
      <span className="max-w-[140px] truncate">{label}</span>
    </span>
  );
}

function TariffRow({ group, botsById, deleteTariff }) {
  const tariff = group.lead;
  const bundleItems = dedupeBundleItems(group.bundleItems || []);
  const hasGroup = tariff.channel_id || tariff.channels;

  const bot = tariff.bot_id ? botsById.get(String(tariff.bot_id)) : null;
  const botLabel = bot
    ? (bot.tg_username ? `@${bot.tg_username}` : `Bot ${bot.tg_account_id}`)
    : 'Все боты';
  const durationLabel = !tariff.duration_days || tariff.duration_days === 0
    ? 'Навсегда'
    : `${tariff.duration_days} дн.`;
  const isLifetime = !tariff.duration_days || tariff.duration_days === 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 md:gap-6 p-4 hover:bg-slate-50/70 transition-colors border-b border-slate-100 last:border-b-0">
      {/* Left zone: identity + chips */}
      <div className="flex items-start gap-3 min-w-0">
        <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 mt-0.5">
          <Package className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-base text-slate-900 truncate max-w-full">{tariff.title}</h3>
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
              {isLifetime ? <InfinityIcon className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
              {durationLabel}
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">
              <BotIcon className="w-3 h-3" />
              {botLabel}
            </span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap mt-2">
            {hasGroup && (
              <AccessChip icon={Users} label={tariff.channels?.title || 'Закрытый канал'} />
            )}
            {bundleItems.map((item) => (
              <AccessChip
                key={item.itemIds?.[0] || item.id}
                icon={item.item_type === 'channel' ? MessageCircle : Link2}
                label={item.item_type === 'channel'
                  ? (item.channels?.title || 'Чат')
                  : (item.resource_title || 'Ссылка / текст')}
              />
            ))}
            {!hasGroup && bundleItems.length === 0 && (
              <span className="text-[11px] text-slate-400 italic font-medium">Только базовая выдача</span>
            )}
          </div>
        </div>
      </div>

      {/* Right zone: prices + actions */}
      <div className="flex items-center justify-between md:justify-end gap-3 shrink-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          {group.variants.map((variant) => {
            const isFreeVariant = Number(variant.price) === 0;
            return (
              <span
                key={variant.id}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-black ${
                  isFreeVariant ? 'bg-emerald-600 text-white border-0' : priceBadgeClass(variant.currency)
                }`}
              >
                {isFreeVariant ? 'Бесплатно' : `${variant.price} ${currencyGlyph(variant.currency)}`}
              </span>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => {
            if (!window.confirm(`Удалить тариф «${tariff.title}»? Все варианты оплаты будут удалены.`)) return;
            deleteTariff(group.tariffIds);
          }}
          className="inline-flex items-center justify-center w-9 h-9 rounded-xl border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 hover:border-rose-300 shrink-0 transition-colors"
          title="Удалить тариф"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

/* ---------------- create dialog ---------------- */

function CreateTariffPanel({
  onClose, newTariff, setNewTariff, channels, onCreate, creating, bundleSupport
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

  useEffect(() => {
    setNewTariff((prev) => ({
      ...prev,
      channel_id: groupChannels.length > 0 ? groupChannels[0].id : ''
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
        <div className="space-y-3">
              <ErrorText>{errors.access}</ErrorText>

              {/* Closed channel (private) */}
              <div className={`rounded-xl border transition-all ${groupAccess.enabled ? 'border-indigo-200 bg-indigo-50/30' : 'border-slate-200 bg-white'}`}>
                <div className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-900">Закрытый канал</div>
                    <div className="text-xs text-slate-500 font-medium">Приватный канал — бот выдаст доступ после оплаты</div>
                  </div>
                  <Toggle checked={groupAccess.enabled} onChange={(v) => updateAccessMethod('group', { enabled: v })} label="Закрытый канал" />
                </div>
                {groupAccess.enabled && (
                  <div className="px-3 pb-3 space-y-2">
                    {groupChannels.length > 0 ? (
                      <Select
                        value={newTariff.channel_id}
                        onValueChange={(v) => setNewTariff((prev) => ({ ...prev, channel_id: v }))}
                      >
                        <SelectTrigger className={`h-10 w-full bg-white rounded-xl shadow-sm ${errors.group_channel ? 'border-rose-300' : 'border-slate-200'}`}>
                          <SelectValue placeholder="Выбери закрытый канал" />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl">
                          {groupChannels.map((channel) => (
                            <SelectItem key={channel.id} value={channel.id}>{channel.title}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <div className="space-y-2">
                        <Input value="Нет закрытых каналов у этого бота" disabled className="bg-slate-50 text-slate-400 h-10" />
                        <div className="flex items-start gap-2 text-[11px] font-medium text-slate-500 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-400" />
                          <span>
                            Создай приватный канал в Telegram, добавь этого бота админом с правом приглашать, затем привяжи канал выше в секции «Контур продаж» и обнови данные.
                          </span>
                        </div>
                      </div>
                    )}
                    <ErrorText>{errors.group_channel}</ErrorText>
                  </div>
                )}
              </div>

              {/* Closed chat (private) — only if bundleSupport */}
              {bundleSupport && (
                <div className={`rounded-xl border transition-all ${chatAccess.enabled ? 'border-indigo-200 bg-indigo-50/30' : 'border-slate-200 bg-white'}`}>
                  <div className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-slate-900">Закрытый чат</div>
                      <div className="text-xs text-slate-500 font-medium">Приватная группа — бот отправит ссылку на вступление</div>
                    </div>
                    <Toggle checked={chatAccess.enabled} onChange={(v) => updateAccessMethod('chat', { enabled: v })} label="Закрытый чат" />
                  </div>
                  {chatAccess.enabled && (
                    <div className="px-3 pb-3">
                      {chatChannels.length > 0 ? (
                        <Select
                          value={chatAccess.channel_id || ''}
                          onValueChange={(v) => updateAccessMethod('chat', { channel_id: v })}
                        >
                          <SelectTrigger className={`h-10 w-full bg-white rounded-xl shadow-sm ${errors.chat_channel ? 'border-rose-300' : 'border-slate-200'}`}>
                            <SelectValue placeholder="Выбери закрытый чат" />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl">
                            {chatChannels.map((channel) => (
                              <SelectItem key={channel.id} value={channel.id}>{channel.title}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input value="Нет закрытых чатов у этого бота" disabled className="bg-slate-50 text-slate-400 h-10" />
                      )}
                      <ErrorText>{errors.chat_channel}</ErrorText>
                    </div>
                  )}
                </div>
              )}

              {/* Resource (only if bundleSupport) */}
              {bundleSupport && (
                <div className={`rounded-xl border transition-all ${resourceAccess.enabled ? 'border-indigo-200 bg-indigo-50/30' : 'border-slate-200 bg-white'}`}>
                  <div className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-slate-900">Ссылка / текст</div>
                      <div className="text-xs text-slate-500 font-medium">Бот отправит материал после оплаты</div>
                    </div>
                    <Toggle checked={resourceAccess.enabled} onChange={(v) => updateAccessMethod('resource', { enabled: v })} label="Ссылка / текст" />
                  </div>
                  {resourceAccess.enabled && (
                    <div className="px-3 pb-3 space-y-3">
                      <div>
                        <FieldLabel>Название материала</FieldLabel>
                        <Input
                          value={resourceAccess.title || ''}
                          onChange={(e) => updateAccessMethod('resource', { title: e.target.value })}
                          placeholder="Гайд / курс / ссылка"
                          className="h-10"
                        />
                      </div>
                      <div>
                        <FieldLabel required>URL или текст</FieldLabel>
                        <Textarea
                          value={resourceAccess.text || ''}
                          onChange={(e) => updateAccessMethod('resource', { text: e.target.value })}
                          placeholder="https://... или текст, который получит покупатель"
                          rows={2}
                          className={errors.resource_text ? 'border-rose-300 focus-visible:ring-rose-500' : ''}
                        />
                        <ErrorText>{errors.resource_text}</ErrorText>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!bundleSupport && (
                <div className="flex items-start gap-2 text-[11px] font-bold text-amber-700 bg-amber-50 p-3 rounded-xl border border-amber-200">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>Bundle-пакеты в БД не активированы — доступны только закрытые группы.</span>
                </div>
              )}
        </div>

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
        </div>

        <div className="flex justify-end pt-2">
          <Button
            type="button"
            onClick={handleCreate}
            disabled={creating}
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

/* ---------------- empty state ---------------- */

function EmptyState({ onCreate }) {
  return (
    <Card className="border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
      <div className="p-10 text-center space-y-4">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400">
          <Package className="w-7 h-7" />
        </div>
        <div className="max-w-md mx-auto space-y-1.5">
          <h3 className="font-bold text-lg text-slate-900">Пока нет тарифов</h3>
          <p className="text-sm text-slate-500 font-medium">Создай первый тариф — он станет доступен для покупки через бота</p>
        </div>
        <Button
          type="button"
          onClick={onCreate}
          className="h-11 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-md shadow-indigo-200 mt-2"
        >
          <Plus className="w-4 h-4 mr-2" /> Создать тариф
        </Button>
      </div>
    </Card>
  );
}

/* ---------------- main export ---------------- */

export function TariffsSection({
  bundleSupport,
  channels,
  createTariff,
  deleteTariff,
  getTariffBundleItems,
  newTariff,
  officialBots,
  setNewTariff,
  tariffs,
  creating
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [filterBotId, setFilterBotId] = useState('');

  // Auto-select first bot if any exist (don't default to "All bots")
  useEffect(() => {
    if (!filterBotId && officialBots && officialBots.length > 0) {
      setFilterBotId(String(officialBots[0].id));
    }
  }, [officialBots, filterBotId]);

  // Create tariff inherits bot from the top-level filter — no separate field in the form.
  useEffect(() => {
    if (filterBotId) {
      setNewTariff((prev) => ({ ...prev, bot_id: filterBotId }));
    }
  }, [filterBotId, setNewTariff]);

  const tariffGroups = useMemo(() => {
    const groups = buildTariffGroups(tariffs).map((group) => ({
      ...group,
      bundleItems: getTariffBundleItems(group.tariffIds)
    }));
    return groups;
  }, [tariffs, getTariffBundleItems]);

  const botsById = useMemo(() => {
    const map = new Map();
    (officialBots || []).forEach((bot) => map.set(String(bot.id), bot));
    return map;
  }, [officialBots]);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tariffGroups.filter((group) => {
      if (q && !String(group.lead?.title || '').toLowerCase().includes(q)) return false;
      if (filterBotId) {
        const botId = String(group.lead?.bot_id || '');
        if (botId && botId !== filterBotId) return false;
      }
      return true;
    });
  }, [tariffGroups, search, filterBotId]);

  const hasTariffs = tariffGroups.length > 0;

  return (
    <section className="space-y-5">
      {/* Create panel (inline, above the list) */}
      {createOpen && (
        <CreateTariffPanel
          onClose={() => setCreateOpen(false)}
          newTariff={newTariff}
          setNewTariff={setNewTariff}
          channels={channels}
          onCreate={createTariff}
          creating={creating}
          bundleSupport={bundleSupport}
        />
      )}

      {/* Toolbar + list, OR empty state */}
      {hasTariffs ? (
        <Card className="border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
          {/* Card header with title + create */}
          <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                <Check className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  Активные тарифы
                  <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 border-0 text-xs rounded-full px-2">
                    {filteredGroups.length}
                  </Badge>
                </h2>
                <p className="text-xs text-slate-500 font-medium mt-0.5 truncate">
                  {filterBotId ? 'Отфильтровано по выбранному боту' : 'Доступны для покупки через бота'}
                </p>
              </div>
            </div>
            <Button
              type="button"
              onClick={() => setCreateOpen((v) => !v)}
              className={`h-10 px-4 rounded-xl font-bold shadow-md shrink-0 transition-colors ${
                createOpen
                  ? 'bg-slate-200 text-slate-700 hover:bg-slate-300 shadow-slate-200'
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-200'
              }`}
            >
              {createOpen ? (
                <>Отмена</>
              ) : (
                <><Plus className="w-4 h-4 mr-2" /> Создать</>
              )}
            </Button>
          </div>

          {/* Toolbar (search only) */}
          <div className="bg-white border-b border-slate-100 p-4 sm:p-5">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск по названию тарифа..."
                className="w-full pl-10 pr-4 h-11 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all shadow-sm"
              />
            </div>
          </div>

          {/* Rows */}
          {filteredGroups.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <Search className="w-8 h-8 text-slate-300 mx-auto" />
              <div className="text-sm font-bold text-slate-700">Ничего не найдено</div>
              <div className="text-xs text-slate-500 font-medium">Попробуй изменить запрос или бота в шапке</div>
            </div>
          ) : (
            <div>
              {filteredGroups.map((group) => (
                <TariffRow
                  key={group.key}
                  group={group}
                  botsById={botsById}
                  deleteTariff={deleteTariff}
                />
              ))}
            </div>
          )}
        </Card>
      ) : (
        <EmptyState onCreate={() => setCreateOpen(true)} />
      )}
    </section>
  );
}
