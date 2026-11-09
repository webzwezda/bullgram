import { AlertCircle, Loader2, ShieldCheck, ShieldOff, Trash2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { UserbotCombobox } from '@/components/bots/UserbotCombobox';
import { StatusBadge } from './CenterWidgets.jsx';

export function CenterAccountCard({
  selectedLiveUserbot,
  deleteAccount,
  deletingAccountId,
  liveUserbots,
  setSelectedLiveUserbotId,
  openConnectPanel,
  restrictedMarker,
  recoveryStatusBadge,
  recovery,
  checkingAccountId,
  togglingSafeModeId,
  toggleSafeMode,
  profileTab,
}) {
  const isSafeMode = String(selectedLiveUserbot.runtime_status || '') === 'pending_activation';
  const modeBusy = checkingAccountId === String(selectedLiveUserbot.id)
    || togglingSafeModeId === String(selectedLiveUserbot.id);
  const modeTitle = isSafeMode
    ? 'Safe mode — активировать аккаунт'
    : 'Боевой режим — перевести в Safe mode';
  return (
        <div className="relative bg-white border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 rounded-2xl overflow-hidden">
        <div className="absolute top-3 right-3 sm:top-4 sm:right-4 z-10 flex items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={!isSafeMode}
            aria-busy={modeBusy}
            onClick={() => toggleSafeMode(selectedLiveUserbot)}
            disabled={modeBusy}
            title={modeTitle}
            aria-label={modeTitle}
            className={`h-8 shrink-0 flex items-center gap-2 px-2 rounded-xl border bg-white/80 backdrop-blur-sm border-border-default transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 ${
              isSafeMode
                ? 'text-feedback-warning-text hover:bg-feedback-warning-bg'
                : 'text-feedback-success-text hover:bg-feedback-success-bg'
            }`}
          >
            <span aria-hidden="true" className="flex items-center">
              {modeBusy
                ? <Loader2 className="w-4 h-4 animate-spin text-ink-muted" />
                : isSafeMode
                  ? <ShieldOff className="w-4 h-4" />
                  : <ShieldCheck className="w-4 h-4" />}
            </span>
            <span
              aria-hidden="true"
              className={`relative inline-flex h-4 w-8 shrink-0 items-center rounded-full transition-colors duration-200 ${
                isSafeMode ? 'bg-slate-200' : 'bg-emerald-500'
              }`}
            >
              <span
                className={`ml-0.5 inline-block h-3 w-3 rounded-full bg-white shadow-sm transition duration-200 ${
                  isSafeMode ? 'translate-x-0' : 'translate-x-4'
                }`}
              />
            </span>
          </button>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 text-rose-600 hover:text-rose-700 hover:bg-rose-50 border border-rose-200 rounded-xl bg-white/80 backdrop-blur-sm"
            onClick={() => deleteAccount(selectedLiveUserbot)}
            disabled={deletingAccountId === String(selectedLiveUserbot.id)}
            title="Удалить аккаунт"
          >
            {deletingAccountId === String(selectedLiveUserbot.id)
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Trash2 className="w-4 h-4" />}
          </Button>
        </div>
        <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center gap-3 pr-36">
            <UserbotCombobox
              accounts={liveUserbots}
              value={String(selectedLiveUserbot.id)}
              onValueChange={(value) => setSelectedLiveUserbotId(value)}
              triggerVariant="avatar"
              className="h-12 bg-white border-slate-200 shadow-sm rounded-xl gap-2.5 w-full sm:w-auto"
              align="start"
              sideOffset={4}
            />

            <button
              type="button"
              onClick={openConnectPanel}
              className="h-12 inline-flex items-center justify-center gap-2 px-4 rounded-xl bg-action-primary text-action-primary-text! text-sm font-bold hover:bg-action-primary-hover transition-all shadow-sm whitespace-nowrap"
            >
              <UserPlus className="w-4 h-4" />
              Подключить аккаунт
            </button>

            {(() => {
              const restrictedBadge = restrictedMarker(selectedLiveUserbot);
              const recoveryBadge = recoveryStatusBadge(recovery);
              if (!restrictedBadge && !recoveryBadge) return null;
              return (
                <div className="flex flex-wrap items-center gap-1.5 min-w-0 flex-1 justify-center">
                  {restrictedBadge && <StatusBadge tone="error">{restrictedBadge.text}</StatusBadge>}
                  {recoveryBadge && <StatusBadge tone={recoveryBadge.tone || 'default'}>{recoveryBadge.text}</StatusBadge>}
                </div>
              );
            })()}
          </div>

          {(() => {
            // Режим аккаунта (боевой/safe) живёт в пилюле-свитче у «удалить»
            // (правый верхний угол) и в тоггле «Состояния сессии». Здесь
            // остаются только диагностические красные баннеры — они не про режим.
            const runtimeStatus = String(selectedLiveUserbot.runtime_status || '');
            const restrictedBadge = restrictedMarker(selectedLiveUserbot);
            const hasRuntimeError = selectedLiveUserbot.runtime_error
              && ['restricted', 'dead_proxy', 'expired', 'error'].includes(runtimeStatus);

            if (restrictedBadge?.detail) {
              return (
                <div className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 shadow-sm">
                  <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />
                  <div>
                    <h4 className="text-sm font-semibold text-rose-900">Ограничения</h4>
                    <p className="text-sm text-rose-800 mt-0.5">{restrictedBadge.detail}</p>
                  </div>
                </div>
              );
            }
            if (hasRuntimeError) {
              return (
                <div className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 shadow-sm">
                  <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />
                  <div>
                    <h4 className="text-sm font-semibold text-rose-900">Ошибка выполнения</h4>
                    <p className="text-sm text-rose-800 mt-0.5">{selectedLiveUserbot.runtime_error}</p>
                  </div>
                </div>
              );
            }
            return null;
          })()}
        </div>

        {/* Единственная секция карточки — профиль. «Вступить» и «Продать»
            удалены из интерфейса по решению владельца (2026-11-10). */}
        {profileTab}
        </div>
  );
}
