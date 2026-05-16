import { useEffect, useState } from 'react';
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
      ctaHref: '/billing/normal'
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
      ctaHref: '/billing/normal'
    };
  }
  return {
    label: 'Нет плана',
    cls: 'bg-slate-100 text-slate-600',
    endsAt: null,
    days: null,
    expired: false,
    cta: 'Активировать Normal',
    ctaHref: '/billing/normal'
  };
}

export function MyPlanPage() {
  const { user, accessToken, profilePlan, trialEndsAt, normalEndsAt } = useAuth();
  const [billing, setBilling] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!accessToken) { setLoading(false); return; }
    async function load() {
      try {
        const data = await apiRequest('/api/billing/orders/current', { accessToken });
        setBilling(data);
      } catch {
        // billing endpoint may fail for trial users, ignore
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [accessToken]);

  async function checkOrder() {
    if (!billing?.order?.id) return;
    setChecking(true);
    try {
      const data = await apiRequest('/api/billing/orders/current', { accessToken });
      setBilling(data);
    } catch {
      // ignore
    } finally {
      setChecking(false);
    }
  }

  if (!user) {
    return (
      <div className="text-center py-16 space-y-4">
        <p className="text-slate-500">Войдите, чтобы увидеть свой тариф.</p>
        <a className="inline-block text-sm text-indigo-600 hover:underline" href="/?login=1">Войти</a>
      </div>
    );
  }

  const meta = planMeta(profilePlan, trialEndsAt, normalEndsAt);
  const order = billing?.order;

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
          {/* Plan card */}
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
            {meta.cta && (
              <a
                href={meta.ctaHref}
                className="inline-block rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
              >
                {meta.cta}
              </a>
            )}
          </div>

          {/* Pending order */}
          {order && order.status === 'pending' && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-900">
                  Заказ {billing.plan?.title || order.plan_code}
                </span>
                <span className="text-xs font-semibold text-amber-700 bg-amber-100 rounded-md px-2 py-0.5">
                  Ожидает оплату
                </span>
              </div>
              <div className="text-sm text-slate-600">
                {Number(order.amount_rub || 0).toLocaleString('ru-RU')} RUB
                {order.duration_days && ` • ${order.duration_days} дн.`}
              </div>
              <div className="text-xs text-slate-400">
                Создан {formatWhen(order.created_at)}
                {order.expires_at && ` • Счёт действителен до ${formatWhen(order.expires_at)}`}
              </div>
              <div className="flex gap-2 pt-1">
                {order.payment_url && (
                  <a
                    href={order.payment_url}
                    className="inline-block rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
                  >
                    Оплатить
                  </a>
                )}
                <button
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                  type="button"
                  disabled={checking}
                  onClick={checkOrder}
                >
                  {checking ? 'Проверяем...' : 'Проверить статус'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
