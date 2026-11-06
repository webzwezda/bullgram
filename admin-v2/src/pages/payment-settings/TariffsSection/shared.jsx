import { Link } from 'react-router-dom';
import { Wallet } from 'lucide-react';
import { toast } from 'sonner';

/* ---------------- small UI primitives ---------------- */

export function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        checked ? 'bg-indigo-600' : 'bg-slate-200'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

export function FieldLabel({ children, required }) {
  return (
    <label className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5 mb-1.5">
      {children}
      {required && <span className="text-rose-500">*</span>}
    </label>
  );
}

export function ErrorText({ children }) {
  if (!children) return null;
  return <div className="text-xs text-rose-600 font-semibold mt-1">{children}</div>;
}

export function priceBadgeClass(currency) {
  if (currency === 'TON') return 'bg-slate-900 text-white border-0';
  // Легаси-RUB цены — исторические данные, тон амбера отличает их от актуальных TON-цен.
  if (currency === 'RUB') return 'bg-amber-50 text-amber-700 border border-amber-200';
  return 'bg-slate-100 text-slate-700 border border-slate-200';
}

export function currencyGlyph(currency) {
  if (currency === 'TON') return 'TON';
  if (currency === 'RUB') return '₽';
  return currency;
}

/* ---------------- destination wallet ---------------- */

function shortTonAddress(addr) {
  const t = String(addr || '');
  return t.length > 16 ? `${t.slice(0, 8)}…${t.slice(-6)}` : t;
}

/**
 * Показывает, куда физически уйдут деньги от покупателя (payment_settings.ton_wallet),
 * чтобы владелец мог визуально сверить «свой ли кошелёк» до публикации тарифа.
 * Данные тянутся один раз в TariffsSection и приходят пропсами — состояние кошелька
 * также блокирует сабмит платного тарифа в CreateTariffPanel.
 */
export function MoneyDestinationNote({ wallet, loaded }) {
  if (!loaded) return null;

  async function copyWallet() {
    try {
      await navigator.clipboard.writeText(wallet);
      toast.success(`Кошелёк скопирован: ${shortTonAddress(wallet)}`);
    } catch {
      toast.error('Не удалось скопировать кошелёк');
    }
  }

  if (!wallet) {
    return (
      <div className="flex items-start gap-2 text-left text-xs font-medium text-amber-700 bg-amber-50 p-3 rounded-xl border border-amber-200">
        <Wallet className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          Кошелёк для приёма оплат ещё не указан — покупателям&nbsp;некуда платить.
          Задайте его в{' '}
          <Link to="/billing" className="link-action">Кассе → Реквизиты</Link>.
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 text-left text-xs font-medium text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-200">
      <Wallet className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" />
      <div className="min-w-0">
        <span>
          Оплаты приходят на ваш кошелёк:{' '}
          <code
            className="font-mono font-bold text-slate-900 select-all"
            title={wallet}
          >
            {shortTonAddress(wallet)}
          </code>{' '}
          <button
            type="button"
            onClick={copyWallet}
            className="link-action"
          >
            копировать
          </button>
        </span>
        <span className="block mt-0.5">
          Это не ваш кошелёк или хотите сменить?{' '}
          <Link to="/billing" className="link-action">Проверьте реквизиты в Кассе</Link>.
        </span>
      </div>
    </div>
  );
}
