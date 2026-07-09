import { useCallback, useMemo } from 'react';
import {
  AlertCircle,
  Box,
  CheckCircle2,
  CreditCard,
  Loader2,
  Minus,
  Plus,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Star,
  X
} from 'lucide-react';
import { useAuth } from '../../app/providers/AuthProvider.jsx';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TonConnectPayButton } from '../../features/ton-checkout/TonConnectPayButton.jsx';
import { TonWalletChip } from '../../features/ton-checkout/TonWalletChip.jsx';

const VERIFY_ENDPOINT = '/api/shop/public/purchase/verify-ton-connect';

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

export function UserbotStorefrontSection({
  openUserbotPurchases,
  setSelectedOpenPurchaseId,
  showUserbotPurchaseInline,
  storefrontState,
  bundledUserbotLot,
  bundledUserbotLots,
  userbotBuyQuantity,
  setUserbotBuyQuantity,
  checkoutState,
  setCheckoutState,
  cancelUserbotCheckout,
  createUserbotBatchCheckout,
  openUserbotCheckout,
  refreshPurchases,
  reloadAccounts
}) {
  const { accessToken } = useAuth();

  const bundleSlot = useMemo(() => ({
    slotKey: 'bundle',
    item: bundledUserbotLot,
    items: bundledUserbotLots,
    title: 'Готовый юзербот',
    emptyText: 'Свободных аккаунтов с прокси сейчас нет.',
    features: ['Чистая Telegram сессия', 'Индивидуальный IPv4 Proxy', 'Запуск без пересадки', 'Гарантия на первый вход']
  }), [bundledUserbotLot, bundledUserbotLots]);

  const quantity = Math.min(
    Math.max(Number(userbotBuyQuantity[bundleSlot.slotKey] || 1), 1),
    Math.max(bundleSlot.items.length, 1)
  );
  const selectedItems = bundleSlot.items.slice(0, quantity);
  const bundleTotalTon = selectedItems.reduce(
    (sum, item) => sum + Number(item?.price_ton || 0),
    0
  );

  const activePurchase = checkoutState.purchase;
  const isCreatingCheckout = checkoutState.loading;

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
      await Promise.all([refreshPurchases(), reloadAccounts()]);
    } catch {
      // surface не критичен — список обновится при следующем заходе
    }
  }, [refreshPurchases, reloadAccounts, setCheckoutState]);

  const handlePayError = useCallback((err) => {
    setCheckoutState((prev) => ({
      ...prev,
      error: err?.message || 'Ошибка при оплате TON Connect'
    }));
  }, [setCheckoutState]);

  const buildVerifyBody = useCallback(({ senderWallet }) => {
    if (!activePurchase) return { sender_wallet: senderWallet };
    if (activePurchase.batch && Array.isArray(activePurchase.purchase_ids)) {
      return {
        purchase_ids: activePurchase.purchase_ids,
        sender_wallet: senderWallet
      };
    }
    return {
      purchase_id: activePurchase.id,
      sender_wallet: senderWallet
    };
  }, [activePurchase]);

  return (
    <div className="mb-6">
      <Card className="border border-slate-200/70 bg-white rounded-2xl shadow-[0_8px_30px_rgb(15,23,42,0.04)] overflow-hidden">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 bg-slate-50/40 px-5 sm:px-6 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="size-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
              <ShoppingCart className="size-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-slate-900 truncate">Магазин аккаунтов</h2>
              <p className="text-[13px] text-slate-500 mt-0.5">Готовые юзерботы с прокси. Оплата через TON Connect.</p>
            </div>
          </div>
          <TonWalletChip />
        </div>

        {/* Body */}
        <div className="p-5 sm:p-6 space-y-5">
          {storefrontState.error ? (
            <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
              <AlertCircle className="size-5 text-rose-500 shrink-0 mt-0.5" />
              <div className="pt-0.5">{storefrontState.error}</div>
            </div>
          ) : null}

          {/* Pending purchases compact list */}
          {openUserbotPurchases.length > 0 ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider text-amber-700">
                  <CreditCard className="size-4" />
                  Ожидают оплаты
                  <Badge variant="secondary" className="bg-amber-100 text-amber-700 border-0 rounded-full px-2 text-[11px]">
                    {openUserbotPurchases.length}
                  </Badge>
                </div>
              </div>
              <ul className="space-y-2">
                {openUserbotPurchases.map((purchase) => {
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
                          showUserbotPurchaseInline(purchase);
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
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                        onClick={() => cancelUserbotCheckout(purchase)}
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
              <div className="text-sm font-medium text-slate-500">Загрузка предложений из Shop...</div>
            </div>
          ) : !bundleSlot.item ? (
            <div className="flex flex-col items-center justify-center py-10 text-center bg-slate-50/50 rounded-2xl border border-slate-100">
              <div className="size-14 bg-white rounded-full flex items-center justify-center shadow-sm mb-3 border border-slate-100">
                <Box className="size-7 text-slate-300" />
              </div>
              <h3 className="text-base font-bold text-slate-900 mb-1">Нет в наличии</h3>
              <p className="text-sm text-slate-500 max-w-sm">{bundleSlot.emptyText}</p>
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
              {/* Left: Product info */}
              <div className="space-y-5">
                <div className="space-y-2">
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 text-[11px] font-bold uppercase tracking-wider">
                    <Star className="size-3.5 fill-indigo-600" /> Хит продаж
                  </div>
                  <h3 className="text-2xl font-black tracking-tight text-slate-900 leading-tight">
                    {bundleSlot.item.title}
                  </h3>
                  <p className="text-[13px] text-slate-500 font-medium">Комплект для безопасной и долговечной работы</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="bg-white border-slate-200 text-slate-700 py-1.5 px-3 text-[12px]">
                    <Box className="size-4 mr-2 text-slate-400" /> Аккаунт
                  </Badge>
                  <Badge variant="outline" className="bg-white border-slate-200 text-slate-700 py-1.5 px-3 text-[12px]">
                    <ShieldCheck className="size-4 mr-2 text-slate-400" /> Proxy
                  </Badge>
                </div>

                <ul className="space-y-2 pt-1">
                  {bundleSlot.features.map((feature, i) => (
                    <li
                      key={i}
                      className="flex items-center gap-3 text-[13px] font-medium text-slate-700 bg-slate-50/50 px-3 py-2 rounded-xl border border-slate-100"
                    >
                      <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Right: Checkout card */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                    {quantity > 1 ? `Итого за ${quantity} шт.` : 'Стоимость'}
                  </div>
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-3xl font-black tracking-tight text-slate-900">
                      {activePurchase
                        ? Number(activePurchase.amount_ton || 0)
                        : bundleTotalTon}{' '}
                      <span className="text-base font-bold text-slate-500">TON</span>
                    </span>
                  </div>
                </div>

                {/* Quantity selector — disabled if purchase already created */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Количество</span>
                    <span className="text-[11px] text-slate-400">Доступно: {bundleSlot.items.length}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-200 p-1">
                    <button
                      type="button"
                      className="flex h-9 w-10 items-center justify-center rounded-lg bg-white text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                      onClick={() => setUserbotBuyQuantity((prev) => ({
                        ...prev,
                        [bundleSlot.slotKey]: Math.max(Number(prev[bundleSlot.slotKey] || 1) - 1, 1)
                      }))}
                      disabled={!!activePurchase || quantity <= 1}
                      aria-label="Уменьшить количество"
                    >
                      <Minus className="size-4" />
                    </button>
                    <div className="flex-1 text-center font-bold text-base text-slate-900">
                      {quantity} <span className="text-xs text-slate-400 font-medium ml-1">шт.</span>
                    </div>
                    <button
                      type="button"
                      className="flex h-9 w-10 items-center justify-center rounded-lg bg-white text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                      onClick={() => setUserbotBuyQuantity((prev) => ({
                        ...prev,
                        [bundleSlot.slotKey]: Math.min(Number(prev[bundleSlot.slotKey] || 1) + 1, Math.max(bundleSlot.items.length, 1))
                      }))}
                      disabled={!!activePurchase || quantity >= Math.max(bundleSlot.items.length, 1)}
                      aria-label="Увеличить количество"
                    >
                      <Plus className="size-4" />
                    </button>
                  </div>
                </div>

                {/* Pay area */}
                <div className="pt-3 border-t border-slate-200/70 space-y-3">
                  {checkoutState.error ? (
                    <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-medium text-rose-800">
                      <AlertCircle className="size-4 text-rose-500 shrink-0 mt-0.5" />
                      <div>{checkoutState.error}</div>
                    </div>
                  ) : null}

                  {activePurchase ? (
                    <div className="space-y-2">
                      <TonConnectPayButton
                        amountTon={activePurchase.amount_ton}
                        amountNano={activePurchase.amount_nanoton}
                        merchantWallet={activePurchase.seller_wallet}
                        memo={activePurchase.memo}
                        network={activePurchase.network || 'mainnet'}
                        verifyEndpoint={VERIFY_ENDPOINT}
                        buildVerifyBody={buildVerifyBody}
                        accessToken={accessToken}
                        onPaid={handlePaid}
                        onError={handlePayError}
                      />
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-500">
                          {activePurchase.expires_at
                            ? `Истекает ${new Date(activePurchase.expires_at).toLocaleString('ru-RU')}`
                            : 'Лот зарезервирован'}
                        </span>
                        <button
                          type="button"
                          className="text-[12px] font-medium text-slate-500 hover:text-rose-600 transition"
                          onClick={() => setCheckoutState({
                            item: null,
                            purchase: null,
                            paymentMethod: 'ton',
                            loading: false,
                            checking: false,
                            error: '',
                            notice: '',
                            noticeTone: 'default'
                          })}
                        >
                          Сбросить
                        </button>
                      </div>
                    </div>
                  ) : isCreatingCheckout ? (
                    <Button disabled className="w-full h-11 rounded-xl bg-slate-100 text-slate-500">
                      <Loader2 className="size-4 mr-2 animate-spin" />
                      Резервируем лот...
                    </Button>
                  ) : (
                    <Button
                      className="w-full h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm shadow-md shadow-indigo-500/20"
                      onClick={() => {
                        if (selectedItems.length > 1) {
                          createUserbotBatchCheckout(selectedItems, 'ton');
                        } else if (selectedItems.length === 1) {
                          openUserbotCheckout(selectedItems[0], 'ton');
                        }
                      }}
                    >
                      <Sparkles className="size-4 mr-2" />
                      Купить за {bundleTotalTon} TON
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
