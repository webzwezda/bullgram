import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
} from 'lucide-react';
import QRCode from 'qrcode';
import { apiRequest } from '../api/client.js';
import { Card } from '../components/ui/card.jsx';
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
  const navigate = useNavigate();
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
      <section className="space-y-6">
        <Card className="p-0 gap-0 border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
          <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
            <div className="flex flex-row items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-slate-200 animate-pulse shrink-0" />
              <div className="space-y-2">
                <div className="h-5 w-48 bg-slate-200 animate-pulse rounded" />
                <div className="h-3 w-64 bg-slate-100 animate-pulse rounded" />
              </div>
            </div>
          </div>
          <div className="p-5 sm:p-6 bg-white space-y-4">
            <div className="h-20 bg-slate-100 animate-pulse rounded-2xl" />
            <div className="h-32 bg-slate-100 animate-pulse rounded-2xl" />
          </div>
        </Card>
      </section>
    );
  }
  if (error) {
    return (
      <section className="space-y-6">
        <Card className="p-0 gap-0 border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
          <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
            <div className="flex flex-row items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-rose-600 flex items-center justify-center text-white shadow-md shadow-rose-500/20 shrink-0">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">Счёт не найден</h2>
                <p className="text-sm font-medium text-slate-500 mt-0.5">{error}</p>
              </div>
            </div>
          </div>
          <div className="p-5 sm:p-6 bg-white">
            <button
              type="button"
              onClick={() => navigate('/create')}
              className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold transition-colors shadow-md shadow-indigo-200"
            >
              Создать новый счёт
            </button>
          </div>
        </Card>
      </section>
    );
  }

  const payUrl = `${typeof window !== 'undefined' ? window.location.origin : 'https://bullgram.xyz'}/pay/${invoice.id}`;
  const isPaid = invoice.status === 'paid';
  const isExpired = invoice.status === 'expired';

  const status = isPaid
    ? { Icon: CheckCircle2, bg: 'bg-emerald-600', shadow: 'shadow-emerald-500/20', title: 'Счёт оплачен', desc: `${Number(invoice.amount_ton || 0)} TON пришли на ваш кошелёк. Секрет ниже — что получил покупатель.` }
    : isExpired
      ? { Icon: Clock, bg: 'bg-slate-500', shadow: 'shadow-slate-400/20', title: 'Срок счёта истёк', desc: 'Создайте новый счёт, если покупка ещё актуальна.' }
      : { Icon: CheckCircle2, bg: 'bg-emerald-600', shadow: 'shadow-emerald-500/20', title: 'Счёт создан', desc: 'Отправьте ссылку покупателю — он оплатит и увидит секрет.' };

  const StatusIcon = status.Icon;

  return (
    <section className="space-y-6">
      <Card className="p-0 gap-0 border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
        <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
          <div className="flex flex-row items-center gap-4">
            <div className={`w-12 h-12 rounded-2xl ${status.bg} flex items-center justify-center text-white shadow-md ${status.shadow} shrink-0`}>
              <StatusIcon className="w-6 h-6" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-bold text-slate-900">{status.title}</h2>
              <p className="text-sm font-medium text-slate-500 mt-0.5">{status.desc}</p>
            </div>
            {!isPaid && !isExpired ? (
              <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white border border-slate-200 text-[11px] font-mono text-slate-600 shrink-0">
                <Clock className="w-3.5 h-3.5" />
                {remaining || '00:00'}
              </span>
            ) : null}
          </div>
        </div>

        {!isExpired ? (
          <div className="p-5 sm:p-6 bg-white space-y-5">
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

            <div className="space-y-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Ссылка для покупателя</div>
              <code className="block text-xs font-mono text-slate-900 bg-slate-50 border border-slate-100 rounded-lg p-3 break-all">
                {payUrl}
              </code>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={onCopyLink}
                  className={`flex-1 inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl text-sm font-bold transition-colors ${
                    copied ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-200'
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
            </div>

            <div className="grid sm:grid-cols-[auto_1fr] gap-4 items-center">
              {linkQr ? (
                <div className="flex flex-col items-center">
                  <img
                    src={linkQr}
                    alt="QR-код ссылки на оплату"
                    className="w-40 h-40 sm:w-44 sm:h-44 rounded-xl bg-white border border-slate-200 p-2"
                  />
                  <span className="text-[10px] text-slate-400 text-center mt-1.5 max-w-[12rem] leading-tight">
                    QR ссылки — наведите камеру покупателя
                  </span>
                </div>
              ) : (
                <div className="w-40 h-40 sm:w-44 sm:h-44 rounded-xl bg-slate-100 animate-pulse self-center" />
              )}

              {!isPaid ? (
                <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <Loader2 className="w-4 h-4 animate-spin text-slate-500 shrink-0" />
                    <span className="text-sm text-slate-600 font-medium">Ожидаем оплату…</span>
                    <a
                      href={payUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-700"
                    >
                      Открыть <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <button
                    type="button"
                    onClick={fetchInvoice}
                    className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg bg-white border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-50 transition-colors w-fit"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Обновить статус
                  </button>
                </div>
              ) : null}
            </div>

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
        ) : null}
      </Card>
    </section>
  );
}
