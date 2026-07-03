import { useEffect, useState } from 'react';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { apiRequest } from '../api/client.js';
import { SUPPORT_TELEGRAM } from '../contacts.js';

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
      ctaHref: SUPPORT_TELEGRAM
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
      ctaHref: SUPPORT_TELEGRAM
    };
  }
  return {
    label: 'Нет плана',
    cls: 'bg-slate-100 text-slate-600',
    endsAt: null,
    days: null,
    expired: false,
    cta: 'Активировать Normal',
    ctaHref: SUPPORT_TELEGRAM
  };
}

export function MyPlanPage() {
  const { user, accessToken, profilePlan, trialEndsAt, normalEndsAt } = useAuth();
  const [billing, setBilling] = useState(null);
  const [loading, setLoading] = useState(true);

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
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
              >
                {meta.cta}
              </a>
            )}
          </div>
        </>
      )}
    </div>
  );
}
