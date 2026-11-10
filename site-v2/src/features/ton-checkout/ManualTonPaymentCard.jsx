import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { AlertTriangle, Check, Copy, ExternalLink, Loader2 } from 'lucide-react';

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
  const [copyFailed, setCopyFailed] = useState(false);

  async function copy() {
    const target = copyValue || value;
    if (!target) return;
    try {
      await navigator.clipboard.writeText(target);
      setCopyFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      return;
    } catch {
      // clipboard API недоступен (например, вебвью Telegram) — legacy-путь ниже
    }
    try {
      const helper = document.createElement('textarea');
      helper.value = target;
      helper.setAttribute('readonly', '');
      helper.style.position = 'fixed';
      helper.style.opacity = '0';
      document.body.appendChild(helper);
      helper.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(helper);
      if (!ok) throw new Error('copy rejected');
      setCopyFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
      setCopyFailed(true);
      setTimeout(() => setCopyFailed(false), 4000);
    }
  }

  return (
    <button
      type="button"
      className="group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-surface-subtle transition-colors"
      onClick={copy}
      title={copyValue || value}
    >
      <span className="w-[72px] shrink-0 text-[11px] font-black uppercase tracking-widest text-ink-muted">{label}</span>
      <span className={`min-w-0 flex-1 font-mono text-[12px] font-bold text-ink-body ${copyFailed ? 'break-all' : 'truncate'}`}>{value}</span>
      <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors ${
        copied ? 'text-feedback-success-text' : copyFailed ? 'text-feedback-error-text' : 'text-ink-faint group-hover:text-ink-muted'
      }`}>
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </span>
    </button>
  );
}

// «Тихий счёт» (sketch 2026-11-11): без коробок — реквизиты плоскими строками,
// QR и кнопки кошельков рядом, предупреждение warning-парой, CTA — action.ton.
export function ManualTonPaymentCard({ purchase, checking = false, error = '', onCheck }) {
  const [qr, setQr] = useState(null);
  const [qrFailed, setQrFailed] = useState(false);

  const addr = purchase?.seller_wallet;
  const memo = purchase?.memo || '';
  const nano = amountNanoTon(purchase);
  const tonUrl = addr ? `ton://transfer/${addr}?amount=${nano}&text=${encodeURIComponent(memo)}` : '';

  useEffect(() => {
    if (!tonUrl) return;
    let cancelled = false;
    QRCode.toDataURL(tonUrl, { margin: 1, width: 360 })
      .then((dataUrl) => {
        if (!cancelled) {
          setQr(dataUrl);
          setQrFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) setQrFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [tonUrl]);

  if (!addr) {
    return (
      <p className="text-sm text-ink-muted">Продавец не указал кошелёк — оплата переводом недоступна</p>
    );
  }

  const links = buildWalletLinks(purchase);
  const amountText = String(Number(purchase.amount_ton || 0));

  return (
    <div className="space-y-4">
      <div className="space-y-0.5">
        <RequisiteRow label="Сумма" value={`${amountText} TON`} copyValue={amountText} />
        <RequisiteRow label="Memo" value={purchase.memo || ''} />
        <RequisiteRow label="Кошелёк" value={purchase.seller_wallet} />
      </div>

      <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-4">
        <div className="flex flex-col items-center gap-1.5 shrink-0">
          {qr ? (
            <div className="w-[132px] aspect-square rounded-xl border border-border-default p-2 bg-surface-card shadow-sm">
              <img
                className="w-full h-full object-contain mix-blend-multiply"
                src={qr}
                alt="QR для перевода TON с memo"
              />
            </div>
          ) : qrFailed ? (
            <p className="w-[132px] text-[11px] text-ink-muted text-center leading-relaxed">
              QR не построился — открой кошелёк по кнопке рядом
            </p>
          ) : (
            <div className="w-[132px] aspect-square rounded-xl bg-surface-subtle-strong animate-pulse" />
          )}
          <p className="text-[11px] text-ink-muted text-center">Камерой TON-кошелька</p>
        </div>

        {links.length ? (
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-black uppercase tracking-widest text-ink-muted mb-2">Открыть в кошельке</div>
            <div className="grid grid-cols-2 gap-2">
              {links.map((link) => (
                <a
                  key={link.key}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-border-default bg-surface-card text-ink-body text-[11px] font-bold hover:bg-surface-subtle transition-all"
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="size-3 text-ink-faint shrink-0" />
                  {link.label}
                </a>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="space-y-2.5">
        {error ? (
          <p className="text-xs text-feedback-error-text text-center">{error}</p>
        ) : null}
        <div className="rounded-lg bg-feedback-warning-bg px-3 py-2 flex items-start gap-1.5">
          <AlertTriangle className="size-3 text-feedback-warning-text shrink-0 mt-0.5" />
          <span className="text-[11px] font-bold text-feedback-warning-text leading-relaxed">
            Переводи ровно {amountText} TON с этим memo — иначе платёж не зачтётся
          </span>
        </div>
        <button
          type="button"
          className="w-full h-11 inline-flex items-center justify-center gap-2 rounded-xl bg-action-ton hover:bg-action-ton-hover text-action-ton-text font-bold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
        <span className="flex items-center gap-1.5 text-[11px] text-ink-muted">
          <Loader2 className="size-3 animate-spin shrink-0" />
          Статус проверяется автоматически каждые 10 секунд
        </span>
      </div>
    </div>
  );
}
