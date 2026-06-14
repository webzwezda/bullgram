import { useState } from 'react';
import { cn } from '@/lib/utils';
import { CreditCard, Wallet, CheckCircle2, AlertCircle, Landmark } from 'lucide-react';
import {
  AUTOFILL_BLOCK_PROPS,
  SBP_BANK_OPTIONS
} from './payment-settings.constants.js';
import {
  normalizePhone,
  normalizePhoneLive,
  normalizeTonWallet,
  parseSbpBanks
} from './payment-settings.utils.js';

const TABS = [
  { value: 'sbp', label: 'СБП', Icon: CreditCard },
  { value: 'ton', label: 'TON', Icon: Wallet },
];

function SaveButton({ saving, onClick }) {
  return (
    <div className="flex justify-end">
      <button
        type="button"
        className="h-11 px-7 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold shadow-sm shadow-blue-500/20 transition-all active:scale-[0.98] disabled:opacity-70 disabled:pointer-events-none"
        onClick={onClick}
        disabled={saving}
      >
        {saving ? 'Сохраняем...' : 'Сохранить'}
      </button>
    </div>
  );
}

export function RequisitesSection({
  fieldErrors,
  patchSettings,
  saveSettings,
  saving,
  settings,
  toggleSbpBank,
  validatePaymentFields,
  plain = false
}) {
  const tonReady = Boolean(settings.ton_wallet);
  const sbpReady = Boolean(settings.sbp_phone && settings.sbp_bank);
  const [tab, setTab] = useState(sbpReady || !tonReady ? 'sbp' : 'ton');

  const activeIndex = TABS.findIndex((t) => t.value === tab);

  return (
    <div className={plain ? "@container space-y-6" : "@container bg-white border border-slate-200/60 rounded-3xl p-6 md:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)]"}>
      {/* Header + Tabs */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20 shrink-0">
            <Landmark className="w-5 h-5" />
          </div>
          <h3 className="text-lg font-bold text-slate-900">Реквизиты для оплаты</h3>
        </div>

        {/* Tab bar with sliding indicator */}
        <div role="tablist" aria-label="Способ оплаты">
          <div
            className="req-tabs-track relative inline-flex items-center gap-0.5 bg-slate-100 rounded-xl p-[3px]"
            style={{ '--active-index': activeIndex }}
          >
            {TABS.map((t) => {
              const ready = t.value === 'sbp' ? sbpReady : tonReady;
              const active = t.value === tab;
              return (
                <button
                  key={t.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={cn(
                    'relative z-[1] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-[10px] text-[13px] font-bold border-none bg-transparent cursor-pointer transition-colors duration-150',
                    active ? 'text-slate-900' : 'text-slate-500'
                  )}
                  onClick={() => setTab(t.value)}
                >
                  <t.Icon className="w-4 h-4" />
                  <span>{t.label}</span>
                  {ready
                    ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    : <AlertCircle className="w-3.5 h-3.5 text-slate-400" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* SBP Tab */}
      <div
        role="tabpanel"
        className={tab !== 'sbp' ? 'hidden' : ''}
        aria-label="СБП перевод"
      >
        <div className="space-y-6">
          <fieldset>
            <legend className="text-sm font-bold text-slate-700 mb-3">Банки получателя</legend>
            <div className="flex flex-wrap gap-2.5">
              {SBP_BANK_OPTIONS.map((option) => {
                const isActive = parseSbpBanks(settings.sbp_bank).includes(option.value);
                return (
                  <label
                    key={option.value}
                    className={cn(
                      'inline-flex items-center gap-2.5 px-3.5 py-2 rounded-xl border cursor-pointer transition-all duration-150 select-none',
                      isActive
                        ? 'bg-emerald-50/50 border-emerald-200/80 shadow-[0_2px_10px_-2px_rgba(16,185,129,0.1)]'
                        : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                    )}
                  >
                    <div className={cn(
                      'w-5 h-5 rounded-md flex items-center justify-center transition-colors',
                      isActive ? 'bg-emerald-500 text-white' : 'bg-slate-100 border border-slate-200'
                    )}>
                      {isActive && <CheckCircle2 className="w-3.5 h-3.5" />}
                    </div>
                    <span className={cn(
                      'text-sm font-bold transition-colors',
                      isActive ? 'text-emerald-900' : 'text-slate-700'
                    )}>
                      {option.label}
                    </span>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={isActive}
                      onChange={() => toggleSbpBank(option.value)}
                      aria-label={option.label}
                    />
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="grid gap-5 sm:grid-cols-2 max-w-2xl">
            <div className="flex flex-col gap-2">
              <label htmlFor="sbp-phone" className="text-sm font-bold text-slate-700">
                Номер телефона
              </label>
              <input
                {...AUTOFILL_BLOCK_PROPS}
                id="sbp-phone"
                type="tel"
                autoComplete="tel"
                className={cn(
                  'w-full h-12 px-4 rounded-xl border bg-slate-50/50 text-[15px] font-medium text-slate-900 transition-all outline-none',
                  'focus:bg-white focus:border-blue-500 focus:ring-[3px] focus:ring-blue-500/12',
                  'placeholder:text-slate-400 placeholder:font-normal',
                  'user-valid:border-emerald-500',
                  fieldErrors.sbp_phone
                    ? 'border-rose-400 bg-rose-50/30 focus:border-rose-500 focus:ring-rose-500/12'
                    : 'border-slate-200'
                )}
                value={settings.sbp_phone || ''}
                name="sbp_recipient_phone"
                onChange={(event) => {
                  const normalized = normalizePhoneLive(event.target.value);
                  patchSettings({ sbp_phone: normalized });
                  validatePaymentFields({ ...settings, sbp_phone: normalized });
                }}
                onBlur={(event) => {
                  const normalized = normalizePhone(event.target.value);
                  patchSettings({ sbp_phone: normalized });
                  validatePaymentFields({ ...settings, sbp_phone: normalized });
                }}
                placeholder="+7 999 123-45-67"
                inputMode="tel"
                aria-invalid={fieldErrors.sbp_phone ? 'true' : undefined}
                aria-errormessage={fieldErrors.sbp_phone ? 'sbp-phone-error' : undefined}
              />
              {fieldErrors.sbp_phone && (
                <div id="sbp-phone-error" className="text-xs font-bold text-rose-500 mt-1" role="alert">
                  {fieldErrors.sbp_phone}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="sbp-fio" className="text-sm font-bold text-slate-700">
                ФИО получателя
              </label>
              <input
                {...AUTOFILL_BLOCK_PROPS}
                id="sbp-fio"
                type="text"
                autoComplete="name"
                className="w-full h-12 px-4 rounded-xl border border-slate-200 bg-slate-50/50 text-[15px] font-medium text-slate-900 transition-all outline-none focus:bg-white focus:border-blue-500 focus:ring-[3px] focus:ring-blue-500/12 placeholder:text-slate-400 placeholder:font-normal"
                value={settings.sbp_fio || ''}
                name="sbp_recipient_fio"
                onChange={(event) => patchSettings({ sbp_fio: event.target.value })}
                onBlur={(event) => patchSettings({ sbp_fio: event.target.value.trim() })}
                placeholder="Иванов Иван Иванович"
              />
            </div>
          </div>

          <SaveButton saving={saving} onClick={() => saveSettings()} />
        </div>
      </div>

      {/* TON Tab */}
      <div
        role="tabpanel"
        className={tab !== 'ton' ? 'hidden' : ''}
        aria-label="TON кошелек"
      >
        <div className="space-y-6">
          <p className="text-sm text-slate-500 font-medium leading-relaxed">
            Укажите адрес вашего кошелька для автоматического приема криптовалюты в сети The Open Network (TON).
          </p>

          <div className="max-w-md flex flex-col gap-2">
            <label htmlFor="ton-wallet" className="text-sm font-bold text-slate-700">
              Адрес кошелька
            </label>
            <input
              {...AUTOFILL_BLOCK_PROPS}
              id="ton-wallet"
              type="text"
              className={cn(
                'w-full h-12 px-4 rounded-xl border bg-slate-50/50 text-[15px] font-medium text-slate-900 transition-all outline-none',
                'focus:bg-white focus:border-blue-500 focus:ring-[3px] focus:ring-blue-500/12',
                'placeholder:text-slate-400 placeholder:font-normal',
                'user-valid:border-emerald-500',
                fieldErrors.ton_wallet
                  ? 'border-rose-400 bg-rose-50/30 focus:border-rose-500 focus:ring-rose-500/12'
                  : 'border-slate-200'
              )}
              value={settings.ton_wallet || ''}
              name="ton_payout_wallet"
              onChange={(event) => {
                const normalized = normalizeTonWallet(event.target.value);
                patchSettings({ ton_wallet: normalized });
                validatePaymentFields({ ...settings, ton_wallet: normalized });
              }}
              onBlur={(event) => {
                const value = normalizeTonWallet(event.target.value);
                patchSettings({ ton_wallet: value });
                validatePaymentFields({ ...settings, ton_wallet: value });
              }}
              placeholder="UQA..."
              aria-invalid={fieldErrors.ton_wallet ? 'true' : undefined}
              aria-errormessage={fieldErrors.ton_wallet ? 'ton-wallet-error' : undefined}
            />
            {fieldErrors.ton_wallet && (
              <div id="ton-wallet-error" className="text-xs font-bold text-rose-500 mt-1" role="alert">
                {fieldErrors.ton_wallet}
              </div>
            )}
          </div>

          <SaveButton saving={saving} onClick={() => saveSettings()} />
        </div>
      </div>
    </div>
  );
}
