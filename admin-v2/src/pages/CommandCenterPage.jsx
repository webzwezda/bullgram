import { useEffect, useState } from 'react';
import { Bot, Users } from 'lucide-react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';

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
          setState({
            loading: false,
            error: '',
            data
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            loading: false,
            error: error.message,
            data: null
          });
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
      <section className="page max-w-6xl mx-auto">
        <div className="page__header">
          <h1>Командный центр</h1>
          <p>Не удалось получить данные с сервера.</p>
        </div>
        <div className="error-card">{state.error}</div>
      </section>
    );
  }

  const summary = state.data?.summary || {};

  return (
    <section className="page page--flush space-y-6 max-w-6xl mx-auto pb-12">
      {/* Bots and Userbots Stats Card */}
      <div className="p-0 gap-0 border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
        <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-655 shrink-0">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 tracking-tight">Подключенные боты и аккаунты</h2>
              <p className="text-xs font-semibold text-slate-400 mt-0.5">Текущее количество Telegram-аккаунтов и официальных ботов</p>
            </div>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 p-5 sm:p-6 bg-white">
          {/* Official Bots */}
          <div className="p-5 rounded-2xl border border-slate-200 bg-slate-50/30 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-650 shrink-0">
              <Bot className="w-6 h-6" />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Официальные боты</div>
              <div className="text-2xl font-bold tracking-tight text-slate-900 mt-0.5">
                {summary.botCount || 0}
              </div>
              <div className="text-xs text-slate-500 font-semibold mt-1">
                Продажи: {summary.salesBotCount || 0} • Сигналы: {summary.opsBotCount || 0}
              </div>
            </div>
          </div>

          {/* Userbots */}
          <div className="p-5 rounded-2xl border border-slate-200 bg-slate-50/30 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-650 shrink-0">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Юзерботы</div>
              <div className="text-2xl font-bold tracking-tight text-slate-900 mt-0.5">
                {(summary.userbotCount || 0) + (summary.userbotListedInShopCount || 0)}
              </div>
              <div className="text-xs text-slate-500 font-semibold mt-1">
                В работе: {summary.userbotCount || 0} • На витрине: {summary.userbotListedInShopCount || 0}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
