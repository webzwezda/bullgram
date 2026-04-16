import { useEffect, useState } from 'react';

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
      <div className="mt-4 rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-[14px] bg-slate-50 px-4 py-3">
            <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-400">Сумма</div>
            <div className="mt-1 text-[15px] font-semibold text-slate-900">{userbotPurchaseAmountSummary(checkoutState.purchase)}</div>
          </div>
          {checkoutState.purchase.expires_at ? (
            <div className="rounded-[14px] bg-slate-50 px-4 py-3">
              <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-400">До</div>
              <div className="mt-1 text-[15px] font-semibold text-slate-900">{formatWhen(checkoutState.purchase.expires_at)}</div>
            </div>
          ) : null}
        </div>

        {checkoutState.purchase.payment_method === 'ton' ? (
          <div className="space-y-4">
            <div className="rounded-[14px] border border-blue-100 bg-blue-50 px-4 py-3 text-[13px] text-blue-900">
              Переведи ровно эту сумму с этим memo. Иначе платеж не сматчится.
            </div>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
              <div className="space-y-3">
                {checkoutState.purchase.seller_wallet ? (
                  <div className="rounded-[14px] bg-slate-50 px-4 py-3">
                    <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-400">Кошелек</div>
                    <div className="mt-1 break-all font-mono text-[13px] text-slate-900">{checkoutState.purchase.seller_wallet}</div>
                  </div>
                ) : null}
                {checkoutState.purchase.memo ? (
                  <div className="rounded-[14px] bg-slate-50 px-4 py-3">
                    <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-400">Memo</div>
                    <div className="mt-1 break-all font-mono text-[13px] text-slate-900">{checkoutState.purchase.memo}</div>
                  </div>
                ) : null}
              </div>
              {activeQrSrc ? (
                <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-3">
                  {hasTrustQr && hasTonQr ? (
                    <div className="mb-3 flex gap-2 rounded-[14px] bg-white p-1">
                      <button
                        type="button"
                        className={`min-w-0 flex-1 rounded-[12px] px-3 py-2 text-[12px] font-semibold transition ${
                          tonCheckoutView === 'trust' ? 'bg-slate-900 text-white' : 'text-slate-600'
                        }`}
                        onClick={() => setTonCheckoutView('trust')}
                      >
                        Trust Wallet
                      </button>
                      <button
                        type="button"
                        className={`min-w-0 flex-1 rounded-[12px] px-3 py-2 text-[12px] font-semibold transition ${
                          tonCheckoutView === 'ton' ? 'bg-slate-900 text-white' : 'text-slate-600'
                        }`}
                        onClick={() => setTonCheckoutView('ton')}
                      >
                        TON
                      </button>
                    </div>
                  ) : null}
                  <div className="mb-2 text-center text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                    {tonCheckoutView === 'ton' ? 'TON QR' : 'Trust Wallet QR'}
                  </div>
                  <div className="flex items-center justify-center">
                    <img
                      src={activeQrSrc}
                      alt={activeQrLabel}
                      className="w-full max-w-[180px]"
                    />
                  </div>
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-3">
              {hasTrustLink ? (
                <a
                  className="inline-flex h-11 items-center justify-center rounded-[14px] border border-slate-200 px-5 text-[14px] font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
                  href={checkoutState.purchase.trust_wallet_uri}
                >
                  Trust Wallet
                </a>
              ) : null}
              {hasTonLink ? (
                <a
                  className="inline-flex h-11 items-center justify-center rounded-[14px] border border-slate-200 px-5 text-[14px] font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
                  href={checkoutState.purchase.ton_uri}
                >
                  TON
                </a>
              ) : null}
              <button
                className="inline-flex h-11 items-center justify-center rounded-[14px] border border-slate-200 px-5 text-[14px] font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
                type="button"
                onClick={checkUserbotCheckout}
                disabled={checkoutState.checking}
              >
                {checkoutState.checking ? 'Проверяем...' : 'Проверить оплату'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-[14px] border border-blue-100 bg-blue-50 px-4 py-3 text-[13px] text-blue-900">
              Сначала переведи, потом кинь чек. Без чека продавец оплату не подтвердит.
            </div>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
              <div className="space-y-3">
                {checkoutState.purchase.sbp_fio ? (
                  <div className="rounded-[14px] bg-slate-50 px-4 py-3">
                    <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-400">Получатель</div>
                    <div className="mt-1 text-[15px] font-semibold text-slate-900">{checkoutState.purchase.sbp_fio}</div>
                  </div>
                ) : null}
                {checkoutState.purchase.sbp_bank ? (
                  <div className="rounded-[14px] bg-slate-50 px-4 py-3">
                    <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-400">Банки</div>
                    <div className="mt-1 text-[15px] font-semibold text-slate-900">{checkoutState.purchase.sbp_bank}</div>
                  </div>
                ) : null}
                {checkoutState.purchase.sbp_phone ? (
                  <div className="rounded-[14px] bg-slate-50 px-4 py-3">
                    <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-400">Телефон</div>
                    <div className="mt-1 font-mono text-[13px] text-slate-900">{checkoutState.purchase.sbp_phone}</div>
                  </div>
                ) : null}
              </div>
            </div>
            {checkoutState.purchase.status === 'awaiting_receipt' ? (
              <div className="rounded-[14px] border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
                Чек уже отправлен. Жди ручную проверку.
                {checkoutState.purchase.receipt_file_url ? (
                  <>
                    {' '}<a href={resolveBackendAssetUrl(checkoutState.purchase.receipt_file_url)} target="_blank" rel="noreferrer">Открыть чек</a>
                  </>
                ) : null}
              </div>
            ) : (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-[13px] font-semibold text-slate-800">Комментарий к чеку</span>
                    <input
                      className="h-11 w-full rounded-[14px] border border-slate-200 bg-white px-4 text-[14px] text-slate-950 outline-none transition focus:border-blue-300"
                      value={receiptNote}
                      onChange={(event) => setReceiptNote(event.target.value)}
                      placeholder="Например: оплатил со Сбера"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-[13px] font-semibold text-slate-800">Чек</span>
                    <input
                      className="h-11 w-full rounded-[14px] border border-slate-200 bg-white px-4 text-[14px] text-slate-950 file:mr-3 file:border-0 file:bg-transparent file:text-[13px] file:font-semibold"
                      type="file"
                      accept="image/*,.pdf"
                      onChange={(event) => setReceiptFile(event.target.files?.[0] || null)}
                    />
                    {checkoutState.purchase.receipt_file_url ? (
                      <span className="text-[12px] text-slate-500">
                        Уже отправлен: <a href={resolveBackendAssetUrl(checkoutState.purchase.receipt_file_url)} target="_blank" rel="noreferrer">открыть файл</a>
                      </span>
                    ) : null}
                  </label>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    className="inline-flex h-11 items-center justify-center rounded-[14px] bg-blue-600 px-5 text-[14px] font-semibold text-white transition hover:bg-blue-700"
                    type="button"
                    onClick={markUserbotCheckoutPaid}
                    disabled={checkoutState.checking}
                  >
                    {checkoutState.checking ? 'Отправляем...' : 'Отправить чек продавцу'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {checkoutState.notice ? (
          <div
            className={`mt-4 rounded-[14px] px-4 py-3 text-[13px] ${
              checkoutState.noticeTone === 'success'
                ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                : checkoutState.noticeTone === 'warning'
                  ? 'border border-amber-200 bg-amber-50 text-amber-800'
                  : 'border border-slate-200 bg-slate-50 text-slate-700'
            }`}
          >
            {checkoutState.notice}
          </div>
        ) : null}

        {checkoutState.error ? (
          <div className="mt-4 rounded-[14px] border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">
            {checkoutState.error}
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
      <div className="rounded-[18px] border border-blue-200 bg-blue-50/40 p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-slate-900">{purchase.item?.title || userbotLotKindLabel(purchase.item)}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <div className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1.5">
                <div className="text-[12px] font-medium text-emerald-700">Аккаунт</div>
              </div>
              <div className={`inline-flex items-center rounded-full px-3 py-1.5 ${
                hasProxyInBundle ? 'bg-emerald-50' : 'bg-slate-100'
              }`}>
                <div className={`text-[12px] font-medium ${
                  hasProxyInBundle ? 'text-emerald-700' : 'text-slate-600'
                }`}>
                  Proxy
                </div>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className={status.className}>{status.text}</span>
            <button
              className="inline-flex h-10 items-center justify-center rounded-[13px] border border-rose-200 bg-white px-4 text-[14px] font-semibold text-rose-700 transition hover:border-rose-300 hover:text-rose-800"
              type="button"
              onClick={() => cancelUserbotCheckout(purchase)}
              disabled={checkoutState.checking && isActiveCheckout}
            >
              {checkoutState.checking && isActiveCheckout ? 'Отменяем...' : 'Отменить покупку'}
            </button>
          </div>
        </div>
        <div className="mt-4 rounded-[14px] bg-white px-4 py-3">
          <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-400">Выбор оплаты</div>
          {canSwitchPaymentMethod ? (
            <div className="mt-3 grid grid-cols-2 gap-3 rounded-[20px] bg-slate-100 p-2">
              {purchasePaymentMethods.map((method) => {
                const currentMethod = isActiveCheckout
                  ? (checkoutState.purchase?.payment_method || purchase.payload?.payment_method || purchase.payment_method || 'ton')
                  : (purchase.payload?.payment_method || purchase.payment_method || 'ton');
                const active = currentMethod === method;
                return (
                  <button
                    key={method}
                    type="button"
                    className={`flex items-center justify-center gap-2 rounded-[18px] px-5 py-4 text-[14px] font-semibold transition ${
                      active
                        ? 'bg-white text-slate-950 shadow-[0_8px_24px_rgba(15,23,42,0.10)]'
                        : 'bg-transparent text-slate-500'
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
                    <span>{paymentMethodLabel(method)}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="mt-1 text-[15px] font-semibold text-slate-900">{paymentMethodLabel(purchase.payload?.payment_method || purchase.payment_method || 'ton')}</div>
          )}
        </div>
        {isActiveCheckout ? renderInlineCheckoutPanel(purchase) : null}
      </div>
    );
  }

  return (
    <div className="userbots-market-shell">
      {openUserbotPurchases.length > 0 ? (
        <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
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
            <div className="rounded-[20px] border border-slate-200 bg-white px-5 py-6 shadow-sm">
              <div className="text-[14px] text-slate-500">Подтягиваем лоты из Shop...</div>
            </div>
          ) : (
            [
              {
                slotKey: 'userbot',
                item: accountOnlyUserbotLot,
                items: accountOnlyUserbotLots,
                title: 'Аккаунт',
                hasProxy: false,
                emptyText: 'Свободного аккаунта без прокси сейчас нет.'
              },
              {
                slotKey: 'bundle',
                item: bundledUserbotLot,
                items: bundledUserbotLots,
                title: 'Аккаунт + прокси',
                hasProxy: true,
                emptyText: 'Свободного аккаунта с прокси сейчас нет.'
              }
            ].map((slot) => {
              const item = slot.item;
              if (!item) {
                return (
                  <article key={slot.slotKey} className="flex h-full flex-col gap-3 rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="space-y-2">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{slot.title}</div>
                      <div className="flex flex-wrap gap-2">
                        <div className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1.5">
                          <div className="text-[12px] font-medium text-emerald-700">Аккаунт</div>
                        </div>
                        <div className={`inline-flex items-center rounded-full px-3 py-1.5 ${
                          slot.hasProxy ? 'bg-emerald-50' : 'bg-slate-100'
                        }`}>
                          <div className={`text-[12px] font-medium ${
                            slot.hasProxy ? 'text-emerald-700' : 'text-slate-600'
                          }`}>
                            Proxy
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-[20px] font-black leading-none tracking-[-0.04em] text-slate-900">Нет в наличии</div>
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
              return (
                <article key={item.id} className="flex h-full flex-col gap-3 rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-2">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{slot.title}</div>
                      <div className="line-clamp-2 text-[17px] font-semibold leading-6 tracking-[-0.02em] text-slate-900">{item.title}</div>
                    </div>
                    <div className="shrink-0 flex flex-wrap justify-end gap-2">
                      <div className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1.5">
                        <div className="text-[12px] font-medium text-emerald-700">Аккаунт</div>
                      </div>
                      <div className={`inline-flex items-center rounded-full px-3 py-1.5 ${
                        hasProxy ? 'bg-emerald-50' : 'bg-slate-100'
                      }`}>
                        <div className={`text-[12px] font-medium ${
                          hasProxy ? 'text-emerald-700' : 'text-slate-600'
                        }`}>
                          Proxy
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[22px] font-black leading-none tracking-[-0.04em] text-slate-900">{userbotItemPriceSummary(item)}</div>
                    <div className="text-[12px] leading-5 text-slate-500">
                      {slot.hasProxy ? 'С прокси. Можно запускать без пересадки.' : 'Без прокси. Подключишь свой позже.'}
                    </div>
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="flex h-9 w-9 items-center justify-center rounded-[11px] border border-slate-200 bg-white text-[18px] font-semibold text-slate-700 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
                          onClick={() => setUserbotBuyQuantity((prev) => ({
                            ...prev,
                            [slot.slotKey]: Math.max(Number(prev[slot.slotKey] || 1) - 1, 1)
                          }))}
                          disabled={quantity <= 1}
                          aria-label="Уменьшить количество"
                        >
                          -
                        </button>
                        <div className="flex h-9 min-w-[68px] items-center justify-center rounded-[11px] border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-900">
                          {quantity} шт.
                        </div>
                        <button
                          type="button"
                          className="flex h-9 w-9 items-center justify-center rounded-[11px] border border-slate-200 bg-white text-[18px] font-semibold text-slate-700 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
                          onClick={() => setUserbotBuyQuantity((prev) => ({
                            ...prev,
                            [slot.slotKey]: Math.min(Number(prev[slot.slotKey] || 1) + 1, Math.max(slot.items.length, 1))
                          }))}
                          disabled={quantity >= Math.max(slot.items.length, 1)}
                          aria-label="Увеличить количество"
                        >
                          +
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 sm:justify-end">
                      {['ton', 'p2p'].map((method) => {
                        const enabled = methods.includes(method);
                        const loading = checkoutState.loading && checkoutState.item?.id === item.id;
                        return (
                          <button
                            key={`${item.id}:${method}`}
                            className={`inline-flex h-9 min-w-[82px] items-center justify-center rounded-[11px] px-4 text-[13px] font-semibold transition ${
                              enabled
                                ? method === 'ton'
                                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                                  : 'border border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50'
                                : 'border border-slate-200 bg-slate-100 text-slate-400 opacity-60 cursor-not-allowed'
                            }`}
                            type="button"
                            onClick={() => {
                              if (!enabled) return;
                              createUserbotBatchCheckout(selectedItems, method);
                            }}
                            disabled={!enabled || loading}
                            title={!enabled ? 'Для выбранного количества этот способ недоступен' : undefined}
                          >
                            {loading && checkoutState.paymentMethod === method
                              ? 'Открываем...'
                              : paymentMethodLabel(method)}
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
