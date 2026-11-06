import { Globe, ExternalLink, Filter, Loader2 } from 'lucide-react';
import {
  LANE_OPTIONS,
  PROXY_TABLE_PAGE_SIZE,
  ADMIN_PROXY_GROUPS,
  STATUS_DOT_HEX,
  proxyBadge,
  proxyHealthMode,
  proxyHasLiveUserbot,
  countryFlag,
  formatWhen,
  formatTon,
  inventoryGroupActionLabel,
  proxyEgressSummary,
} from './proxyShared.js';
import { ProxySaleToolbar, ProxySoldList, ProxyTablePagination } from './ProxyTableParts.jsx';

// Таблица прокси живёт в модульной области: внутри страницы функция
// пересоздавалась на каждом рендере, React видел новый type компонента
// и ремонтировал весь subtree (потеря фокуса поля цены, лишний DOM-разбор
// на каждый ввод символа). Все зависимости страницы передаются пропсами.
export function ProxyTableSection({
  armedDeleteId,
  checkProxy,
  checkingIds,
  deleteProxy,
  getVisibleProxies,
  isAdmin,
  listingSale,
  listSelectedForSale,
  moveProxyToGroup,
  movingProxyId,
  proxyPage,
  salePriceTon,
  saleProxies,
  saleSelection,
  saleStatusFilter,
  selectedLane,
  sellerProxyItemMap,
  setArmedDeleteId,
  setProxyPage,
  setSalePriceTon,
  setSaleStatusFilter,
  setSelectedLane,
  toggleAllSaleSelection,
  toggleSaleSelection
}) {
  const { items: visibleItems, isSold } = getVisibleProxies();
  const laneInfo = LANE_OPTIONS.find(l => l.id === selectedLane);
  const listableSaleProxies = saleProxies.filter((proxy) => !proxyHasLiveUserbot(proxy));
  const selectedSaleCount = listableSaleProxies.filter((proxy) => saleSelection.has(String(proxy.id))).length;
  const allSaleSelected = listableSaleProxies.length > 0 && selectedSaleCount === listableSaleProxies.length;

  const onSaleLane = selectedLane === 'on-sale' && isAdmin;
  const listingByProxyId = new Map();
  let listedCount = 0;
  let unlistedCount = 0;
  if (onSaleLane) {
    for (const proxy of visibleItems) {
      const shopItems = sellerProxyItemMap.get(String(proxy.id)) || [];
      const isListed = shopItems.some((i) => i.status === 'published' && i.visibility !== 'private');
      if (isListed) listedCount += 1;
      if (shopItems.length === 0) unlistedCount += 1;
      listingByProxyId.set(String(proxy.id), { isListed, hasLot: shopItems.length > 0 });
    }
  }

  const tableItems = onSaleLane
    ? visibleItems.filter((proxy) => {
        const status = listingByProxyId.get(String(proxy.id));
        if (saleStatusFilter === 'listed') return status.isListed;
        if (saleStatusFilter === 'unlisted') return !status.hasLot;
        return true;
      })
    : visibleItems;

  const totalPages = Math.max(1, Math.ceil(tableItems.length / PROXY_TABLE_PAGE_SIZE));
  const safePage = Math.min(proxyPage, totalPages);
  const pageStartIndex = (safePage - 1) * PROXY_TABLE_PAGE_SIZE;
  const pageItems = tableItems.slice(pageStartIndex, pageStartIndex + PROXY_TABLE_PAGE_SIZE);

  return (
    <>
    <div className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
      {/* Unified header with filters */}
      <div className="p-6 md:p-8 border-b border-slate-100">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-violet-600 flex items-center justify-center text-white shadow-lg shadow-violet-500/20">
              <Filter className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">Прокси</h2>
              <p className="text-sm text-slate-500 font-medium mt-0.5">
                {laneInfo ? laneInfo.label : 'Все прокси'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="px-4 py-2 bg-violet-50 text-violet-700 rounded-xl text-sm font-bold border border-violet-100">
              {visibleItems.length}
            </div>
          </div>
        </div>

        {/* Row 1: Lane selection */}
        <div className="mb-3">
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
            Категория
          </div>
          <div className="flex gap-2 p-1.5 bg-slate-100 rounded-2xl overflow-x-auto">
            {LANE_OPTIONS.map((lane) => (
              <button
                key={lane.id}
                type="button"
                className={`px-4 py-2 text-xs font-black uppercase tracking-wider rounded-xl transition-all whitespace-nowrap ${
                  selectedLane === lane.id
                    ? 'bg-white text-violet-600 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
                onClick={() => {
                  setSelectedLane(lane.id);
                  setProxyPage(1);
                }}
              >
                {lane.label}
              </button>
            ))}
          </div>
        </div>

        {onSaleLane ? (
          <div className="flex flex-wrap gap-2 mt-4">
            {[
              ['all', `Все · ${visibleItems.length}`],
              ['listed', `На витрине · ${listedCount}`],
              ['unlisted', `Не выставлены · ${unlistedCount}`]
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`px-3 py-1.5 text-[11px] font-black uppercase tracking-wider rounded-lg border transition-all ${
                  saleStatusFilter === value
                    ? 'bg-violet-600 border-violet-600 text-white'
                    : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700'
                }`}
                onClick={() => {
                  setSaleStatusFilter(value);
                  setProxyPage(1);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}

        {selectedLane === 'on-sale' && isAdmin && saleProxies.length > 0 ? (
          <ProxySaleToolbar
            saleProxies={saleProxies}
            allSaleSelected={allSaleSelected}
            toggleAllSaleSelection={toggleAllSaleSelection}
            listingSale={listingSale}
            selectedSaleCount={selectedSaleCount}
            salePriceTon={salePriceTon}
            setSalePriceTon={setSalePriceTon}
            listSelectedForSale={listSelectedForSale}
          />
        ) : null}
      </div>

      {tableItems.length === 0 ? (
        <div className="p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center text-slate-300 mx-auto mb-4">
            <Globe className="w-8 h-8" />
          </div>
          <p className="text-slate-500 font-bold">
            {isSold ? 'Проданных прокси пока нет' : 'Прокси с этим фильтром нет'}
          </p>
        </div>
      ) : isSold ? (
        <ProxySoldList pageItems={pageItems} />
      ) : (
        <div className="divide-y divide-slate-100">
          {pageItems.map((proxy) => {
            const badge = proxyBadge(proxy);
            const mode = proxyHealthMode(proxy);
            const proxyIsBusy = proxyHasLiveUserbot(proxy);
            const geo = proxy.last_check_country
              ? `${countryFlag(proxy.last_check_country_code) ? `${countryFlag(proxy.last_check_country_code)} ` : ''}${proxy.last_check_country}${proxy.last_check_city ? `, ${proxy.last_check_city}` : ''}`
              : mode === 'telegram_only'
                ? 'Telegram only'
                : '—';
            const statusBgColor = badge.tone === 'ok'
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : badge.tone === 'warning'
                ? 'bg-amber-50 text-amber-700 border-amber-200'
                : badge.tone === 'danger'
                  ? 'bg-red-50 text-red-700 border-red-200'
                  : 'bg-slate-50 text-slate-600 border-slate-200';
            const shopItems = selectedLane === 'on-sale'
              ? (sellerProxyItemMap.get(String(proxy.id)) || [])
              : [];
            const isListed = shopItems.some((i) => i.status === 'published' && i.visibility !== 'private');
            const hasDraft = shopItems.some((i) => i.status === 'draft' || i.visibility === 'private');
            return (
              <div key={proxy.id} className="p-5 md:px-8 md:py-5 hover:bg-slate-50/50 transition-colors">
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                  <div className="flex-1 min-w-0 space-y-2.5">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      {selectedLane === 'on-sale' && isAdmin && shopItems.length === 0 ? (
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-violet-600 shrink-0"
                          checked={saleSelection.has(String(proxy.id))}
                          disabled={proxyIsBusy}
                          title={proxyIsBusy ? 'На прокси живой юзербот — выставить на витрину нельзя' : undefined}
                          onChange={() => toggleSaleSelection(proxy.id)}
                        />
                      ) : null}
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: STATUS_DOT_HEX[badge.tone] || STATUS_DOT_HEX.default }} />
                      <div className="text-[15px] font-bold text-slate-900">{proxy.name}</div>
                      <span className={`inline-flex px-2.5 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wide border ${statusBgColor}`}>
                        {badge.text}
                      </span>
                      {selectedLane === 'on-sale' ? (
                        isListed ? (
                          <span className="inline-flex px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-black uppercase">На витрине</span>
                        ) : hasDraft ? (
                          <span className="inline-flex px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 border border-slate-200 text-[10px] font-black uppercase">Черновик</span>
                        ) : (
                          <span className="inline-flex px-2 py-0.5 rounded-md bg-amber-50 text-amber-600 border border-amber-200 text-[10px] font-black uppercase">Не выставлен</span>
                        )
                      ) : null}
                      {Number(proxy.userbot_count || 0) > 1 ? (
                        <span className="inline-flex px-2 py-0.5 rounded-md bg-red-50 text-red-600 border border-red-100 text-[10px] font-black uppercase">Shared</span>
                      ) : null}
                      {selectedLane === 'on-sale' && proxyIsBusy ? (
                        <span
                          className="inline-flex px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 border border-slate-200 text-[10px] font-black uppercase"
                          title="На прокси живой юзербот — витрина отклонит листинг"
                        >
                          Занят юзерботом
                        </span>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Адрес</span>
                        <span className="font-mono text-[13px] font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded">{proxy.host}:{proxy.port}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Гео</span>
                        <span className="font-medium text-slate-700">{geo}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Нагрузка</span>
                        <span className={`font-bold ${Number(proxy.userbot_count || 0) > 0 ? 'text-slate-900' : 'text-emerald-600'}`}>
                          {Number(proxy.userbot_count || 0) > 0 ? `${proxy.userbot_count} userbot` : 'Свободен'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Исходящий</span>
                        <span className="font-mono text-[13px] text-slate-700">{proxyEgressSummary(proxy)}</span>
                      </div>
                      {proxy.ipv6 ? (
                        <span className="text-xs font-bold text-slate-500 bg-slate-50 px-2 py-0.5 rounded-md">IPv6</span>
                      ) : null}
                    </div>

                    <div className="text-xs text-slate-500">
                      Проверен: <span className="text-slate-700">{formatWhen(proxy.last_checked_at)}</span>
                    </div>

                    {proxy.last_check_error ? (
                      <div className="text-xs text-red-700 bg-red-50 px-3 py-2 rounded-lg border border-red-200">
                        {proxy.last_check_error}
                      </div>
                    ) : null}
                    {mode === 'telegram_only' ? (
                      <div className="text-xs text-slate-500 bg-slate-50 px-3 py-2 rounded-lg border border-slate-100">
                        Работает только для Telegram-подключений
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      className="h-9 px-4 rounded-xl bg-blue-600 text-white text-[13px] font-bold hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      type="button"
                      disabled={checkingIds.has(String(proxy.id))}
                      onClick={() => checkProxy(proxy.id)}
                    >
                      {checkingIds.has(String(proxy.id)) ? 'Проверяем...' : 'Проверить'}
                    </button>
                    {isAdmin && proxy.provision_source === 'manual_admin' ? (
                      <select
                        className="h-9 px-3 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 bg-white"
                        aria-label={`Группа прокси «${proxy.name}»`}
                        title="Переносит прокси в другую группу сразу"
                        value={proxy.inventory_group || 'shop_sale'}
                        disabled={movingProxyId === String(proxy.id)}
                        onChange={(event) => moveProxyToGroup(proxy, event.target.value)}
                      >
                        {ADMIN_PROXY_GROUPS.map((group) => (
                          <option key={group} value={group}>{inventoryGroupActionLabel(group)}</option>
                        ))}
                      </select>
                    ) : null}
                    <button
                      className={`h-9 px-4 rounded-xl text-[13px] font-bold transition-all ${
                        armedDeleteId === String(proxy.id)
                          ? 'bg-red-600 text-white hover:bg-red-700'
                          : 'border border-red-200 text-red-600 hover:bg-red-50'
                      }`}
                      type="button"
                      onClick={() => (armedDeleteId === String(proxy.id) ? deleteProxy(proxy) : setArmedDeleteId(String(proxy.id)))}
                    >
                      {armedDeleteId === String(proxy.id) ? 'Точно удалить?' : 'Удалить'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 ? (
        <ProxyTablePagination
          pageStartIndex={pageStartIndex}
          tableItems={tableItems}
          safePage={safePage}
          totalPages={totalPages}
          setProxyPage={setProxyPage}
        />
      ) : null}
    </div>
    </>
  );
}
