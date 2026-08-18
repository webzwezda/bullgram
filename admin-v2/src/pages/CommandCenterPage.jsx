import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CircleCheck } from 'lucide-react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';

// Командный центр — только светофоры-указатели «куда смотреть».
// Никаких операционных данных: числа и детали живут на своих страницах.
const AREA_LABELS = {
  '/app/userbots': 'Юзерботы',
  '/app/proxies': 'Прокси',
  '/app/orders': 'Заказы',
  '/app/payments': 'Оплата',
  '/app/access': 'Доступ',
  '/app/abandoned': 'Брошенные корзины',
  '/app/referrals': 'Партнёрка',
  '/app/shop': 'Магазин',
  '/app/billing': 'Касса'
};

function pluralProblems(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'проблема';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'проблемы';
  return 'проблем';
}

function collectPointers(data) {
  const groups = new Map();

  const addTo = (href, count, tone) => {
    const key = href || '/app';
    const group = groups.get(key) || { href: key, count: 0, danger: false };
    group.count += count;
    if (tone === 'danger') group.danger = true;
    groups.set(key, group);
  };

  for (const action of data?.urgentActions || []) {
    if (action.tone === 'ok' || !action.value) continue;
    addTo(action.href, action.value, action.tone);
  }

  const readiness = data?.paymentReadiness;
  if (readiness && !readiness.hasSettings) {
    addTo('/app/billing', 1, 'warning');
  } else if (readiness && !readiness.hasTon) {
    addTo('/app/billing', 1, 'warning');
  }

  return Array.from(groups.values()).sort((a, b) => {
    if (a.danger !== b.danger) return a.danger ? -1 : 1;
    return b.count - a.count;
  });
}

export function CommandCenterPage() {
  const { accessToken } = useAuth();
  const [state, setState] = useState({
    loading: true,
    error: '',
    data: null
  });

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      try {
        const data = await apiRequest('/api/dashboard', { accessToken });
        if (!cancelled) {
          setState({ loading: false, error: '', data });
        }
      } catch (error) {
        if (!cancelled) {
          setState({ loading: false, error: error.message, data: null });
        }
      }
    }

    if (accessToken) {
      loadDashboard();
    }

    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  if (state.loading) {
    return <LoadingState text="Загружаем сводку аккаунта..." />;
  }

  if (state.error) {
    return (
      <section className="page max-w-3xl mx-auto">
        <div className="page__header">
          <h1>Командный центр</h1>
          <p>Не удалось получить данные с сервера.</p>
        </div>
        <div className="error-card">{state.error}</div>
      </section>
    );
  }

  const pointers = collectPointers(state.data);

  return (
    <section className="page page--flush space-y-6 max-w-3xl mx-auto pb-12">
      <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200/50 shadow-lg shadow-slate-200/40">
        <div className="bg-slate-50/50 border-b border-slate-100 px-5 py-5 sm:px-6">
          <h2 className="text-base font-bold text-slate-900 tracking-tight">Куда смотреть сейчас</h2>
          <p className="text-xs font-semibold text-slate-400 mt-0.5">
            Только сводка проблем — детали на своих страницах
          </p>
        </div>

        {pointers.length === 0 ? (
          <div className="px-5 py-10 sm:px-6 flex flex-col items-center gap-3 text-center">
            <CircleCheck className="w-10 h-10 text-emerald-500" />
            <div className="text-base font-bold text-slate-900">Всё работает</div>
            <p className="text-sm text-slate-500 max-w-sm">
              Ни в одном разделе нет проблем. Когда появятся — здесь загорится указатель.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {pointers.map((pointer) => (
              <li key={pointer.href}>
                <Link
                  to={pointer.href.replace(/^\/app/, '') || '/'}
                  className="flex items-center gap-3 px-5 py-4 sm:px-6 hover:bg-slate-50 transition-colors group"
                >
                  <span
                    className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                      pointer.danger ? 'bg-rose-500' : 'bg-amber-400'
                    }`}
                  />
                  <span className="text-sm font-bold text-slate-900">
                    {AREA_LABELS[pointer.href] || 'Раздел'}
                  </span>
                  <span className="flex-1" />
                  <span
                    className={`text-sm font-bold ${
                      pointer.danger ? 'text-rose-600' : 'text-amber-600'
                    }`}
                  >
                    {pointer.count} {pluralProblems(pointer.count)}
                  </span>
                  <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 group-hover:translate-x-0.5 transition-all" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export default CommandCenterPage;
