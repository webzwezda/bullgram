import { Loader2 } from 'lucide-react';
import { PROXY_TABLE_PAGE_SIZE, formatTon } from './proxyShared.js';

export function ProxySaleToolbar({ saleProxies, allSaleSelected, toggleAllSaleSelection, listingSale, selectedSaleCount, salePriceTon, setSalePriceTon, listSelectedForSale }) {
  return (
          <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl bg-violet-50/60 border border-violet-100 px-4 py-3">
            <label className="flex items-center gap-2 text-[13px] font-bold text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                className="w-4 h-4 accent-violet-600"
                checked={allSaleSelected}
                onChange={toggleAllSaleSelection}
              />
              Все не выставленные ({saleProxies.length})
            </label>
            <span className="text-[12px] text-slate-500 font-medium">
              Отметь прокси в списке, задай цену — лот на каждый создастся и опубликуется сам.
            </span>
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-[12px] font-bold text-slate-500">Цена/шт</span>
              <input
                className="h-9 w-24 px-3 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-900 outline-none focus:border-violet-400"
                type="number"
                min="0"
                step="0.01"
                value={salePriceTon}
                onChange={(event) => setSalePriceTon(event.target.value)}
                placeholder="TON"
              />
              <button
                type="button"
                className="h-9 px-4 rounded-xl bg-violet-600 text-white text-[13px] font-bold hover:bg-violet-700 transition-all disabled:opacity-50 inline-flex items-center gap-2"
                disabled={listingSale || !selectedSaleCount || !(Number(salePriceTon) > 0)}
                onClick={listSelectedForSale}
              >
                {listingSale ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {listingSale ? 'Выставляем...' : `Выставить${selectedSaleCount ? ` ${selectedSaleCount}` : ''}`}
              </button>
            </div>
          </div>
  );
}

export function ProxySoldList({ pageItems }) {
  return (
        <div className="divide-y divide-slate-100">
          {pageItems.map((item) => {
            const proxyAssets = (item.assets || []).filter((asset) => asset.asset_type === 'proxy');
            return (
              <div key={item.id} className="p-5 md:px-8 md:py-5 hover:bg-slate-50/50 transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1.5">
                      <div className="text-[15px] font-bold text-slate-900 truncate">{item.title}</div>
                      <span className="shrink-0 text-xs font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded-md">TON {formatTon(item.price_ton)}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
                      <span>{proxyAssets.map((a) => a.label || 'Proxy').join(', ') || 'Proxy'}</span>
                      <span>Продаж: <strong className="text-slate-700">{item.stats?.paid_purchases || 0}</strong></span>
                      <span>Handoff: <strong className="text-slate-700">{item.stats?.completed_transfers || 0}</strong></span>
                    </div>
                  </div>
                  {/* Осознанная внешняя ссылка в paywall-кабину: заказы продавца
                      (проданные прокси) живут в /app/billing?tab=purchases,
                      в приложении «Юзербот» их экрана нет. Полный переход, новая вкладка. */}
                  <a
                    className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 !text-white text-xs font-bold hover:bg-blue-700 transition-all"
                    href="/paywall/billing?tab=purchases"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" strokeWidth={2.5} />
                    Заказы
                  </a>
                </div>
              </div>
            );
          })}
        </div>
  );
}

export function ProxyTablePagination({ pageStartIndex, tableItems, safePage, totalPages, setProxyPage }) {
  return (
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 md:px-8 py-4 border-t border-slate-100">
          <span className="text-xs font-bold text-slate-500">
            Показано {pageStartIndex + 1}–{Math.min(pageStartIndex + PROXY_TABLE_PAGE_SIZE, tableItems.length)} из {tableItems.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="h-8 px-3 rounded-lg border border-slate-200 text-[12px] font-bold text-slate-600 hover:bg-slate-50 transition disabled:opacity-40"
              disabled={safePage <= 1}
              onClick={() => setProxyPage((prev) => Math.max(1, prev - 1))}
            >
              ← Назад
            </button>
            <span className="text-[13px] font-bold text-slate-700 tabular-nums">Стр. {safePage} из {totalPages}</span>
            <button
              type="button"
              className="h-8 px-3 rounded-lg border border-slate-200 text-[12px] font-bold text-slate-600 hover:bg-slate-50 transition disabled:opacity-40"
              disabled={safePage >= totalPages}
              onClick={() => setProxyPage((prev) => Math.min(totalPages, prev + 1))}
            >
              Вперёд →
            </button>
          </div>
        </div>
  );
}
