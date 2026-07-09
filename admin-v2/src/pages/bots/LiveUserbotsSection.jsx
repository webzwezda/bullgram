import { Bot, Trash2, AlertCircle, Loader2, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UserbotSaleComposer } from './UserbotSaleComposer.jsx';

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

export function LiveUserbotsSection({
  accountDeleteFeedback,
  canSellUserbotAssets,
  deleteAccount,
  liveUserbots,
  openSaleComposer,
  recoveryStatusBadge,
  resetSaleComposer,
  restrictedMarker,
  saleComposer,
  saveUserbotSaleLot,
  selectedLiveUserbot,
  setSaleComposer,
  setSelectedLiveUserbotId,
  state,
  toggleSalePaymentMethod
}) {
  const isDeleting = state.deletingAccountId;

  return (
    <Card className="border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 mb-6 bg-white overflow-hidden rounded-2xl">
      <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
              <Bot className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                Боевые аккаунты
                <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border-0 text-xs rounded-full px-2">
                  {liveUserbots.length}
                </Badge>
              </h2>
              <p className="text-sm text-slate-500 mt-0.5">Выбор аккаунта, статус и продажа. Настройка — в Центре юзербота ниже.</p>
            </div>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            {liveUserbots.length > 0 && (
              <Select
                value={selectedLiveUserbot ? String(selectedLiveUserbot.id) : ''}
                onValueChange={(value) => setSelectedLiveUserbotId(value)}
              >
                <SelectTrigger className="w-full sm:w-[240px] bg-white border-slate-200 shadow-sm rounded-xl">
                  <SelectValue placeholder="Выбрать аккаунт" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {liveUserbots.map((item) => (
                    <SelectItem key={item.id} value={String(item.id)} className="rounded-lg">
                      {item.tg_username ? `@${item.tg_username}` : `TG ID ${item.tg_account_id}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {selectedLiveUserbot && (
              <Button
                variant="outline"
                size="icon"
                className="shrink-0 text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200 rounded-xl"
                onClick={() => deleteAccount(selectedLiveUserbot)}
                disabled={isDeleting === String(selectedLiveUserbot.id)}
                title="Удалить аккаунт"
              >
                {isDeleting === String(selectedLiveUserbot.id) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              </Button>
            )}
          </div>
        </div>
      </div>

      {!selectedLiveUserbot ? (
        <div className="p-12 text-center flex flex-col items-center justify-center bg-white">
          <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4 ring-1 ring-slate-100">
            <Bot className="w-8 h-8 text-slate-300" />
          </div>
          <h3 className="text-base font-semibold text-slate-900">Нет выбранного аккаунта</h3>
          <p className="mt-1 text-sm text-slate-500 max-w-sm">
            {liveUserbots.length === 0
              ? 'Боевых юзерботов пока нет. Сначала подключи аккаунт выше.'
              : 'Выберите аккаунт из списка выше для управления.'}
          </p>
        </div>
      ) : (
        <div className="p-5 sm:p-6 bg-white space-y-6">
          {(() => {
            const account = selectedLiveUserbot;
            const restrictedBadge = restrictedMarker(account);
            const recovery = state.recoveryMap[String(account.id)];
            const recoveryBadge = recoveryStatusBadge(recovery);
            const runtimeStatus = String(account.runtime_status || '');
            const isSafeMode = runtimeStatus === 'pending_activation';

            return (
              <div className="space-y-6">
                {/* Hero Profile Banner */}
                <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-gradient-to-br from-slate-50 to-indigo-50/30 border border-slate-100">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-white border border-slate-200 flex items-center justify-center shadow-sm">
                      <Bot className="w-6 h-6 text-slate-700" />
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
                        {restrictedBadge && <StatusBadge tone="error">{restrictedBadge.text}</StatusBadge>}
                        {recoveryBadge && <StatusBadge tone={recoveryBadge.tone || 'default'}>{recoveryBadge.text}</StatusBadge>}
                        {isSafeMode && <StatusBadge tone="warning">Safe mode</StatusBadge>}
                        {!restrictedBadge && !recoveryBadge && !isSafeMode && <StatusBadge tone="success">Активен</StatusBadge>}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    className="shrink-0 bg-white hover:bg-slate-50 border border-slate-200 shadow-sm rounded-xl"
                    onClick={() => { window.location.href = `/app/userbots?userbot_id=${encodeURIComponent(account.id)}`; }}
                  >
                    Центр управления
                    <ChevronRight className="w-4 h-4 ml-1.5 text-slate-400" />
                  </Button>
                </div>

                {/* Status Alerts */}
                {isSafeMode ? (
                  <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
                    <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
                    <div>
                      <h4 className="text-sm font-semibold text-amber-900">Режим Safe Mode</h4>
                      <p className="text-sm text-amber-800 mt-0.5">
                        Аккаунт ожидает живой активации перед входом в боевой контур. Активация — в Центре юзербота ниже.
                      </p>
                    </div>
                  </div>
                ) : restrictedBadge?.detail ? (
                  <div className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 shadow-sm">
                    <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />
                    <div>
                      <h4 className="text-sm font-semibold text-rose-900">Ограничения</h4>
                      <p className="text-sm text-rose-800 mt-0.5">{restrictedBadge.detail}</p>
                    </div>
                  </div>
                ) : account.runtime_error && ['restricted', 'dead_proxy', 'expired', 'error'].includes(runtimeStatus) ? (
                  <div className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 shadow-sm">
                    <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />
                    <div>
                      <h4 className="text-sm font-semibold text-rose-900">Ошибка выполнения</h4>
                      <p className="text-sm text-rose-800 mt-0.5">{account.runtime_error}</p>
                    </div>
                  </div>
                ) : null}

                {/* Bottom Action Bar */}
                <div className="flex flex-wrap items-center gap-3 pt-4">
                  {canSellUserbotAssets && (
                    <Button
                      variant="secondary"
                      size="lg"
                      className="rounded-xl"
                      onClick={() => {
                        if (saleComposer.accountId === String(account.id)) {
                          resetSaleComposer();
                        } else {
                          openSaleComposer(account);
                        }
                      }}
                    >
                      {saleComposer.accountId === String(account.id) ? 'Скрыть продажу' : 'Продать аккаунт'}
                    </Button>
                  )}
                </div>

                {/* Feedback messages */}
                <div className="space-y-2 pt-2">
                  {accountDeleteFeedback.accountId === String(account.id) && accountDeleteFeedback.text && (
                    <div className="p-3 rounded-xl bg-rose-50 text-rose-800 border border-rose-100 text-sm font-medium animate-in slide-in-from-bottom-2">
                      {accountDeleteFeedback.text}
                    </div>
                  )}
                </div>

                {/* Sale composer */}
                {canSellUserbotAssets && saleComposer.accountId === String(account.id) && (
                  <div className="pt-4 animate-in fade-in zoom-in-95 duration-200">
                    <UserbotSaleComposer
                      account={account}
                      resetSaleComposer={resetSaleComposer}
                      saleComposer={saleComposer}
                      saveUserbotSaleLot={saveUserbotSaleLot}
                      setSaleComposer={setSaleComposer}
                      toggleSalePaymentMethod={toggleSalePaymentMethod}
                    />
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </Card>
  );
}
