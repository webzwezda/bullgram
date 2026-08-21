import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, ExternalLink, Loader2, ShieldCheck } from 'lucide-react';

function amountNanoTon(purchase) {
  const nano = String(purchase?.amount_nanoton || '').trim();
  if (/^\d+$/.test(nano)) return nano;
  return String(Math.round(Number(purchase?.amount_ton || 0) * 1e9));
}

function buildWalletLinks(purchase) {
  const addr = purchase?.seller_wallet;
  const memo = purchase?.memo || '';
  if (!addr) return [];
  const nano = amountNanoTon(purchase);
  const tonAmount = Number(purchase?.amount_ton || 0);
  return [
    {
      key: 'tonkeeper',
      label: 'Tonkeeper',
      url: `https://tonkeeper.com/transfer/${addr}?amount=${nano}&text=${encodeURIComponent(memo)}`
    },
    {
      key: 'mytonwallet',
      label: 'MyTonWallet',
      url: `https://app.mytonwallet.io/transfer/${addr}?amount=${nano}&text=${encodeURIComponent(memo)}`
    },
    {
      key: 'trust',
      label: 'Trust Wallet',
      url: `https://link.trustwallet.com/send?asset=c607&address=${addr}&amount=${tonAmount}&memo=${encodeURIComponent(memo)}`
    },
    {
      key: 'ton',
      label: 'TON',
      url: `ton://transfer/${addr}?amount=${nano}&text=${encodeURIComponent(memo)}`
    }
  ];
}

function RequisiteRow({ label, value, copyValue }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const target = copyValue || value;
    if (!target) return;
    try {
      await navigator.clipboard.writeText(target);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard недоступен — значение видно целиком при фокусе
    }
  }

  return (
    <button
      type="button"
      className="group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-slate-50 transition-colors"
      onClick={copy}
    >
      <span className="w-14 shrink-0 text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] font-bold text-slate-700">{value}</span>
      <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors ${
        copied ? 'text-emerald-600' : 'text-slate-300 group-hover:text-slate-500'
      }`}>
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </span>
    </button>
  );
}

export function ManualTonPaymentCard({ purchase, checking = false, error = '', onCheck }) {
  const [qrView, setQrView] = useState('trust');
  const [qrs, setQrs] = useState({ ton: null, trust: null });

  const addr = purchase?.seller_wallet;
  const memo = purchase?.memo || '';
  const nano = amountNanoTon(purchase);
  const tonUrl = addr ? `ton://transfer/${addr}?amount=${nano}&text=${encodeURIComponent(memo)}` : '';
  const trustUrl = addr
    ? `https://link.trustwallet.com/send?asset=c607&address=${addr}&amount=${Number(purchase?.amount_ton || 0)}&memo=${encodeURIComponent(memo)}`
    : '';

  useEffect(() => {
    if (!tonUrl) return;
    let cancelled = false;
    Promise.all([
      QRCode.toDataURL(tonUrl, { margin: 1, width: 360 }),
      QRCode.toDataURL(trustUrl, { margin: 1, width: 360 })
    ])
      .then(([ton, trust]) => {
        if (!cancelled) setQrs({ ton, trust });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tonUrl, trustUrl]);

  if (!addr) return null;

  const links = buildWalletLinks(purchase);
  const effectiveQrView = qrs.trust ? qrView : 'ton';
  const qrSrc = effectiveQrView === 'trust'
    ? (qrs.trust || qrs.ton)
    : (qrs.ton || qrs.trust);
  const amountText = String(Number(purchase.amount_ton || 0));

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex flex-col sm:flex-row">
        <div className="sm:w-[240px] sm:shrink-0 p-4 flex flex-col items-center justify-center gap-2.5 border-b sm:border-b-0 sm:border-r border-slate-100 bg-slate-50/50">
          {qrs.trust && qrs.ton ? (
            <div className="flex p-0.5 bg-slate-200/70 rounded-lg">
              <button
                type="button"
                className={`px-3 py-1 text-[10px] font-extrabold uppercase tracking-wide rounded-md transition-all ${effectiveQrView === 'trust' ? 'bg-white text-sky-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                onClick={() => setQrView('trust')}
              >
                Trust
              </button>
              <button
                type="button"
                className={`px-3 py-1 text-[10px] font-extrabold uppercase tracking-wide rounded-md transition-all ${effectiveQrView === 'ton' ? 'bg-white text-sky-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                onClick={() => setQrView('ton')}
              >
                TON
              </button>
            </div>
          ) : null}
          {qrSrc ? (
            <div className="w-[180px] aspect-square rounded-xl border border-slate-100 p-2 bg-white shadow-sm">
              <img
                className="w-full h-full object-contain mix-blend-multiply"
                src={qrSrc}
                alt={effectiveQrView === 'ton' ? 'QR для перевода TON' : 'QR для Trust Wallet'}
              />
            </div>
          ) : (
            <div className="w-[180px] aspect-square rounded-xl bg-slate-100 animate-pulse" />
          )}
          <p className="text-[11px] text-slate-400 text-center">Отсканируй камерой кошелька</p>
        </div>

        <div className="flex-1 min-w-0 divide-y divide-slate-100">
          <div className="p-2 space-y-0.5">
            <RequisiteRow label="Сумма" value={`${amountText} TON`} copyValue={amountText} />
            <RequisiteRow label="Memo" value={purchase.memo || ''} />
            <RequisiteRow label="Кошелёк" value={purchase.seller_wallet} />
          </div>

          {links.length ? (
            <div className="px-4 py-3 space-y-2">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Или открыть в кошельке</div>
              <div className="grid grid-cols-2 gap-2">
                {links.map((link) => (
                  <a
                    key={link.key}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-[11px] font-bold hover:bg-slate-50 hover:border-slate-300 transition-all"
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink className="size-3 text-slate-400 shrink-0" />
                    {link.label}
                  </a>
                ))}
              </div>
            </div>
          ) : null}

          <div className="p-4 space-y-2">
            {error ? (
              <p className="text-xs text-rose-600 text-center">{error}</p>
            ) : null}
            <button
              type="button"
              className="w-full h-11 inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm shadow-md shadow-indigo-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={onCheck}
              disabled={checking}
            >
              {checking ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Проверяем...
                </>
              ) : 'Проверить оплату'}
            </button>
            <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <ShieldCheck className="size-3 text-emerald-500 shrink-0" />
              Переводи ровно сумму с этим memo — иначе платёж не зачтётся
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <Loader2 className="size-3 animate-spin shrink-0" />
              Статус проверяется автоматически каждые 10 секунд
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
