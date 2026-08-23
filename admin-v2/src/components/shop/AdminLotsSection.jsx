import { useCallback, useEffect, useState } from 'react';
import { Store, Loader2, Tag, Clock, User } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { apiRequest } from '../../api/client.js';

const TYPE_LABELS = {
  proxy: 'Прокси',
  userbot: 'Юзербот',
  bundle: 'Комплект',
  channel_audience_asset: 'База',
  text_offer: 'Оффер'
};

function typeLabel(itemType) {
  return TYPE_LABELS[String(itemType || '')] || 'Лот';
}

const LOTS_PAGE_SIZE = 20;

export function AdminLotsSection({ accessToken, types, title, emptyText, onChanged }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [unpublishingId, setUnpublishingId] = useState('');
  const [page, setPage] = useState(1);

  const loadLots = useCallback(async () => {
    if (!accessToken) return;
    try {
      const data = await apiRequest(`/api/shop/admin/market-lots?types=${encodeURIComponent(types)}`, { accessToken });
      setItems(data?.items || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken, types]);

  useEffect(() => {
    setLoading(true);
    loadLots();
  }, [loadLots]);

  const totalPages = Math.max(1, Math.ceil(items.length / LOTS_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStartIndex = (safePage - 1) * LOTS_PAGE_SIZE;
  const pageItems = items.slice(pageStartIndex, pageStartIndex + LOTS_PAGE_SIZE);

  async function unpublishLot(itemId) {
    setUnpublishingId(String(itemId));
    try {
      await apiRequest(`/api/shop/seller/items/${itemId}/unpublish`, { accessToken, method: 'POST' });
      setItems((prev) => prev.filter((item) => String(item.id) !== String(itemId)));
      toast.success('Лот снят с продажи');
      if (onChanged) await onChanged();
    } catch (error) {
      toast.error(error.message);
      loadLots();
    } finally {
      setUnpublishingId('');
    }
  }

  return (
    <Card className="border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 mb-6 bg-white overflow-hidden rounded-2xl">
      <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
            <Store className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              {title}
              <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border-0 text-xs rounded-full px-2">
                {items.length}
              </Badge>
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">Все опубликованные лоты. Снятие убирает лот с витрины сразу.</p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="p-10 flex items-center justify-center text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="p-12 text-center flex flex-col items-center justify-center bg-white">
          <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4 ring-1 ring-slate-100">
            <Store className="w-8 h-8 text-slate-300" />
          </div>
          <h3 className="text-base font-semibold text-slate-900">Витрина пуста</h3>
          <p className="mt-1 text-sm text-slate-500 max-w-sm">
            {emptyText || 'Опубликованных лотов сейчас нет.'}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {pageItems.map((item) => (
            <div key={item.id} className="p-5 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/50 transition-colors">
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <div className="text-[15px] font-bold text-slate-900 truncate">{item.title}</div>
                  <span className="inline-flex px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200 text-[10px] font-black uppercase tracking-wide">
                    {typeLabel(item.item_type)}
                  </span>
                  {item.active_reservation ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-black uppercase tracking-wide">
                      <Clock className="w-3 h-3" /> Бронь
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1 font-bold text-slate-700">
                    <Tag className="w-3.5 h-3.5 text-slate-400" /> TON {Number(item.price_ton || 0)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <User className="w-3.5 h-3.5 text-slate-400" />
                    {item.owner_name || `Owner ${String(item.owner_id || '').slice(0, 8)}`}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="shrink-0 h-9 px-4 rounded-xl border border-red-200 text-red-600 text-[13px] font-bold hover:bg-red-50 transition-all disabled:opacity-50 inline-flex items-center gap-2"
                disabled={unpublishingId === String(item.id)}
                onClick={() => unpublishLot(item.id)}
              >
                {unpublishingId === String(item.id) ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Снять с продажи
              </button>
            </div>
          ))}
        </div>
      )}

      {!loading && totalPages > 1 ? (
        <div className="border-t border-slate-100 px-5 sm:px-6 py-3.5 flex items-center justify-between gap-3 bg-slate-50/50">
          <span className="text-[12px] text-slate-500">
            Показано {pageStartIndex + 1}–{Math.min(pageStartIndex + LOTS_PAGE_SIZE, items.length)} из {items.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="h-8 px-3 rounded-lg border border-slate-200 text-[12px] font-bold text-slate-600 hover:bg-slate-50 transition disabled:opacity-40"
              disabled={safePage <= 1}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            >
              ← Назад
            </button>
            <span className="text-[13px] font-bold text-slate-700 tabular-nums">Стр. {safePage} из {totalPages}</span>
            <button
              type="button"
              className="h-8 px-3 rounded-lg border border-slate-200 text-[12px] font-bold text-slate-600 hover:bg-slate-50 transition disabled:opacity-40"
              disabled={safePage >= totalPages}
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            >
              Вперёд →
            </button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
