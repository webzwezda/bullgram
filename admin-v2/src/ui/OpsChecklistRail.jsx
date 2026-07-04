import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { supabase } from '../lib/supabase.js';
import { CheckCircle2, Circle, CreditCard, Bot, LayoutList, Globe, Smartphone, ChevronRight, Rocket, LogOut, LogIn, Crown, Users } from 'lucide-react';

const ICONS = {
  CreditCard, Bot, LayoutList, Globe, Smartphone, Users
};

function formatDateOnly(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium'
  }).format(new Date(value));
}

function getTrialDaysLeft(value) {
  if (!value) return null;
  const diffMs = new Date(value).getTime() - Date.now();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function planMeta(plan, trialEndsAt) {
  if (plan === 'pro') {
    return {
      title: 'Pro',
      hint: 'Без лимитов',
      pillClass: 'bg-amber-100 text-amber-800 border-amber-200'
    };
  }

  if (plan === 'normal') {
    return {
      title: 'Normal',
      hint: '',
      pillClass: 'bg-emerald-100 text-emerald-800 border-emerald-200'
    };
  }

  const daysLeft = getTrialDaysLeft(trialEndsAt);
  const expired = daysLeft !== null && daysLeft < 0;
  const dueSoon = daysLeft !== null && daysLeft <= 3;

  return {
    title: expired ? 'Trial истек' : 'Trial',
    hint: trialEndsAt ? (expired ? `Истек ${formatDateOnly(trialEndsAt)}` : `До ${formatDateOnly(trialEndsAt)}`) : 'Активирован',
    pillClass: dueSoon || expired ? 'bg-red-100 text-red-800 border-red-200' : 'bg-blue-100 text-blue-800 border-blue-200'
  };
}

function ChecklistGroup({ title, description, steps, icon: MainIcon }) {
  const completed = steps.filter(s => s.state === 'done').length;
  const total = steps.length;
  const progress = Math.round((completed / total) * 100);

  return (
    <div className="bg-white border border-slate-200/60 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] mb-2 relative overflow-hidden">
      <div className="absolute top-0 right-0 p-6 opacity-[0.03] pointer-events-none">
        <MainIcon className="w-32 h-32" />
      </div>
      
      <div className="relative">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-2xl bg-slate-50 flex items-center justify-center border border-slate-100">
            <MainIcon className="w-5 h-5 text-slate-700" />
          </div>
          <h3 className="text-lg font-black text-slate-900 tracking-tight">{title}</h3>
        </div>
        
        <p className="text-sm text-slate-500 leading-relaxed mb-5 pr-4">
          {description}
        </p>
        
        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div 
              className="h-full bg-emerald-500 rounded-full transition-all duration-700 ease-out" 
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            {completed} / {total}
          </span>
        </div>

        <div className="flex flex-col gap-2.5">
          {steps.map((step) => {
            const StepIcon = ICONS[step.icon];
            const isDone = step.state === 'done';
            
            return (
              <a 
                key={step.id} 
                href={step.href}
                className={`
                  group relative flex items-center gap-4 p-3.5 rounded-2xl transition-all duration-300 border
                  ${isDone ? 'bg-slate-50/50 border-transparent hover:bg-slate-50' : 
                    'bg-white border-slate-100 hover:border-slate-200 hover:shadow-sm'}
                `}
              >
                <div className="flex-shrink-0 transition-transform duration-300 group-hover:scale-110">
                  {isDone ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  ) : (
                    <Circle className="w-5 h-5 text-slate-200 group-hover:text-slate-300" />
                  )}
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className={`text-sm font-bold truncate transition-colors ${isDone ? 'text-slate-400 line-through' : 'text-slate-700 group-hover:text-slate-900'}`}>
                      {step.title}
                    </h4>
                  </div>
                  <p className={`text-xs mt-0.5 truncate transition-colors ${isDone ? 'text-slate-300' : 'text-slate-500 group-hover:text-slate-600'}`}>
                    {step.hint}
                  </p>
                </div>

                <div className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full transition-all duration-300 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 group-hover:bg-slate-50">
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </div>
              </a>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function OpsChecklistRail() {
  const { accessToken, user, login, logout, profilePlan, trialEndsAt } = useAuth();
  const [state, setState] = useState({
    loading: true,
    summary: null,
    paymentReadiness: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      if (!accessToken) return;
      try {
        const [data, settingsResponse, tariffCountResponse] = await Promise.all([
          apiRequest('/api/dashboard', { accessToken }),
          apiRequest('/api/payment-settings', { accessToken }).catch(() => null),
          user?.id
            ? supabase
                .from('tariffs')
                .select('id', { count: 'exact', head: true })
                .eq('owner_id', user.id)
                .eq('is_active', true)
            : Promise.resolve({ count: 0, error: null })
        ]);

        const settings = settingsResponse?.settings || null;
        const tariffCount = tariffCountResponse?.error ? 0 : (tariffCountResponse?.count || 0);

        const paymentReadiness = settings
          ? {
              ...(data.paymentReadiness || {}),
              hasTon: !!settings.ton_wallet
            }
          : (data.paymentReadiness || {});

        if (cancelled) return;
        setState({
          loading: false,
          summary: {
            ...(data.summary || {}),
            tariffCount
          },
          paymentReadiness,
        });
      } catch (error) {
        if (cancelled) return;
        setState(prev => ({ ...prev, loading: false }));
      }
    }

    loadData();
    const intervalId = accessToken ? window.setInterval(loadData, 60_000) : null;
    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [accessToken, user?.id]);

  const checklists = useMemo(() => {
    const summary = state.summary || {};
    const payment = state.paymentReadiness || {};

    const botSteps = [
      {
        id: 'payments',
        done: !!payment.hasTon,
        title: 'Способы оплаты',
        hint: 'Укажите реквизиты для приема платежей',
        href: '/app/payments',
        icon: 'CreditCard'
      },
      {
        id: 'bot',
        done: (summary.salesBotCount || 0) > 0 || (summary.channelWithBotCount || 0) > 0,
        title: 'Telegram бот',
        hint: 'Создайте бота для автоматизации продаж',
        href: '/app/botfather',
        icon: 'Bot'
      },
      {
        id: 'plans',
        done: (summary.tariffCount || 0) > 0,
        title: 'Тарифы и доступ',
        hint: 'Настройте стоимость и сроки подписки',
        href: '/app/plans',
        icon: 'LayoutList'
      },
      {
        id: 'referrals',
        done: false, // Could be linked to state in future
        title: 'Рефералка',
        hint: 'Настройте бонусную программу',
        href: '/app/referrals',
        icon: 'Users'
      }
    ];

    const userbotSteps = [
      {
        id: 'proxy',
        done: (summary.proxyCount || 0) > 0,
        title: 'Прокси-сервер',
        hint: 'Подключите IPv4 прокси',
        href: '/app/proxies',
        icon: 'Globe'
      },
      {
        id: 'userbot',
        done: (summary.userbotCount || 0) > 0,
        title: 'Аккаунт юзербота',
        hint: 'Авторизуйте рабочий Telegram аккаунт',
        href: '/app/userbots',
        icon: 'Smartphone'
      }
    ];

    const processSteps = (steps) => {
      return steps.map((item) => ({
        ...item,
        state: item.done ? 'done' : 'todo'
      }));
    };

    return {
      bot: processSteps(botSteps),
      userbots: processSteps(userbotSteps)
    };
  }, [state.paymentReadiness, state.summary]);

  const profileName = user?.user_metadata?.full_name || user?.user_metadata?.name || 'Оператор Bullgram';
  const profileEmail = user?.email || '';
  const avatarUrl = user?.user_metadata?.avatar_url || '';
  const profileInitial = (profileEmail || profileName || 'U').trim().charAt(0).toUpperCase();

  const currentPlan = useMemo(() => planMeta(profilePlan, trialEndsAt), [profilePlan, trialEndsAt]);

  return (
    <aside className="ops-rail font-sans">
      <div className="bg-white border border-slate-200/60 rounded-3xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] mb-4">
        <div className="flex items-center gap-3 mb-4">
          {avatarUrl ? (
            <img src={avatarUrl} alt={profileName} className="w-10 h-10 rounded-full object-cover border border-slate-200" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-teal-500 flex items-center justify-center text-white font-bold">
              {profileInitial}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-slate-900 truncate">{profileName}</div>
            <div className="text-xs text-slate-500 truncate">{profileEmail || 'Без email'}</div>
          </div>
        </div>

        <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100 mb-4">
          <div className="flex items-center gap-2">
            <Crown className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">Тариф</span>
          </div>
          <div className="flex flex-col items-end">
            <span className={`px-2 py-0.5 text-xs font-bold rounded-md border ${currentPlan.pillClass}`}>
              {currentPlan.title}
            </span>
            <span className="text-[10px] text-slate-400 mt-1 font-medium">{currentPlan.hint}</span>
          </div>
        </div>

        {user ? (
          <button 
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-white hover:bg-slate-50 text-slate-600 text-xs font-bold rounded-lg border border-slate-200 transition-colors shadow-sm"
          >
            <LogOut className="w-3.5 h-3.5" />
            Выйти из системы
          </button>
        ) : (
          <button 
            onClick={login}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold rounded-lg transition-colors shadow-sm"
          >
            <LogIn className="w-3.5 h-3.5" />
            Войти через Google
          </button>
        )}
      </div>

      <ChecklistGroup 
        title="Продажа доступа" 
        description="Настройка автоматической выдачи инвайтов в приватные группы после оплаты."
        steps={checklists.bot}
        icon={Bot}
      />

      <ChecklistGroup 
        title="Юзерботы" 
        description="Инфраструктура для рассылок и инвайтинга с рабочих аккаунтов Telegram."
        steps={checklists.userbots}
        icon={Rocket}
      />
    </aside>
  );
}
