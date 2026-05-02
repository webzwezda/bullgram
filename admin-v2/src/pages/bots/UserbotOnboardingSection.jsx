function QrFingerprintConfigurator({
  fingerprintProfiles,
  fingerprintProfilesState,
  onboarding,
  stepNumber,
  switchFingerprintMode,
  updateOnboarding,
  currentQrFingerprintProfile
}) {
  if (onboarding.connectMethod !== 'qr') return null;
  const selectedProfile = currentQrFingerprintProfile(onboarding.qrFingerprintProfileId);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5">
        <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[12px] font-bold text-slate-600">
          {stepNumber}
        </div>
        <div className="text-[14px] font-bold uppercase tracking-[0.08em] text-slate-900">Fingerprint профиля</div>
      </div>
      <div className="grid grid-cols-2 gap-3 rounded-[16px] bg-slate-100/80 p-1.5 border border-slate-200/60">
        <button
          type="button"
          onClick={() => switchFingerprintMode('preset')}
          className={`flex items-center justify-center gap-2 rounded-[18px] px-4 py-3 text-[14px] font-semibold transition ${
            onboarding.fingerprintMode === 'preset'
              ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/60'
              : 'bg-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
          }`}
        >
          <span>Готовый пресет</span>
        </button>
        <button
          type="button"
          onClick={() => switchFingerprintMode('custom')}
          className={`flex items-center justify-center gap-2 rounded-[18px] px-4 py-3 text-[14px] font-semibold transition ${
            onboarding.fingerprintMode === 'custom'
              ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/60'
              : 'bg-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
          }`}
        >
          <span>Свой профиль</span>
        </button>
      </div>

      {onboarding.fingerprintMode === 'preset' ? (
        <div className="space-y-2">
          <select
            className="h-12 w-full rounded-[14px] border border-slate-200 bg-slate-50 px-4 text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 shadow-sm"
            value={onboarding.qrFingerprintProfileId}
            onChange={(event) => updateOnboarding({ qrFingerprintProfileId: event.target.value })}
          >
            {fingerprintProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.owner_id ? `${profile.label} • мой` : profile.label}
              </option>
            ))}
          </select>
          {selectedProfile?.note ? (
            <div className="text-[12px] leading-5 text-slate-500">{selectedProfile.note}</div>
          ) : null}
          {fingerprintProfilesState.error ? (
            <div className="text-[12px] leading-5 text-amber-600">{fingerprintProfilesState.error}</div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3 rounded-[18px] bg-slate-50/80 p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-[13px] font-semibold text-slate-800">Название профиля</span>
              <input
                className="h-11 w-full rounded-[14px] border border-slate-200 bg-white px-4 text-[14px] text-slate-950 outline-none transition focus:border-blue-300"
                value={onboarding.customFingerprintLabel}
                onChange={(event) => updateOnboarding({ customFingerprintLabel: event.target.value })}
                placeholder="Например: мой Android 15"
              />
            </label>
            <label className="space-y-2">
              <span className="text-[13px] font-semibold text-slate-800">api_id</span>
              <input
                className="h-11 w-full rounded-[14px] border border-slate-200 bg-white px-4 text-[14px] text-slate-950 outline-none transition focus:border-blue-300"
                value={onboarding.customApiId}
                onChange={(event) => updateOnboarding({ customApiId: event.target.value })}
                placeholder="2040"
              />
            </label>
            <label className="space-y-2 md:col-span-2">
              <span className="text-[13px] font-semibold text-slate-800">api_hash</span>
              <input
                className="h-11 w-full rounded-[14px] border border-slate-200 bg-white px-4 text-[14px] text-slate-950 outline-none transition focus:border-blue-300"
                value={onboarding.customApiHash}
                onChange={(event) => updateOnboarding({ customApiHash: event.target.value })}
                placeholder="32-символьный hash"
              />
            </label>
            <label className="space-y-2">
              <span className="text-[13px] font-semibold text-slate-800">Устройство</span>
              <input
                className="h-11 w-full rounded-[14px] border border-slate-200 bg-white px-4 text-[14px] text-slate-950 outline-none transition focus:border-blue-300"
                value={onboarding.customDeviceModel}
                onChange={(event) => updateOnboarding({ customDeviceModel: event.target.value })}
              />
            </label>
            <label className="space-y-2">
              <span className="text-[13px] font-semibold text-slate-800">Система</span>
              <input
                className="h-11 w-full rounded-[14px] border border-slate-200 bg-white px-4 text-[14px] text-slate-950 outline-none transition focus:border-blue-300"
                value={onboarding.customSystemVersion}
                onChange={(event) => updateOnboarding({ customSystemVersion: event.target.value })}
              />
            </label>
            <label className="space-y-2">
              <span className="text-[13px] font-semibold text-slate-800">Версия Telegram</span>
              <input
                className="h-11 w-full rounded-[14px] border border-slate-200 bg-white px-4 text-[14px] text-slate-950 outline-none transition focus:border-blue-300"
                value={onboarding.customAppVersion}
                onChange={(event) => updateOnboarding({ customAppVersion: event.target.value })}
              />
            </label>
            <label className="space-y-2">
              <span className="text-[13px] font-semibold text-slate-800">system_lang_code</span>
              <input
                className="h-11 w-full rounded-[14px] border border-slate-200 bg-white px-4 text-[14px] text-slate-950 outline-none transition focus:border-blue-300"
                value={onboarding.customSystemLangCode}
                onChange={(event) => updateOnboarding({ customSystemLangCode: event.target.value })}
              />
            </label>
            <label className="space-y-2">
              <span className="text-[13px] font-semibold text-slate-800">lang_code</span>
              <input
                className="h-11 w-full rounded-[14px] border border-slate-200 bg-white px-4 text-[14px] text-slate-950 outline-none transition focus:border-blue-300"
                value={onboarding.customLangCode}
                onChange={(event) => updateOnboarding({ customLangCode: event.target.value })}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

export function UserbotOnboardingSection({
  availableOnboardingProxies,
  currentQrFingerprintProfile,
  fingerprintProfiles,
  fingerprintProfilesState,
  handleJsonFileChange,
  handleSessionFileChange,
  importSession,
  onboarding,
  proxyLabel,
  startQrLogin,
  steps,
  switchFingerprintMode,
  updateOnboarding
}) {
  const finalStep = onboarding.connectMethod === 'files' ? steps.authFiles : steps.authQr;

  return (
    <>
      <div className="mb-6 rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="space-y-4">
          <div className="text-[24px] leading-none font-semibold tracking-[-0.03em] text-slate-950">
            Подключить самому
          </div>
          <div className="flex items-center gap-2.5">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[12px] font-bold text-slate-600">
              {steps.proxy}
            </div>
            <div className="text-[14px] font-bold uppercase tracking-[0.08em] text-slate-900">Выбор прокси</div>
          </div>
          <select
            className="h-12 w-full rounded-[14px] border border-slate-200 bg-slate-50 px-4 text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 shadow-sm"
            value={onboarding.proxyId}
            onChange={(event) => updateOnboarding({ proxyId: event.target.value })}
          >
            <option value="">Выбери живой прокси</option>
            {availableOnboardingProxies.map((proxy) => (
              <option key={proxy.id} value={proxy.id}>
                {proxyLabel(proxy)}{proxy.provision_source === 'purchased' && Number(proxy.userbot_count || 0) === 0 ? ' • куплен и свободен' : ''}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2.5">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[12px] font-bold text-slate-600">
              {steps.connect}
            </div>
            <div className="text-[14px] font-bold uppercase tracking-[0.08em] text-slate-900">Способ входа</div>
          </div>
          <div className="grid grid-cols-2 gap-3 rounded-[16px] bg-slate-100/80 p-1.5 border border-slate-200/60">
            <button
              type="button"
              onClick={() => updateOnboarding({ connectMethod: 'qr' })}
              className={`flex items-center justify-center gap-2 rounded-[12px] px-4 py-2.5 text-[13px] font-semibold transition ${
                onboarding.connectMethod === 'qr'
                  ? 'bg-white text-blue-600 shadow-[0_8px_24px_rgba(15,23,42,0.10)]'
                  : 'bg-transparent text-slate-600'
              }`}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="shrink-0"
              >
                <path d="M4 9V5h4"></path>
                <path d="M20 9V5h-4"></path>
                <path d="M4 15v4h4"></path>
                <path d="M20 15v4h-4"></path>
                <path d="M9 4H7a3 3 0 0 0-3 3v2"></path>
                <path d="M15 4h2a3 3 0 0 1 3 3v2"></path>
                <path d="M9 20H7a3 3 0 0 1-3-3v-2"></path>
                <path d="M15 20h2a3 3 0 0 0 3-3v-2"></path>
                <rect x="9" y="9" width="6" height="6" rx="1.4"></rect>
              </svg>
              <span>Через QR</span>
            </button>
            <button
              type="button"
              onClick={() => updateOnboarding({ connectMethod: 'files' })}
              className={`flex items-center justify-center gap-2 rounded-[12px] px-4 py-2.5 text-[13px] font-semibold transition ${
                onboarding.connectMethod === 'files'
                  ? 'bg-white text-slate-950 shadow-[0_8px_24px_rgba(15,23,42,0.10)]'
                  : 'bg-transparent text-slate-500'
              }`}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="shrink-0"
              >
                <path d="M8 7.5h5l2.5 2.5H20a2 2 0 0 1 2 2v4.5a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9.5a2 2 0 0 1 2-2Z"></path>
                <path d="M5 9.5H4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h1"></path>
                <path d="M9.5 13h5"></path>
                <path d="M9.5 16h3"></path>
              </svg>
              <span>Из файлов</span>
            </button>
          </div>

          <QrFingerprintConfigurator
            currentQrFingerprintProfile={currentQrFingerprintProfile}
            fingerprintProfiles={fingerprintProfiles}
            fingerprintProfilesState={fingerprintProfilesState}
            onboarding={onboarding}
            stepNumber={steps.fingerprint}
            switchFingerprintMode={switchFingerprintMode}
            updateOnboarding={updateOnboarding}
          />

          <div className="flex items-center gap-2.5">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[12px] font-bold text-slate-600">
              {finalStep}
            </div>
            <div className="text-[14px] font-bold uppercase tracking-[0.08em] text-slate-900">
              {onboarding.connectMethod === 'files' ? 'Загрузка файлов' : 'Вход через QR'}
            </div>
          </div>

          {onboarding.connectMethod === 'files' ? (
            <div className="space-y-3 rounded-[18px] bg-slate-50/80 p-4">
              <div className="space-y-3">
                <div className="space-y-2">
                  <div>
                    <div className="text-[13px] font-semibold text-slate-800">Файл `.session`</div>
                    <div className="text-[12px] leading-5 text-slate-500">Основная Telegram-сессия аккаунта</div>
                  </div>
                  <div className={`relative flex w-full items-center gap-3 rounded-[16px] border bg-white px-4 py-3 text-left transition hover:border-slate-300 hover:bg-slate-50 ${
                    onboarding.sessionFileName ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200'
                  }`}>
                    <input
                      type="file"
                      accept=".session"
                      className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                      onChange={handleSessionFileChange}
                    />
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-slate-100 text-slate-500">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"></path>
                        <path d="M14 3v5h5"></path>
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-medium text-slate-900">{onboarding.sessionFileName || 'Выбрать файл'}</div>
                    </div>
                    <div className="text-[12px] font-semibold text-slate-500">{onboarding.sessionFileName ? 'Заменить' : '.session'}</div>
                  </div>
                </div>
                <div className="space-y-2">
                  <div>
                    <div className="text-[13px] font-semibold text-slate-800">Файл `.json`</div>
                    <div className="text-[12px] leading-5 text-slate-500">Профиль устройства для этой же сессии</div>
                  </div>
                  <div className={`relative flex w-full items-center gap-3 rounded-[16px] border bg-white px-4 py-3 text-left transition hover:border-slate-300 hover:bg-slate-50 ${
                    onboarding.jsonFileName ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200'
                  }`}>
                    <input
                      type="file"
                      accept=".json,application/json"
                      className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                      onChange={handleJsonFileChange}
                    />
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-slate-100 text-slate-500">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"></path>
                        <path d="M14 3v5h5"></path>
                        <path d="M9 13h6"></path>
                        <path d="M9 17h4"></path>
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-medium text-slate-900">{onboarding.jsonFileName || 'Выбрать файл'}</div>
                    </div>
                    <div className="text-[12px] font-semibold text-slate-500">{onboarding.jsonFileName ? 'Заменить' : '.json'}</div>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={importSession}
                disabled={!onboarding.sessionFile || !onboarding.jsonFile || onboarding.isImporting}
                className="inline-flex h-11 items-center justify-center rounded-[14px] bg-blue-600 px-5 text-[14px] font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
              >
                {onboarding.isImporting ? 'Подключаем...' : 'Подключить'}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {onboarding.qrCodeUrl ? (
                <div>
                  <img src={onboarding.qrCodeUrl} alt="QR login" className="mx-auto w-full max-w-[220px]" />
                </div>
              ) : (
                <div className="rounded-[16px] border border-dashed border-slate-300 bg-white px-4 py-6">
                  <button
                    type="button"
                    onClick={startQrLogin}
                    disabled={onboarding.isGeneratingQr}
                    className="inline-flex h-11 w-full items-center justify-center rounded-[14px] bg-blue-600 px-5 text-[14px] font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                  >
                    {onboarding.isGeneratingQr ? 'Генерируем QR...' : 'Получить QR'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {onboarding.qrStatus ? (
        <div className={`table-subtext userbots-status-note userbots-status-note--${onboarding.qrStatusTone || 'default'}`}>
          {onboarding.qrStatus}
        </div>
      ) : null}
    </>
  );
}
