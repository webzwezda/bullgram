export function ListedShopUserbotsSection({
  deleteShopItem,
  formatWhen,
  listedShopUserbots,
  restrictedMarker,
  selectedShopUserbot,
  setSelectedShopUserbotId,
  state
}) {
  return (
    <div className="mt-6 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center">
          <span className="text-[12px] font-medium uppercase tracking-[0.08em] text-slate-400">Выставлены в Shop</span>
          <span className="ml-2 inline-flex min-w-6 items-center justify-center rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
            {listedShopUserbots.length}
          </span>
        </div>
        {selectedShopUserbot && state.reservedItemsByAsset[`userbot:${String(selectedShopUserbot.id)}`]?.item_id ? (
          <button
            type="button"
            className="inline-flex h-10 items-center justify-center rounded-[13px] border border-rose-200 bg-rose-50 px-4 text-[14px] font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => deleteShopItem(state.reservedItemsByAsset[`userbot:${String(selectedShopUserbot.id)}`].item_id)}
            disabled={state.deletingShopItemId === String(state.reservedItemsByAsset[`userbot:${String(selectedShopUserbot.id)}`].item_id)}
          >
            {state.deletingShopItemId === String(state.reservedItemsByAsset[`userbot:${String(selectedShopUserbot.id)}`].item_id) ? 'Удаляем...' : 'Удалить лот'}
          </button>
        ) : null}
      </div>
      {listedShopUserbots.length === 0 ? (
        <div className="rounded-[18px] border border-dashed border-slate-200 bg-slate-50/60 px-5 py-6 text-[14px] text-slate-500">
          Юзерботов в shop-резерве сейчас нет.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="w-full lg:max-w-[420px]">
            <select
              className="h-12 w-full rounded-[16px] border border-slate-200 bg-white px-4 text-[15px] font-medium text-slate-900 outline-none transition focus:border-blue-500"
              value={selectedShopUserbot ? String(selectedShopUserbot.id) : ''}
              onChange={(event) => setSelectedShopUserbotId(event.target.value)}
            >
              {listedShopUserbots.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.tg_username ? `@${account.tg_username}` : `TG ID ${account.tg_account_id}`}
                </option>
              ))}
            </select>
          </div>
          {(() => {
            const account = selectedShopUserbot;
            if (!account) return null;
            const item = state.reservedItemsByAsset[`userbot:${String(account.id)}`];
            const sellerItem = item?.item_id ? state.sellerItemsById[String(item.item_id)] : null;
            const activeReservation = sellerItem?.recent_purchase && sellerItem.recent_purchase.status === 'pending'
              ? sellerItem.recent_purchase
              : null;
            const restrictedBadge = restrictedMarker(account);
            const itemTypeLabel = item?.item_title || 'Лот не нашли';
            const hasProxyInBundle = /прокси/i.test(itemTypeLabel) || false;
            return (
              <div className="rounded-[20px] border border-slate-200 bg-slate-50/70 p-4">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-[16px] font-semibold tracking-[-0.02em] text-slate-900">
                          @{account.tg_username || 'без username'}
                        </div>
                        {restrictedBadge ? <span className={restrictedBadge.className}>{restrictedBadge.text}</span> : null}
                      </div>
                      <div className="mt-1 text-[13px] text-slate-500">TG ID {account.tg_account_id}</div>
                      {restrictedBadge?.detail ? (
                        <div className="mt-2 text-[13px] leading-5 text-rose-600">{restrictedBadge.detail}</div>
                      ) : null}
                    </div>
                    <a
                      className="inline-flex h-10 items-center justify-center rounded-[13px] border border-slate-200 bg-white px-4 text-[14px] font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                      href="/app/shop"
                    >
                      Shop
                    </a>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(220px,0.9fr)]">
                    <div className="rounded-[16px] bg-white px-4 py-3">
                      <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-400">Лот</div>
                      <div className="mt-2 text-[15px] font-semibold leading-6 text-slate-900">{itemTypeLabel}</div>
                    </div>
                    <div className="rounded-[16px] bg-white px-4 py-3">
                      <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-400">Состав</div>
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
                  </div>
                </div>

                {activeReservation ? (
                  <div className="mt-4 rounded-[16px] border border-amber-200 bg-amber-50 px-4 py-3">
                    <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-amber-700">Бронь</div>
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      <div>
                        <div className="text-[12px] text-amber-700/80">Покупатель</div>
                        <div className="mt-1 text-[14px] font-semibold text-amber-900">
                          {activeReservation.buyer_name || `owner ${String(activeReservation.buyer_owner_id || '').slice(0, 8)}`}
                        </div>
                      </div>
                      <div>
                        <div className="text-[12px] text-amber-700/80">Истекает</div>
                        <div className="mt-1 text-[14px] font-semibold text-amber-900">
                          {activeReservation.expires_at ? formatWhen(activeReservation.expires_at) : 'Без срока'}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
