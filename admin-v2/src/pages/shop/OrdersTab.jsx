import { ShoppingCart, Search, FileCheck, CheckCircle2, XCircle, ExternalLink, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  PURCHASE_FILTERS, purchaseStatusMeta, purchaseAmountSummary,
  formatWhen, paymentMethodLabel, purchaseAssetText, purchaseHasAssetType, TONE_COLORS
} from './shop.utils.js';

function StatusBadge({ tone, children, className = '' }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold tracking-wide ${TONE_COLORS[tone] || TONE_COLORS.default} ${className}`}>
      {children}
    </span>
  );
}

export function OrdersTab({
  filteredPurchases,
  purchaseSummary,
  receiptQueue,
  onCheck,
  onApprove,
  onReject,
  purchaseFilter,
  setPurchaseFilter,
  purchaseSearch,
  setPurchaseSearch
}) {
  return (
    <div className="space-y-4">
      <Card className="border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 rounded-2xl bg-white overflow-hidden">
        <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-600 flex items-center justify-center text-white shadow-md shadow-emerald-500/20 shrink-0">
              <ShoppingCart className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                Заказы
                <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border-0 text-xs rounded-full px-2">
                  {purchaseSummary.total}
                </Badge>
              </h2>
              <p className="text-sm text-slate-500 mt-0.5">Заказы, статусы оплаты и передача товара. Спорные P2P оплаты разбираются в сверке.</p>
            </div>
          </div>
        </div>

        <CardContent className="p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                className="h-10 pl-9 rounded-xl bg-white border-slate-200 text-sm"
                placeholder="Название, покупатель, memo..."
                value={purchaseSearch}
                onChange={(e) => setPurchaseSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {PURCHASE_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setPurchaseFilter(f.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  purchaseFilter === f.id
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {filteredPurchases.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                <ShoppingCart className="w-8 h-8 text-slate-300" />
              </div>
              <h3 className="text-base font-bold text-slate-900 mb-1">Заказов нет</h3>
              <p className="text-sm text-slate-500 max-w-sm">Когда появится первый заказ, он отобразится здесь.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredPurchases.slice(0, 50).map((purchase) => {
                const status = purchaseStatusMeta(purchase);
                return (
                  <div key={purchase.id} className="rounded-xl border border-slate-200 bg-white p-4 hover:bg-slate-50/50 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-slate-900 text-sm">{purchase.item?.title || 'Товар удалён'}</span>
                          {purchase.batch && (
                            <Badge variant="secondary" className="bg-slate-100 text-slate-600 border-0 text-[10px] rounded-md px-1.5 py-0">
                              x{purchase.purchase_ids?.length}
                            </Badge>
                          )}
                          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                        </div>

                        <div className="text-xs text-slate-500 mt-1.5 space-x-1.5">
                          <span className="font-medium text-slate-700">{purchaseAmountSummary(purchase)}</span>
                          <span>•</span>
                          <span>{paymentMethodLabel(purchase.payload?.payment_method)}</span>
                          <span>•</span>
                          <span>{purchase.payload?.payment_method === 'p2p' ? (purchase.payload?.sbp_bank || 'СБП') : 'TON'}</span>
                        </div>

                        <div className="text-xs text-slate-400 mt-1">
                          Покупатель: {purchase.buyer_owner_id?.slice(0, 8) || '—'}...
                          {purchase.payload?.memo && <span> • Memo: {purchase.payload.memo}</span>}
                        </div>

                        <div className="text-xs text-slate-400 mt-0.5">
                          {purchase.status === 'pending'
                            ? `Ожидает до ${formatWhen(purchase.expires_at)}`
                            : formatWhen(purchase.created_at)}
                        </div>

                        {purchase.ownership_transfer_error && (
                          <div className="flex items-center gap-1.5 mt-1.5 text-xs text-rose-600">
                            <AlertTriangle className="w-3 h-3" />
                            {purchase.ownership_transfer_error}
                          </div>
                        )}

                        {purchase.payload?.payment_method === 'p2p' && purchase.payload?.receipt_file_url && (
                          <div className="mt-1.5">
                            <a href={purchase.payload.receipt_file_url} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 hover:underline inline-flex items-center gap-1">
                              <FileCheck className="w-3 h-3" />
                              Открыть чек
                            </a>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                        <Button variant="outline" size="sm" className="text-xs h-8 rounded-lg" onClick={() => onCheck(purchase)}>
                          Проверить
                        </Button>
                        {purchase.status === 'awaiting_receipt' && (
                          <>
                            <Button size="sm" className="text-xs h-8 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => onApprove(purchase)}>
                              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                              Подтвердить
                            </Button>
                            <Button variant="outline" size="sm" className="text-xs h-8 rounded-lg text-rose-600 border-rose-200 hover:bg-rose-50" onClick={() => onReject(purchase)}>
                              <XCircle className="w-3.5 h-3.5 mr-1" />
                              Отклонить
                            </Button>
                          </>
                        )}
                        {purchase.payload?.buyer_tg_user_id && (
                          <a
                            href={`/app/dossier?tg=${encodeURIComponent(purchase.payload.buyer_tg_user_id)}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                        {purchaseHasAssetType(purchase, 'proxy') && (
                          <a href="/app/proxies" target="_blank" rel="noreferrer" className="text-xs text-slate-400 hover:text-indigo-600">Прокси</a>
                        )}
                        {purchaseHasAssetType(purchase, 'userbot') && (
                          <a href="/app/userbots" target="_blank" rel="noreferrer" className="text-xs text-slate-400 hover:text-indigo-600">Боты</a>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {receiptQueue.length > 0 && (
        <Card className="border-amber-200 shadow-lg shadow-amber-100/40 ring-1 ring-amber-200/50 rounded-2xl bg-white overflow-hidden">
          <div className="bg-amber-50/50 border-b border-amber-100 p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
                <FileCheck className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 flex items-center gap-2">
                  Оплаты на подтверждение
                  <Badge variant="secondary" className="bg-amber-100 text-amber-700 border-0 text-xs rounded-full px-2">
                    {receiptQueue.length}
                  </Badge>
                </h3>
                <p className="text-xs text-slate-500">Покупатели отметили оплату. Основное рабочее место для таких случаев — сверка оплат.</p>
                <a href="/app/billing" className="mt-2 inline-flex text-xs font-bold text-amber-700 hover:text-amber-900">
                  Открыть сверку оплат
                </a>
              </div>
            </div>
          </div>
          <CardContent className="p-5 space-y-3">
            {receiptQueue.map((purchase) => (
              <div key={`receipt-${purchase.id}`} className="rounded-xl border border-amber-200 bg-amber-50/30 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm text-slate-900">{purchase.item?.title || 'Лот'}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {purchaseAmountSummary(purchase)} • {paymentMethodLabel(purchase.payload?.payment_method)}
                      {purchase.payload?.sbp_bank && ` • ${purchase.payload.sbp_bank}`}
                      {purchase.purchase_ids?.length > 1 && ` • ${purchase.purchase_ids.length} счёта`}
                    </div>
                    {purchase.payload?.receipt_note && (
                      <div className="text-xs text-slate-400 mt-1">{purchase.payload.receipt_note}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {purchase.payload?.receipt_file_url && (
                      <a href={purchase.payload.receipt_file_url} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 hover:underline">
                        Открыть чек
                      </a>
                    )}
                    <Button size="sm" className="text-xs h-8 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => onApprove(purchase)}>
                      Подтвердить
                    </Button>
                    <Button variant="outline" size="sm" className="text-xs h-8 rounded-lg text-rose-600 border-rose-200 hover:bg-rose-50" onClick={() => onReject(purchase)}>
                      Отклонить
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
