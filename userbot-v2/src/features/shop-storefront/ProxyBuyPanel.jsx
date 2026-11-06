import { useCallback } from 'react';
import { toast } from 'sonner';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Minus,
  Plus
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ShopPurchasePaymentPanel } from '../ton-checkout/ShopPurchasePaymentPanel.jsx';

export function ProxyBuyPanel({
  accessToken,
  activePurchase,
  buyLimit,
  checkPurchase,
  checkoutState,
  createBatchCheckout,
  isCreatingCheckout,
  isTestnet,
  maxQuantity,
  offer,
  openCheckout,
  PROXY_SLOT_KEY,
  quantity,
  refreshPurchases,
  reloadProxies,
  selectedItems,
  setBuyQuantities,
  setCheckoutState,
  totalTon
}) {
  const handlePaid = useCallback(async () => {
    setCheckoutState({
      item: null,
      purchase: null,
      paymentMethod: 'ton',
      loading: false,
      checking: false,
      error: '',
      notice: '',
      noticeTone: 'default'
    });
    try {
      await Promise.all([refreshPurchases(), reloadProxies()]);
    } catch {
      // surface не критичен — список обновится при следующем заходе
    }
  }, [refreshPurchases, reloadProxies, setCheckoutState]);

  const handlePayError = useCallback((err) => {
    setCheckoutState((prev) => ({
      ...prev,
      error: err?.message || 'Ошибка при оплате TON Connect'
    }));
  }, [setCheckoutState]);

  const handleReset = useCallback(() => {
    setCheckoutState({
      item: null,
      purchase: null,
      paymentMethod: 'ton',
      loading: false,
      checking: false,
      error: '',
      notice: '',
      noticeTone: 'default'
    });
  }, [setCheckoutState]);

  const handleManualCheck = useCallback(async () => {
    const result = await checkPurchase();
    if (result === 'paid') {
      toast.success('Оплата найдена. Прокси скоро появится в кабинете.');
    }
  }, [checkPurchase]);

  return (
    <div className="rounded-2xl bg-slate-50/70 p-4 space-y-3">
      {activePurchase ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">К оплате</div>
            <div className="text-xl font-black tracking-tight text-slate-900 leading-tight">
              {Number(activePurchase.amount_ton || 0)}
              <span className="text-sm font-bold text-slate-500 ml-1">TON</span>
              {isTestnet ? (
                <span className="ml-1.5 inline-flex items-center px-2 py-0.5 rounded-md bg-orange-100 text-orange-700 text-[10px] font-bold uppercase tracking-wider align-middle">
                  Testnet
                </span>
              ) : null}
            </div>
          </div>

          {checkoutState.error ? (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-medium text-rose-800">
              <AlertCircle className="size-4 text-rose-500 shrink-0 mt-0.5" />
              <div>{checkoutState.error}</div>
            </div>
          ) : null}

          {checkoutState.notice ? (
            <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[12px] font-medium ${
              checkoutState.noticeTone === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-amber-200 bg-amber-50 text-amber-800'
            }`}>
              <CheckCircle2 className={`size-4 shrink-0 mt-0.5 ${checkoutState.noticeTone === 'success' ? 'text-emerald-500' : 'text-amber-500'}`} />
              <div>{checkoutState.notice}</div>
            </div>
          ) : null}

          <ShopPurchasePaymentPanel
            purchase={activePurchase}
            checking={checkoutState.checking}
            accessToken={accessToken}
            onPaid={handlePaid}
            onPayError={handlePayError}
            onManualCheck={handleManualCheck}
            onReset={handleReset}
          />
        </>
      ) : (
        <>
          {/* Quantity + Price row */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1 rounded-xl bg-white ring-1 ring-slate-200 p-1">
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => setBuyQuantities((prev) => ({
                  ...prev,
                  [PROXY_SLOT_KEY]: Math.max(Number(prev[PROXY_SLOT_KEY] || 1) - 1, 1)
                }))}
                disabled={quantity <= 1}
                aria-label="Уменьшить количество"
              >
                <Minus className="size-4" />
              </button>
              <span className="min-w-8 text-center font-bold text-sm text-slate-900 tabular-nums px-0.5">{quantity}</span>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => setBuyQuantities((prev) => ({
                  ...prev,
                  [PROXY_SLOT_KEY]: Math.min(Number(prev[PROXY_SLOT_KEY] || 1) + 1, maxQuantity)
                }))}
                disabled={quantity >= maxQuantity || Number(buyLimit) <= 0}
                aria-label="Увеличить количество"
              >
                <Plus className="size-4" />
              </button>
            </div>

            <div className="text-right">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                {quantity > 1 ? `Итого за ${quantity} шт.` : 'Стоимость'}
              </div>
              <div className="text-xl font-black tracking-tight text-slate-900 leading-tight">
                {totalTon}
                <span className="text-sm font-bold text-slate-500 ml-1">TON</span>
              </div>
              {quantity > 1 && offer.samePrice ? (
                <div className="text-[11px] text-slate-400 mt-0.5">
                  ≈ {(totalTon / quantity).toFixed(2)} TON/шт.
                </div>
              ) : null}
            </div>
          </div>

          {checkoutState.error ? (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-medium text-rose-800">
              <AlertCircle className="size-4 text-rose-500 shrink-0 mt-0.5" />
              <div>{checkoutState.error}</div>
            </div>
          ) : null}

          {checkoutState.notice ? (
            <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[12px] font-medium ${
              checkoutState.noticeTone === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-amber-200 bg-amber-50 text-amber-800'
            }`}>
              <CheckCircle2 className={`size-4 shrink-0 mt-0.5 ${checkoutState.noticeTone === 'success' ? 'text-emerald-500' : 'text-amber-500'}`} />
              <div>{checkoutState.notice}</div>
            </div>
          ) : null}

          {isCreatingCheckout ? (
            <Button disabled className="w-full h-11 rounded-xl bg-slate-100 text-slate-500">
              <Loader2 className="size-4 mr-2 animate-spin" />
              Резервируем лот...
            </Button>
          ) : Number(buyLimit) <= 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] font-medium text-amber-800">
              Trial-лимит по прокси исчерпан. Сначала перейди на другой план или освободи текущий прокси.
            </div>
          ) : (
            <Button
              className="w-full h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm shadow-md shadow-indigo-500/20"
              onClick={() => {
                if (selectedItems.length > 1) {
                  createBatchCheckout(selectedItems, 'ton');
                } else if (selectedItems.length === 1) {
                  openCheckout(selectedItems[0], 'ton');
                }
              }}
            >
              Купить за {totalTon} TON
            </Button>
          )}
        </>
      )}
    </div>
  );
}
