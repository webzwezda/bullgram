import { useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { LayoutDashboard, CreditCard, ShoppingBag, Newspaper, GraduationCap, AlertCircle, ArrowRight, MessageCircle } from 'lucide-react';
import { TelegramPaywallPage } from './pages/TelegramPaywallPage.jsx';
import { PricingPage } from './pages/PricingPage.jsx';
import { ShopPage } from './pages/ShopPage.jsx';
import { BillingNormalPage } from './pages/BillingNormalPage.jsx';
import { BillingSuccessPage } from './pages/BillingSuccessPage.jsx';
import { BillingFailPage } from './pages/BillingFailPage.jsx';
import { SALES_LINKS } from './components/MarketingPrimitives.jsx';
import { useAuth } from './app/providers/AuthProvider.jsx';
import { SiteAuthGate } from './ui/SiteAuthGate.jsx';
import { UserProfileCard } from './ui/UserProfileCard.jsx';
import { LoginCard } from './ui/LoginCard.jsx';

const navSections = [
  {
    title: 'BullRun',
    items: [
      { to: '/', label: 'Главная', icon: LayoutDashboard },
      { to: '/telegram', label: 'Telegram', icon: MessageCircle },
      { to: '/pricing', label: 'Тарифы', icon: CreditCard },
      { to: '/shop', label: 'Shop', icon: ShoppingBag },
      { href: '/courses/', label: 'Курсы', icon: GraduationCap, external: true },
      { href: '/blog/', label: 'Блог', icon: Newspaper, external: true }
    ]
  }
];

export function App() {
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const isHomeRoute = location.pathname === '/';
  const isPricingRoute = location.pathname === '/pricing';
  const isTelegramRoute = location.pathname === '/telegram';
  const isBillingReturnRoute = location.pathname === '/billing/success' || location.pathname === '/billing/fail';
  const isLegacyNormalShopRoute = location.pathname === '/shop' && new URLSearchParams(location.search).get('offer') === 'normal';
  const { user, profilePlan, profileRole, trialEndsAt, checkoutPulse, sellerPulse, packagePulse } = useAuth();
  const navItems = navSections.flatMap((section) => section.items);

  const currentNavLabel = useMemo(() => {
    if (location.pathname === '/') return 'Главная';
    if (location.pathname.startsWith('/billing')) return 'Оплата Normal';
    const current = navItems.find((item) => item.to && item.to !== '/' && location.pathname.startsWith(item.to));
    return current?.label || 'BullRun';
  }, [location.pathname, navItems]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  const checkoutSignal = (() => {
    if (!user || !checkoutPulse) return null;
    if (checkoutPulse.failedCount > 0) {
      return {
        eyebrow: 'Handoff сломан',
        title: 'Оплата уже есть, но передача прав где-то споткнулась',
        text: 'Не начинай новые сделки вслепую. Сначала добей проблемный handoff в Shop.',
        href: '/shop',
        label: 'Открыть покупки'
      };
    }
    if (checkoutPulse.awaitingReceiptCount > 0) {
      return {
        eyebrow: 'Ждет чек',
        title: 'Есть P2P-покупка, которая ждет ручной проверки',
        text: 'Открой покупки и не дублируй оплату.',
        href: '/shop',
        label: 'Открыть покупки'
      };
    }
    if (checkoutPulse.pendingCount > 0) {
      return {
        eyebrow: 'Открытый checkout',
        title: 'У тебя уже есть незакрытый счет',
        text: 'Закрой текущий TON/P2P checkout перед переходом к следующему шагу.',
        href: '/shop',
        label: 'Вернуться к checkout'
      };
    }
    if (profilePlan === 'trial' && checkoutPulse.paidCount > 0) {
      return {
        eyebrow: 'Пора апгрейдиться',
        title: 'Trial уже сделал свою работу',
        text: 'Переходи на Normal, чтобы открыть рабочий контур без trial-стопоров.',
        href: SALES_LINKS.ops,
        label: 'Перейти на Normal'
      };
    }
    return null;
  })();

  const trialUrgencySignal = (() => {
    if (!user || profilePlan !== 'trial' || !trialEndsAt) return null;
    const endsAt = new Date(trialEndsAt).getTime();
    const diffMs = endsAt - Date.now();
    if (Number.isNaN(endsAt) || diffMs <= 0 || diffMs > 1000 * 60 * 60 * 72) return null;

    const hoursLeft = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60)));
    return {
      eyebrow: 'Trial скоро сгорит',
      title: `Осталось около ${hoursLeft} ч`,
      text: 'Переходи на Normal и снимай trial-лимиты до того, как входной режим начнет тормозить работу.',
      href: SALES_LINKS.ops,
      label: 'Открыть Normal'
    };
  })();

  const sellerSignal = (() => {
    if (!user || profilePlan !== 'normal' || !sellerPulse?.hasAny) return null;
    if (sellerPulse.failedCount > 0) {
      return {
        eyebrow: 'Handoff сломан',
        title: 'Seller checkout споткнулся',
        text: 'Добей handoff в Shop, потом возвращайся к seller mode.',
        href: '/shop?offer=seller',
        label: 'Добить checkout'
      };
    }
    if (sellerPulse.awaitingReceiptCount > 0) {
      return {
        eyebrow: 'Ждет чек',
        title: 'Seller-покупка ждет проверки',
        text: 'Не начинай новый апгрейд, пока этот хвост не закроется.',
        href: '/shop?offer=seller',
        label: 'Вернуться к checkout'
      };
    }
    if (sellerPulse.pendingCount > 0) {
      return {
        eyebrow: 'Checkout открыт',
        title: 'Seller mode ждет оплаты',
        text: 'Закрой текущий checkout, потом двигайся дальше.',
        href: '/shop?offer=seller',
        label: 'Открыть checkout'
      };
    }
    return null;
  })();

  const shellSignal = checkoutSignal || trialUrgencySignal || sellerSignal;

  const appRoutes = (
    <Routes>
      <Route path="/" element={<TelegramPaywallPage />} />
      <Route path="/telegram" element={<TelegramPaywallPage />} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/shop" element={isLegacyNormalShopRoute ? <Navigate to="/billing/normal" replace /> : <ShopPage />} />
      <Route path="/billing/normal" element={<BillingNormalPage />} />
      <Route path="/billing/success" element={<BillingSuccessPage />} />
      <Route path="/billing/fail" element={<BillingFailPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row font-sans text-slate-900">
      <div className="sticky top-0 z-40 flex items-center justify-between gap-4 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
        <div className="min-w-0">
          <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">BullRun</div>
          <div className="truncate text-sm font-black text-slate-900">{currentNavLabel}</div>
        </div>
        <button
          type="button"
          className="inline-flex h-11 w-11 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white shadow-sm"
          onClick={() => setMobileNavOpen((value) => !value)}
          aria-label={mobileNavOpen ? 'Закрыть меню' : 'Открыть меню'}
          aria-expanded={mobileNavOpen}
        >
          <span className="h-0.5 w-5 rounded-full bg-slate-900" />
          <span className="h-0.5 w-5 rounded-full bg-slate-900" />
          <span className="h-0.5 w-5 rounded-full bg-slate-900" />
        </button>
      </div>

      {mobileNavOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 border-0 bg-slate-950/40 lg:hidden"
          aria-label="Закрыть меню"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      <aside className={`fixed inset-y-0 left-0 z-50 flex w-[min(86vw,320px)] -translate-x-full flex-col border-r border-slate-200 bg-white px-5 py-6 shadow-2xl shadow-slate-950/15 transition-transform duration-200 lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-72 lg:translate-x-0 lg:border-b-0 lg:shadow-none ${mobileNavOpen ? 'translate-x-0' : ''}`}>
        
        {user ? (
          <UserProfileCard />
        ) : (
          <LoginCard />
        )}

        <nav className="flex flex-col gap-6 flex-1 overflow-y-auto">
          {navSections.map((section) => (
            <div key={section.title} className="flex flex-col gap-2">
              <div className="px-3 text-xs font-bold tracking-widest uppercase text-slate-400 mb-1">
                {section.title}
              </div>
              <div className="flex flex-col gap-1">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  if (item.external) {
                    return (
                      <a
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileNavOpen(false)}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-slate-600 transition-all duration-200 hover:bg-slate-50 hover:text-slate-900"
                      >
                        <Icon className="w-5 h-5 flex-shrink-0" />
                        {item.label}
                      </a>
                    );
                  }

                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === '/'}
                      onClick={() => setMobileNavOpen(false)}
                      className={({ isActive }) => `
                        flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200
                        ${isActive 
                          ? 'bg-blue-50 text-blue-700' 
                          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                        }
                      `}
                    >
                      <Icon className="w-5 h-5 flex-shrink-0" />
                      {item.label}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-x-hidden flex flex-col w-full">
        {shellSignal && (
          <div className="mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 p-6 sm:p-8 rounded-3xl bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200/60 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-2xl bg-amber-100 text-amber-600 shrink-0">
                <AlertCircle className="w-6 h-6" strokeWidth={2.5} />
              </div>
              <div>
                <div className="text-xs font-extrabold uppercase tracking-widest text-amber-600 mb-1.5">
                  {shellSignal.eyebrow}
                </div>
                <h3 className="text-xl font-extrabold text-slate-900 mb-2">{shellSignal.title}</h3>
                <p className="text-slate-600 font-medium leading-relaxed max-w-2xl">{shellSignal.text}</p>
              </div>
            </div>
            <a
              href={shellSignal.href}
              className="shrink-0 group relative inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-6 py-3.5 text-sm font-bold text-white shadow-md shadow-amber-500/20 transition-all duration-200 hover:bg-amber-600"
            >
              {shellSignal.label}
              <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-1" strokeWidth={2.5} />
            </a>
          </div>
        )}

        {(isHomeRoute || isPricingRoute || isTelegramRoute || isBillingReturnRoute || isLegacyNormalShopRoute) ? (
          appRoutes
        ) : (
          <SiteAuthGate>
            <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-sm flex-1">
              {appRoutes}
            </div>
          </SiteAuthGate>
        )}
      </main>
    </div>
  );
}
