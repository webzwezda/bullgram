import { Fragment, Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import {
  Users, ShoppingCart, Database,
  Bot, Wallet, Send,
  RefreshCcw,
  History
} from 'lucide-react';
import { useAuth } from './app/providers/AuthProvider.jsx';
import { AuthGate } from './ui/AuthGate.jsx';
import { ErrorBoundary } from './ui/ErrorBoundary.jsx';
import { LoadingState } from './ui/LoadingState.jsx';
import { OpsRail } from './ui/OpsRail.jsx';
import { Toaster } from './components/ui/sonner.jsx';

const CustomersPage = lazy(() => import('./pages/CustomersPage.jsx').then((module) => ({ default: module.CustomersPage })));
const BasesPage = lazy(() => import('./pages/BasesPage.jsx').then((module) => ({ default: module.BasesPage })));
const OfficialBotsPage = lazy(() => import('./pages/bots/OfficialBotsPage.jsx').then((module) => ({ default: module.OfficialBotsPage })));
const ReferralsPage = lazy(() => import('./pages/ReferralsPage.jsx').then((module) => ({ default: module.ReferralsPage })));
const RetentionPage = lazy(() => import('./pages/RetentionPage.jsx').then((module) => ({ default: module.RetentionPage })));
const AbandonedPage = lazy(() => import('./pages/AbandonedPage.jsx').then((module) => ({ default: module.AbandonedPage })));
const PaymentSettingsPage = lazy(() => import('./pages/PaymentSettingsPage.jsx').then((module) => ({ default: module.PaymentSettingsPage })));
const BroadcastPage = lazy(() => import('./pages/BroadcastPage.jsx').then((module) => ({ default: module.BroadcastPage })));
const BroadcastHistoryPage = lazy(() => import('./pages/BroadcastHistoryPage.jsx').then((module) => ({ default: module.BroadcastHistoryPage })));

// Юзерботные экраны переехали в отдельное приложение /userbot (план 2026-09-26).
// react-router Navigate не умеет переходить между SPA, поэтому полный переход
// через window.location.replace с прокидом query (deep-links несут ?userbot_id= и т.п.).
function ExternalRedirect({ to }) {
  const { search } = useLocation();
  useEffect(() => {
    window.location.replace(to + search);
  }, [to, search]);
  return null;
}
export function App() {
  const { user, profileRole, profileLoading } = useAuth();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const navSections = [
    {
      title: 'Продажи и Клиенты',
      items: [
        { to: '/', label: 'Бот продаж', icon: Bot },
        { to: '/customers', label: 'Клиенты', icon: Users },
        { to: '/retention', label: 'Удержание', icon: RefreshCcw },
        { to: '/abandoned', label: 'Брошенные корзины', icon: ShoppingCart },
        { to: '/referrals', label: 'Партнерка', icon: Users },
      ]
    },
    {
      title: 'Рассылка',
      items: [
        { to: '/bases', label: 'Базы', icon: Database },
        { to: '/broadcast', label: 'Рассылка', icon: Send, exact: true },
        { to: '/broadcast/history', label: 'История рассылок', icon: History },
      ]
    },
    {
      title: 'Финансы',
      items: [
        { to: '/billing', label: 'Касса', icon: Wallet },
      ]
    },
    // Казна (/treasury) — внутренний инструмент платформы: в меню не выводится,
    // доступ по прямой ссылке, гейт по роли admin внутри роута.
  ];
  const navItems = navSections.flatMap((section) => section.items);

  const currentNavLabel = useMemo(() => {
    if (location.pathname === '/') return 'Бот продаж';
    const exact = navItems.find((item) => item.to === location.pathname);
    if (exact) return exact.label;
    const prefix = navItems.find((item) => item.to !== '/' && location.pathname.startsWith(`${item.to}/`));
    return prefix?.label || 'Bullgram';
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
          aria-label="Bullgram — Бот продаж"
        >
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm shadow-md shadow-blue-500/20">
            BR
          </div>
          <span className="font-black text-xl tracking-tight text-slate-900">Bullgram</span>
        </NavLink>
        
        <nav className="flex flex-col gap-6 flex-1 min-h-0 overflow-y-auto pr-1 -mr-1" style={{ scrollbarWidth: 'none' }}>
          {navSections.map((section, sectionIndex) => (
            <Fragment key={section.title}>
            <div className="flex flex-col gap-1.5">
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
            </Fragment>
          ))}
        </nav>
        <div className="px-3 pt-4 border-t border-slate-100">
          <div className="flex items-center gap-3 text-[11px] font-medium text-slate-500">
            <a href="/" className="transition-colors hover:text-slate-700">
              На сайт
            </a>
            <span className="text-slate-300">·</span>
            <a href="/userbot/api" className="transition-colors hover:text-slate-700">
              API
            </a>
            <span className="text-slate-300">·</span>
            <a href="/userbot/mcp" className="transition-colors hover:text-slate-700">
              MCP
            </a>
          </div>
        </div>
      </aside>

      <div className="workspace-shell">
        <main className="main">
          <AuthGate>
            <ErrorBoundary>
            <Suspense fallback={<LoadingState text="Грузим экран admin-v2..." />}>
              <Routes>
                <Route path="/" element={<OfficialBotsPage />} />
                {/* Автопостер переехал в приложение «Боты» (/bots, план 2026-09-27). */}
                <Route path="/autopost" element={<ExternalRedirect to="/bots/autopost" />} />
                <Route path="/customers" element={<CustomersPage />} />
                <Route path="/crm" element={<Navigate to="/customers" replace />} />
                <Route path="/orders" element={<Navigate to="/customers" replace />} />
                <Route path="/access" element={<Navigate to="/customers" replace />} />
                <Route path="/bases" element={<BasesPage />} />
                <Route path="/dossier" element={<Navigate to="/customers" replace />} />
                <Route path="/userbots" element={<ExternalRedirect to="/userbot/accounts" />} />
                <Route path="/sales-bot" element={<Navigate to="/" replace />} />
                <Route path="/bots" element={<ExternalRedirect to="/userbot/accounts" />} />
                {/* Казна — отдельное приложение /treasury (внутренний инструмент платформы) */}
                <Route path="/treasury" element={<ExternalRedirect to="/treasury" />} />
                <Route path="/shop" element={<ExternalRedirect to="/treasury" />} />
                <Route path="/shop-receipts" element={<Navigate to="/billing" replace />} />
                <Route path="/referrals" element={<ReferralsPage />} />
                <Route path="/retention" element={<RetentionPage />} />
                <Route path="/abandoned" element={<AbandonedPage />} />
                <Route path="/analytics" element={<Navigate to="/customers" replace />} />
                <Route path="/broadcast/history" element={<BroadcastHistoryPage />} />
                <Route path="/broadcast" element={<BroadcastPage />} />
                <Route path="/payments" element={<Navigate to="/billing" replace />} />
                <Route path="/claw" element={<ExternalRedirect to="/userbot/mcp" />} />
                <Route path="/claw/log" element={<ExternalRedirect to="/userbot/mcp" />} />
                <Route path="/integrations" element={<ExternalRedirect to="/userbot/api" />} />
                <Route path="/api" element={<ExternalRedirect to="/userbot/api" />} />
                <Route path="/mcp" element={<ExternalRedirect to="/userbot/mcp" />} />
                <Route path="/api/mcp" element={<ExternalRedirect to="/userbot/mcp" />} />
                <Route path="/api/sms-push" element={<Navigate to="/billing" replace />} />
                <Route path="/plans" element={<Navigate to="/" replace />} />
                <Route path="/billing" element={<PaymentSettingsPage />} />
                <Route path="/p2p/create" element={<ExternalRedirect to="/treasury" />} />
                <Route path="/p2p/orders" element={<ExternalRedirect to="/treasury" />} />
                <Route path="/proxies" element={<ExternalRedirect to="/userbot/proxies" />} />
                <Route path="/admin-groups" element={<Navigate to="/" replace />} />
                <Route path="/profile" element={<ExternalRedirect to="/userbot/profile" />} />
              </Routes>
            </Suspense>
            </ErrorBoundary>
          </AuthGate>
        </main>

        <OpsRail />

        <Toaster position="bottom-right" richColors duration={4000} />
      </div>
    </div>
  );
}
