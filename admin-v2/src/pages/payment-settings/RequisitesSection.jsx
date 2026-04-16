import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  AUTOFILL_BLOCK_PROPS,
  SBP_BANK_OPTIONS
} from './payment-settings.constants.js';
import {
  normalizePhone,
  normalizePhoneLive,
  normalizeTonWallet,
  parseSbpBanks,
  requisitesStatusBadgeClass
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
    <div className="space-y-6">
      <div className="grid gap-5 lg:grid-cols-2">
        {/* TON Wallet */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-950">TON кошелек</h3>
              <p className="mt-1 text-sm text-slate-500">Для приема криптовалюты</p>
            </div>
            {settings.ton_wallet && (
              <span className="text-green-600 text-sm font-medium">✓ Активен</span>
            )}
          </div>

          <label className="field-group">
            <span>Адрес кошелька</span>
            <input
              {...AUTOFILL_BLOCK_PROPS}
              className={cn('field h-11 rounded-xl border-slate-200 bg-slate-50 text-[14px]', fieldErrors.ton_wallet && 'border-rose-300')}
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
            {fieldErrors.ton_wallet ? <div className="error-inline">{fieldErrors.ton_wallet}</div> : null}
          </label>
        </section>

        {/* СБП */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-950">СБП</h3>
              <p className="mt-1 text-sm text-slate-500">Для оплаты с карты</p>
            </div>
            {settings.sbp_phone && (
              <span className="text-green-600 text-sm font-medium">✓ Активен</span>
            )}
          </div>

          <div className="space-y-4">
            <div>
              <span className="text-sm font-medium text-slate-700">Банки</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {SBP_BANK_OPTIONS.map((option) => {
                  const isActive = parseSbpBanks(settings.sbp_bank).includes(option.value);
                  return (
                    <label key={option.value} className="checkbox-pill">
                      <span className="text-sm font-semibold text-slate-950">{option.label}</span>
                      <input
                        type="checkbox"
                        checked={isActive}
                        onChange={() => toggleSbpBank(option.value)}
                        aria-label={option.label}
                      />
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-3">
              <label className="field-group">
                <span>Номер телефона</span>
                <input
                  {...AUTOFILL_BLOCK_PROPS}
                  className={cn('field h-11 rounded-xl border-slate-200 bg-slate-50 text-[14px]', fieldErrors.sbp_phone && 'border-rose-300')}
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
                {fieldErrors.sbp_phone ? <div className="error-inline">{fieldErrors.sbp_phone}</div> : null}
              </label>

              <label className="field-group">
                <span>ФИО получателя</span>
                <input
                  {...AUTOFILL_BLOCK_PROPS}
                  className="field h-11 rounded-xl border-slate-200 bg-slate-50 text-[14px]"
                  value={settings.sbp_fio || ''}
                  name="sbp_recipient_fio"
                  onChange={(event) => patchSettings({ sbp_fio: event.target.value })}
                  onBlur={(event) => patchSettings({ sbp_fio: event.target.value.trim() })}
                  placeholder="Иванов Иван Иванович"
                />
              </label>
            </div>
          </div>
        </section>
      </div>

      <div className="flex justify-start">
        <Button
          type="button"
          className="h-11 w-full rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white hover:bg-slate-800 sm:w-auto sm:min-w-[200px]"
          onClick={() => saveSettings()}
          disabled={saving}
        >
          {saving ? 'Сохраняем...' : 'Сохранить'}
        </Button>
      </div>
    </div>
  );
}
