import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CreditCard, Wallet, CheckCircle2, AlertCircle } from 'lucide-react';
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

export function RequisitesSection({
  fieldErrors,
  patchSettings,
  saveSettings,
  saving,
  settings,
  toggleSbpBank,
  validatePaymentFields
}) {
  return (
    <div className="max-w-5xl pt-6 space-y-6">
      
      {/* TON Wallet */}
      <section className="bg-white border border-slate-200/60 rounded-3xl p-6 md:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] relative overflow-hidden transition-all hover:border-slate-300/60">
        <div className="flex flex-col md:flex-row gap-8">
          
          <div className="md:w-1/3 shrink-0">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center border border-blue-100">
                <Wallet className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">TON кошелек</h3>
                {settings.ton_wallet ? (
                  <div className="inline-flex items-center gap-1.5 text-emerald-600 text-xs font-bold mt-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Активен
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-1.5 text-slate-400 text-xs font-bold mt-1">
                    <AlertCircle className="w-3.5 h-3.5" /> Не заполнен
                  </div>
                )}
              </div>
            </div>
            <p className="text-sm text-slate-500 font-medium leading-relaxed">
              Укажите адрес вашего кошелька для автоматического приема криптовалюты в сети The Open Network (TON).
            </p>
          </div>

          <div className="flex-1">
            <div className="max-w-md">
              <label className="flex flex-col gap-2">
                <span className="text-sm font-bold text-slate-700">Адрес кошелька</span>
                <input
                  {...AUTOFILL_BLOCK_PROPS}
                  className={cn(
                    'w-full h-12 px-4 rounded-xl border bg-slate-50/50 text-[15px] font-medium text-slate-900 transition-colors focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 placeholder:text-slate-400 placeholder:font-normal',
                    fieldErrors.ton_wallet ? 'border-rose-300 focus:ring-rose-500/20 focus:border-rose-500 bg-rose-50/30' : 'border-slate-200'
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
                  aria-invalid={fieldErrors.ton_wallet ? 'true' : 'false'}
                />
                {fieldErrors.ton_wallet && <div className="text-xs font-bold text-rose-500 mt-1">{fieldErrors.ton_wallet}</div>}
              </label>
            </div>
          </div>

        </div>
      </section>

      {/* СБП */}
      <section className="bg-white border border-slate-200/60 rounded-3xl p-6 md:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] relative overflow-hidden transition-all hover:border-slate-300/60">
        <div className="flex flex-col md:flex-row gap-8">
          
          <div className="md:w-1/3 shrink-0">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center border border-emerald-100">
                <CreditCard className="w-6 h-6 text-emerald-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Перевод по СБП</h3>
                {settings.sbp_phone ? (
                  <div className="inline-flex items-center gap-1.5 text-emerald-600 text-xs font-bold mt-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Активен
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-1.5 text-slate-400 text-xs font-bold mt-1">
                    <AlertCircle className="w-3.5 h-3.5" /> Не заполнен
                  </div>
                )}
              </div>
            </div>
            <p className="text-sm text-slate-500 font-medium leading-relaxed">
              Реквизиты для приема рублевых платежей. Покупатели будут переводить деньги по номеру телефона через Систему Быстрых Платежей.
            </p>
          </div>

          <div className="flex-1">
            <div className="space-y-6">
              
              <div>
                <span className="block text-sm font-bold text-slate-700 mb-3">Банки получателя</span>
                <div className="flex flex-wrap gap-2.5">
                  {SBP_BANK_OPTIONS.map((option) => {
                    const isActive = parseSbpBanks(settings.sbp_bank).includes(option.value);
                    return (
                      <label 
                        key={option.value} 
                        className={`
                          relative flex items-center gap-2.5 px-3 py-2 rounded-xl border cursor-pointer transition-all duration-200 select-none
                          ${isActive 
                            ? 'bg-emerald-50/50 border-emerald-200/80 shadow-[0_2px_10px_-2px_rgba(16,185,129,0.1)]' 
                            : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'}
                        `}
                      >
                        <div className={`
                          w-5 h-5 rounded-md flex items-center justify-center transition-colors
                          ${isActive ? 'bg-emerald-500 text-white' : 'bg-slate-100 border border-slate-200'}
                        `}>
                          {isActive && <CheckCircle2 className="w-3.5 h-3.5" />}
                        </div>
                        <span className={`text-sm font-bold ${isActive ? 'text-emerald-900' : 'text-slate-700'}`}>
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
              </div>

              <div className="grid gap-5 md:grid-cols-2 max-w-2xl">
                <label className="flex flex-col gap-2">
                  <span className="text-sm font-bold text-slate-700">Номер телефона</span>
                  <input
                    {...AUTOFILL_BLOCK_PROPS}
                    className={cn(
                      'w-full h-12 px-4 rounded-xl border bg-slate-50/50 text-[15px] font-medium text-slate-900 transition-colors focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 placeholder:text-slate-400 placeholder:font-normal',
                      fieldErrors.sbp_phone ? 'border-rose-300 focus:ring-rose-500/20 focus:border-rose-500 bg-rose-50/30' : 'border-slate-200'
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
                    aria-invalid={fieldErrors.sbp_phone ? 'true' : 'false'}
                  />
                  {fieldErrors.sbp_phone && <div className="text-xs font-bold text-rose-500 mt-1">{fieldErrors.sbp_phone}</div>}
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-sm font-bold text-slate-700">ФИО получателя</span>
                  <input
                    {...AUTOFILL_BLOCK_PROPS}
                    className="w-full h-12 px-4 rounded-xl border border-slate-200 bg-slate-50/50 text-[15px] font-medium text-slate-900 transition-colors focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 placeholder:text-slate-400 placeholder:font-normal"
                    value={settings.sbp_fio || ''}
                    name="sbp_recipient_fio"
                    onChange={(event) => patchSettings({ sbp_fio: event.target.value })}
                    onBlur={(event) => patchSettings({ sbp_fio: event.target.value.trim() })}
                    placeholder="Иванов Иван Иванович"
                  />
                </label>
              </div>

            </div>
          </div>

        </div>
      </section>

      <div className="pt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-t border-slate-200/80">
        <div className="text-sm text-slate-500 font-medium">
          Изменения применяются мгновенно ко всем новым заказам
        </div>
        <button
          type="button"
          className="h-12 px-8 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[15px] font-bold shadow-sm shadow-blue-500/20 transition-all active:scale-[0.98] disabled:opacity-70 disabled:pointer-events-none w-full sm:w-auto"
          onClick={() => saveSettings()}
          disabled={saving}
        >
          {saving ? 'Сохраняем...' : 'Сохранить реквизиты'}
        </button>
      </div>
    </div>
  );
}
