import { useEffect, useState } from 'react';
import { CheckCircle2, ShieldCheck, Wallet, CreditCard, Box, Star, AlertCircle, Copy, Check, FileText } from 'lucide-react';

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
  accountOnlyUserbotLot,
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
      <div className="mt-4 rounded-[20px] bg-slate-50/50 p-5 border border-slate-100 shadow-inner">
        <div className="mb-5 flex flex-wrap gap-4 items-start justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Сумма к оплате</div>
            <div className="mt-1 text-[24px] font-black tracking-tight text-slate-900">
              {userbotPurchaseAmountSummary(checkoutState.purchase)}
            </div>
          </div>
          {checkoutState.purchase.expires_at ? (
            <div className="text-right">
              <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Оплатить до</div>
              <div className="mt-1 text-[14px] font-bold text-slate-700">
                {formatWhen(checkoutState.purchase.expires_at)}
              </div>
            </div>
          ) : null}
        </div>

        {checkoutState.purchase.payment_method === 'ton' ? (
          <div className="space-y-5">
            <div className="flex items-start gap-3 rounded-[16px] bg-blue-50/50 px-4 py-3 border border-blue-100/50">
              <AlertCircle className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
              <p className="text-[13px] font-medium leading-relaxed text-blue-800">
                Переведи ровно эту сумму с этим memo. Иначе платеж не сматчится автоматически.
              </p>
            </div>
            
            <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_180px]">
              <div className="space-y-4">
                {checkoutState.purchase.seller_wallet ? (
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400 mb-1.5">Кошелек получателя</div>
                    <div className="flex items-center gap-3 rounded-[12px] bg-white px-3.5 py-2.5 border border-slate-200 shadow-sm">
                      <div className="break-all font-mono text-[13px] font-medium text-slate-800">{checkoutState.purchase.seller_wallet}</div>
                    </div>
                  </div>
                ) : null}
                {checkoutState.purchase.memo ? (
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400 mb-1.5">Memo (обязательно)</div>
                    <div className="flex items-center gap-3 rounded-[12px] bg-white px-3.5 py-2.5 border border-blue-200 shadow-sm ring-2 ring-blue-500/10">
                      <div className="break-all font-mono text-[13px] font-bold text-blue-600">{checkoutState.purchase.memo}</div>
                    </div>
                  </div>
                ) : null}
              </div>
              
              {activeQrSrc ? (
                <div className="rounded-[16px] border border-slate-200 bg-white p-3 shadow-sm flex flex-col items-center">
                  {hasTrustQr && hasTonQr ? (
                    <div className="mb-3 flex w-full gap-1 rounded-[10px] bg-slate-100 p-1">
                      <button
                        type="button"
                        className={`min-w-0 flex-1 rounded-[8px] py-1.5 text-[11px] font-bold transition ${
                          tonCheckoutView === 'trust' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                        }`}
                        onClick={() => setTonCheckoutView('trust')}
                      >
                        Trust
                      </button>
                      <button
                        type="button"
                        className={`min-w-0 flex-1 rounded-[8px] py-1.5 text-[11px] font-bold transition ${
                          tonCheckoutView === 'ton' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                        }`}
                        onClick={() => setTonCheckoutView('ton')}
                      >
                        TON
                      </button>
                    </div>
                  ) : null}
                  <div className="mb-2 text-center text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">
                    {tonCheckoutView === 'ton' ? 'Scan to pay' : 'Trust Wallet'}
                  </div>
                  <img
                    src={activeQrSrc}
                    alt={activeQrLabel}
                    className="w-[140px] h-[140px] rounded-lg"
                  />
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-2">
              {hasTrustLink ? (
                <a
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-[10px] bg-white border border-slate-200 px-4 text-[13px] font-bold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                  href={checkoutState.purchase.trust_wallet_uri}
                >
                  <Wallet className="w-4 h-4 text-slate-400" />
                  Trust Wallet
                </a>
              ) : null}
              {hasTonLink ? (
                <a
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-[10px] bg-white border border-slate-200 px-4 text-[13px] font-bold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                  href={checkoutState.purchase.ton_uri}
                >
                  <Wallet className="w-4 h-4 text-slate-400" />
                  TON Wallet
                </a>
              ) : null}
              <button
                className="inline-flex h-10 flex-1 min-w-[160px] sm:flex-none items-center justify-center gap-2 rounded-[10px] bg-[#0088CC] px-5 text-[13px] font-bold text-white shadow-sm transition hover:bg-[#0077B5] disabled:opacity-60"
                type="button"
                onClick={checkUserbotCheckout}
                disabled={checkoutState.checking}
              >
                {checkoutState.checking ? (
                  <span>Проверяем...</span>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Проверить оплату</span>
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex items-start gap-3 rounded-[16px] bg-amber-50/50 px-4 py-3 border border-amber-200/50">
              <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-[13px] font-medium leading-relaxed text-amber-800">
                Сначала переведи по реквизитам ниже, затем прикрепи скриншот чека. Продавец проверит оплату вручную.
              </p>
            </div>
            
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-3 p-4 rounded-[16px] border border-slate-100 bg-white shadow-sm">
                {checkoutState.purchase.sbp_fio ? (
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400 mb-0.5">Получатель</div>
                    <div className="text-[14px] font-semibold text-slate-900">{checkoutState.purchase.sbp_fio}</div>
                  </div>
                ) : null}
                {checkoutState.purchase.sbp_bank ? (
                  <div className="pt-2 border-t border-slate-100">
                    <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400 mb-0.5">Банки</div>
                    <div className="text-[14px] font-semibold text-slate-900">{checkoutState.purchase.sbp_bank}</div>
                  </div>
                ) : null}
                {checkoutState.purchase.sbp_phone ? (
                  <div className="pt-2 border-t border-slate-100">
                    <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400 mb-0.5">Телефон</div>
                    <div className="font-mono text-[15px] font-bold text-slate-900">{checkoutState.purchase.sbp_phone}</div>
                  </div>
                ) : null}
              </div>
              
              <div className="flex flex-col justify-end">
                {checkoutState.purchase.status === 'awaiting_receipt' ? (
                  <div className="rounded-[16px] border border-emerald-200 bg-emerald-50 p-4 h-full flex flex-col items-center justify-center text-center gap-2">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                    <div>
                      <div className="text-[14px] font-bold text-emerald-900">Чек отправлен</div>
                      <div className="text-[12px] font-medium text-emerald-700 mt-1">Ожидайте подтверждения от продавца</div>
                    </div>
                    {checkoutState.purchase.receipt_file_url ? (
                      <a 
                        className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-bold text-emerald-600 hover:text-emerald-800 transition"
                        href={resolveBackendAssetUrl(checkoutState.purchase.receipt_file_url)} 
                        target="_blank" 
                        rel="noreferrer"
                      >
                        <FileText className="w-3.5 h-3.5" /> Посмотреть отправленный чек
                      </a>
                    ) : null}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <span className="text-[12px] font-bold text-slate-700">Скриншот чека</span>
                      <label className="flex flex-col items-center justify-center h-[90px] w-full rounded-[14px] border-2 border-dashed border-slate-200 bg-white hover:bg-slate-50 transition cursor-pointer relative overflow-hidden group">
                        <div className="flex flex-col items-center gap-1.5 text-slate-500 group-hover:text-blue-600 transition">
                          <FileText className="w-5 h-5" />
                          <span className="text-[12px] font-bold">Выбрать файл</span>
                        </div>
                        <input
                          className="absolute inset-0 opacity-0 cursor-pointer"
                          type="file"
                          accept="image/*,.pdf"
                          onChange={(event) => setReceiptFile(event.target.files?.[0] || null)}
                        />
                      </label>
                    </div>
                    <div className="space-y-1.5">
                      <span className="text-[12px] font-bold text-slate-700">Комментарий (опционально)</span>
                      <input
                        className="h-10 w-full rounded-[10px] border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-950 placeholder:text-slate-400 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 shadow-sm"
                        value={receiptNote}
                        onChange={(event) => setReceiptNote(event.target.value)}
                        placeholder="Например: Перевел со Сбера"
                      />
                    </div>
                    <button
                      className="mt-1 w-full h-11 inline-flex items-center justify-center gap-2 rounded-[12px] bg-blue-600 text-[14px] font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
                      type="button"
                      onClick={markUserbotCheckoutPaid}
                      disabled={checkoutState.checking}
                    >
                      {checkoutState.checking ? 'Отправляем...' : (
                        <>
                          <Check className="w-4 h-4" /> Отправить чек
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {checkoutState.notice ? (
          <div
            className={`mt-5 flex items-start gap-2.5 rounded-[14px] px-4 py-3 text-[13px] font-medium leading-relaxed ${
              checkoutState.noticeTone === 'success'
                ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                : checkoutState.noticeTone === 'warning'
                  ? 'border border-amber-200 bg-amber-50 text-amber-800'
                  : 'border border-slate-200 bg-white text-slate-700 shadow-sm'
            }`}
          >
            {checkoutState.noticeTone === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />}
            {checkoutState.noticeTone === 'warning' && <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />}
            {(!checkoutState.noticeTone || checkoutState.noticeTone === 'info') && <AlertCircle className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />}
            <p>{checkoutState.notice}</p>
          </div>
        ) : null}

        {checkoutState.error ? (
          <div className="mt-5 flex items-start gap-2.5 rounded-[14px] border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] font-medium leading-relaxed text-rose-800">
            <AlertCircle className="w-4 h-4 text-rose-500 mt-0.5 shrink-0" />
            <p>{checkoutState.error}</p>
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
      <div className="rounded-[20px] bg-white p-5 border border-slate-200 shadow-sm mt-2 mb-2 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="text-[16px] font-bold text-slate-900">{purchase.item?.title || userbotLotKindLabel(purchase.item)}</div>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1 border border-slate-200/60 shadow-sm">
                <Box className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-[12px] font-bold text-slate-600">Аккаунт</span>
              </div>
              {hasProxyInBundle && (
                <div className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1 border border-slate-200/60 shadow-sm">
                  <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-[12px] font-bold text-slate-600">Proxy</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className={status.className}>{status.text}</span>
            <button
              className="inline-flex h-9 items-center justify-center rounded-[10px] border border-rose-200 bg-white px-3.5 text-[13px] font-bold text-rose-600 shadow-sm transition hover:border-rose-300 hover:text-rose-700 hover:bg-rose-50"
              type="button"
              onClick={() => cancelUserbotCheckout(purchase)}
              disabled={checkoutState.checking && isActiveCheckout}
            >
              {checkoutState.checking && isActiveCheckout ? 'Отменяем...' : 'Отменить заказ'}
            </button>
          </div>
        </div>
        
        <div className="mt-5 pt-4 border-t border-slate-100">
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400 mb-3">Способ оплаты</div>
          {canSwitchPaymentMethod ? (
            <div className="flex flex-wrap gap-2">
              {purchasePaymentMethods.map((method) => {
                const currentMethod = isActiveCheckout
                  ? (checkoutState.purchase?.payment_method || purchase.payload?.payment_method || purchase.payment_method || 'ton')
                  : (purchase.payload?.payment_method || purchase.payment_method || 'ton');
                const active = currentMethod === method;
                return (
                  <button
                    key={method}
                    type="button"
                    className={`flex items-center justify-center gap-2 rounded-[10px] px-4 py-2.5 text-[13px] font-bold transition-all ${
                      active
                        ? 'bg-slate-900 text-white shadow-sm ring-2 ring-slate-900/10'
                        : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
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
            <div className="inline-flex items-center gap-2 rounded-[10px] bg-slate-900 px-4 py-2.5 text-[13px] font-bold text-white shadow-sm">
              {purchase.payload?.payment_method === 'ton' || purchase.payment_method === 'ton' ? <Wallet className="w-4 h-4" /> : <CreditCard className="w-4 h-4" />}
              <span>{paymentMethodLabel(purchase.payload?.payment_method || purchase.payment_method || 'ton')}</span>
            </div>
          )}
        </div>
        {isActiveCheckout ? renderInlineCheckoutPanel(purchase) : null}
      </div>
    );
  }

  return (
    <div className="userbots-market-shell">
      {openUserbotPurchases.length > 0 ? (
        <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6 mb-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-[20px] font-semibold tracking-[-0.03em] text-slate-950">Нужно оплатить</div>
              <div className="mt-1 text-[14px] text-slate-500">Открытые покупки, которые еще не закрыты оплатой.</div>
            </div>
            <span className="inline-flex min-w-7 items-center justify-center rounded-full bg-slate-100 px-2.5 py-1 text-[12px] font-semibold text-slate-700">
              {openUserbotPurchases.length}
            </span>
          </div>
          <div className="space-y-3">
            <select
              className="h-11 w-full rounded-[14px] border border-slate-200 bg-white px-4 text-[15px] font-medium text-slate-900 outline-none transition focus:border-blue-300"
              value={selectedOpenPurchase ? String(selectedOpenPurchase.id) : ''}
              onChange={(event) => {
                const nextId = event.target.value;
                setSelectedOpenPurchaseId(nextId);
                const nextPurchase = openUserbotPurchases.find((purchase) => String(purchase.id) === String(nextId));
                if (nextPurchase) {
                  showUserbotPurchaseInline(nextPurchase);
                }
              }}
            >
              {openUserbotPurchases.map((purchase) => (
                <option key={purchase.id} value={purchase.id}>
                  {purchase.item?.title || userbotLotKindLabel(purchase.item)}
                </option>
              ))}
            </select>
            {selectedOpenPurchase ? renderOpenPurchaseSummary(selectedOpenPurchase) : null}
          </div>
        </div>
      ) : null}

      <div className="space-y-4">
        {storefrontState.error ? <div className="error-inline">{storefrontState.error}</div> : null}
        <div className="grid userbots-buy-grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
          {storefrontState.loading ? (
            <div className="rounded-[18px] border border-slate-200 bg-white px-5 py-6 shadow-sm flex items-center justify-center min-h-[160px]">
              <div className="text-[14px] text-slate-500 font-medium">Подтягиваем лоты из Shop...</div>
            </div>
          ) : (
            [
              {
                slotKey: 'userbot',
                item: accountOnlyUserbotLot,
                items: accountOnlyUserbotLots,
                title: 'Аккаунт',
                hasProxy: false,
                isRecommended: false,
                emptyText: 'Свободного аккаунта без прокси сейчас нет.',
                features: ['Чистый аккаунт', 'Без прокси']
              },
              {
                slotKey: 'bundle',
                item: bundledUserbotLot,
                items: bundledUserbotLots,
                title: 'Аккаунт + прокси',
                hasProxy: true,
                isRecommended: true,
                emptyText: 'Свободного аккаунта с прокси сейчас нет.',
                features: ['Чистый аккаунт', 'С прокси', 'Запуск без пересадки']
              }
            ].map((slot) => {
              const item = slot.item;
              if (!item) {
                return (
                  <article key={slot.slotKey} className="flex h-full flex-col gap-3 rounded-[18px] border border-slate-200 bg-slate-50/50 p-4 shadow-sm opacity-70">
                    <div className="space-y-2">
                      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{slot.title}</div>
                      <div className="flex flex-wrap gap-2">
                        <div className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1">
                          <Box className="w-3 h-3 text-slate-500" />
                          <span className="text-[11px] font-semibold text-slate-600">Аккаунт</span>
                        </div>
                        {slot.hasProxy && (
                          <div className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1">
                            <ShieldCheck className="w-3 h-3 text-slate-500" />
                            <span className="text-[11px] font-semibold text-slate-600">Proxy</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-[20px] font-black leading-none tracking-[-0.04em] text-slate-400">Нет в наличии</div>
                      <div className="text-[12px] leading-5 text-slate-500">{slot.emptyText}</div>
                    </div>
                  </article>
                );
              }

              const quantity = Math.min(
                Math.max(Number(userbotBuyQuantity[slot.slotKey] || 1), 1),
                Math.max(slot.items.length, 1)
              );
              const selectedItems = slot.items.slice(0, quantity);
              const methods = batchUserbotLotPaymentMethods(selectedItems);
              const assets = Array.isArray(item.assets) ? item.assets : [];
              const hasProxy = item.item_type === 'bundle' || assets.some((asset) => asset.asset_type === 'proxy');
              
              const priceSummary = userbotItemPriceSummary(item);
              const [tonPart, rubPart] = priceSummary.split(' / ');

              return (
                <article 
                  key={item.id} 
                  className={`group relative flex h-full flex-col gap-4 rounded-[18px] bg-white p-4 transition-all duration-300 hover:border-slate-300 hover:shadow-md ${
                    slot.isRecommended 
                      ? 'border border-blue-400 shadow-blue-500/5' 
                      : 'border border-slate-200 shadow-sm'
                  }`}
                >
                  {slot.isRecommended && (
                    <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-sm flex items-center gap-1">
                      <Star className="w-3 h-3 fill-white" /> Рекомендуем
                    </div>
                  )}

                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{slot.title}</div>
                      <h3 className="line-clamp-2 text-[16px] font-bold leading-tight tracking-[-0.02em] text-slate-900">{item.title}</h3>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-[24px] font-black leading-none tracking-[-0.04em] text-slate-900">{tonPart || priceSummary}</span>
                        {rubPart && (
                          <span className="text-[13px] font-semibold text-slate-400">≈ {rubPart}</span>
                        )}
                      </div>
                      <div className="text-[12px] font-medium text-slate-500">
                        За 1 шт.
                      </div>
                    </div>

                    <div className="flex items-center rounded-[8px] bg-slate-50 border border-slate-200/60 p-0.5 shrink-0">
                      <button
                        type="button"
                        className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-white text-[16px] font-medium text-slate-600 shadow-sm transition hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => setUserbotBuyQuantity((prev) => ({
                          ...prev,
                          [slot.slotKey]: Math.max(Number(prev[slot.slotKey] || 1) - 1, 1)
                        }))}
                        disabled={quantity <= 1}
                      >
                        -
                      </button>
                      <div className="min-w-[36px] text-center">
                        <span className="text-[13px] font-bold text-slate-900">{quantity}</span>
                      </div>
                      <button
                        type="button"
                        className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-white text-[16px] font-medium text-slate-600 shadow-sm transition hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => setUserbotBuyQuantity((prev) => ({
                          ...prev,
                          [slot.slotKey]: Math.min(Number(prev[slot.slotKey] || 1) + 1, Math.max(slot.items.length, 1))
                        }))}
                        disabled={quantity >= Math.max(slot.items.length, 1)}
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <ul className="space-y-1.5">
                    {slot.features.map((feature, i) => (
                      <li key={i} className="flex items-center gap-2 text-[12px] font-medium text-slate-700">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-auto pt-3 border-t border-slate-100">
                    <div className="flex gap-2">
                      {['ton', 'p2p'].map((method) => {
                        const enabled = methods.includes(method);
                        const loading = checkoutState.loading && checkoutState.item?.id === item.id;
                        const isTon = method === 'ton';
                        
                        return (
                          <button
                            key={`${item.id}:${method}`}
                            className={`flex-1 flex h-[38px] items-center justify-center gap-1.5 rounded-[10px] px-3 text-[13px] font-bold transition-all duration-200 ${
                              enabled
                                ? isTon
                                  ? 'bg-[#0088CC] text-white shadow-sm hover:bg-[#0077B5]'
                                  : 'bg-slate-100 text-slate-800 hover:bg-slate-200 border border-slate-200/60'
                                : 'bg-slate-50 text-slate-400 border border-slate-200 cursor-not-allowed opacity-70'
                            }`}
                            type="button"
                            onClick={() => {
                              if (!enabled) return;
                              createUserbotBatchCheckout(selectedItems, method);
                            }}
                            disabled={!enabled || loading}
                            title={!enabled ? 'Недоступно' : undefined}
                          >
                            {isTon ? <Wallet className="w-3.5 h-3.5" /> : <CreditCard className="w-3.5 h-3.5" />}
                            <span>{loading && checkoutState.paymentMethod === method ? '...' : (isTon ? 'Оплатить TON' : 'Оплатить СБП')}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
