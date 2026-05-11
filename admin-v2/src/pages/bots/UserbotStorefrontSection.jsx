import { useEffect, useState } from 'react';
import { CheckCircle2, ShieldCheck, Wallet, CreditCard, Box, Star, AlertCircle, Copy, Check, FileText, ShoppingCart, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';

function preferredTonCheckoutView(purchase) {
  if (purchase?.trust_wallet_qr || purchase?.trust_wallet_uri) return 'trust';
  if (purchase?.ton_qr || purchase?.ton_uri) return 'ton';
  return 'trust';
}

export function UserbotStorefrontSection({
  openUserbotPurchases,
  selectedOpenPurchase,
  selectedOpenPurchaseId,
  setSelectedOpenPurchaseId,
  showUserbotPurchaseInline,
  storefrontState,
  accountOnlyUserbotLot, // Kept for backwards compatibility if passed, but not rendered
  accountOnlyUserbotLots,
  bundledUserbotLot,
  bundledUserbotLots,
  userbotBuyQuantity,
  setUserbotBuyQuantity,
  checkoutState,
  setCheckoutState,
  receiptNote,
  setReceiptNote,
  setReceiptFile,
  checkUserbotCheckout,
  cancelUserbotCheckout,
  markUserbotCheckoutPaid,
  createUserbotBatchCheckout,
  openUserbotCheckout,
  formatWhen,
  resolveBackendAssetUrl,
  userbotPurchaseAmountSummary,
  paymentMethodLabel,
  purchaseStatusMeta,
  userbotLotKindLabel,
  userbotLotPaymentMethods,
  batchUserbotLotPaymentMethods,
  userbotItemPriceSummary
}) {
  const [tonCheckoutView, setTonCheckoutView] = useState('trust');

  useEffect(() => {
    setTonCheckoutView(preferredTonCheckoutView(checkoutState.purchase));
  }, [
    checkoutState.purchase?.id,
    checkoutState.purchase?.trust_wallet_qr,
    checkoutState.purchase?.trust_wallet_uri,
    checkoutState.purchase?.ton_qr,
    checkoutState.purchase?.ton_uri
  ]);

  function renderInlineCheckoutPanel(activePurchase = checkoutState.purchase) {
    if (!activePurchase || !checkoutState.purchase) return null;

    const hasTrustQr = !!checkoutState.purchase.trust_wallet_qr;
    const hasTonQr = !!checkoutState.purchase.ton_qr;
    const hasTrustLink = !!checkoutState.purchase.trust_wallet_uri;
    const hasTonLink = !!checkoutState.purchase.ton_uri;
    const activeQrSrc = tonCheckoutView === 'ton'
      ? (checkoutState.purchase.ton_qr || checkoutState.purchase.trust_wallet_qr)
      : (checkoutState.purchase.trust_wallet_qr || checkoutState.purchase.ton_qr);
    const activeQrLabel = tonCheckoutView === 'ton' ? 'QR для TON-кошелька' : 'QR для Trust Wallet';

    return (
      <div className="mt-5 rounded-2xl bg-slate-50/50 p-5 border border-slate-100 shadow-inner">
        <div className="mb-6 flex flex-wrap gap-6 items-start justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Сумма к оплате</div>
            <div className="text-3xl font-black tracking-tight text-slate-900">
              {userbotPurchaseAmountSummary(checkoutState.purchase)}
            </div>
          </div>
          {checkoutState.purchase.expires_at ? (
            <div className="text-right">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Оплатить до</div>
              <div className="text-sm font-bold text-slate-700 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
                {formatWhen(checkoutState.purchase.expires_at)}
              </div>
            </div>
          ) : null}
        </div>

        {checkoutState.purchase.payment_method === 'ton' ? (
          <div className="space-y-6">
            <div className="flex items-start gap-3 rounded-xl bg-blue-50/80 px-4 py-3 border border-blue-100/50 shadow-sm">
              <AlertCircle className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
              <p className="text-sm font-medium leading-relaxed text-blue-800">
                Переведите ровно эту сумму с указанным memo. Иначе платеж не будет зачислен автоматически.
              </p>
            </div>
            
            <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_200px]">
              <div className="space-y-5">
                {checkoutState.purchase.seller_wallet ? (
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Кошелек получателя</div>
                    <div className="flex items-center gap-3 rounded-xl bg-white px-4 py-3 border border-slate-200 shadow-sm">
                      <div className="break-all font-mono text-sm font-medium text-slate-800">{checkoutState.purchase.seller_wallet}</div>
                    </div>
                  </div>
                ) : null}
                {checkoutState.purchase.memo ? (
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Memo (Обязательно)</div>
                    <div className="flex items-center gap-3 rounded-xl bg-indigo-50/50 px-4 py-3 border-2 border-indigo-200 shadow-sm ring-4 ring-indigo-500/10">
                      <div className="break-all font-mono text-sm font-bold text-indigo-700">{checkoutState.purchase.memo}</div>
                    </div>
                  </div>
                ) : null}
              </div>
              
              {activeQrSrc ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col items-center">
                  {hasTrustQr && hasTonQr ? (
                    <div className="mb-4 flex w-full gap-1 rounded-xl bg-slate-100 p-1">
                      <button
                        type="button"
                        className={`min-w-0 flex-1 rounded-lg py-1.5 text-xs font-bold transition-all ${
                          tonCheckoutView === 'trust' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                        }`}
                        onClick={() => setTonCheckoutView('trust')}
                      >
                        Trust
                      </button>
                      <button
                        type="button"
                        className={`min-w-0 flex-1 rounded-lg py-1.5 text-xs font-bold transition-all ${
                          tonCheckoutView === 'ton' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                        }`}
                        onClick={() => setTonCheckoutView('ton')}
                      >
                        TON
                      </button>
                    </div>
                  ) : null}
                  <div className="mb-3 text-center text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {tonCheckoutView === 'ton' ? 'Scan to pay' : 'Trust Wallet'}
                  </div>
                  <img
                    src={activeQrSrc}
                    alt={activeQrLabel}
                    className="w-36 h-36 rounded-xl border border-slate-100 shadow-sm"
                  />
                </div>
              ) : null}
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-3 pt-4 border-t border-slate-200/60">
              <div className="flex w-full sm:w-auto gap-2">
                {hasTrustLink ? (
                  <a
                    className="flex-1 sm:flex-none inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-white border border-slate-200 px-4 text-sm font-bold text-slate-700 shadow-sm transition hover:border-indigo-300 hover:bg-slate-50"
                    href={checkoutState.purchase.trust_wallet_uri}
                  >
                    <Wallet className="w-4 h-4 text-slate-400" />
                    Trust Wallet
                  </a>
                ) : null}
                {hasTonLink ? (
                  <a
                    className="flex-1 sm:flex-none inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-white border border-slate-200 px-4 text-sm font-bold text-slate-700 shadow-sm transition hover:border-indigo-300 hover:bg-slate-50"
                    href={checkoutState.purchase.ton_uri}
                  >
                    <Wallet className="w-4 h-4 text-slate-400" />
                    TON Wallet
                  </a>
                ) : null}
              </div>
              <Button
                className="w-full sm:w-auto sm:ml-auto h-11 rounded-xl bg-[#0088CC] hover:bg-[#0077B5] text-white font-bold shadow-md shadow-blue-500/20 px-6"
                onClick={checkUserbotCheckout}
                disabled={checkoutState.checking}
              >
                {checkoutState.checking ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Проверяем...</>
                ) : (
                  <><CheckCircle2 className="w-4 h-4 mr-2" /> Проверить оплату</>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-start gap-3 rounded-xl bg-amber-50 px-4 py-3 border border-amber-200/60 shadow-sm">
              <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-sm font-medium leading-relaxed text-amber-800">
                Переведите средства по реквизитам ниже, затем прикрепите скриншот чека. Администратор проверит оплату вручную.
              </p>
            </div>
            
            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-4 p-5 rounded-2xl border border-slate-200 bg-white shadow-sm">
                {checkoutState.purchase.sbp_fio ? (
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Получатель</div>
                    <div className="text-base font-bold text-slate-900">{checkoutState.purchase.sbp_fio}</div>
                  </div>
                ) : null}
                {checkoutState.purchase.sbp_bank ? (
                  <div className="pt-3 border-t border-slate-100">
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Банк</div>
                    <div className="text-base font-bold text-slate-900">{checkoutState.purchase.sbp_bank}</div>
                  </div>
                ) : null}
                {checkoutState.purchase.sbp_phone ? (
                  <div className="pt-3 border-t border-slate-100">
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Телефон</div>
                    <div className="font-mono text-lg font-black tracking-tight text-indigo-600">{checkoutState.purchase.sbp_phone}</div>
                  </div>
                ) : null}
              </div>
              
              <div className="flex flex-col justify-end">
                {checkoutState.purchase.status === 'awaiting_receipt' ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 h-full flex flex-col items-center justify-center text-center gap-3 shadow-sm">
                    <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center">
                      <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                    </div>
                    <div>
                      <div className="text-base font-bold text-emerald-900">Чек успешно отправлен</div>
                      <div className="text-sm font-medium text-emerald-700 mt-1">Ожидайте подтверждения от продавца</div>
                    </div>
                    {checkoutState.purchase.receipt_file_url ? (
                      <a 
                        className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-emerald-600 hover:text-emerald-800 transition bg-white px-3 py-1.5 rounded-lg shadow-sm border border-emerald-100"
                        href={resolveBackendAssetUrl(checkoutState.purchase.receipt_file_url)} 
                        target="_blank" 
                        rel="noreferrer"
                      >
                        <FileText className="w-3.5 h-3.5" /> Посмотреть чек
                      </a>
                    ) : null}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <span className="text-sm font-semibold text-slate-700">Скриншот чека</span>
                      <label className="flex flex-col items-center justify-center h-24 w-full rounded-xl border-2 border-dashed border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/30 transition cursor-pointer relative overflow-hidden group shadow-sm">
                        <div className="flex flex-col items-center gap-2 text-slate-400 group-hover:text-indigo-600 transition">
                          <FileText className="w-6 h-6" />
                          <span className="text-sm font-bold">Выбрать файл</span>
                        </div>
                        <input
                          className="absolute inset-0 opacity-0 cursor-pointer"
                          type="file"
                          accept="image/*,.pdf"
                          onChange={(event) => setReceiptFile(event.target.files?.[0] || null)}
                        />
                      </label>
                    </div>
                    <div className="space-y-2">
                      <span className="text-sm font-semibold text-slate-700">Комментарий (опционально)</span>
                      <Input
                        className="h-11 rounded-xl bg-white border-slate-200 text-sm shadow-sm"
                        value={receiptNote}
                        onChange={(event) => setReceiptNote(event.target.value)}
                        placeholder="Например: Сбербанк, последние 4 цифры 1234"
                      />
                    </div>
                    <Button
                      className="w-full h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-md shadow-indigo-500/20"
                      onClick={markUserbotCheckoutPaid}
                      disabled={checkoutState.checking}
                    >
                      {checkoutState.checking ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Отправка...</> : (
                        <><Check className="w-4 h-4 mr-2" /> Отправить чек на проверку</>
                      )}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {checkoutState.notice ? (
          <div
            className={`mt-6 flex items-start gap-3 rounded-xl px-4 py-3 text-sm font-medium shadow-sm ${
              checkoutState.noticeTone === 'success'
                ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                : checkoutState.noticeTone === 'warning'
                  ? 'border border-amber-200 bg-amber-50 text-amber-800'
                  : 'border border-slate-200 bg-white text-slate-700'
            }`}
          >
            {checkoutState.noticeTone === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />}
            {checkoutState.noticeTone === 'warning' && <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />}
            {(!checkoutState.noticeTone || checkoutState.noticeTone === 'info') && <AlertCircle className="w-5 h-5 text-slate-400 shrink-0" />}
            <div className="pt-0.5">{checkoutState.notice}</div>
          </div>
        ) : null}

        {checkoutState.error ? (
          <div className="mt-6 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800 shadow-sm">
            <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />
            <div className="pt-0.5">{checkoutState.error}</div>
          </div>
        ) : null}
      </div>
    );
  }

  function renderOpenPurchaseSummary(purchase) {
    if (!purchase) return null;
    const status = purchaseStatusMeta(purchase.status);
    const isActiveCheckout = String(checkoutState.purchase?.id || '') === String(purchase.id);
    const hasProxyInBundle = purchase.item?.item_type === 'bundle' || (Array.isArray(purchase.assets) && purchase.assets.some((asset) => asset.asset_type === 'proxy'));
    const purchaseItem = purchase.item || null;
    const purchasePaymentMethods = userbotLotPaymentMethods(purchaseItem);
    const canSwitchPaymentMethod = purchase.status === 'pending' && purchasePaymentMethods.length > 1;
    
    return (
      <div className="rounded-2xl bg-white p-5 sm:p-6 border border-slate-200 shadow-sm mt-4 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-1.5 h-full bg-indigo-500"></div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="text-lg font-bold text-slate-900">{purchase.item?.title || userbotLotKindLabel(purchase.item)}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge variant="secondary" className="bg-slate-100 text-slate-700 hover:bg-slate-200 border-0 flex gap-1.5 items-center px-3 py-1 text-xs">
                <Box className="w-3.5 h-3.5 text-slate-500" /> Аккаунт
              </Badge>
              {hasProxyInBundle && (
                <Badge variant="secondary" className="bg-slate-100 text-slate-700 hover:bg-slate-200 border-0 flex gap-1.5 items-center px-3 py-1 text-xs">
                  <ShieldCheck className="w-3.5 h-3.5 text-slate-500" /> Индивидуальный Proxy
                </Badge>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className={status.className}>{status.text}</span>
            <Button
              variant="outline"
              className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200 rounded-xl"
              onClick={() => cancelUserbotCheckout(purchase)}
              disabled={checkoutState.checking && isActiveCheckout}
            >
              {checkoutState.checking && isActiveCheckout ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              {checkoutState.checking && isActiveCheckout ? 'Отмена...' : 'Отменить заказ'}
            </Button>
          </div>
        </div>
        
        <div className="mt-6 pt-5 border-t border-slate-100">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Способ оплаты</div>
          {canSwitchPaymentMethod ? (
            <div className="flex flex-wrap gap-3">
              {purchasePaymentMethods.map((method) => {
                const currentMethod = isActiveCheckout
                  ? (checkoutState.purchase?.payment_method || purchase.payload?.payment_method || purchase.payment_method || 'ton')
                  : (purchase.payload?.payment_method || purchase.payment_method || 'ton');
                const active = currentMethod === method;
                return (
                  <button
                    key={method}
                    type="button"
                    className={`flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition-all duration-200 ${
                      active
                        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20'
                        : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 hover:border-slate-300'
                    }`}
                    onClick={() => {
                      if (checkoutState.loading || checkoutState.checking) return;
                      if (active) {
                        if (!isActiveCheckout) {
                          showUserbotPurchaseInline(purchase);
                        }
                        return;
                      }
                      openUserbotCheckout(purchaseItem, method);
                    }}
                    disabled={checkoutState.loading || checkoutState.checking}
                  >
                    {method === 'ton' ? <Wallet className="w-4 h-4" /> : <CreditCard className="w-4 h-4" />}
                    <span>{paymentMethodLabel(method)}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm">
              {purchase.payload?.payment_method === 'ton' || purchase.payment_method === 'ton' ? <Wallet className="w-4 h-4" /> : <CreditCard className="w-4 h-4" />}
              <span>{paymentMethodLabel(purchase.payload?.payment_method || purchase.payment_method || 'ton')}</span>
            </div>
          )}
        </div>
        {isActiveCheckout ? renderInlineCheckoutPanel(purchase) : null}
      </div>
    );
  }

  // Define the single product slot we are selling now
  const bundleSlot = {
    slotKey: 'bundle',
    item: bundledUserbotLot,
    items: bundledUserbotLots,
    title: 'Готовый юзербот',
    emptyText: 'Свободных аккаунтов с прокси сейчас нет.',
    features: ['Чистая Telegram сессия', 'Индивидуальный IPv4 Proxy', 'Запуск без пересадки', 'Гарантия на первый вход']
  };

  return (
    <div className="mb-6 space-y-6">
      {openUserbotPurchases.length > 0 ? (
        <Card className="border-0 shadow-lg shadow-amber-500/10 ring-1 ring-amber-200/50 bg-white overflow-hidden rounded-2xl">
          <div className="bg-amber-50/50 border-b border-amber-100/50 p-5 sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-amber-500 flex items-center justify-center text-white shadow-md shadow-amber-500/20 shrink-0">
                  <CreditCard className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                    Ожидают оплаты
                    <Badge variant="secondary" className="bg-amber-100 text-amber-700 border-0 text-xs rounded-full px-2">
                      {openUserbotPurchases.length}
                    </Badge>
                  </h2>
                  <p className="text-sm text-slate-500 mt-0.5">Незавершенные заказы, требующие действия</p>
                </div>
              </div>
            </div>
          </div>
          <div className="p-5 sm:p-6 bg-slate-50/30">
            <Select
              value={selectedOpenPurchase ? String(selectedOpenPurchase.id) : ''}
              onValueChange={(value) => {
                const nextId = value;
                setSelectedOpenPurchaseId(nextId);
                const nextPurchase = openUserbotPurchases.find((purchase) => String(purchase.id) === String(nextId));
                if (nextPurchase) {
                  showUserbotPurchaseInline(nextPurchase);
                }
              }}
            >
              <SelectTrigger className="w-full data-[size=default]:h-12 bg-white border-slate-200 rounded-xl text-sm font-medium shadow-sm max-w-2xl">
                <SelectValue placeholder="Выберите заказ" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                {openUserbotPurchases.map((purchase) => (
                  <SelectItem key={purchase.id} value={purchase.id} className="rounded-lg py-2.5">
                    {purchase.item?.title || userbotLotKindLabel(purchase.item)} — {purchaseStatusMeta(purchase.status).text}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedOpenPurchase ? renderOpenPurchaseSummary(selectedOpenPurchase) : null}
          </div>
        </Card>
      ) : null}

      <Card className="border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
        <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
              <ShoppingCart className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">Магазин аккаунтов</h2>
              <p className="text-sm text-slate-500 mt-0.5">Покупка готовых юзерботов (Аккаунт + Прокси) в ваш контур</p>
            </div>
          </div>
        </div>

        <div className="p-5 sm:p-6">
          {storefrontState.error ? (
            <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800 shadow-sm mb-4">
              <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />
              <div>{storefrontState.error}</div>
            </div>
          ) : null}

          {storefrontState.loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
              <div className="text-sm font-medium text-slate-500">Загрузка предложений из Shop...</div>
            </div>
          ) : !bundleSlot.item ? (
            <div className="flex flex-col items-center justify-center py-12 text-center bg-slate-50/50 rounded-2xl border border-slate-100">
              <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm mb-4 border border-slate-100">
                <Box className="w-8 h-8 text-slate-300" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-1">Нет в наличии</h3>
              <p className="text-sm text-slate-500 max-w-sm">{bundleSlot.emptyText}</p>
            </div>
          ) : (
            (() => {
              const item = bundleSlot.item;
              const quantity = Math.min(
                Math.max(Number(userbotBuyQuantity[bundleSlot.slotKey] || 1), 1),
                Math.max(bundleSlot.items.length, 1)
              );
              const selectedItems = bundleSlot.items.slice(0, quantity);
              const methods = batchUserbotLotPaymentMethods(selectedItems);
              const priceSummary = userbotItemPriceSummary(item);
              const [tonPart, rubPart] = priceSummary.split(' / ');

              return (
                <div className="flex flex-col lg:flex-row gap-8">
                  {/* Left: Product Info */}
                  <div className="flex-1 space-y-6">
                    <div className="space-y-2">
                      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-bold uppercase tracking-wider mb-2">
                        <Star className="w-3.5 h-3.5 fill-indigo-600" /> Хит продаж
                      </div>
                      <h3 className="text-3xl font-black tracking-tight text-slate-900 leading-tight">
                        {item.title}
                      </h3>
                      <p className="text-slate-500 font-medium">Комплект для безопасной и долговечной работы</p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline" className="bg-white border-slate-200 text-slate-700 py-1.5 px-3">
                        <Box className="w-4 h-4 mr-2 text-slate-400" /> Аккаунт
                      </Badge>
                      <Badge variant="outline" className="bg-white border-slate-200 text-slate-700 py-1.5 px-3">
                        <ShieldCheck className="w-4 h-4 mr-2 text-slate-400" /> Proxy
                      </Badge>
                    </div>

                    <ul className="space-y-3 pt-2">
                      {bundleSlot.features.map((feature, i) => (
                        <li key={i} className="flex items-center gap-3 text-sm font-medium text-slate-700 bg-slate-50/50 p-2.5 rounded-xl border border-slate-100">
                          <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-500" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Right: Checkout Card */}
                  <div className="w-full lg:w-[380px] shrink-0">
                    <div className="rounded-2xl border border-indigo-100 bg-gradient-to-b from-white to-indigo-50/30 p-6 shadow-xl shadow-indigo-500/5 sticky top-6">
                      <div className="space-y-1 mb-6">
                        <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Стоимость за 1 шт.</div>
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="text-3xl font-black leading-none tracking-tight text-slate-900">{tonPart || priceSummary}</span>
                        </div>
                        {rubPart && (
                          <div className="text-sm font-medium text-slate-500 mt-1">≈ {rubPart}</div>
                        )}
                      </div>

                      <div className="space-y-4">
                        <div>
                          <label className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 block">Количество</label>
                          <div className="flex items-center justify-between rounded-xl bg-white border border-slate-200 p-1 shadow-sm">
                            <button
                              type="button"
                              className="flex h-10 w-12 items-center justify-center rounded-lg bg-slate-50 text-lg font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
                              onClick={() => setUserbotBuyQuantity((prev) => ({
                                ...prev,
                                [bundleSlot.slotKey]: Math.max(Number(prev[bundleSlot.slotKey] || 1) - 1, 1)
                              }))}
                              disabled={quantity <= 1}
                            >
                              -
                            </button>
                            <div className="flex-1 text-center font-bold text-lg text-slate-900">
                              {quantity} <span className="text-sm text-slate-400 font-medium ml-1">шт.</span>
                            </div>
                            <button
                              type="button"
                              className="flex h-10 w-12 items-center justify-center rounded-lg bg-slate-50 text-lg font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
                              onClick={() => setUserbotBuyQuantity((prev) => ({
                                ...prev,
                                [bundleSlot.slotKey]: Math.min(Number(prev[bundleSlot.slotKey] || 1) + 1, Math.max(bundleSlot.items.length, 1))
                              }))}
                              disabled={quantity >= Math.max(bundleSlot.items.length, 1)}
                            >
                              +
                            </button>
                          </div>
                          <div className="text-center text-xs text-slate-400 mt-2 font-medium">
                            Доступно: {bundleSlot.items.length} шт.
                          </div>
                        </div>

                        <div className="pt-4 border-t border-slate-200/60 space-y-3">
                          {['ton', 'p2p'].map((method) => {
                            const enabled = methods.includes(method);
                            const loading = checkoutState.loading && checkoutState.item?.id === item.id;
                            const isTon = method === 'ton';
                            
                            return (
                              <Button
                                key={`${item.id}:${method}`}
                                className={`w-full h-12 rounded-xl text-sm font-bold shadow-sm transition-all duration-200 ${
                                  enabled
                                    ? isTon
                                      ? 'bg-[#0088CC] hover:bg-[#0077B5] text-white shadow-blue-500/20'
                                      : 'bg-white hover:bg-slate-50 text-slate-800 border border-slate-200 shadow-slate-200/50'
                                    : 'bg-slate-50 text-slate-400 border border-slate-200 cursor-not-allowed opacity-70'
                                }`}
                                variant={isTon ? 'default' : 'outline'}
                                onClick={() => {
                                  if (!enabled) return;
                                  createUserbotBatchCheckout(selectedItems, method);
                                }}
                                disabled={!enabled || loading}
                                title={!enabled ? 'Метод недоступен для данной комбинации' : undefined}
                              >
                                {isTon ? <Wallet className="w-4 h-4 mr-2" /> : <CreditCard className="w-4 h-4 mr-2" />}
                                {loading && checkoutState.paymentMethod === method ? 'Обработка...' : (isTon ? 'Оплатить через TON' : 'Оплатить через СБП')}
                              </Button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()
          )}
        </div>
      </Card>
    </div>
  );
}
