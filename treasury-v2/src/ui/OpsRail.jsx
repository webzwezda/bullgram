import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { TonWalletSidebarRow } from '../features/ton-checkout/TonWalletSidebarRow.jsx';
import { TelegramSidebarRow } from '../features/telegram/TelegramSidebarRow.jsx';
import { Bot, CreditCard, Rocket, LogOut, LogIn, Crown, Send, AlertTriangle } from 'lucide-react';

function PromoCard({ href, icon: Icon, chipClass, iconClass, title, children }) {
  return (
    <a
      href={href}
      className="block bg-white border border-slate-200/60 rounded-3xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] mb-4 transition-colors hover:bg-slate-50"
    >
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-2xl flex items-center justify-center border shrink-0 ${chipClass}`}>
          <Icon className={`w-5 h-5 ${iconClass}`} />
        </div>
        <span className="text-sm font-bold text-slate-900">{title}</span>
        <span className="ml-auto text-slate-400" aria-hidden="true">→</span>
      </div>
      <p className="text-[11px] leading-snug text-slate-500 mt-2">{children}</p>
    </a>
  );
}

const UserbotsPromoCard = () => (
  <PromoCard href="/userbot/accounts" icon={Rocket} chipClass="bg-blue-50 border-blue-100" iconClass="text-blue-600" title="Юзерботы и прокси">
    Отдельное приложение для юзерботов. Рассылки и кики здесь продолжают их использовать.
  </PromoCard>
);

const PaywallPromoCard = () => (
  <PromoCard href="/paywall" icon={CreditCard} chipClass="bg-indigo-50 border-indigo-100" iconClass="text-indigo-600" title="Paywall">
    Отдельное приложение продажи доступа: бот продаж, клиенты, рассылки и касса.
  </PromoCard>
);

const BotsPromoCard = () => (
  <PromoCard href="/bots" icon={Bot} chipClass="bg-blue-50 border-blue-100" iconClass="text-blue-600" title="Боты">
    Хаб мелких ботов. Автопостер ведёт твои каналы: посты по расписанию и предложки.
  </PromoCard>
);

function planMeta(plan) {
  if (plan === 'pro' || plan === 'normal') {
    return {
      title: 'Pro',
      hint: 'Без лимитов',
      pillClass: 'bg-amber-100 text-amber-800 border-amber-200'
    };
  }

  return {
    title: 'Trial',
    hint: 'Бессрочно',
    pillClass: 'bg-indigo-50 text-indigo-700 border-indigo-200'
  };
}

// Промо-карточки соседних поверхностей в хвосте рельса (решение владельца):
//   showPaywall=true (paywall) — алерт Pro-выдачи и промо «Юзерботы и прокси»;
//   showUserbotPromos=true (кабинет /userbot) — промо paywall и хаба «Боты»;
//   showBotsPromos=true (хаб /bots) — промо «Юзерботы и прокси» и paywall.
// Чек-листы онбординга сняты 2026-09-27: рельс это личный кабинет, не онбординг.
export function OpsRail({ showPaywall = true, showUserbotPromos = false, showBotsPromos = false }) {
  const { accessToken, user, login, logout, profilePlan } = useAuth();
  const [proFulfillmentPending, setProFulfillmentPending] = useState(0);

  useEffect(() => {
    let cancelled = false;

    // Дашборд нужен рельсу ради единственного сигнала: оплаченные Pro без выдачи.
    async function loadData() {
      if (!accessToken) return;
      try {
        const data = await apiRequest('/api/dashboard', { accessToken });
        if (!cancelled) setProFulfillmentPending(data.summary?.proFulfillmentPending || 0);
      } catch (error) {
        if (!cancelled) setProFulfillmentPending(0);
      }
    }

    loadData();
    const intervalId = accessToken ? window.setInterval(loadData, 60_000) : null;
    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [accessToken]);

  const profileName = user?.user_metadata?.full_name || user?.user_metadata?.name || 'Оператор Bullgram';
  const profileEmail = user?.email || '';
  const avatarUrl = user?.user_metadata?.avatar_url || '';
  const profileInitial = (profileEmail || profileName || 'U').trim().charAt(0).toUpperCase();

  const currentPlan = useMemo(() => planMeta(profilePlan), [profilePlan]);

  return (
    <aside className="ops-rail font-sans">
      <div className="bg-white border border-slate-200/60 rounded-3xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] mb-4">
        <div className="flex items-center gap-3 mb-4">
          {avatarUrl ? (
            <img src={avatarUrl} alt={profileName} className="w-10 h-10 rounded-full object-cover border border-slate-200" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white font-bold">
              {profileInitial}
            </div>
          )}
          <a href="/userbot/profile" className="flex-1 min-w-0 block hover:opacity-80 transition-opacity">
            <div className="text-sm font-bold text-slate-900 truncate hover:underline">{profileName}</div>
            <div className="text-xs text-slate-500 truncate hover:underline">{profileEmail || 'Без email'}</div>
          </a>
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
            <span className="text-xs text-slate-500 mt-1 font-medium">{currentPlan.hint}</span>
          </div>
        </div>

        {user ? <TonWalletSidebarRow /> : null}
        {user ? <TelegramSidebarRow /> : null}

        {user ? (
          <button
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-white hover:bg-slate-50 text-slate-600 text-xs font-bold rounded-lg border border-slate-200 transition-colors shadow-sm"
          >
            <LogOut className="w-3.5 h-3.5" />
            Выйти из системы
          </button>
        ) : (
          <div className="flex flex-col gap-1.5">
            <button
              onClick={() => login()}
              className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold rounded-lg transition-colors shadow-sm"
            >
              <LogIn className="w-3.5 h-3.5" />
              Войти через Google
            </button>
            <button
              onClick={() => login('custom:telegram')}
              className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold rounded-lg transition-colors shadow-sm"
            >
              <Send className="w-3.5 h-3.5" />
              Войти через Telegram
            </button>
          </div>
        )}
      </div>

      {showPaywall && proFulfillmentPending > 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded-3xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] mb-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-100 flex items-center justify-center border border-amber-200 shrink-0">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h3 className="text-sm font-black text-amber-900 tracking-tight">
                Pro-оплаты без выдачи: {proFulfillmentPending}
              </h3>
              <p className="text-xs text-amber-800 leading-relaxed mt-1">
                На витрине нет свободного бандла или перенос упал. Добавь бандл на витрину или{' '}
                <Link to="/shop-receipts" className="font-bold underline">проверь заказы в магазине</Link>.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {showUserbotPromos ? (
        <>
          <PaywallPromoCard />
          <BotsPromoCard />
        </>
      ) : null}

      {showBotsPromos ? (
        <>
          <UserbotsPromoCard />
          <PaywallPromoCard />
        </>
      ) : null}

      {showPaywall ? <UserbotsPromoCard /> : null}
    </aside>
  );
}
