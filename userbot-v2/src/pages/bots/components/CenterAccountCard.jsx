import { AlertCircle, Loader2, ShieldCheck, ShieldOff, Tag, Trash2, User, UserPlus } from 'lucide-react';
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
  canSellUserbotAssets,
  activeTab,
  setActiveTab,
  profileTab,
  groupsTab,
  saleTab,
}) {
  const TAB_OPTIONS = [
    {
      id: 'profile',
      label: 'Профиль',
      icon: User,
      title: 'Профиль',
      subtitle: 'Аккаунт, прокси, аватар, описание',
    },
    {
      id: 'groups',
      label: 'Вступить',
      icon: UserPlus,
      title: 'Вступить в группу или чат',
      subtitle: 'По ссылке t.me/groupname, @username или +hash',
    },
    ...(canSellUserbotAssets ? [{
      id: 'sale',
      label: 'Продать',
      icon: Tag,
      title: 'Продать',
      subtitle: 'Выставить лот в Shop за TON',
    }] : [])
  ];
  const isSafeMode = String(selectedLiveUserbot.runtime_status || '') === 'pending_activation';
  const modeBusy = checkingAccountId === String(selectedLiveUserbot.id)
    || togglingSafeModeId === String(selectedLiveUserbot.id);
  const modeTitle = isSafeMode
    ? 'Safe mode — активировать аккаунт'
    : 'Боевой режим — перевести в Safe mode';
  return (
        <div className="relative bg-white border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 rounded-2xl overflow-hidden">
        <div className="absolute top-3 right-3 sm:top-4 sm:right-4 z-10 flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className={`shrink-0 border rounded-xl bg-white/80 backdrop-blur-sm border-border-default ${
              isSafeMode
                ? 'text-feedback-warning-text hover:bg-feedback-warning-bg'
                : 'text-feedback-success-text hover:bg-feedback-success-bg'
            }`}
            onClick={() => toggleSafeMode(selectedLiveUserbot)}
            disabled={modeBusy}
            aria-busy={modeBusy}
            title={modeTitle}
            aria-label={modeTitle}
          >
            {modeBusy
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : isSafeMode
                ? <ShieldOff className="w-4 h-4" />
                : <ShieldCheck className="w-4 h-4" />}
          </Button>
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
          <div className="flex flex-wrap items-center gap-3 pr-24 sm:pr-28">
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
            // Режим аккаунта (боевой/safe) теперь живёт только в иконке-щите
            // рядом с «удалить» в правом верхнем углу. Здесь остаются только
            // диагностические красные баннеры — они не про режим.
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

          <div className={`grid grid-cols-1 sm:grid-cols-2 ${TAB_OPTIONS.length > 2 ? 'lg:grid-cols-3' : ''} gap-3`}>
            {TAB_OPTIONS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`p-4 rounded-2xl border text-left transition-all duration-200 hover:scale-[1.01] active:scale-[0.99] cursor-pointer flex items-center gap-3 ${
                    isActive
                      ? 'border-indigo-600 bg-white ring-1 ring-indigo-600 shadow-md shadow-indigo-100/55'
                      : 'border-slate-200 bg-white/60 hover:border-slate-300 hover:bg-white/80 shadow-sm'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all shrink-0 ${
                    isActive ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-500'
                  }`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="font-bold text-sm text-slate-900">{tab.title}</h4>
                    <p className="text-xs text-slate-500 font-medium mt-0.5 truncate">{tab.subtitle}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {activeTab === 'profile' ? profileTab : null}
        {activeTab === 'groups' ? groupsTab : null}
        {activeTab === 'sale' ? saleTab : null}
        </div>
  );
}
