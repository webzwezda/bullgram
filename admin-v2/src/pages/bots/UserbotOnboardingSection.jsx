import { useEffect } from 'react';
import { UserPlus, Network, Smartphone, FolderArchive, QrCode, FileKey, FileJson, CheckCircle2, Fingerprint, Loader2, UploadCloud, MonitorSmartphone } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';

function StepHeader({ number, title }) {
  return (
    <div className="flex items-center gap-2.5 mb-3">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-bold text-indigo-600 ring-1 ring-indigo-200">
        {number}
      </div>
      <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900">{title}</h3>
    </div>
  );
}

function SegmentedControl({ options, value, onChange }) {
  return (
    <div className="flex p-1 bg-slate-100/80 rounded-xl border border-slate-200/60 w-full">
      {options.map((opt) => {
        const isActive = value === opt.value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`relative flex items-center justify-center gap-2 flex-1 px-4 py-2.5 text-sm font-semibold rounded-lg transition-all duration-200 ease-in-out ${
              isActive
                ? 'text-slate-900 bg-white shadow-sm ring-1 ring-slate-200/50'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
            }`}
          >
            {Icon && <Icon className={`w-4 h-4 ${isActive ? opt.activeColor || 'text-indigo-600' : 'text-slate-400'}`} />}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function FileUploadBox({ label, fileName, acceptedTypes, onChange, icon: Icon, colorClass }) {
  const isUploaded = !!fileName;

  return (
    <label className={`relative flex w-full items-center gap-4 rounded-2xl border-2 border-dashed px-5 py-4 text-left transition-all duration-200 cursor-pointer group bg-white ${
      isUploaded
        ? `border-${colorClass}-300 bg-${colorClass}-50/30`
        : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50/50'
    }`}>
      <input
        type="file"
        accept={acceptedTypes}
        className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
        onChange={onChange}
      />
      <div className={`flex size-12 shrink-0 items-center justify-center rounded-xl shadow-sm transition-colors ${
        isUploaded
          ? `bg-${colorClass}-100 text-${colorClass}-600`
          : 'bg-white border border-slate-200 text-slate-400 group-hover:text-indigo-500'
      }`}>
        {isUploaded ? <CheckCircle2 className="w-6 h-6" /> : <Icon className="w-6 h-6" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-bold ${isUploaded ? 'text-slate-900' : 'text-slate-700'}`}>{label}</div>
        <div className={`truncate text-sm font-medium mt-0.5 ${isUploaded ? 'text-slate-600' : 'text-slate-400'}`}>
          {fileName || `Нажмите чтобы выбрать файл`}
        </div>
      </div>
      <div className={`shrink-0 text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg transition-colors ${
        isUploaded
          ? 'bg-slate-200/50 text-slate-600'
          : 'bg-indigo-50 text-indigo-600 group-hover:bg-indigo-100'
      }`}>
        {isUploaded ? 'Заменить' : 'Обзор'}
      </div>
    </label>
  );
}

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
    <div className="rounded-2xl bg-slate-50/50 p-4 border border-slate-100">
      <StepHeader number={stepNumber} title="Профиль устройства (Fingerprint)" />

      <div className="mb-4">
        <SegmentedControl
          value={onboarding.fingerprintMode}
          onChange={switchFingerprintMode}
          options={[
            { value: 'preset', label: 'Готовый пресет', icon: Fingerprint, activeColor: 'text-indigo-600' },
            { value: 'custom', label: 'Ручная настройка', icon: MonitorSmartphone, activeColor: 'text-indigo-600' }
          ]}
        />
      </div>

      <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
        {onboarding.fingerprintMode === 'preset' ? (
          <div className="space-y-3">
            <Select
              value={onboarding.qrFingerprintProfileId || ''}
              onValueChange={(value) => updateOnboarding({ qrFingerprintProfileId: value })}
            >
              <SelectTrigger className="w-full data-[size=default]:h-12 bg-white border-slate-200 rounded-xl text-sm font-medium shadow-sm">
                <SelectValue placeholder="Выберите профиль из списка" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                {fingerprintProfiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id} className="rounded-lg py-2.5">
                    {profile.owner_id ? `${profile.label} • мой` : profile.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedProfile?.note && (
              <div className="flex gap-2 p-3 rounded-xl bg-slate-50 border border-slate-100">
                <Fingerprint className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                <div className="text-xs leading-5 text-slate-600 font-medium">{selectedProfile.note}</div>
              </div>
            )}
            {fingerprintProfilesState.error && (
              <div className="text-sm font-medium text-rose-600 bg-rose-50 p-3 rounded-xl border border-rose-100">
                {fingerprintProfilesState.error}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-2xl bg-white/80 p-5 border border-slate-100 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5 md:col-span-2">
                <label className="text-[13px] font-semibold text-slate-700 ml-1">Название профиля (для себя)</label>
                <Input
                  className="h-11 rounded-xl bg-white border-slate-200 text-sm shadow-sm"
                  value={onboarding.customFingerprintLabel}
                  onChange={(event) => updateOnboarding({ customFingerprintLabel: event.target.value })}
                  placeholder="Например: Мой основной Android"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-slate-700 ml-1">api_id</label>
                <Input
                  className="h-11 rounded-xl bg-white border-slate-200 text-sm shadow-sm font-mono"
                  value={onboarding.customApiId}
                  onChange={(event) => updateOnboarding({ customApiId: event.target.value })}
                  placeholder="2040"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-slate-700 ml-1">api_hash</label>
                <Input
                  className="h-11 rounded-xl bg-white border-slate-200 text-sm shadow-sm font-mono"
                  value={onboarding.customApiHash}
                  onChange={(event) => updateOnboarding({ customApiHash: event.target.value })}
                  placeholder="b18441a1ff607e10a989891a5462e627"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-slate-700 ml-1">Устройство (device_model)</label>
                <Input
                  className="h-11 rounded-xl bg-white border-slate-200 text-sm shadow-sm"
                  value={onboarding.customDeviceModel}
                  onChange={(event) => updateOnboarding({ customDeviceModel: event.target.value })}
                  placeholder="Pixel 7 Pro"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-slate-700 ml-1">Система (system_version)</label>
                <Input
                  className="h-11 rounded-xl bg-white border-slate-200 text-sm shadow-sm"
                  value={onboarding.customSystemVersion}
                  onChange={(event) => updateOnboarding({ customSystemVersion: event.target.value })}
                  placeholder="Android 14.0"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-slate-700 ml-1">Версия приложения (app_version)</label>
                <Input
                  className="h-11 rounded-xl bg-white border-slate-200 text-sm shadow-sm font-mono"
                  value={onboarding.customAppVersion}
                  onChange={(event) => updateOnboarding({ customAppVersion: event.target.value })}
                  placeholder="10.14.5"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-slate-700 ml-1">system_lang_code</label>
                <Input
                  className="h-11 rounded-xl bg-white border-slate-200 text-sm shadow-sm font-mono"
                  value={onboarding.customSystemLangCode}
                  onChange={(event) => updateOnboarding({ customSystemLangCode: event.target.value })}
                  placeholder="en-US"
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <label className="text-[13px] font-semibold text-slate-700 ml-1">lang_code</label>
                <Input
                  className="h-11 rounded-xl bg-white border-slate-200 text-sm shadow-sm font-mono"
                  value={onboarding.customLangCode}
                  onChange={(event) => updateOnboarding({ customLangCode: event.target.value })}
                  placeholder="en"
                />
              </div>
            </div>
          </div>
        )}
      </div>
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

  useEffect(() => {
    if (onboarding.proxyId) return;
    if (!availableOnboardingProxies.length) return;
    const firstFree = availableOnboardingProxies.find((p) => p.provision_source === 'purchased' && Number(p.userbot_count || 0) === 0);
    const pick = firstFree || availableOnboardingProxies[0];
    if (pick) {
      updateOnboarding({ proxyId: pick.id });
    }
  }, [onboarding.proxyId, availableOnboardingProxies]);

  return (
    <>
      <Card className="border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 mb-6 bg-white overflow-hidden rounded-2xl">
        <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
              <UserPlus className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">Подключение аккаунта</h2>
              <p className="text-sm text-slate-500 mt-0.5">Добавьте нового юзербота в ваш контур</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Step 1: Proxy */}
          <div className="rounded-2xl bg-slate-50/50 p-4 border border-slate-100">
            <StepHeader number={steps.proxy} title="Выбор прокси" />
            <Select
              value={onboarding.proxyId || ''}
              onValueChange={(value) => updateOnboarding({ proxyId: value })}
            >
              <SelectTrigger className="w-full data-[size=default]:h-12 bg-white border-slate-200 rounded-xl text-sm font-medium shadow-sm hover:border-indigo-300 transition-colors">
                <div className="flex items-center gap-2">
                  <Network className="w-4 h-4 text-slate-400" />
                  <SelectValue placeholder="Выберите живой прокси для подключения" />
                </div>
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                {availableOnboardingProxies.map((proxy) => {
                  const isFreeAndPurchased = proxy.provision_source === 'purchased' && Number(proxy.userbot_count || 0) === 0;
                  return (
                    <SelectItem key={proxy.id} value={proxy.id} className="rounded-lg py-2.5">
                      <div className="flex items-center justify-between w-full pr-2 gap-4">
                        <span>{proxyLabel(proxy)}</span>
                        {isFreeAndPurchased && (
                          <Badge variant="outline" className="bg-emerald-50 text-emerald-600 border-emerald-200 whitespace-nowrap ml-auto">
                            Свободен
                          </Badge>
                        )}
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Step 2: Connect Method */}
          <div className="rounded-2xl bg-slate-50/50 p-4 border border-slate-100">
            <StepHeader number={steps.connect} title="Способ входа" />
            <SegmentedControl
              value={onboarding.connectMethod}
              onChange={(val) => updateOnboarding({ connectMethod: val })}
              options={[
                { value: 'qr', label: 'Через QR-код', icon: QrCode, activeColor: 'text-indigo-600' },
                { value: 'files', label: 'Импорт сессии', icon: FolderArchive, activeColor: 'text-indigo-600' }
              ]}
            />
          </div>

          {/* Step 3: Fingerprint (QR only) */}
          <QrFingerprintConfigurator
            currentQrFingerprintProfile={currentQrFingerprintProfile}
            fingerprintProfiles={fingerprintProfiles}
            fingerprintProfilesState={fingerprintProfilesState}
            onboarding={onboarding}
            stepNumber={steps.fingerprint}
            switchFingerprintMode={switchFingerprintMode}
            updateOnboarding={updateOnboarding}
          />

          {/* Final Step: Files or QR */}
          <div className="rounded-2xl bg-slate-50/50 p-4 border border-slate-100">
            <StepHeader
              number={finalStep}
              title={onboarding.connectMethod === 'files' ? 'Загрузка файлов сессии' : 'Авторизация устройства'}
            />

            {onboarding.connectMethod === 'files' ? (
              <div className="space-y-4 animate-in fade-in duration-300">
                <FileUploadBox
                  label="Сессия Telegram (.session)"
                  fileName={onboarding.sessionFileName}
                  acceptedTypes=".session"
                  onChange={handleSessionFileChange}
                  icon={FileKey}
                  colorClass="indigo"
                />

                <FileUploadBox
                  label="Профиль устройства (.json)"
                  fileName={onboarding.jsonFileName}
                  acceptedTypes=".json,application/json"
                  onChange={handleJsonFileChange}
                  icon={FileJson}
                  colorClass="slate"
                />

                <div className="pt-2">
                  <Button
                    size="lg"
                    onClick={importSession}
                    disabled={!onboarding.sessionFile || !onboarding.jsonFile || onboarding.isImporting}
                    className="w-full sm:w-auto min-w-[240px] h-12 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-200 text-base"
                  >
                    {onboarding.isImporting ? (
                      <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Подключение...</>
                    ) : (
                      <><UploadCloud className="w-5 h-5 mr-2" /> Импортировать аккаунт</>
                    )}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4 animate-in fade-in duration-300">
                {onboarding.qrCodeUrl ? (
                  <div className="flex flex-col sm:flex-row items-center gap-6 rounded-2xl border border-indigo-100 bg-indigo-50/30 p-6">
                    <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-100 shrink-0">
                      <img src={onboarding.qrCodeUrl} alt="QR login" className="w-48 h-48 sm:w-56 sm:h-56" />
                    </div>
                    <div className="flex flex-col gap-4 text-center sm:text-left">
                      <div>
                        <h4 className="text-lg font-bold text-slate-900 mb-1">Отсканируйте код</h4>
                        <p className="text-sm text-slate-500">Откройте Telegram на телефоне, чтобы привязать сессию к сервису.</p>
                      </div>
                      <ol className="text-sm text-slate-700 space-y-2 text-left bg-white/60 p-4 rounded-xl border border-indigo-50/50">
                        <li className="flex gap-2">
                          <span className="font-bold text-indigo-500">1.</span>
                          <span>Зайдите в <b>Настройки</b></span>
                        </li>
                        <li className="flex gap-2">
                          <span className="font-bold text-indigo-500">2.</span>
                          <span>Выберите <b>Устройства</b></span>
                        </li>
                        <li className="flex gap-2">
                          <span className="font-bold text-indigo-500">3.</span>
                          <span>Нажмите <b>Подключить устройство</b></span>
                        </li>
                      </ol>
                    </div>
                  </div>
                ) : (
                  <div className="p-8 border-2 border-dashed border-slate-200 rounded-2xl bg-white flex flex-col items-center text-center">
                    <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center shadow-sm mb-4 border border-slate-100">
                      <Smartphone className="w-8 h-8 text-indigo-500" />
                    </div>
                    <h4 className="text-base font-bold text-slate-900 mb-2">Генерация сессии</h4>
                    <p className="text-sm text-slate-500 max-w-sm mb-6">
                      Мы создадим уникальный QR-код на основе выбранного прокси и отпечатка устройства.
                    </p>
                    <Button
                      size="lg"
                      onClick={startQrLogin}
                      disabled={onboarding.isGeneratingQr}
                      className="h-12 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-200 px-8 text-base w-full sm:w-auto"
                    >
                      {onboarding.isGeneratingQr ? (
                        <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Запуск...</>
                      ) : (
                        <><QrCode className="w-5 h-5 mr-2" /> Сгенерировать QR-код</>
                      )}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </Card>

      {onboarding.qrStatus && (
        <div className={`mb-6 p-4 flex gap-3 items-start rounded-2xl border text-sm font-medium shadow-sm animate-in slide-in-from-bottom-2 ${
          onboarding.qrStatusTone === 'success'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : onboarding.qrStatusTone === 'warning'
              ? 'border-amber-200 bg-amber-50 text-amber-800'
              : onboarding.qrStatusTone === 'error'
                ? 'border-rose-200 bg-rose-50 text-rose-800'
                : 'border-slate-200 bg-white text-slate-700'
        }`}>
          {onboarding.qrStatusTone === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />}
          {onboarding.qrStatusTone === 'warning' && <Loader2 className="w-5 h-5 text-amber-500 shrink-0 mt-0.5 animate-spin" />}
          <div className="pt-0.5">{onboarding.qrStatus}</div>
        </div>
      )}
    </>
  );
}
