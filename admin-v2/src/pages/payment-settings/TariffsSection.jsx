import { useMemo, useState, useEffect } from 'react';
import { Check, Plus, Search } from 'lucide-react';
import { useAuth } from '../../app/providers/AuthProvider.jsx';
import { apiRequest } from '../../api/client.js';
import { Button } from '../../components/ui/button.jsx';
import { Card } from '../../components/ui/card.jsx';
import { Badge } from '../../components/ui/badge.jsx';
import { CreateTariffPanel } from './TariffsSection/CreateTariffPanel.jsx';
import { TariffRow, EmptyState } from './TariffsSection/TariffList.jsx';

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

  // Кошелёк приёма оплат — один фетч на экран: и для подсказки «куда идут деньги»,
  // и для блокировки создания платного тарифа без кошелька.
  const { accessToken } = useAuth();
  const [destWallet, setDestWallet] = useState('');
  const [destLoaded, setDestLoaded] = useState(false);
  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    apiRequest('/api/payment-settings', { accessToken })
      .then((data) => { if (!cancelled) setDestWallet(String(data?.settings?.ton_wallet || '')); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setDestLoaded(true); });
    return () => { cancelled = true; };
  }, [accessToken]);

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
      // При активном фильтре по боту показываем только точные совпадения:
      // тарифы без привязки к боту (bot_id=null) видны только в режиме «Все боты».
      if (filterBotId) {
        const botId = String(group.lead?.bot_id || '');
        if (botId !== filterBotId) return false;
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
          destWallet={destWallet}
          destLoaded={destLoaded}
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
                  {filterBotId ? 'Показаны только тарифы выбранного бота' : 'Доступны для покупки через бота'}
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
        <EmptyState onCreate={() => setCreateOpen(true)} destWallet={destWallet} destLoaded={destLoaded} />
      )}
    </section>
  );
}
