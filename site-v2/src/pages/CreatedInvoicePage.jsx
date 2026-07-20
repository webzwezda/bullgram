import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
} from 'lucide-react';
import QRCode from 'qrcode';
import { apiRequest } from '../api/client.js';
import { SecretRevealBlock } from '../components/SecretRevealBlock.jsx';

const POLL_INTERVAL_MS = 5000;
const PUBLIC_VIEW_ENDPOINT = (id) => `/api/public-invoices/public/${id}/public-view`;

function formatRemaining(expiresAt) {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return '00:00';
  const totalSec = Math.floor(ms / 1000);
  const hh = Math.floor(totalSec / 3600);
  const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  return hh > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function CreatedInvoicePage() {
  const { id } = useParams();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [linkQr, setLinkQr] = useState(null);
  const [remaining, setRemaining] = useState(null);
  const timerRef = useRef(null);

  const fetchInvoice = useCallback(async () => {
    try {
      const data = await apiRequest(PUBLIC_VIEW_ENDPOINT(id));
      setInvoice(data);
      setError('');
    } catch (e) {
      setError(e.message || 'Не удалось загрузить счёт');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchInvoice();
  }, [fetchInvoice]);

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (invoice?.status === 'pending' && !error) {
      timerRef.current = setInterval(fetchInvoice, POLL_INTERVAL_MS);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [invoice?.status, invoice?.id, error, fetchInvoice]);

  useEffect(() => {
    if (!invoice?.expires_at) return;
    setRemaining(formatRemaining(invoice.expires_at));
    const t = setInterval(() => setRemaining(formatRemaining(invoice.expires_at)), 1000);
    return () => clearInterval(t);
  }, [invoice?.expires_at]);

  useEffect(() => {
    if (!invoice?.id) return;
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://bullgram.xyz';
    const url = `${origin}/pay/${invoice.id}`;
    QRCode.toDataURL(url, { margin: 1, width: 320 })
      .then(setLinkQr)
      .catch(() => setLinkQr(null));
  }, [invoice?.id]);

  const onCopyLink = async () => {
    if (!invoice?.id) return;
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://bullgram.xyz';
    const url = `${origin}/pay/${invoice.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const onShareTelegram = () => {
    if (!invoice?.id) return;
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://bullgram.xyz';
    const url = `${origin}/pay/${invoice.id}`;
    const text = `Счёт на ${Number(invoice.amount_ton || 0)} TON`;
    window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`, '_blank');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="rounded-2xl bg-white border border-slate-200 p-6 max-w-md w-full text-center">
          <div className="w-12 h-12 rounded-2xl bg-rose-50 border border-rose-100 flex items-center justify-center mb-3 mx-auto">
            <AlertCircle className="w-6 h-6 text-rose-500" />
          </div>
          <h3 className="text-base font-bold text-slate-900 mb-1">Счёт не найден</h3>
          <p className="text-sm text-slate-500 mb-4">{error}</p>
        </div>
      </div>
    );
  }

  const payUrl = `${typeof window !== 'undefined' ? window.location.origin : 'https://bullgram.xyz'}/pay/${invoice.id}`;
  const isPaid = invoice.status === 'paid';
  const isExpired = invoice.status === 'expired';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-10">
        <header className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-sm">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="leading-tight">
              <div className="font-black text-slate-900 text-sm">Bullgram</div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">Счёт создан</div>
            </div>
          </div>
          {!isPaid && !isExpired ? (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white border border-slate-200 text-[11px] font-mono text-slate-600">
              <Clock className="w-3.5 h-3.5" />
              {remaining || '00:00'}
            </div>
          ) : null}
        </header>

        <div className="rounded-3xl bg-white border border-slate-200 p-6 sm:p-8 shadow-sm space-y-6">
          {isPaid ? (
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center mb-4 mx-auto">
                <CheckCircle2 className="w-8 h-8 text-emerald-500" />
              </div>
              <h1 className="text-2xl font-black tracking-tight text-slate-900 mb-1">Счёт оплачен</h1>
              <p className="text-sm text-slate-500 max-w-sm mx-auto">
                {Number(invoice.amount_ton || 0)} TON пришли на ваш кошелёк.
                Секрет ниже — что получил покупатель.
              </p>
            </div>
          ) : isExpired ? (
            <div className="text-center">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center mb-4 mx-auto">
                <Clock className="w-7 h-7 text-slate-400" />
              </div>
              <h1 className="text-xl font-black tracking-tight text-slate-900 mb-1">Срок счёта истёк</h1>
              <p className="text-sm text-slate-500 max-w-sm mx-auto">
                Создайте новый счёт, если покупка ещё актуальна.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                </div>
                <div>
                  <h1 className="text-xl font-black tracking-tight text-slate-900">Счёт создан</h1>
                  <p className="text-sm text-slate-500 mt-0.5">
                    Отправьте ссылку покупателю — он оплатит и увидит секрет.
                  </p>
                </div>
              </div>

              <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Сумма</div>
                <div className="text-2xl font-black tracking-tight text-slate-900">
                  {Number(invoice.amount_ton || 0)}
                  <span className="text-sm font-bold text-slate-500 ml-1.5">TON</span>
                  {invoice.network === 'testnet' ? (
                    <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-md bg-orange-100 text-orange-700 text-[10px] font-bold uppercase tracking-wider">
                      Testnet
                    </span>
                  ) : null}
                </div>
                {invoice.item_title ? (
                  <div className="text-sm text-slate-600">{invoice.item_title}</div>
                ) : null}
              </div>
            </>
          )}

          {!isExpired ? (
            <div className="rounded-2xl border border-slate-200 p-4 space-y-3 bg-white">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Ссылка для покупателя</div>
              <code className="block text-xs font-mono text-slate-900 bg-slate-50 border border-slate-100 rounded-lg p-3 break-all">
                {payUrl}
              </code>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={onCopyLink}
                  className={`flex-1 inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl text-sm font-bold transition-colors ${
                    copied ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-900 text-white hover:bg-slate-800'
                  }`}
                >
                  {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Скопировано' : 'Скопировать ссылку'}
                </button>
                <button
                  type="button"
                  onClick={onShareTelegram}
                  className="flex-1 inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl bg-white border border-slate-200 text-slate-700 text-sm font-bold hover:bg-slate-50 transition-colors"
                >
                  <Send className="w-4 h-4" />
                  Поделиться в Telegram
                </button>
              </div>
              {linkQr ? (
                <div className="flex flex-col items-center pt-2">
                  <img
                    src={linkQr}
                    alt="QR-код ссылки на оплату"
                    className="w-44 h-44 rounded-xl bg-white border border-slate-200 p-2"
                  />
                  <span className="text-[10px] text-slate-400 text-center mt-1.5 max-w-[12rem] leading-tight">
                    QR самой ссылки — наведите камеру покупателя
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}

          {!isPaid && !isExpired ? (
            <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 flex items-center gap-3">
              <Loader2 className="w-4 h-4 animate-spin text-slate-500 shrink-0" />
              <span className="text-sm text-slate-600 font-medium">Ожидаем оплату…</span>
              <a
                href={payUrl}
                target="_blank"
                rel="noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-slate-700 hover:text-slate-900"
              >
                Открыть <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          ) : null}

          {isPaid && invoice.secret_payload ? (
            <SecretRevealBlock secret={invoice.secret_payload} title="Секрет (для истории)" />
          ) : null}

          {isPaid ? null : (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 leading-relaxed">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
                <p>
                  Сохраните эту страницу в закладки — без аккаунта восстановить ссылку нельзя.
                  Платформа не хранит ваши счета дольше 90 дней.
                </p>
              </div>
            </div>
          )}
        </div>

        {!isPaid && !isExpired ? (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={fetchInvoice}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-700 hover:bg-white transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Обновить статус
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
