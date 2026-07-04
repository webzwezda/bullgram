import { Wallet, Landmark } from 'lucide-react';
import {
  AUTOFILL_BLOCK_PROPS
} from './payment-settings.constants.js';
import {
  normalizeTonWallet
} from './payment-settings.utils.js';

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
  validatePaymentFields,
  plain = false
}) {
  return (
    <div className={plain ? "@container space-y-6" : "@container bg-white border border-slate-200/60 rounded-3xl p-6 md:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)]"}>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20 shrink-0">
          <Landmark className="w-5 h-5" />
        </div>
        <h3 className="text-lg font-bold text-slate-900">Реквизиты для оплаты</h3>
      </div>

      <div className="space-y-6">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
          <Wallet className="w-4 h-4 text-slate-500" />
          TON кошелек
        </div>

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
            className={`w-full h-12 px-4 rounded-xl border bg-slate-50/50 text-[15px] font-medium text-slate-900 transition-all outline-none focus:bg-white focus:border-blue-500 focus:ring-[3px] focus:ring-blue-500/12 placeholder:text-slate-400 placeholder:font-normal user-valid:border-emerald-500 ${
              fieldErrors.ton_wallet
                ? 'border-rose-400 bg-rose-50/30 focus:border-rose-500 focus:ring-rose-500/12'
                : 'border-slate-200'
            }`}
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
  );
}
