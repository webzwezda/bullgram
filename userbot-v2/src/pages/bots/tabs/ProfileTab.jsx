import { ExternalLink, Loader2, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConnectionPanel, RecoveryPanel, SessionPanel } from './ProfileTabPanels.jsx';

export function ProfileTab({
  selectedLiveUserbot,
  selectedUserbot,
  selectedLiveUserbotId,
  recovery,
  profileSyncState,
  telegramWebEnabled,
  labelDirty,
  labelDraft,
  labelSaving,
  setLabelDraft,
  saveCustomLabel,
  selectedProfilePhotoSrc,
  selectedProfileInitial,
  selectedProfileName,
  syncSelectedUserbotProfile,
  selectedDraftFirstName,
  selectedDraftLastName,
  selectedDraftAbout,
  setProfileDraft,
  selectedProfileAttemptedAt,
  profileDirty,
  openPanels,
  togglePanel,
  binding,
  updateBinding,
  availableBindingProxiesForAccount,
  proxyLabel,
  availableFailoverProxiesForAccount,
  toggleSafeMode,
  checkingAccountId,
  togglingSafeModeId,
  accountCheckReport,
  defaultCheckLines,
  accountRestoreFeedback,
  restoreAccount,
  restoringAccountId,
  canRestoreFromFiles,
  formatWhen,
  accountBindingFeedback,
  hasUnsavedChanges,
  saveAllChanges,
  bindingAccountId,
  checkAccount,
}) {
    if (!selectedLiveUserbot) return null;
    const runtimeStatus = String(selectedLiveUserbot.runtime_status || '');
    const isSafeMode = runtimeStatus === 'pending_activation';
    const isCombatMode = !isSafeMode;
    const hasRecoveryInfo = !!(recovery?.last_restored_at || recovery?.last_restore_error);
    const showRecoveryNextStep = !recovery && ['expired', 'error'].includes(runtimeStatus);

    return (
      <>
        <div className="p-5 sm:p-6">
          <div className="rounded-2xl bg-white shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 overflow-hidden">
            <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-12 h-12 shrink-0 overflow-hidden rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20">
                    {selectedProfilePhotoSrc ? (
                      <img src={selectedProfilePhotoSrc} alt="" className="w-12 h-12 object-cover" />
                    ) : (
                      <span className="text-base font-black">
                        {selectedProfileInitial}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-xl font-bold text-slate-900 truncate">
                      {selectedProfileName || 'Имя пока не подтянуто'}
                    </h2>
                    {(() => {
                      const parts = [
                        selectedUserbot.tg_username ? `@${selectedUserbot.tg_username}` : '',
                        selectedUserbot.tg_phone || '',
                        selectedUserbot.tg_account_id ? `ID ${selectedUserbot.tg_account_id}` : ''
                      ].filter(Boolean);
                      if (!parts.length) return null;
                      return (
                        <p className="text-sm text-ink-muted mt-0.5 truncate">
                          {parts.join(' • ')}
                        </p>
                      );
                    })()}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    className="h-10 px-3 sm:px-4 rounded-xl border border-slate-200 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors disabled:opacity-50 shadow-sm whitespace-nowrap"
                    onClick={syncSelectedUserbotProfile}
                    disabled={profileSyncState.pulling || profileSyncState.saving || !selectedLiveUserbotId}
                  >
                    {profileSyncState.pulling ? 'Тянем...' : 'Стянуть из Telegram'}
                  </button>
                  {telegramWebEnabled ? (
                    <button
                      type="button"
                      className="h-10 px-3 sm:px-4 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2 shadow-sm whitespace-nowrap"
                      onClick={() => {
                        if (!selectedLiveUserbotId) return;
                        window.open(`/userbot/telegram-web/${selectedLiveUserbotId}`, '_blank', 'noopener');
                      }}
                      disabled={!selectedLiveUserbotId}
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Telegram Web
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="p-5 sm:p-6 space-y-5">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-slate-500">Название аккаунта</label>
                    {labelDirty ? <span className="text-[11px] text-indigo-500">не сохранено</span> : null}
                  </div>
                  <div className="flex gap-2">
                    <input
                      className="h-10 flex-1 px-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-950 outline-none transition shadow-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
                      value={labelDraft}
                      maxLength={100}
                      onChange={(event) => setLabelDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && labelDirty && !labelSaving) saveCustomLabel();
                      }}
                      placeholder="Например: Вася, Админ группы, Основной аккаунт"
                    />
                    <button
                      type="button"
                      className={`h-10 px-4 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-all shadow-sm whitespace-nowrap ${
                        labelDirty ? 'visible' : 'invisible'
                      }`}
                      onClick={saveCustomLabel}
                      disabled={!labelDirty || labelSaving}
                    >
                      {labelSaving ? '...' : 'Сохранить'}
                    </button>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-500">Имя</label>
                    <input
                      className="h-10 w-full px-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-950 outline-none transition shadow-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
                      value={selectedDraftFirstName}
                      maxLength={64}
                      onChange={(event) => setProfileDraft((prev) => ({ ...prev, firstName: event.target.value }))}
                      placeholder="Имя аккаунта"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-500">Фамилия</label>
                    <input
                      className="h-10 w-full px-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-950 outline-none transition shadow-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
                      value={selectedDraftLastName}
                      maxLength={64}
                      onChange={(event) => setProfileDraft((prev) => ({ ...prev, lastName: event.target.value }))}
                      placeholder="Фамилия аккаунта"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-slate-500">Описание</label>
                    <span className="text-[11px] text-slate-600">{selectedDraftAbout.length}/70</span>
                  </div>
                  <textarea
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-950 outline-none transition shadow-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 resize-none"
                    rows={3}
                    value={selectedDraftAbout}
                    maxLength={70}
                    onChange={(event) => setProfileDraft((prev) => ({ ...prev, about: event.target.value }))}
                    placeholder="Описание профиля"
                  />
                </div>
              </div>

              {profileDirty ? (
                <div className="flex justify-end pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    className="h-9 px-3 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
                    onClick={() => setProfileDraft({
                      accountId: String(selectedUserbot.id),
                      firstName: selectedUserbot.tg_first_name || '',
                      lastName: selectedUserbot.tg_last_name || '',
                      about: selectedUserbot.tg_about || ''
                    })}
                    disabled={profileSyncState.pulling || profileSyncState.saving}
                  >
                    Отменить изменения
                  </button>
                </div>
              ) : null}

              {selectedUserbot.tg_profile_sync_error ? (
                <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">
                  Ошибка профиля{selectedProfileAttemptedAt ? ` (${selectedProfileAttemptedAt})` : ''}: {selectedUserbot.tg_profile_sync_error}
                </div>
              ) : null}
            </div>
          </div>
        </div>

          <div className="p-6 md:p-8 border-t border-slate-100 grid gap-6">
            <ConnectionPanel
              open={openPanels.connection}
              onToggle={() => togglePanel('connection')}
              binding={binding}
              updateBinding={updateBinding}
              selectedLiveUserbot={selectedLiveUserbot}
              availableBindingProxiesForAccount={availableBindingProxiesForAccount}
              proxyLabel={proxyLabel}
              availableFailoverProxiesForAccount={availableFailoverProxiesForAccount}
            />
            <SessionPanel
              open={openPanels.session}
              onToggle={() => togglePanel('session')}
              isCombatMode={isCombatMode}
              toggleSafeMode={toggleSafeMode}
              selectedLiveUserbot={selectedLiveUserbot}
              checkingAccountId={checkingAccountId}
              togglingSafeModeId={togglingSafeModeId}
              isSafeMode={isSafeMode}
              accountCheckReport={accountCheckReport}
              defaultCheckLines={defaultCheckLines}
              checkAccount={checkAccount}
            />
          </div>

          {(hasRecoveryInfo || showRecoveryNextStep) && (
            <RecoveryPanel
              recovery={recovery}
              formatWhen={formatWhen}
              showRecoveryNextStep={showRecoveryNextStep}
              canRestoreFromFiles={canRestoreFromFiles}
              selectedLiveUserbot={selectedLiveUserbot}
              restoreAccount={restoreAccount}
              restoringAccountId={restoringAccountId}
              accountRestoreFeedback={accountRestoreFeedback}
            />
          )}

          <div className="p-6 md:p-8 border-t border-slate-100 sticky bottom-0 bg-white/95 backdrop-blur-sm z-10">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3">
              {(profileSyncState.text || (accountBindingFeedback.accountId === String(selectedLiveUserbot.id) && accountBindingFeedback.text)) ? (
                <div className={`flex-1 p-3 rounded-xl border text-sm font-medium animate-in slide-in-from-bottom-2 ${
                  profileSyncState.tone === 'error' || accountBindingFeedback.tone === 'error'
                    ? 'bg-rose-50 border-rose-100 text-rose-800'
                    : profileSyncState.tone === 'success' || accountBindingFeedback.tone === 'success'
                      ? 'bg-emerald-50 border-emerald-100 text-emerald-800'
                      : 'bg-slate-50 border-slate-100 text-slate-700'
                }`}>
                  {profileSyncState.text || accountBindingFeedback.text}
                </div>
              ) : null}
              <button
                type="button"
                className={`h-11 px-6 rounded-xl text-[14px] font-bold transition-all shadow-sm inline-flex items-center justify-center gap-2 whitespace-nowrap ${
                  hasUnsavedChanges
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-200/50'
                    : 'bg-slate-100 text-slate-400 cursor-not-allowed shadow-none'
                }`}
                onClick={saveAllChanges}
                disabled={!hasUnsavedChanges || profileSyncState.saving || bindingAccountId === String(selectedLiveUserbot.id)}
              >
                {profileSyncState.saving || bindingAccountId === String(selectedLiveUserbot.id) ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Сохраняем...
                  </>
                ) : (
                  <>
                    <Settings2 className="w-4 h-4" />
                    Сохранить
                  </>
                )}
              </button>
            </div>
          </div>
        </>
    );
}
