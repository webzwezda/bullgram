import { Box, ShieldCheck, Trash2, Clock, User, Store, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { UserbotCombobox } from '@/components/bots/UserbotCombobox';

function StatusBadge({ tone, children, className = '' }) {
  const colorMap = {
    success: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    warning: 'bg-amber-100 text-amber-800 border-amber-200',
    error: 'bg-rose-100 text-rose-800 border-rose-200',
    danger: 'bg-rose-100 text-rose-800 border-rose-200',
    ok: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    default: 'bg-slate-100 text-slate-700 border-slate-200'
  };
  return (
    <span className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold tracking-wide transition-colors ${colorMap[tone] || colorMap.default} ${className}`}>
      {children}
    </span>
  );
}

export function ListedShopUserbotsSection({
  deleteShopItem,
  formatWhen,
  listedShopUserbots,
  restrictedMarker,
  selectedShopUserbot,
  setSelectedShopUserbotId,
  state
}) {
  const isDeleting = selectedShopUserbot && state.deletingShopItemId === String(state.reservedItemsByAsset[`userbot:${String(selectedShopUserbot.id)}`]?.item_id);

  return (
    <Card className="border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 mb-6 bg-white overflow-hidden rounded-2xl">
      <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
              <Store className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                Выставлены в Shop
                <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border-0 text-xs rounded-full px-2">
                  {listedShopUserbots.length}
                </Badge>
              </h2>
              <p className="text-sm text-slate-500 mt-0.5">Аккаунты, ожидающие покупателя на витрине</p>
            </div>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            {listedShopUserbots.length > 0 && (
              <UserbotCombobox
                accounts={listedShopUserbots}
                value={selectedShopUserbot ? String(selectedShopUserbot.id) : ''}
                onValueChange={(value) => setSelectedShopUserbotId(value)}
                triggerVariant="plain"
                placeholder="Выбрать аккаунт"
                className="w-full sm:w-[240px] bg-white border-slate-200 shadow-sm rounded-xl"
              />
            )}
            
            {selectedShopUserbot && state.reservedItemsByAsset[`userbot:${String(selectedShopUserbot.id)}`]?.item_id && (
              <Button
                variant="outline"
                size="icon"
                className="shrink-0 text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200 rounded-xl"
                onClick={() => deleteShopItem(state.reservedItemsByAsset[`userbot:${String(selectedShopUserbot.id)}`].item_id)}
                disabled={isDeleting}
                title="Удалить лот с витрины"
              >
                {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              </Button>
            )}
          </div>
        </div>
      </div>
      
      {!selectedShopUserbot ? (
        <div className="p-12 text-center flex flex-col items-center justify-center bg-white">
          <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4 ring-1 ring-slate-100">
            <Store className="w-8 h-8 text-slate-300" />
          </div>
          <h3 className="text-base font-semibold text-slate-900">Пустая витрина</h3>
          <p className="mt-1 text-sm text-slate-500 max-w-sm">
            {listedShopUserbots.length === 0 
              ? 'Юзерботов в shop-резерве сейчас нет. Выставьте аккаунт на продажу в блоке выше.' 
              : 'Выберите аккаунт из списка выше для просмотра лота.'}
          </p>
        </div>
      ) : (
        <div className="p-5 sm:p-6 bg-white">
          {(() => {
            const account = selectedShopUserbot;
            const item = state.reservedItemsByAsset[`userbot:${String(account.id)}`];
            const sellerItem = item?.item_id ? state.sellerItemsById[String(item.item_id)] : null;
            const activeReservation = sellerItem?.recent_purchase && sellerItem.recent_purchase.status === 'pending'
              ? sellerItem.recent_purchase
              : null;
            const restrictedBadge = restrictedMarker(account);
            const itemTypeLabel = item?.item_title || 'Лот не нашли';
            const hasProxyInBundle = (sellerItem?.assets || []).some((asset) => asset.asset_type === 'proxy');
            
            return (
              <div className="space-y-6">
                {/* Hero Profile Banner */}
                <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-gradient-to-br from-slate-50 to-indigo-50/30 border border-slate-100">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-white border border-slate-200 flex items-center justify-center shadow-sm">
                      <Store className="w-6 h-6 text-slate-700" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-lg font-bold text-slate-900 tracking-tight">
                          {account.tg_username ? `@${account.tg_username}` : 'Без username'}
                        </span>
                        <Badge variant="outline" className="bg-white text-slate-500 font-mono text-[10px] uppercase">
                          ID: {account.tg_account_id}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-1.5">
                        {restrictedBadge ? (
                          <StatusBadge tone="error">{restrictedBadge.text}</StatusBadge>
                        ) : (
                          <StatusBadge tone="success">Выставлен</StatusBadge>
                        )}
                      </div>
                      {restrictedBadge?.detail ? (
                        <div className="mt-2 text-xs font-medium text-rose-600">{restrictedBadge.detail}</div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4 shadow-sm">
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">Название лота</div>
                    <div className="text-base font-bold text-slate-900">{itemTypeLabel}</div>
                  </div>
                  
                  <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4 shadow-sm">
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Состав комплекта</div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline" className="bg-white border-slate-200 text-slate-700 py-1 px-2.5 shadow-sm">
                        <Box className="w-3.5 h-3.5 mr-1.5 text-slate-400" /> Аккаунт
                      </Badge>
                      {hasProxyInBundle && (
                        <Badge variant="outline" className="bg-white border-slate-200 text-slate-700 py-1 px-2.5 shadow-sm">
                          <ShieldCheck className="w-3.5 h-3.5 mr-1.5 text-slate-400" /> Proxy
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>

                {activeReservation ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-5 shadow-sm">
                    <div className="text-xs font-bold uppercase tracking-wider text-amber-600 mb-3 flex items-center gap-1.5">
                      <Clock className="w-4 h-4" /> Активная бронь
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="flex items-center gap-3">
                        <div className="flex w-10 h-10 items-center justify-center rounded-xl bg-amber-100 border border-amber-200/60 shadow-sm">
                          <User className="w-5 h-5 text-amber-600" />
                        </div>
                        <div>
                          <div className="text-[11px] font-bold uppercase tracking-wider text-amber-700/60">Покупатель</div>
                          <div className="text-sm font-bold text-amber-900">
                            {activeReservation.buyer_name || `Owner ID: ${String(activeReservation.buyer_owner_id || '').slice(0, 8)}`}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex w-10 h-10 items-center justify-center rounded-xl bg-amber-100 border border-amber-200/60 shadow-sm">
                          <Clock className="w-5 h-5 text-amber-600" />
                        </div>
                        <div>
                          <div className="text-[11px] font-bold uppercase tracking-wider text-amber-700/60">Истекает</div>
                          <div className="text-sm font-bold text-amber-900">
                            {activeReservation.expires_at ? formatWhen(activeReservation.expires_at) : 'Без ограничения по времени'}
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
    </Card>
  );
}
