import { Package, Plus, Search, Server, Trash2, ExternalLink, EyeOff } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ITEM_FILTERS, itemStatusMeta, offerCodeLabel, visibilityLabel, salesChannelLabel, paymentMethodsLabel, itemPriceSummary, assetText, TONE_COLORS } from './shop.utils.js';

function StatusBadge({ tone, children, className = '' }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold tracking-wide ${TONE_COLORS[tone] || TONE_COLORS.default} ${className}`}>
      {children}
    </span>
  );
}

export function ItemsTab({
  filteredItems,
  itemSummary,
  canUseAssetSeller,
  planRules,
  profileRole,
  onUnpublish,
  onDelete,
  onOpenCreate,
  onOpenProxyComposer,
  itemFilter,
  setItemFilter,
  itemSearch,
  setItemSearch
}) {

  return (
    <Card className="border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 rounded-2xl bg-white overflow-hidden">
      <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
              <Package className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                Мои товары
                <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border-0 text-xs rounded-full px-2">
                  {itemSummary.total}
                </Badge>
              </h2>
              <p className="text-sm text-slate-500 mt-0.5">Все товары в одном месте: опубликованные, черновики и проданные.</p>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            {canUseAssetSeller && (
              <Button variant="outline" size="sm" className="rounded-xl text-xs" onClick={onOpenProxyComposer}>
                <Server className="w-3.5 h-3.5 mr-1.5" />
                Продать прокси
              </Button>
            )}
            <Button size="sm" className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs" onClick={onOpenCreate}>
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Создать оффер
            </Button>
          </div>
        </div>
      </div>

      <CardContent className="p-5 sm:p-6 space-y-4">
        {profileRole !== 'admin' && (
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 text-sm text-slate-600">
            <span className="font-semibold text-slate-800">Тариф: {planRules.label}</span>
            <span className="mx-2">•</span>
            {planRules.canUseShopAdmin ? 'Полный seller-режим' : 'Только текстовые офферы'}
          </div>
        )}

        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              className="h-10 pl-9 rounded-xl bg-white border-slate-200 text-sm"
              placeholder="Название, тип, видимость..."
              value={itemSearch}
              onChange={(e) => setItemSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {ITEM_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setItemFilter(f.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                itemFilter === f.id
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
              <Package className="w-8 h-8 text-slate-300" />
            </div>
            <h3 className="text-base font-bold text-slate-900 mb-1">Товаров пока нет</h3>
            <p className="text-sm text-slate-500 max-w-sm">Создайте первый оффер или выставьте прокси на продажу.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredItems.slice(0, 50).map((item) => {
              const status = itemStatusMeta(item);
              const codeLabel = offerCodeLabel(item.offer_code);
              return (
                <div key={item.id} className="rounded-xl border border-slate-200 bg-white p-4 hover:bg-slate-50/50 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-900 text-sm truncate">{item.title}</span>
                        {codeLabel && (
                          <Badge variant="secondary" className="bg-slate-100 text-slate-600 border-0 text-[10px] rounded-md px-1.5 py-0">
                            {codeLabel}
                          </Badge>
                        )}
                        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                      </div>
                      <div className="text-xs text-slate-500 mt-1.5 space-x-1.5">
                        <span>{item.item_type === 'text_offer' ? 'Текстовый оффер' : item.item_type}</span>
                        <span>•</span>
                        <span className="font-medium text-slate-700">{itemPriceSummary(item)}</span>
                        <span>•</span>
                        <span>{visibilityLabel(item.visibility)}</span>
                        <span>•</span>
                        <span>{salesChannelLabel(item.sales_channel)}</span>
                        <span>•</span>
                        <span>{paymentMethodsLabel(item.payment_methods)}</span>
                      </div>
                      {(item.assets || []).length > 0 && (
                        <div className="text-xs text-slate-400 mt-1">{assetText(item)}</div>
                      )}
                      <div className="text-xs text-slate-400 mt-1.5">
                        Ожидает: {item.stats?.pending_purchases || 0} • Оплачено: {item.stats?.paid_purchases || 0} • Завершено: {item.stats?.completed_transfers || 0} • Ошибки: {item.stats?.failed_transfers || 0}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {item.status === 'published' && (
                        <Button variant="ghost" size="sm" className="text-xs h-8 rounded-lg" onClick={() => onUnpublish(item.id)}>
                          <EyeOff className="w-3.5 h-3.5 mr-1" />
                          Снять
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" className="text-xs h-8 rounded-lg text-rose-600 hover:text-rose-700 hover:bg-rose-50" onClick={() => onDelete(item.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                      <a
                        href={`/shop/?item=${encodeURIComponent(item.id)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
