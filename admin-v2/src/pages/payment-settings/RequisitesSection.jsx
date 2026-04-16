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
      <div className="grid gap-5 xl:items-start xl:grid-cols-[minmax(0,1.18fr)_minmax(290px,0.82fr)]">
        <section className="rounded-[28px] border border-amber-200/70 bg-[linear-gradient(180deg,_rgba(255,255,255,0.98)_0%,_rgba(255,251,245,0.97)_100%)] p-6 shadow-[0_18px_50px_rgba(148,101,40,0.08)] sm:p-7">
          <div className="flex flex-col gap-4 border-b border-slate-200/80 pb-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <div className="-ml-[5px] inline-flex w-fit items-center rounded-full border border-amber-200/80 bg-amber-50 pl-2 pr-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-amber-700">
                Банковские реквизиты
              </div>
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-slate-950">СБП / карта</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                  Банковские реквизиты для получения оплаты в системе быстрых платежей.
                </p>
              </div>
            </div>
            <div className={cn('inline-flex w-fit items-center rounded-full px-3 py-1 text-sm font-medium', requisitesStatusBadgeClass(!!settings.sbp_phone))}>
              {settings.sbp_phone ? 'Готов' : 'Пусто'}
            </div>
          </div>

          <div className="mt-6 grid gap-6">
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-950 text-sm font-semibold text-white">1</div>
                <div>
                  <div className="text-sm font-semibold text-slate-950">Выбор банков</div>
                  <div className="text-sm text-slate-500">Включи один банк или оба сразу. На них покупатель сможет отправить оплату.</div>
                </div>
              </div>
              <div className="field-group">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
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
            </div>

            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-950 text-sm font-semibold text-white">2</div>
                <div>
                  <div className="text-sm font-semibold text-slate-950">Номер телефона и ФИО</div>
                  <div className="text-sm text-slate-500">После выбора банков укажи номер СБП и имя получателя.</div>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="field-group">
                  <span>Номер для СБП</span>
                  <input
                    {...AUTOFILL_BLOCK_PROPS}
                    className={cn('field h-12 rounded-2xl border-slate-200 bg-white/92 text-[15px] shadow-none', fieldErrors.sbp_phone && 'border-rose-300')}
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
                    className="field h-12 rounded-2xl border-slate-200 bg-white/92 text-[15px] shadow-none"
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
        </section>

        <section className="rounded-[28px] border border-sky-200/80 bg-[linear-gradient(180deg,_rgba(255,255,255,0.98)_0%,_rgba(244,250,255,0.98)_100%)] p-6 shadow-[0_18px_50px_rgba(37,99,235,0.08)] sm:p-7">
          <div className="flex flex-col gap-4 border-b border-slate-200/80 pb-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <div className="-ml-[5px] inline-flex w-fit items-center rounded-full border border-sky-200/80 bg-sky-50 pl-2 pr-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-sky-700">
                Криптокошелёк
              </div>
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-slate-950">TON</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  TON адрес на который будет приходить оплата.
                </p>
              </div>
            </div>
            <div className={cn('inline-flex w-fit items-center rounded-full px-3 py-1 text-sm font-medium', requisitesStatusBadgeClass(!!settings.ton_wallet))}>
              {settings.ton_wallet ? 'Готов' : 'Пусто'}
            </div>
          </div>

          <div className="mt-5 space-y-4">
            <label className="field-group">
              <span>TON-кошелек</span>
              <input
                {...AUTOFILL_BLOCK_PROPS}
                className={cn('field h-12 rounded-2xl border-slate-200 bg-white/92 text-[15px] shadow-none', fieldErrors.ton_wallet && 'border-rose-300')}
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
              <div className="table-subtext">Кошелек проверяем сразу, без пробелов и лишнего мусора.</div>
              {fieldErrors.ton_wallet ? <div className="error-inline">{fieldErrors.ton_wallet}</div> : null}
            </label>
          </div>
        </section>

        <div className="flex justify-start xl:col-start-1">
          <Button
            type="button"
            className="h-11 w-full rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white hover:bg-slate-800 sm:w-auto sm:min-w-[220px]"
            onClick={() => saveSettings()}
            disabled={saving}
          >
            {saving ? 'Сохраняем...' : 'Сохранить все реквизиты'}
          </Button>
        </div>
      </div>
    </div>
  );
}
