import { CreditCard, Loader2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

function purchaseBadge(status) {
  switch (status) {
    case 'paid':
      return { text: 'Оплачено', className: 'bg-emerald-100 text-emerald-700 border border-emerald-200' };
    case 'awaiting_receipt':
      return { text: 'Ждём чек', className: 'bg-amber-100 text-amber-700 border border-amber-200' };
    case 'expired':
      return { text: 'Просрочено', className: 'bg-slate-100 text-slate-600 border border-slate-200' };
    case 'pending':
    default:
      return { text: 'Ожидает оплаты', className: 'bg-sky-100 text-sky-700 border border-sky-200' };
  }
}

function shortTitle(purchase, fallback) {
  const itemTitle = purchase?.item?.title;
  if (itemTitle) return itemTitle;
  if (purchase?.batch) return `Комплект x${purchase.purchase_ids?.length || 1}`;
  return fallback || 'Заказ';
}

export function OpenPurchasesList({ openPurchases, activePurchase, checkoutState, setSelectedOpenPurchaseId, showPurchaseInline, cancelCheckout }) {
  return openPurchases.length > 0 ? (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider text-amber-700">
          <CreditCard className="size-4" />
          Ожидают оплаты
          <Badge variant="secondary" className="bg-amber-100 text-amber-700 border-0 rounded-full px-2 text-[11px]">
            {openPurchases.length}
          </Badge>
        </div>
      </div>
      <ul className="space-y-2">
        {openPurchases.map((purchase) => {
          const isActive = String(activePurchase?.id || '') === String(purchase.id)
            || (activePurchase?.batch && Array.isArray(activePurchase?.purchase_ids)
              && activePurchase.purchase_ids.includes(String(purchase.id)));
          const status = purchaseBadge(purchase.status);
          return (
            <li
              key={purchase.id}
              className={`flex flex-wrap items-center gap-3 rounded-xl border bg-white px-4 py-3 transition ${
                isActive ? 'border-indigo-300 ring-2 ring-indigo-500/15' : 'border-slate-200'
              }`}
            >
              <button
                type="button"
                className="flex-1 min-w-0 text-left"
                onClick={() => {
                  setSelectedOpenPurchaseId(String(purchase.id));
                  showPurchaseInline(purchase);
                }}
              >
                <div className="text-[14px] font-bold text-slate-900 truncate">
                  {shortTitle(purchase, 'Заказ')}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
                  <span className="font-mono">{Number(purchase.amount_ton || 0)} TON</span>
                  <span className="text-slate-300">•</span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ${status.className}`}>
                    {status.text}
                  </span>
                </div>
              </button>
              {purchase.status === 'pending' ? (
                <Button
                  size="sm"
                  className="h-8 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white border-0 text-xs font-bold"
                  onClick={() => {
                    setSelectedOpenPurchaseId(String(purchase.id));
                    showPurchaseInline(purchase);
                  }}
                >
                  Оплатить
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                onClick={() => cancelCheckout(purchase)}
                disabled={checkoutState.checking && isActive}
                aria-label="Отменить покупку"
              >
                {checkoutState.checking && isActive ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <X className="size-4" />
                )}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  ) : null;
}
