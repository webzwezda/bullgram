import { useMemo, useState } from 'react';
import { Check, ChevronDown, ExternalLink, Loader2, QrCode, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

function amountNanoTon(purchase) {
  const nano = String(purchase?.amount_nanoton || '').trim();
  if (/^\d+$/.test(nano)) return nano;
  try {
    return BigInt(Math.round(Number(purchase?.amount_ton || 0) * 1e9)).toString();
  } catch {
    return '';
  }
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
      url: purchase?.ton_uri || `ton://transfer/${addr}?amount=${nano}&text=${encodeURIComponent(memo)}`
    }
  ];
}

function CopyRow({ label, value }) {
  const [copied, setCopied] = useState(false);

  async function copyValue() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Не удалось скопировать');
    }
  }

  return (
    <button
      type="button"
      className="flex min-h-[44px] w-full items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-2 text-left hover:bg-slate-50 transition-colors"
      onClick={copyValue}
    >
      <span className="w-20 shrink-0 text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-xs font-bold text-slate-700">{value}</span>
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-slate-500">
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <span className="h-3.5 w-3.5" aria-hidden />}
        {copied ? 'Ок' : 'Copy'}
      </span>
    </button>
  );
}

export function ManualTonPaymentCard({ purchase, checking = false, onCheck, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  const [qrView, setQrView] = useState('trust');

  const links = useMemo(
    () => buildWalletLinks(purchase),
    [purchase?.seller_wallet, purchase?.amount_nanoton, purchase?.amount_ton, purchase?.memo, purchase?.ton_uri]
  );

  const hasTrustQr = !!purchase?.trust_wallet_qr;
  const hasTonQr = !!purchase?.ton_qr;
  const effectiveQrView = hasTrustQr ? qrView : 'ton';
  const qrSrc = effectiveQrView === 'trust'
    ? (purchase?.trust_wallet_qr || purchase?.ton_qr)
    : (purchase?.ton_qr || purchase?.trust_wallet_qr);

  if (!purchase?.seller_wallet) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-[12px] font-bold text-slate-600 hover:bg-slate-50 transition"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="inline-flex items-center gap-2">
          <QrCode className="size-4 text-slate-400" />
          Оплатить вручную
          <span className="hidden sm:inline font-medium text-slate-400">— Tonkeeper, MyTonWallet, Trust или перевод по реквизитам</span>
        </span>
        <ChevronDown className={`size-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div className="border-t border-slate-100 p-4 space-y-4">
          <p className="text-[12px] text-slate-500">
            Переведи ровно <strong className="text-slate-800 font-mono">{Number(purchase.amount_ton || 0)} TON</strong> с этим memo,
            потом нажми «Проверить оплату».
          </p>

          {links.length ? (
            <div className="flex flex-wrap gap-2">
              {links.map((link) => (
                <a
                  key={link.key}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 transition-all"
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  {link.label}
                </a>
              ))}
            </div>
          ) : null}

          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 space-y-2">
              <CopyRow label="Кошелек" value={purchase.seller_wallet} />
              <CopyRow label="Memo" value={purchase.memo || ''} />
            </div>
            {qrSrc ? (
              <div className="shrink-0 flex flex-col bg-slate-50/50 p-3 rounded-2xl border border-slate-100 w-full md:w-[200px]">
                {hasTrustQr && hasTonQr ? (
                  <div className="flex p-1 bg-slate-100 rounded-xl mb-3 w-full">
                    <button
                      type="button"
                      className={`flex-1 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wide rounded-lg transition-all ${effectiveQrView === 'trust' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                      onClick={() => setQrView('trust')}
                    >
                      Trust
                    </button>
                    <button
                      type="button"
                      className={`flex-1 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wide rounded-lg transition-all ${effectiveQrView === 'ton' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                      onClick={() => setQrView('ton')}
                    >
                      TON
                    </button>
                  </div>
                ) : null}
                <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 mb-2 text-center">
                  {effectiveQrView === 'ton' ? 'QR для TON' : 'QR для Trust'}
                </div>
                <div className="w-full aspect-square rounded-xl border border-slate-100 p-1.5 bg-white">
                  <img
                    className="w-full h-full object-contain mix-blend-multiply"
                    src={qrSrc}
                    alt={effectiveQrView === 'ton' ? 'QR для перевода TON' : 'QR для Trust Wallet'}
                  />
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <button
              type="button"
              className="w-full h-10 inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
              <ShieldCheck className="size-3 text-emerald-500" />
              Memo обязательно — без него платёж не зачтётся
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <Loader2 className="size-3 animate-spin" />
              Статус проверяется автоматически каждые 15 секунд
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
