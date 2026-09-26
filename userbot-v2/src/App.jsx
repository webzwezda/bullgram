import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import {
  Rocket, Globe, Bot, KeyRound, ShoppingCart, User,
  LayoutDashboard, Crown, LogOut
} from 'lucide-react';
import { useAuth } from './app/providers/AuthProvider.jsx';
import { AuthGate } from './ui/AuthGate.jsx';
import { ErrorBoundary } from './ui/ErrorBoundary.jsx';
import { LoadingState } from './ui/LoadingState.jsx';
import { Toaster } from './components/ui/sonner.jsx';
import { TonWalletSidebarRow } from './features/ton-checkout/TonWalletSidebarRow.jsx';
import { TelegramSidebarRow } from './features/telegram/TelegramSidebarRow.jsx';

// Экраны приложения (план 2026-09-26-userbot-product-split, Фаза 3):
// дашборд и покупки — новые, остальные переехали из admin-v2 целиком.
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'));
const UserbotsPage = lazy(() => import('./pages/UserbotsPage.jsx'));
const ProxyManagerPage = lazy(() => import('./pages/ProxyManagerPage.jsx').then((module) => ({ default: module.ProxyManagerPage })));
const McpSettingsPage = lazy(() => import('./pages/McpSettingsPage.jsx').then((module) => ({ default: module.McpSettingsPage })));
const ApiIntegrationsPage = lazy(() => import('./pages/ApiIntegrationsPage.jsx').then((module) => ({ default: module.ApiIntegrationsPage })));
const PurchasesPage = lazy(() => import('./pages/PurchasesPage.jsx'));
const ProfilePage = lazy(() => import('./pages/ProfilePage.jsx').then((module) => ({ default: module.ProfilePage })));

// Совместимый редирект: страница юзерботов теперь /accounts, query сохраняем
// (?userbot_id=, ?tg_user_id= — deep-links из уведомлений и CRM admin-v2).
function AccountsRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/accounts${search}`} replace />;
}

// Пилюля тарифа — тот же паттерн, что в OpsRail admin-v2
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
    pillClass: 'bg-blue-100 text-blue-800 border-blue-200'
  };
}

export function App() {
  const { user, logout, profilePlan } = useAuth();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const navSections = [
    {
      title: 'Юзербот',
      items: [
        { to: '/', label: 'Дашборд', icon: LayoutDashboard },
        { to: '/accounts', label: 'Юзерботы', icon: Rocket },
        { to: '/proxies', label: 'Прокси', icon: Globe },
      ]
    },
    {
      title: 'Агент и интеграции',
      items: [
        { to: '/mcp', label: 'Агент', icon: Bot },
        { to: '/api', label: 'API-ключи', icon: KeyRound },
      ]
    },
    {
      title: 'Аккаунт',
      items: [
        { to: '/purchases', label: 'Покупки', icon: ShoppingCart },
        { to: '/profile', label: 'Профиль', icon: User },
      ]
    }
  ];
  const navItems = navSections.flatMap((section) => section.items);

  const currentNavLabel = useMemo(() => {
    if (location.pathname === '/') return 'Дашборд';
    const exact = navItems.find((item) => item.to === location.pathname);
    if (exact) return exact.label;
    const prefix = navItems.find((item) => item.to !== '/' && location.pathname.startsWith(`${item.to}/`));
    return prefix?.label || 'Юзербот';
  }, [location.pathname, navItems]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  if (!user) {
    return (
      <>
        <AuthGate />
        <Toaster position="bottom-right" richColors duration={4000} />
      </>
    );
  }

  const profileName = user?.user_metadata?.full_name || user?.user_metadata?.name || 'Оператор Bullgram';
  const profileEmail = user?.email || '';
  const avatarUrl = user?.user_metadata?.avatar_url || '';
  const profileInitial = (profileEmail || profileName || 'U').trim().charAt(0).toUpperCase();
  const currentPlan = planMeta(profilePlan);

  return (
    <div className="app-shell">
      <div className="mobile-bar">
        <div className="mobile-bar__title">{currentNavLabel}</div>
        <button
          type="button"
          className="mobile-bar__burger"
          onClick={() => setMobileNavOpen((value) => !value)}
          aria-label={mobileNavOpen ? 'Закрыть меню' : 'Открыть меню'}
          aria-expanded={mobileNavOpen}
        >
          <span />
          <span />
          <span />
        </button>
      </div>

      {mobileNavOpen ? <button type="button" className="sidebar-backdrop" aria-label="Закрыть меню" onClick={() => setMobileNavOpen(false)} /> : null}

      <aside
        className={`sidebar bg-white border-r border-slate-200/60 flex flex-col gap-6 p-5 sticky top-0 h-screen overflow-y-auto${mobileNavOpen ? ' sidebar--mobile-open' : ''}`}
        style={{ background: '#ffffff', color: '#0f172a' }}
      >
        <NavLink
          to="/"
          end
          onClick={() => setMobileNavOpen(false)}
          className="mb-2 px-2 flex items-center gap-3 rounded-xl transition-transform hover:scale-[1.02]"
          aria-label="Bullgram — Дашборд"
        >
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm shadow-md shadow-blue-500/20">
            BR
          </div>
          <span className="font-black text-xl tracking-tight text-slate-900">Bullgram</span>
        </NavLink>

        <nav className="flex flex-col gap-6 flex-1 min-h-0 overflow-y-auto pr-1 -mr-1" style={{ scrollbarWidth: 'none' }}>
          {navSections.map((section) => (
            <div key={section.title} className="flex flex-col gap-1.5">
              <div className="px-3 text-[11px] font-bold tracking-wider uppercase text-slate-500 mb-1">
                {section.title}
              </div>
              <div className="flex flex-col gap-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === '/' || Boolean(item.exact)}
                      onClick={() => setMobileNavOpen(false)}
                      className={({ isActive }) => `
                        flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200
                        ${isActive
                          ? 'bg-blue-50 text-blue-700'
                          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                        }
                      `}
                    >
                      <Icon className="w-[18px] h-[18px] flex-shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="px-3 pt-4 border-t border-slate-100">
          <Link
            to="/profile"
            onClick={() => setMobileNavOpen(false)}
            className="flex items-center gap-3 mb-4 hover:opacity-80 transition-opacity"
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt={profileName} className="w-10 h-10 rounded-full object-cover border border-slate-200" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-teal-500 flex items-center justify-center text-white font-bold">
                {profileInitial}
              </div>
            )}
            <span className="flex-1 min-w-0 block">
              <span className="text-sm font-bold text-slate-900 truncate block">{profileName}</span>
              <span className="text-xs text-slate-500 truncate block">{profileEmail || 'Без email'}</span>
            </span>
          </Link>

          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100 mb-4">
            <div className="flex items-center gap-2">
              <Crown className="w-4 h-4 text-slate-400" />
              <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">Тариф</span>
            </div>
            <div className="flex flex-col items-end">
              <span className={`px-2 py-0.5 text-xs font-bold rounded-md border ${currentPlan.pillClass}`}>
                {currentPlan.title}
              </span>
              <span className="text-[10px] text-slate-500 mt-1 font-medium">{currentPlan.hint}</span>
            </div>
          </div>

          <TonWalletSidebarRow />
          <TelegramSidebarRow />

          <button
            type="button"
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-white hover:bg-slate-50 text-slate-600 text-xs font-bold rounded-lg border border-slate-200 transition-colors shadow-sm"
          >
            <LogOut className="w-3.5 h-3.5" />
            Выйти из системы
          </button>

          <div className="flex items-center gap-3 text-[11px] font-medium text-slate-500 mt-4">
            <a href="/" className="transition-colors hover:text-slate-700">
              На сайт
            </a>
          </div>
        </div>
      </aside>

      {/* Одноколоночный контур: правый рейл (OpsRail) — про paywall и сюда не копируется,
          поэтому колонка 320px из .workspace-shell в app.css перекрывается инлайном
          (unlayered CSS app.css сильнее Tailwind-утилит). */}
      <div className="workspace-shell" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
        <main className="main" style={{ paddingRight: 24 }}>
          <AuthGate>
            <ErrorBoundary>
              <Suspense fallback={<LoadingState text="Грузим экран..." />}>
                <Routes>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/accounts" element={<UserbotsPage />} />
                  <Route path="/userbots" element={<AccountsRedirect />} />
                  <Route path="/proxies" element={<ProxyManagerPage />} />
                  <Route path="/mcp" element={<McpSettingsPage />} />
                  <Route path="/api" element={<ApiIntegrationsPage />} />
                  <Route path="/purchases" element={<PurchasesPage />} />
                  <Route path="/profile" element={<ProfilePage />} />
                  <Route path="*" element={<DashboardPage />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </AuthGate>
        </main>

        <Toaster position="bottom-right" richColors duration={4000} />
      </div>
    </div>
  );
}
