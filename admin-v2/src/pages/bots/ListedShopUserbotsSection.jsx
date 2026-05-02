import { Box, ShieldCheck, Link, Trash2, Clock, User } from 'lucide-react';

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
    <div className="mb-6 rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="text-[20px] font-semibold tracking-[-0.03em] text-slate-950">
            Выставлены в Shop
          </div>
          <span className="inline-flex min-w-7 items-center justify-center rounded-full bg-slate-100 px-2 py-0.5 text-[12px] font-bold text-slate-600">
            {listedShopUserbots.length}
          </span>
        </div>
        {selectedShopUserbot && state.reservedItemsByAsset[`userbot:${String(selectedShopUserbot.id)}`]?.item_id ? (
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[12px] border border-rose-200 bg-rose-50 px-3 text-[13px] font-semibold text-rose-700 transition hover:bg-rose-100 hover:text-rose-800 disabled:cursor-not-allowed disabled:opacity-50 shadow-sm"
            onClick={() => deleteShopItem(state.reservedItemsByAsset[`userbot:${String(selectedShopUserbot.id)}`].item_id)}
            disabled={state.deletingShopItemId === String(state.reservedItemsByAsset[`userbot:${String(selectedShopUserbot.id)}`].item_id)}
          >
            <Trash2 className="w-3.5 h-3.5" />
            {state.deletingShopItemId === String(state.reservedItemsByAsset[`userbot:${String(selectedShopUserbot.id)}`].item_id) ? 'Удаляем...' : 'Удалить лот'}
          </button>
        ) : null}
      </div>
      
      {listedShopUserbots.length === 0 ? (
        <div className="rounded-[16px] border border-dashed border-slate-200 bg-slate-50/60 px-5 py-8 text-center">
          <div className="text-[14px] font-medium text-slate-500">Юзерботов в shop-резерве сейчас нет.</div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="w-full">
            <select
              className="h-12 w-full rounded-[14px] border border-slate-200 bg-slate-50 px-4 text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 shadow-sm"
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
              <div className="rounded-[24px] border border-slate-200/60 bg-slate-50/50 p-5 shadow-sm">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-[20px] font-black tracking-tight text-slate-900">
                          @{account.tg_username || 'без username'}
                        </div>
                        {restrictedBadge ? <span className={restrictedBadge.className}>{restrictedBadge.text}</span> : null}
                      </div>
                      <div className="mt-1 text-[13px] font-medium text-slate-500">TG ID {account.tg_account_id}</div>
                      {restrictedBadge?.detail ? (
                        <div className="mt-2 text-[13px] leading-5 font-medium text-rose-600">{restrictedBadge.detail}</div>
                      ) : null}
                    </div>
                    <a
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[12px] border border-slate-200 bg-white px-3 text-[13px] font-bold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 shadow-sm"
                      href="/app/shop"
                    >
                      <Link className="w-3.5 h-3.5 text-slate-400" />
                      Shop
                    </a>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(220px,0.9fr)]">
                    <div className="rounded-[16px] bg-white px-4 py-3 border border-slate-100 shadow-sm">
                      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Лот</div>
                      <div className="mt-1.5 text-[14px] font-bold leading-tight text-slate-900">{itemTypeLabel}</div>
                    </div>
                    <div className="rounded-[16px] bg-white px-4 py-3 border border-slate-100 shadow-sm">
                      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Состав</div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <div className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-1 border border-slate-200/60">
                          <Box className="w-3 h-3 text-slate-400" />
                          <div className="text-[11px] font-bold text-slate-600">Аккаунт</div>
                        </div>
                        {hasProxyInBundle && (
                          <div className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-1 border border-slate-200/60">
                            <ShieldCheck className="w-3 h-3 text-slate-400" />
                            <div className="text-[11px] font-bold text-slate-600">Proxy</div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {activeReservation ? (
                  <div className="mt-4 rounded-[16px] border border-amber-200/50 bg-amber-50/50 px-4 py-3">
                    <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-amber-600 mb-2">Бронь</div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="flex items-center gap-2">
                        <div className="flex w-8 h-8 items-center justify-center rounded-full bg-amber-100/50">
                          <User className="w-4 h-4 text-amber-600" />
                        </div>
                        <div>
                          <div className="text-[11px] font-bold uppercase tracking-wider text-amber-700/60">Покупатель</div>
                          <div className="text-[13px] font-bold text-amber-900">
                            {activeReservation.buyer_name || `owner ${String(activeReservation.buyer_owner_id || '').slice(0, 8)}`}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex w-8 h-8 items-center justify-center rounded-full bg-amber-100/50">
                          <Clock className="w-4 h-4 text-amber-600" />
                        </div>
                        <div>
                          <div className="text-[11px] font-bold uppercase tracking-wider text-amber-700/60">Истекает</div>
                          <div className="text-[13px] font-bold text-amber-900">
                            {activeReservation.expires_at ? formatWhen(activeReservation.expires_at) : 'Без срока'}
                          </div>
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
