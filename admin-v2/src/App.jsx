import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import {
  Users, UserPlus, ShoppingBag, ShoppingCart, Database,
  Bot, Rocket, Globe, Wallet, Receipt, Send,
  RefreshCcw, Landmark,
  Zap, CheckSquare, History
} from 'lucide-react';
import { useAuth } from './app/providers/AuthProvider.jsx';
import { AuthGate } from './ui/AuthGate.jsx';
import { LoadingState } from './ui/LoadingState.jsx';
import { OpsChecklistRail } from './ui/OpsChecklistRail.jsx';
import { Toaster } from './components/ui/sonner.jsx';

const CommandCenterPage = lazy(() => import('./pages/CommandCenterPage.jsx').then((module) => ({ default: module.CommandCenterPage })));
const CustomersPage = lazy(() => import('./pages/CustomersPage.jsx').then((module) => ({ default: module.CustomersPage })));
const BasesPage = lazy(() => import('./pages/BasesPage.jsx').then((module) => ({ default: module.BasesPage })));
const ClientDossierPage = lazy(() => import('./pages/ClientDossierPage.jsx').then((module) => ({ default: module.ClientDossierPage })));
const ShopAdminPage = lazy(() => import('./pages/shop/ShopAdminPage.jsx').then((module) => ({ default: module.ShopAdminPage })));
const UserbotAccountsPage = lazy(() => import('./pages/BotsAccountsPage.jsx').then((module) => ({ default: module.UserbotAccountsPage })));
const OfficialBotsPage = lazy(() => import('./pages/BotsAccountsPage.jsx').then((module) => ({ default: module.OfficialBotsPage })));
const ReferralsPage = lazy(() => import('./pages/ReferralsPage.jsx').then((module) => ({ default: module.ReferralsPage })));
const RetentionPage = lazy(() => import('./pages/RetentionPage.jsx').then((module) => ({ default: module.RetentionPage })));
const AbandonedPage = lazy(() => import('./pages/AbandonedPage.jsx').then((module) => ({ default: module.AbandonedPage })));
const PaymentSettingsPage = lazy(() => import('./pages/PaymentSettingsPage.jsx').then((module) => ({ default: module.PaymentSettingsPage })));
const ProxyManagerPage = lazy(() => import('./pages/ProxyManagerPage.jsx').then((module) => ({ default: module.ProxyManagerPage })));
const BroadcastPage = lazy(() => import('./pages/BroadcastPage.jsx').then((module) => ({ default: module.BroadcastPage })));
const BroadcastHistoryPage = lazy(() => import('./pages/BroadcastHistoryPage.jsx').then((module) => ({ default: module.BroadcastHistoryPage })));
const McpSettingsPage = lazy(() => import('./pages/McpSettingsPage.jsx').then((module) => ({ default: module.McpSettingsPage })));
const ProjectTreasuryPage = lazy(() => import('./pages/ProjectTreasuryPage.jsx').then((module) => ({ default: module.ProjectTreasuryPage })));
const ApiIntegrationsPage = lazy(() => import('./pages/ApiIntegrationsPage.jsx').then((module) => ({ default: module.ApiIntegrationsPage })));
const QuickStartPage = lazy(() => import('./pages/QuickStartPage.jsx').then((module) => ({ default: module.QuickStartPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage.jsx').then((module) => ({ default: module.ProfilePage })));
const ChecklistPage = lazy(() => import('./pages/ChecklistPage.jsx').then((module) => ({ default: module.ChecklistPage })));
export function App() {
  const { user, profileRole, accessToken } = useAuth();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const navSections = [
    {
      title: 'Quick Start',
      items: [
        { to: '/autopost', label: 'Автопостер', icon: Zap },
        { to: '/sales-bot', label: 'Бот продаж', icon: Bot },
        { to: '/checklist', label: 'Чеклисты', icon: CheckSquare },
      ]
    },
    {
      title: 'Продажи и Клиенты',
      items: [
        { to: '/customers', label: 'Клиенты', icon: Users },
        { to: '/retention', label: 'Удержание', icon: RefreshCcw },
        { to: '/abandoned', label: 'Брошенные корзины', icon: ShoppingCart },
        { to: '/referrals', label: 'Партнерка', icon: Users },
        ...(profileRole === 'admin' ? [{ to: '/shop', label: 'Магазин', icon: ShoppingBag }] : []),
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
      title: 'Инфраструктура',
      items: [
        { to: '/userbots', label: 'Юзерботы', icon: Rocket },
        { to: '/proxies', label: 'Прокси', icon: Globe },
      ]
    },
    {
      title: 'Финансы',
      items: [
        { to: '/billing', label: 'Касса', icon: Wallet },
        ...(profileRole === 'admin' ? [{ to: '/treasury', label: 'Казна проекта', icon: Landmark }] : [])
      ]
    },
    ...(profileRole === 'admin'
      ? [{
        title: 'Для админа',
        items: [
          { to: '/dossier', label: 'Досье', icon: UserPlus },
        ]
      }]
      : [])
  ];
  const navItems = navSections.flatMap((section) => section.items);

  const currentNavLabel = useMemo(() => {
    if (location.pathname === '/') return 'Командный центр';
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
          aria-label="Bullgram — Командный центр"
        >
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm shadow-md shadow-blue-500/20">
            BR
          </div>
          <span className="font-black text-xl tracking-tight text-slate-900">Bullgram</span>
        </NavLink>
        
        <nav className="flex flex-col gap-6 flex-1 min-h-0 overflow-y-auto pr-1 -mr-1" style={{ scrollbarWidth: 'none' }}>
          {navSections.map((section) => (
            <div key={section.title} className="flex flex-col gap-1.5">
              <div className="px-3 text-[11px] font-bold tracking-wider uppercase text-slate-400 mb-1">
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
          <div className="flex items-center gap-3 text-[11px] font-medium text-slate-400">
            <a href="/" className="transition-colors hover:text-slate-700">
              На сайт
            </a>
            <span className="text-slate-300">·</span>
            <NavLink
              to="/api"
              className={({ isActive }) =>
                `transition-colors ${isActive ? 'text-slate-700' : 'hover:text-slate-700'}`
              }
            >
              API
            </NavLink>
            <span className="text-slate-300">·</span>
            <NavLink
              to="/mcp"
              className={({ isActive }) =>
                `transition-colors ${isActive ? 'text-slate-700' : 'hover:text-slate-700'}`
              }
            >
              MCP
            </NavLink>
          </div>
        </div>
      </aside>

      <div className="workspace-shell">
        <main className="main">
          <AuthGate>
            <Suspense fallback={<LoadingState text="Грузим экран admin-v2..." />}>
              <Routes>
                <Route path="/" element={<CommandCenterPage />} />
                <Route path="/autopost" element={<QuickStartPage />} />
                <Route path="/customers" element={<CustomersPage />} />
                <Route path="/crm" element={<Navigate to="/customers?tab=expired-in-group" replace />} />
                <Route path="/orders" element={<Navigate to="/customers?tab=paid-orders" replace />} />
                <Route path="/access" element={<Navigate to="/customers?tab=access" replace />} />
                <Route path="/bases" element={<BasesPage />} />
                <Route path="/dossier" element={<ClientDossierPage />} />
                <Route path="/userbots" element={<UserbotAccountsPage />} />
                <Route path="/sales-bot" element={<OfficialBotsPage />} />
                <Route path="/bots" element={<Navigate to="/userbots" replace />} />
                <Route path="/shop" element={profileRole === 'admin' ? <ShopAdminPage /> : <Navigate to="/" replace />} />
                <Route path="/shop-receipts" element={<Navigate to="/billing" replace />} />
                <Route path="/referrals" element={<ReferralsPage />} />
                <Route path="/retention" element={<RetentionPage />} />
                <Route path="/abandoned" element={<AbandonedPage />} />
                <Route path="/analytics" element={<Navigate to="/customers" replace />} />
                <Route path="/broadcast/history" element={<BroadcastHistoryPage />} />
                <Route path="/broadcast" element={<BroadcastPage />} />
                <Route path="/payments" element={<Navigate to="/billing" replace />} />
                <Route path="/claw" element={<Navigate to="/mcp" replace />} />
                <Route path="/claw/log" element={<Navigate to="/mcp" replace />} />
                <Route path="/integrations" element={<Navigate to="/api" replace />} />
                <Route path="/api" element={<ApiIntegrationsPage />} />
                <Route path="/mcp" element={<McpSettingsPage />} />
                <Route path="/api/mcp" element={<Navigate to="/mcp" replace />} />
                <Route path="/api/sms-push" element={<Navigate to="/billing" replace />} />
                <Route path="/plans" element={<Navigate to="/sales-bot" replace />} />
                <Route path="/billing" element={<PaymentSettingsPage mode="billing" />} />
                <Route path="/treasury" element={<ProjectTreasuryPage />} />
                <Route path="/proxies" element={<ProxyManagerPage />} />
                <Route path="/admin-groups" element={<Navigate to="/app" replace />} />
                <Route path="/p2p/create" element={<Navigate to="/shop" replace />} />
                <Route path="/p2p/orders" element={<Navigate to="/shop" replace />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/checklist" element={<ChecklistPage accessToken={accessToken} />} />
              </Routes>
            </Suspense>
          </AuthGate>
        </main>

        <OpsChecklistRail />

        <Toaster position="bottom-right" richColors duration={4000} />
      </div>
    </div>
  );
}
