import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, Clock3, CreditCard, FileText, RefreshCw, ShieldCheck } from 'lucide-react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';

const offerHref = '/docs/oferta_270415104864.docx';

function formatRub(value) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function BillingNormalPage() {
  const { accessToken, profilePlan, normalEndsAt } = useAuth();
  const [state, setState] = useState({
    loading: true,
    busy: false,
    error: '',
    plan: null,
    order: null,
    readiness: null,
    profile: null
  });

  async function loadBillingState() {
    setState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const data = await apiRequest('/api/billing/orders/current', { accessToken });
      setState((prev) => ({
        ...prev,
        loading: false,
        plan: data.plan || null,
        order: data.order || null,
        readiness: data.readiness || null,
        profile: data.profile || null
      }));
    } catch (error) {
      setState((prev) => ({ ...prev, loading: false, error: error.message }));
    }
  }

  useEffect(() => {
    if (accessToken) {
      loadBillingState();
    }
  }, [accessToken]);

  const effectiveProfile = state.profile || {
    product_tier: profilePlan,
    normal_ends_at: normalEndsAt
  };

  const normalActive = useMemo(() => {
    const endsAt = effectiveProfile?.normal_ends_at ? new Date(effectiveProfile.normal_ends_at).getTime() : null;
    return effectiveProfile?.product_tier === 'normal' && endsAt && endsAt > Date.now();
  }, [effectiveProfile?.normal_ends_at, effectiveProfile?.product_tier]);

  async function startCheckout() {
    setState((prev) => ({ ...prev, busy: true, error: '' }));
    try {
      const data = await apiRequest('/api/billing/checkout/normal', {
        accessToken,
        method: 'POST'
      });
      if (data.order?.payment_url) {
        window.location.href = data.order.payment_url;
        return;
      }
      setState((prev) => ({
        ...prev,
        busy: false,
        order: data.order || null,
        readiness: data.readiness || prev.readiness,
        error: 'Robokassa не вернула ссылку на оплату.'
      }));
    } catch (error) {
      setState((prev) => ({ ...prev, busy: false, error: error.message }));
    }
  }

  const plan = state.plan || { title: 'BullRun Normal', amountRub: 900, durationDays: 365 };
  const robokassaReady = state.readiness?.robokassa?.enabled && state.readiness?.robokassa?.configured;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-5">
          <div className="inline-flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-black uppercase tracking-[0.16em] text-blue-700 ring-1 ring-inset ring-blue-200">
            <CreditCard className="h-4 w-4" strokeWidth={2.5} />
            Normal checkout
          </div>
          <h1 className="text-4xl font-black leading-tight tracking-tight text-slate-950 md:text-5xl">
            Оплата Normal через Robokassa
          </h1>
          <p className="max-w-2xl text-base font-semibold leading-7 text-slate-600">
            Это отдельная покупка доступа к BullRun. Shop и P2P остаются для ваших клиентов и не выдают наш тариф Normal.
          </p>
        </div>

        <article className="rounded-lg border border-slate-200 bg-slate-50 p-5">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-blue-600" strokeWidth={2.5} />
            <div className="text-sm font-black uppercase tracking-[0.16em] text-slate-500">Что будет после оплаты</div>
          </div>
          <ul className="mt-5 space-y-3 text-sm font-semibold leading-6 text-slate-700">
            <li className="flex gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />Доступ Normal на {plan.durationDays} дней.</li>
            <li className="flex gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />Trial-ограничения закрываются после Result callback.</li>
            <li className="flex gap-3"><Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />После истечения Normal аккаунт возвращается в Trial.</li>
          </ul>
        </article>
      </section>

      <section className="grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
        <article className="rounded-lg border-2 border-blue-600 bg-white p-6 shadow-xl shadow-blue-600/10">
          <div className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">Первый платный вход</div>
          <h2 className="mt-3 text-3xl font-black text-slate-950">{plan.title || 'BullRun Normal'}</h2>
          <div className="mt-5 text-5xl font-black tracking-tight text-slate-950">{formatRub(plan.amountRub)}</div>
          <div className="mt-1 text-sm font-bold text-slate-500">за {plan.durationDays} дней доступа</div>

          {normalActive ? (
            <div className="mt-6 rounded-lg bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
              Normal активен до {formatDate(effectiveProfile.normal_ends_at)}. Можно продлить заранее, дни добавятся к текущему сроку.
            </div>
          ) : null}

          {state.order?.status === 'pending' ? (
            <div className="mt-6 rounded-lg bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
              Есть открытый счет Robokassa. Новая кнопка создаст свежий счет, если старый уже не нужен.
            </div>
          ) : null}

          {state.error ? (
            <div className="mt-6 flex gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={2.5} />
              <span>{state.error}</span>
            </div>
          ) : null}

          {!robokassaReady && !state.loading ? (
            <div className="mt-6 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={2.5} />
              <span>Robokassa еще не включена на сервере. Основа готова, оплату включим после регистрации магазина.</span>
            </div>
          ) : null}

          <a
            href={offerHref}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-5 py-3 text-sm font-black text-blue-700 transition hover:bg-blue-100"
          >
            <FileText className="h-4 w-4" strokeWidth={2.5} />
            Скачать публичную оферту
          </a>

          <button
            type="button"
            disabled={state.loading || state.busy || !robokassaReady}
            onClick={startCheckout}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-4 text-base font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
          >
            {state.busy ? 'Готовим счет...' : normalActive ? 'Продлить Normal' : 'Перейти к оплате'}
            <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </article>

        <div className="grid gap-4">
          {[
            ['Период', `${plan.durationDays} дней с момента оплаты`],
            ['Доступ', 'Рабочий кабинет BullRun, P2P/TON-касса, CRM, продления, Shop/P2P-инструменты'],
            ['Продление', 'Если продлить до окончания срока, новые дни добавятся к текущему Normal'],
            ['Истечение', 'После normal_ends_at доступ возвращается в Trial, рабочие функции закрываются лимитами']
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-slate-200 bg-white p-5">
              <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{label}</div>
              <div className="mt-2 text-base font-bold leading-7 text-slate-800">{value}</div>
            </div>
          ))}

          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50"
            onClick={loadBillingState}
          >
            <RefreshCw className="h-4 w-4" strokeWidth={2.5} />
            Обновить статус
          </button>
        </div>
      </section>
    </div>
  );
}
