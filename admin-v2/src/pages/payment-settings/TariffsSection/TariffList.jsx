import {
  Package, Trash2, Clock, Bot as BotIcon,
  Users, MessageCircle, Link2, Plus, Infinity as InfinityIcon
} from 'lucide-react';
import { Button } from '../../../components/ui/button.jsx';
import { Card } from '../../../components/ui/card.jsx';
import { MoneyDestinationNote, priceBadgeClass, currencyGlyph } from './shared.jsx';

function dedupeBundleItems(items = []) {
  const byKey = new Map();
  items.forEach((item) => {
    const key = [item.item_type, item.channel_id || '', item.resource_title || '', item.resource_url || ''].join('|');
    if (!byKey.has(key)) byKey.set(key, { ...item, itemIds: [item.id] });
    else byKey.get(key).itemIds.push(item.id);
  });
  return Array.from(byKey.values());
}

function AccessChip({ icon: Icon, label }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-600 bg-slate-100 px-2 py-1 rounded-md">
      <Icon className="w-3 h-3 text-slate-400" />
      <span className="max-w-[140px] truncate">{label}</span>
    </span>
  );
}

export function TariffRow({ group, botsById, deleteTariff }) {
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
              <span className="text-[11px] text-slate-500 italic font-medium">Только базовая выдача</span>
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
                  isFreeVariant ? 'bg-emerald-700 text-white border-0' : priceBadgeClass(variant.currency)
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
            // Это soft-delete (is_active=false): тариф скрывается с витрины, но чеки и статистика остаются.
            if (!window.confirm(`Отключить тариф «${tariff.title}»? Его перестанут видеть покупатели.`)) return;
            deleteTariff(group.tariffIds);
          }}
          className="inline-flex items-center justify-center w-9 h-9 rounded-xl border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 hover:border-rose-300 shrink-0 transition-colors"
          title="Отключить тариф"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export function EmptyState({ onCreate, destWallet, destLoaded }) {
  return (
    <Card className="border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
      <div className="p-10 text-center space-y-4">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400">
          <Package className="w-7 h-7" />
        </div>
        <div className="max-w-md mx-auto space-y-1.5">
          <h3 className="font-bold text-lg text-slate-900">Пока нет тарифов</h3>
          <p className="text-sm text-slate-500 font-medium">Создайте первый тариф — он станет доступен для покупки через бота</p>
        </div>
        <Button
          type="button"
          onClick={onCreate}
          className="h-11 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-md shadow-indigo-200 mt-2"
        >
          <Plus className="w-4 h-4 mr-2" /> Создать тариф
        </Button>
        <div className="max-w-md mx-auto pt-2">
          <MoneyDestinationNote wallet={destWallet} loaded={destLoaded} />
        </div>
      </div>
    </Card>
  );
}
