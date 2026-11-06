import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock, Copy, Download, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { APP_CONFIG } from '../../config.js';
import { Card } from '../../components/ui/card.jsx';
import { SecretRevealBlock } from '../../components/SecretRevealBlock.jsx';

// Выдача аккаунтных лотов: окно скачивания архива из shop-покупки
function formatWindowRemaining(windowEndsAt, now) {
  if (!windowEndsAt) return null;
  const ms = new Date(windowEndsAt).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const minutes = Math.floor(ms / 60000);
  const days = Math.floor(minutes / (60 * 24));
  const hours = Math.floor((minutes % (60 * 24)) / 60);
  if (days > 0) return `${days} д ${hours} ч`;
  if (hours > 0) return `${hours} ч ${minutes % 60} мин`;
  return `${minutes} мин`;
}

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} МБ`;
  if (n >= 1024) return `${Math.round(n / 1024)} КБ`;
  return `${n} Б`;
}

function ShopDeliveryBlock({ purchaseId, delivery, onRefresh }) {
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const isFilesMode = delivery.mode === 'files';
  const windowEndsAt = delivery.window_ends_at || null;
  const remaining = isFilesMode ? formatWindowRemaining(windowEndsAt, now) : null;
  const windowExpired = Boolean(isFilesMode && windowEndsAt && !remaining);

  useEffect(() => {
    if (!isFilesMode || !windowEndsAt) return undefined;
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [isFilesMode, windowEndsAt]);

  const onCopySha = async () => {
    try {
      await navigator.clipboard.writeText(delivery.sha256 || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  // Обычная загрузка файла браузером: ключ доступа — id покупки в URL, без авторизации
  const onDownloadClick = () => {
    setTimeout(() => onRefresh?.(), 1500);
  };

  const sha = delivery.sha256 || '';
  const shortSha = sha.length > 20 ? `${sha.slice(0, 10)}…${sha.slice(-6)}` : sha;
  const sizeLabel = formatBytes(delivery.size_bytes);
  const downloadsUsed = Number(delivery.downloads_used ?? 0);
  const downloadsMax = Number(delivery.downloads_max ?? 0);
  const downloadHref = `${APP_CONFIG.backendUrl}/api/shop/public/purchase/${purchaseId}/download`;

  if (!delivery.available) {
    return (
      <div className="rounded-2xl border border-border-default bg-surface-subtle p-4">
        <div className="flex items-center gap-2 text-sm font-bold text-ink-strong">
          <Download className="h-4 w-4 text-ink-muted" aria-hidden="true" />
          Скачать аккаунт
        </div>
        <p className="mt-1 text-sm font-medium leading-6 text-ink-muted">
          {delivery.reason || 'Выдача пока недоступна.'}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border-default bg-surface-subtle p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-bold text-ink-strong">
          <Download className="h-4 w-4 text-action-primary" aria-hidden="true" />
          Скачать аккаунт{delivery.label ? `: ${delivery.label}` : ''}
        </div>
        {Number.isFinite(downloadsMax) && downloadsMax > 0 ? (
          <span className="shrink-0 text-xs font-semibold text-ink-muted tabular-nums">
            Скачиваний: {downloadsUsed} из {downloadsMax}
          </span>
        ) : null}
      </div>

      {isFilesMode ? (
        windowExpired ? (
          <div className="inline-flex items-center gap-1.5 rounded-md bg-feedback-error-bg px-2 py-1 text-xs font-bold text-feedback-error-text">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            Окно выдачи истекло
          </div>
        ) : remaining ? (
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-ink-body">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-feedback-warning-bg px-2 py-1 text-feedback-warning-text tabular-nums">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              Окно выдачи: {remaining}
            </span>
            <span className="text-ink-muted">Архив с данными доступен, пока идёт окно выдачи.</span>
          </div>
        ) : null
      ) : (
        <p className="text-xs font-medium leading-5 text-ink-muted">
          Аккаунт закреплён за тобой в кабинете — архив можно скачать без ограничения по времени.
        </p>
      )}

      {sha ? (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-border-default bg-surface-card px-3 py-2">
          <span className="min-w-0 truncate font-mono text-xs text-ink-body" title={`SHA-256: ${sha}`}>
            sha256 {shortSha}
          </span>
          <button
            type="button"
            onClick={onCopySha}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-bold text-action-primary transition hover:bg-surface-subtle"
            aria-label="Скопировать SHA-256 архива"
          >
            {copied ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
            {copied ? 'Скопировано' : 'Копировать'}
          </button>
        </div>
      ) : null}
      {sizeLabel ? (
        <p className="text-xs font-medium text-ink-muted tabular-nums">Размер архива: {sizeLabel}</p>
      ) : null}

      <a
        href={downloadHref}
        download
        onClick={onDownloadClick}
        className={`inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold transition-colors ${
          windowExpired
            ? 'pointer-events-none bg-surface-subtle-strong text-ink-faint'
            : 'bg-action-primary text-action-primary-text shadow-md hover:bg-action-primary-hover'
        }`}
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        Скачать аккаунт
      </a>
    </div>
  );
}

export function SkeletonView() {
  return (
    <section className="space-y-6">
      <Card className="p-0 gap-0 border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
        <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
          <div className="flex flex-row items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-slate-200 animate-pulse shrink-0" />
            <div className="space-y-2">
              <div className="h-5 w-40 bg-slate-200 animate-pulse rounded" />
              <div className="h-3 w-56 bg-slate-100 animate-pulse rounded" />
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

export function ErrorView({ message, onRetry }) {
  return (
    <section className="space-y-6">
      <Card className="p-0 gap-0 border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
        <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
          <div className="flex flex-row items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-red-600 flex items-center justify-center text-white shadow-md shadow-red-500/20 shrink-0">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">Не удалось загрузить счёт</h2>
              <p className="text-sm font-medium text-slate-500 mt-0.5">{message}</p>
            </div>
          </div>
        </div>
        <div className="p-5 sm:p-6 bg-white">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold transition-colors shadow-md shadow-indigo-200"
          >
            <RefreshCw className="w-4 h-4" />
            Повторить
          </button>
        </div>
      </Card>
    </section>
  );
}

function formatBillingEndDate(durationDays) {
  if (!durationDays) return null;
  const date = new Date(Date.now() + Number(durationDays) * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' }).format(date);
}

export function PaidView({ purchase, processing, purchaseKind, fulfillmentStatus, onRefresh }) {
  const isBilling = purchaseKind === 'billing';
  const redirecting = isBilling && !processing && fulfillmentStatus === 'completed';
  const shopDelivery = purchaseKind === 'shop' && purchase?.delivery ? purchase.delivery : null;

  // Флоу владельца: Pro оплачен и аккаунт выдан → пользователь сам попадает в кабинет
  useEffect(() => {
    if (!redirecting) return;
    const t = setTimeout(() => window.location.assign('/userbot'), 2500);
    return () => clearTimeout(t);
  }, [redirecting]);

  const title = isBilling ? 'Тариф Pro активирован' : processing ? 'Платёж получен' : 'Счёт оплачен';
  const description = isBilling ? (
    <>
      Доступ открыт до {formatBillingEndDate(purchase.duration_days) || '—'}
      {purchase.duration_days ? ` (${purchase.duration_days} дн.)` : null}.
    </>
  ) : processing ? (
    `${purchase.item_title || 'Заказ'} оплачен на ${Number(purchase.amount_ton || 0)} TON. Подписка активируется в течение нескольких минут — если доступ не пришёл, нажмите «Проверить оплату» в боте.`
  ) : shopDelivery?.available ? (
    `${purchase.item_title || 'Заказ'} оплачен на ${Number(purchase.amount_ton || 0)} TON. Архив с данными готов к скачиванию.`
  ) : (
    `${purchase.item_title || 'Заказ'} оплачен на ${Number(purchase.amount_ton || 0)} TON. Доступ активирован в течение нескольких минут.`
  );

  return (
    <section className="space-y-6">
      <Card className="p-0 gap-0 border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
        <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
          <div className="flex flex-row items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-600 flex items-center justify-center text-white shadow-md shadow-emerald-500/20 shrink-0">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-bold text-slate-900">{title}</h2>
              <p className="text-sm font-medium text-slate-500 mt-0.5">{description}</p>
              {isBilling ? (
                <p className="text-sm font-medium text-slate-500 mt-1">
                  {fulfillmentStatus === 'completed'
                    ? 'Юзербот и прокси закреплены за вами — открываем кабинет…'
                    : 'Юзербот и прокси из тарифа выдадутся автоматически и появятся в кабинете.'}
                </p>
              ) : null}
            </div>
          </div>
        </div>
        <div className="p-5 sm:p-6 bg-white space-y-4">
          {isBilling ? (
            <a
              href="/userbot"
              className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold transition-colors shadow-md shadow-indigo-200"
            >
              Открыть свой аккаунт
              <ExternalLink className="w-4 h-4" />
            </a>
          ) : null}
          {purchaseKind === 'public_invoice' && purchase.secret_payload ? (
            <SecretRevealBlock secret={purchase.secret_payload} />
          ) : null}
          {shopDelivery ? (
            <ShopDeliveryBlock
              purchaseId={purchase.id}
              delivery={shopDelivery}
              onRefresh={onRefresh}
            />
          ) : null}
        </div>
      </Card>
    </section>
  );
}

export function ExpiredView({ canVerifyPayment, verifying, message, onVerify }) {
  return (
    <section className="space-y-6">
      <Card className="p-0 gap-0 border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
        <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
          <div className="flex flex-row items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-slate-500 flex items-center justify-center text-white shadow-md shadow-slate-400/20 shrink-0">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">Срок оплаты истёк</h2>
              <p className="text-sm font-medium text-slate-500 mt-0.5">
                Создайте новый счёт, чтобы продолжить оплату.
              </p>
            </div>
          </div>
        </div>
        {canVerifyPayment ? (
          <div className="p-5 sm:p-6 bg-white space-y-3">
            <p className="text-sm font-medium text-slate-500">
              Если вы уже отправили перевод — деньги не пропадут, проверим.
            </p>
            <button
              type="button"
              onClick={onVerify}
              disabled={verifying}
              className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold transition-colors shadow-md shadow-indigo-200 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Проверить оплату
            </button>
            {message ? (
              <p className="text-sm font-medium text-red-700">{message}</p>
            ) : null}
          </div>
        ) : null}
      </Card>
    </section>
  );
}
