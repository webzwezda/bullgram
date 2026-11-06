import { useMemo } from 'react';
import {
  AlertCircle,
  CreditCard,
  Globe,
  Loader2,
  ShoppingCart,
  X
} from 'lucide-react';
import { useAuth } from '../../app/providers/AuthProvider.jsx';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ProxyBuyPanel } from './ProxyBuyPanel.jsx';

const PROXY_SLOT_KEY = 'proxy';

function formatTon(value) {
  return Number(value || 0).toFixed(2);
}

export function isProxyShopItem(item) {
  if (!item) return false;
  return item.item_type === 'proxy';
}

export function isProxyPurchase(purchase) {
  if (!purchase) return false;
  return purchase.item?.item_type === 'proxy';
}

function isOpenProxyPurchase(purchase) {
  if (!isProxyPurchase(purchase)) return false;
  if (purchase.status === 'awaiting_receipt') return true;
  if (purchase.status === 'pending') return true;
  if (purchase.status === 'paid' && purchase.ownership_transfer_status !== 'completed') return true;
  return false;
}

function groupOpenProxyPurchases(rows = []) {
  const grouped = new Map();
  for (const purchase of rows) {
    const key = purchase.payload?.batch_token || purchase.id;
    const bucket = grouped.get(key) || [];
    bucket.push(purchase);
    grouped.set(key, bucket);
  }

  return Array.from(grouped.values()).map((bucket) => {
    const first = bucket[0];
    const amountTon = bucket.reduce((sum, purchase) => sum + Number(purchase.amount_ton || 0), 0);
    const nanoParts = bucket.map((purchase) => String(purchase.amount_nanoton || '').trim()).filter(Boolean);
    let amountNanoTon = '';
    if (nanoParts.length === bucket.length) {
      try {
        amountNanoTon = nanoParts.reduce((sum, value) => sum + BigInt(value), 0n).toString();
      } catch {
        amountNanoTon = '';
      }
    }
    const expiresAt = bucket
      .map((purchase) => purchase.expires_at ? new Date(purchase.expires_at).getTime() : null)
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => left - right)[0];

    return {
      id: first.payload?.batch_token || first.id,
      purchase_ids: bucket.map((purchase) => purchase.id),
      status: bucket.some((purchase) => purchase.status === 'awaiting_receipt')
        ? 'awaiting_receipt'
        : bucket.some((purchase) => purchase.status === 'paid')
          ? 'paid'
          : 'pending',
      amount_ton: amountTon,
      amount_nanoton: amountNanoTon,
      ownership_transfer_status: bucket.every((purchase) => purchase.ownership_transfer_status === 'completed') ? 'completed' : 'pending',
      created_at: first.created_at,
      expires_at: expiresAt ? new Date(expiresAt).toISOString() : first.expires_at,
      payload: first.payload || {},
      item: {
        ...(first.item || {}),
        title: bucket.length > 1 ? `Прокси x${bucket.length}` : (first.item?.title || 'Прокси')
      },
      assets: bucket.flatMap((purchase) => purchase.assets || []),
      batch: bucket.length > 1 || !!first.payload?.batch_token
    };
  }).filter(Boolean);
}

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

export function ProxyStorefrontSection({
  buyLimit,
  buyQuantities,
  cancelCheckout,
  checkPurchase,
  checkoutState,
  createBatchCheckout,
  openCheckout,
  refreshPurchases,
  reloadProxies,
  setBuyQuantities,
  setCheckoutState,
  setSelectedOpenPurchaseId,
  showPurchaseInline,
  storefrontState
}) {
  const { accessToken } = useAuth();

  const openPurchases = useMemo(
    () => groupOpenProxyPurchases((storefrontState.purchases || []).filter(isOpenProxyPurchase)),
    [storefrontState.purchases]
  );

  const offerItems = useMemo(() => (storefrontState.items || []).slice(0, 6), [storefrontState.items]);
  const offer = useMemo(() => {
    if (!offerItems.length) return null;
    const first = offerItems[0];
    const samePrice = offerItems.every((item) => Number(item.price_ton || 0) === Number(first.price_ton || 0));
    const tonValues = offerItems
      .map((item) => Number(item.price_ton || 0))
      .filter((value) => value > 0);
    const unitPriceText = samePrice
      ? `${formatTon(first.price_ton)} TON`
      : (tonValues.length ? `от ${formatTon(Math.min(...tonValues))} TON` : 'Нужна цена в TON');
    return { unitPriceText, samePrice };
  }, [offerItems]);

  const maxQuantity = Math.max(Math.min(offerItems.length, Math.max(Number(buyLimit) || 0, 1)), 1);
  const quantity = Math.min(Math.max(Number(buyQuantities[PROXY_SLOT_KEY] || 1), 1), maxQuantity);
  const selectedItems = offerItems.slice(0, quantity);
  const totalTon = selectedItems.reduce((sum, item) => sum + Number(item?.price_ton || 0), 0);

  const activePurchase = checkoutState.purchase;
  const isCreatingCheckout = checkoutState.loading;
  const isTestnet = (activePurchase?.network || storefrontState.network) === 'testnet';

  return (
    <div className="mb-6">
      <Card className="border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
        {/* Header */}
        <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
              <ShoppingCart className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">Магазин прокси</h2>
              <p className="text-sm text-slate-500 mt-0.5">Живые прокси для юзерботов. Оплата: TON Connect или перевод вручную.</p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 sm:p-6 space-y-4">
          {storefrontState.error ? (
            <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
              <AlertCircle className="size-5 text-rose-500 shrink-0 mt-0.5" />
              <div className="pt-0.5">{storefrontState.error}</div>
            </div>
          ) : null}

          {/* Pending purchases compact list */}
          {openPurchases.length > 0 ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider text-amber-700">
                  <CreditCard className="size-4" />
                  Ожидают оплату
                  <Badge variant="secondary" className="bg-amber-100 text-amber-700 border-0 rounded-full px-2 text-[11px]">
                    {openPurchases.length}
                  </Badge>
                </div>
              </div>
              <ul className="space-y-2">
                {openPurchases.map((purchase) => {
                  const isActive = String(activePurchase?.id || '') === String(purchase.id);
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
                          {purchase.item?.title || 'Прокси'}
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
          ) : null}

          {/* Shop / empty state */}
          {storefrontState.loading ? (
            <div className="flex flex-col items-center justify-center py-10 text-slate-400 gap-3">
              <Loader2 className="size-8 animate-spin text-indigo-500" />
              <div className="text-sm font-medium text-slate-500">Загружаем предложения из Shop...</div>
            </div>
          ) : !offerItems.length && !activePurchase ? (
            <div className="flex flex-col items-center justify-center py-10 text-center bg-slate-50/50 rounded-2xl border border-slate-100">
              <div className="size-14 bg-white rounded-full flex items-center justify-center shadow-sm mb-3 border border-slate-100">
                <Globe className="size-7 text-slate-300" />
              </div>
              <h3 className="text-base font-bold text-slate-900 mb-1">Нет в наличии</h3>
              <p className="text-sm text-slate-500 max-w-sm">Свободных прокси сейчас нет — загляни позже.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* HERO ROW */}
              {offerItems.length ? (
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-base sm:text-lg font-bold text-slate-900 leading-tight flex-1 min-w-0">
                      Прокси Bullgram
                    </h3>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-[10px] font-bold uppercase tracking-wider shrink-0">
                      <Globe className="size-3 text-indigo-600" /> Прокси
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                    <span className="font-bold text-slate-600">{offer.unitPriceText}{offer.samePrice ? ' / шт.' : ''}</span>
                    <span className="text-slate-300">•</span>
                    <span>Доступно: {offerItems.length} шт.</span>
                    {Number(buyLimit) < offerItems.length ? (
                      <>
                        <span className="text-slate-300">•</span>
                        <span className="font-bold text-amber-600">Лимит: {buyLimit} шт.</span>
                      </>
                    ) : null}
                  </div>
                </div>
              ) : (
                <h3 className="text-base sm:text-lg font-bold text-slate-900 leading-tight">
                  {activePurchase.item?.title || 'Прокси'}
                </h3>
              )}

              {/* BUY PANEL */}
              <ProxyBuyPanel
                accessToken={accessToken}
                activePurchase={activePurchase}
                buyLimit={buyLimit}
                checkPurchase={checkPurchase}
                checkoutState={checkoutState}
                createBatchCheckout={createBatchCheckout}
                isCreatingCheckout={isCreatingCheckout}
                isTestnet={isTestnet}
                maxQuantity={maxQuantity}
                offer={offer}
                openCheckout={openCheckout}
                PROXY_SLOT_KEY={PROXY_SLOT_KEY}
                quantity={quantity}
                refreshPurchases={refreshPurchases}
                reloadProxies={reloadProxies}
                selectedItems={selectedItems}
                setBuyQuantities={setBuyQuantities}
                setCheckoutState={setCheckoutState}
                totalTon={totalTon}
              />
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
