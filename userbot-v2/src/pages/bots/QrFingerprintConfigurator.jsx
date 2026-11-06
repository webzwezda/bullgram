// Вынесено из UserbotOnboardingSection.jsx (механическая разрезка под лимит
// pre-commit 20KB): StepHeader, SegmentedControl и конфигуратор QR-fingerprint.
// Тела перенесены дословно; родитель реимпортирует StepHeader/SegmentedControl.

import { Fingerprint, MonitorSmartphone } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';

export function StepHeader({ number, title }) {
  return (
    <div className="flex items-center gap-2.5 mb-3">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-bold text-indigo-600 ring-1 ring-indigo-200">
        {number}
      </div>
      <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900">{title}</h3>
    </div>
  );
}

export function SegmentedControl({ options, value, onChange }) {
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

export function QrFingerprintConfigurator({
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
                <SelectValue placeholder="Выбери профиль из списка" />
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
