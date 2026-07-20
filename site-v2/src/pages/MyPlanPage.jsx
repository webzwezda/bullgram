import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { apiRequest } from '../api/client.js';

function formatWhen(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function daysUntil(value) {
  if (!value) return null;
  const diffMs = new Date(value).getTime() - Date.now();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function formatCountdown(value) {
  if (!value) return null;
  const ms = new Date(value).getTime() - Date.now();
  if (ms <= 0) return '00:00';
  const totalSec = Math.floor(ms / 1000);
  const hh = Math.floor(totalSec / 3600);
  const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  return hh > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
}

function planMeta(profilePlan, trialEndsAt, normalEndsAt) {
  if (profilePlan === 'normal') {
    const days = daysUntil(normalEndsAt);
    return {
      label: 'Normal',
      cls: 'bg-emerald-100 text-emerald-800',
      endsAt: normalEndsAt,
      days,
      expired: days !== null && days <= 0,
      cta: days !== null && days <= 30 ? 'Продлить' : null,
      ctaHref: '/pricing'
    };
  }
  if (profilePlan === 'trial') {
    const days = daysUntil(trialEndsAt);
    return {
      label: 'Trial',
      cls: 'bg-amber-100 text-amber-800',
      endsAt: trialEndsAt,
      days,
      expired: days !== null && days <= 0,
      cta: 'Перейти на Normal',
      ctaHref: '/pricing'
    };
  }
  return {
    label: 'Нет плана',
    cls: 'bg-slate-100 text-slate-600',
    endsAt: null,
    days: null,
    expired: false,
    cta: 'Активировать Normal',
    ctaHref: '/pricing'
  };
}

export function MyPlanPage() {
  const { user, accessToken, profilePlan, trialEndsAt, normalEndsAt } = useAuth();
  const [billing, setBilling] = useState(null);
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState('');

  useEffect(() => {
    if (!accessToken) { setLoading(false); return; }
    let cancelled = false;

    async function load() {
      try {
        const data = await apiRequest('/api/billing/orders/current', { accessToken });
        if (cancelled) return;
        setBilling(data);
      } catch {
        // billing endpoint may fail for trial users, ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [accessToken]);

  const pendingOrder = billing?.order?.status === 'pending' ? billing.order : null;

  useEffect(() => {
    if (!pendingOrder?.expires_at || !accessToken) return;
    let cancelled = false;

    setCountdown(formatCountdown(pendingOrder.expires_at));

    const tickInterval = setInterval(() => {
      setCountdown(formatCountdown(pendingOrder.expires_at));
    }, 1000);

    const pollInterval = setInterval(async () => {
      try {
        const data = await apiRequest('/api/billing/orders/current', { accessToken });
        if (cancelled) return;
        const fresh = data?.order;
        if (fresh?.status === 'paid') {
          window.location.reload();
          return;
        }
        if (fresh?.status !== 'pending') {
          setBilling(data);
        }
      } catch {
        // network hiccup, retry next tick
      }
    }, 15_000);

    return () => {
      cancelled = true;
      clearInterval(tickInterval);
      clearInterval(pollInterval);
    };
  }, [pendingOrder?.id, pendingOrder?.expires_at, accessToken]);

  if (!user) {
    return (
      <div className="text-center py-16 space-y-4">
        <p className="text-slate-500">Войдите, чтобы увидеть свой тариф.</p>
        <a className="inline-block text-sm text-indigo-600 hover:underline" href="/?login=1">Войти</a>
      </div>
    );
  }

  const meta = planMeta(profilePlan, trialEndsAt, normalEndsAt);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Мой тариф</h1>
        <p className="text-sm text-slate-500 mt-1">Текущий план, дата окончания и оплата.</p>
      </div>

      {loading ? (
        <div className="text-center py-8 text-slate-400">Загружаем...</div>
      ) : (
        <>
          {pendingOrder ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-700">
                  Счёт ожидает оплаты
                </span>
                <span className="font-mono tabular-nums text-sm font-bold text-amber-900">
                  {countdown || '—'}
                </span>
              </div>
              <p className="text-sm text-amber-900">
                У вас есть неоплаченный счёт на Normal. Завершите оплату до истечения таймера — после этого тариф активируется автоматически.
              </p>
              <div className="flex flex-wrap gap-2">
                <Link
                  to={`/pay/${pendingOrder.id}`}
                  className="inline-block rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700 transition-colors"
                >
                  Завершить оплату
                </Link>
                <Link
                  to="/pricing"
                  className="inline-block rounded-xl bg-white px-4 py-2 text-sm font-semibold text-amber-800 ring-1 ring-inset ring-amber-300 hover:bg-amber-100 transition-colors"
                >
                  К тарифам
                </Link>
              </div>
            </div>
          ) : null}

          <div className={`rounded-2xl border p-5 space-y-3 ${meta.expired ? 'border-rose-200 bg-rose-50/50' : 'border-slate-200 bg-white'}`}>
            <div className="flex items-center justify-between">
              <span className={`inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-semibold ${meta.cls}`}>
                {meta.label}
              </span>
              {meta.days !== null && (
                <span className={`text-sm font-medium ${meta.expired ? 'text-rose-600' : meta.days <= 7 ? 'text-amber-600' : 'text-slate-500'}`}>
                  {meta.expired ? 'Истёк' : `${meta.days} дн.`}
                </span>
              )}
            </div>
            {meta.endsAt && (
              <div className="text-sm text-slate-600">
                {meta.expired ? 'Истёк ' : 'Активен до '}{formatWhen(meta.endsAt)}
              </div>
            )}
            {meta.expired && (
              <div className="text-sm text-rose-700">Срок действия истёк. Активируйте Normal для продолжения работы.</div>
            )}
            {meta.cta ? (
              <Link
                to={meta.ctaHref}
                className="inline-block rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
              >
                {meta.cta}
              </Link>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
