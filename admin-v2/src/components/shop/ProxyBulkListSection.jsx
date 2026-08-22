import { useState } from 'react';
import { Loader2, Store } from 'lucide-react';
import { toast } from 'sonner';
import { apiRequest } from '../../api/client.js';

export function ProxyBulkListSection({ accessToken, saleProxies, onListed }) {
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [priceTon, setPriceTon] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const selectedCount = saleProxies.filter((proxy) => selectedIds.has(String(proxy.id))).length;
  const allSelected = saleProxies.length > 0 && selectedCount === saleProxies.length;

  function toggleProxy(proxyId) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const key = String(proxyId);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds((prev) => {
      if (saleProxies.length > 0 && saleProxies.every((proxy) => prev.has(String(proxy.id)))) {
        return new Set();
      }
      return new Set(saleProxies.map((proxy) => String(proxy.id)));
    });
  }

  async function listSelected() {
    const ids = saleProxies
      .filter((proxy) => selectedIds.has(String(proxy.id)))
      .map((proxy) => proxy.id);
    const price = Number(priceTon);

    if (!ids.length) {
      toast.error('Сначала выбери прокси');
      return;
    }
    if (!(price > 0)) {
      toast.error('Укажи цену лота в TON');
      return;
    }

    setSubmitting(true);
    try {
      const data = await apiRequest('/api/shop/seller/items/batch-proxy', {
        accessToken,
        method: 'POST',
        body: { proxy_ids: ids, price_ton: price }
      });

      if (Number(data?.created || 0) > 0) {
        toast.success(`Выставлено лотов: ${data.created}`);
      }
      const nameById = new Map(saleProxies.map((proxy) => [String(proxy.id), proxy.name || `${proxy.host}:${proxy.port}`]));
      for (const failure of data?.errors || []) {
        toast.error(`${nameById.get(String(failure.proxy_id)) || 'Прокси'}: ${failure.error}`);
      }

      setSelectedIds(new Set());
      if (onListed) await onListed();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
      <div className="p-6 md:p-8 border-b border-slate-100">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
              <Store className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">Выставить на продажу</h2>
              <p className="text-sm text-slate-500 font-medium mt-0.5">
                Не выставлено: {saleProxies.length}. Лот создаётся сам: название = имя прокси, описание с гео, оплата TON, публикуется сразу.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="h-9 px-4 rounded-xl border border-slate-200 text-slate-700 text-[13px] font-bold hover:bg-slate-50 transition-all shrink-0"
            onClick={toggleAll}
          >
            {allSelected ? 'Снять все' : 'Выбрать все'}
          </button>
        </div>
      </div>

      <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
        {saleProxies.map((proxy) => {
          const checked = selectedIds.has(String(proxy.id));
          return (
            <label
              key={proxy.id}
              className="flex items-center gap-3 px-5 md:px-8 py-3 hover:bg-slate-50/50 transition-colors cursor-pointer"
            >
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-slate-300 text-indigo-600 accent-indigo-600"
                checked={checked}
                onChange={() => toggleProxy(proxy.id)}
              />
              <span className="text-[14px] font-bold text-slate-900 truncate">{proxy.name}</span>
              <span className="font-mono text-[13px] text-slate-600 bg-slate-100 px-2 py-0.5 rounded">{proxy.host}:{proxy.port}</span>
              {proxy.last_check_country ? (
                <span className="text-xs font-bold text-slate-500">{proxy.last_check_country}</span>
              ) : null}
            </label>
          );
        })}
      </div>

      <div className="p-6 md:p-8 border-t border-slate-100">
        <div className="flex flex-col sm:flex-row sm:items-end gap-4">
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">Цена за штуку, TON</label>
            <input
              className="h-11 w-full sm:w-44 px-4 rounded-[14px] border border-slate-200 bg-slate-50 text-[14px] font-medium text-slate-950 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/10 shadow-sm"
              type="number"
              min="0"
              step="0.01"
              value={priceTon}
              onChange={(event) => setPriceTon(event.target.value)}
              placeholder="0"
            />
          </div>
          <button
            type="button"
            className="h-11 px-6 rounded-[14px] bg-indigo-600 text-[14px] font-bold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 inline-flex items-center justify-center gap-2"
            disabled={submitting || !selectedCount || !(Number(priceTon) > 0)}
            onClick={listSelected}
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {submitting ? 'Выставляем...' : `Выставить ${selectedCount || ''} прокси`}
          </button>
        </div>
      </div>
    </div>
  );
}
