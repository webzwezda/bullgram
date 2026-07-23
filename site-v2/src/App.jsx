import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { LayoutDashboard, CreditCard, ShoppingBag, MessageCircle, Receipt, Wallet, FilePlus } from 'lucide-react';
import { TelegramPaywallPage } from './pages/TelegramPaywallPage.jsx';
import { useAuth } from './app/providers/AuthProvider.jsx';
import { SiteAuthGate } from './ui/SiteAuthGate.jsx';
import { UserProfileCard } from './ui/UserProfileCard.jsx';
import { LoginCard } from './ui/LoginCard.jsx';

const PricingPage = lazy(() => import('./pages/PricingPage.jsx').then((m) => ({ default: m.PricingPage })));
const ShopPage = lazy(() => import('./pages/ShopPage.jsx').then((m) => ({ default: m.ShopPage })));
const PurchasesPage = lazy(() => import('./pages/PurchasesPage.jsx').then((m) => ({ default: m.PurchasesPage })));
const MyPlanPage = lazy(() => import('./pages/MyPlanPage.jsx').then((m) => ({ default: m.MyPlanPage })));
const PayLayout = lazy(() => import('./layouts/PayLayout.jsx').then((m) => ({ default: m.PayLayout })));
const PayPage = lazy(() => import('./pages/PayPage.jsx').then((m) => ({ default: m.PayPage })));
const CreateInvoicePage = lazy(() => import('./pages/CreateInvoicePage.jsx').then((m) => ({ default: m.CreateInvoicePage })));
const CreatedInvoicePage = lazy(() => import('./pages/CreatedInvoicePage.jsx').then((m) => ({ default: m.CreatedInvoicePage })));

const navSections = [
  {
    title: 'Bullgram',
    items: [
      { to: '/', label: 'Главная', icon: LayoutDashboard }
    ]
  },
  {
    title: 'Счета',
    items: [
      { to: '/create', label: 'Создать счёт', icon: FilePlus }
    ]
  },
  {
    title: 'Оплата',
    items: [
      { to: '/pricing', label: 'Тарифы', icon: CreditCard },
      { to: '/plan', label: 'Мой тариф', icon: Wallet }
    ]
  },
  {
    title: 'Магазин',
    adminOnly: true,
    items: [
      { to: '/shop', label: 'Магазин', icon: ShoppingBag },
      { to: '/purchases', label: 'Покупки', icon: Receipt }
    ]
  },
  {
    title: 'Для админа',
    adminOnly: true,
    items: [
      { to: '/telegram', label: 'Telegram', icon: MessageCircle }
    ]
  }
];

export function App() {
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const isHomeRoute = location.pathname === '/';
  const isPricingRoute = location.pathname === '/pricing';
  const isTelegramRoute = location.pathname === '/telegram';
  const isPayRoute = location.pathname.startsWith('/pay');
  const isCreateRoute = location.pathname === '/create' || location.pathname.startsWith('/created');
  const { user, profileRole } = useAuth();
  const navItems = navSections
    .filter((section) => !section.adminOnly || profileRole === 'admin')
    .flatMap((section) => section.items);

  const currentNavLabel = useMemo(() => {
    if (location.pathname === '/') return 'Главная';
    if (location.pathname.startsWith('/purchases')) return 'Мои покупки';
    if (location.pathname === '/plan') return 'Мой тариф';
    if (location.pathname.startsWith('/pay')) return 'Оплата счёта';
    if (location.pathname.startsWith('/created')) return 'Счёт создан';
    const current = navItems.find((item) => item.to && item.to !== '/' && location.pathname.startsWith(item.to));
    return current?.label || 'Bullgram';
  }, [location.pathname, navItems]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  const appRoutes = (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/" element={<TelegramPaywallPage />} />
        <Route path="/telegram" element={<TelegramPaywallPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/shop" element={profileRole === 'admin' ? <ShopPage /> : <Navigate to="/" replace />} />
        <Route path="/purchases" element={profileRole === 'admin' ? <PurchasesPage /> : <Navigate to="/" replace />} />
        <Route path="/plan" element={<MyPlanPage />} />
        <Route path="/pay" element={<PayLayout />}>
          <Route path=":purchaseId" element={<PayPage />} />
        </Route>
        <Route path="/create" element={<CreateInvoicePage />} />
        <Route path="/created/:id" element={<CreatedInvoicePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row font-sans text-slate-900">
      <div className="sticky top-0 z-40 flex items-center justify-between gap-4 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
        <div className="min-w-0">
          <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Bullgram</div>
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
          {navSections.filter((section) => !section.adminOnly || profileRole === 'admin').map((section) => (
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
        {(isHomeRoute || isPricingRoute || isTelegramRoute) ? (
          appRoutes
        ) : (isPayRoute || isCreateRoute) ? (
          <div className="mx-auto w-full max-w-3xl py-2">{appRoutes}</div>
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
