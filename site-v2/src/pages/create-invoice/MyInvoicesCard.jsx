import { useState } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  ExternalLink,
  Receipt,
  RefreshCw,
} from 'lucide-react';
import { Card } from '../../components/ui/card.jsx';

const INVOICE_STATUS = {
  pending: { label: 'Ожидает оплаты', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  paid: { label: 'Оплачен', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  expired: { label: 'Срок истёк', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
};

const DATE_FMT = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

function MyInvoiceRow({ invoice, onOpen }) {
  const [copied, setCopied] = useState(false);
  const status = INVOICE_STATUS[invoice.status] || INVOICE_STATUS.expired;

  const copyLink = async () => {
    const url = `${window.location.origin}/pay/${invoice.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard недоступен — ссылку можно скопировать со страницы счёта
    }
  };

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-colors">
      <button
        type="button"
        onClick={() => onOpen(invoice.id)}
        className="flex-1 min-w-0 text-left"
      >
        <div className="text-sm font-semibold text-slate-900 truncate">{invoice.title || 'Без названия'}</div>
        <div className="text-[11px] text-slate-500 mt-0.5">
          {invoice.created_at ? DATE_FMT.format(new Date(invoice.created_at)) : ''}
        </div>
      </button>
      <div className="shrink-0 text-right">
        {invoice.status === 'unknown' ? (
          <div className="text-[11px] text-slate-500 mt-1">Не удалось загрузить</div>
        ) : (
          <>
            <div className="text-sm font-bold text-slate-900 tabular-nums">
              {Number(invoice.amount_ton)} <span className="text-slate-500 font-semibold">TON</span>
            </div>
            <span className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${status.cls}`}>
              {status.label}
            </span>
          </>
        )}
      </div>
      <div className="shrink-0 flex items-center gap-1.5">
        <button
          type="button"
          onClick={copyLink}
          title="Скопировать ссылку для оплаты"
          className={`inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border text-[11px] font-bold transition-colors ${
            copied
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-100/60'
          }`}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          <span className="hidden sm:inline">{copied ? 'Готово' : 'Ссылка'}</span>
        </button>
        <button
          type="button"
          onClick={() => onOpen(invoice.id)}
          className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-slate-600 text-[11px] font-bold hover:border-slate-300 hover:bg-slate-100/60 transition-colors"
        >
          <ExternalLink className="size-3" />
          <span className="hidden sm:inline">Открыть</span>
        </button>
      </div>
    </div>
  );
}

export function MyInvoicesCard({ items, loading, error, onRetry, onOpen }) {
  const count = items.length;
  return (
    <Card className="p-0 gap-0 border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
      <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
        <div className="flex flex-row items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-slate-700 flex items-center justify-center text-white shadow-md shadow-slate-500/20 shrink-0">
            <Receipt className="w-6 h-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold text-slate-900">Мои счета</h2>
            <p className="text-sm font-medium text-slate-500 mt-0.5">
              {count > 0 ? `Последние ${count} счетов` : 'История ваших счетов'}
            </p>
          </div>
        </div>
      </div>
      <div className="p-5 sm:p-6 bg-white">
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : (
          <>
            {error ? (
              <div className="rounded-xl bg-red-50 border border-red-200 px-3.5 py-3 text-sm text-red-700 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <div className="flex-1">{error}</div>
                <button
                  type="button"
                  onClick={onRetry}
                  className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-red-200 text-red-700 text-xs font-semibold hover:bg-red-50 transition-colors"
                >
                  <RefreshCw className="w-3 h-3" />
                  Повторить
                </button>
              </div>
            ) : null}
            {count > 0 ? (
              <div className={`space-y-2 ${error ? 'mt-3' : ''}`}>
                {items.map((inv) => (
                  <MyInvoiceRow key={inv.id} invoice={inv} onOpen={onOpen} />
                ))}
              </div>
            ) : !error ? (
              <div className="text-center py-8 px-4">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 mx-auto flex items-center justify-center mb-3">
                  <Receipt className="w-6 h-6 text-slate-400" />
                </div>
                <p className="text-sm font-semibold text-slate-700">У вас пока нет счетов</p>
                <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
                  Создай первый — он появится здесь. Неоплаченные счета исчезают из списка после истечения срока.
                </p>
              </div>
            ) : null}
          </>
        )}
      </div>
    </Card>
  );
}
