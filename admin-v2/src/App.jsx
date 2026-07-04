import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, UserPlus, FileText, ShoppingBag, Database,
  Bot, Rocket, Globe, Settings, Wallet, Receipt, Activity, Send, Target,
  RefreshCcw, AlertTriangle, Eye, LockKeyhole, Landmark, Workflow, KeyRound,
  Zap
} from 'lucide-react';
import { useAuth } from './app/providers/AuthProvider.jsx';
import { AuthGate } from './ui/AuthGate.jsx';
import { LoadingState } from './ui/LoadingState.jsx';
import { OpsChecklistRail } from './ui/OpsChecklistRail.jsx';
import { Toaster } from './components/ui/sonner.jsx';

const CommandCenterPage = lazy(() => import('./pages/CommandCenterPage.jsx').then((module) => ({ default: module.CommandCenterPage })));
const UserbotCenterPage = lazy(() => import('./pages/UserbotCenterPage.jsx').then((module) => ({ default: module.UserbotCenterPage })));
const CustomersPage = lazy(() => import('./pages/CustomersPage.jsx').then((module) => ({ default: module.CustomersPage })));
const CrmPage = lazy(() => import('./pages/CrmPage.jsx').then((module) => ({ default: module.CrmPage })));
const OrdersPage = lazy(() => import('./pages/OrdersPage.jsx').then((module) => ({ default: module.OrdersPage })));
const AccessPage = lazy(() => import('./pages/AccessPage.jsx').then((module) => ({ default: module.AccessPage })));
const CustomerBasesPage = lazy(() => import('./pages/CustomerBasesPage.jsx').then((module) => ({ default: module.CustomerBasesPage })));
const ClientDossierPage = lazy(() => import('./pages/ClientDossierPage.jsx').then((module) => ({ default: module.ClientDossierPage })));
const ObserverPage = lazy(() => import('./pages/ObserverPage.jsx').then((module) => ({ default: module.ObserverPage })));
const ShopAdminPage = lazy(() => import('./pages/shop/ShopAdminPage.jsx').then((module) => ({ default: module.ShopAdminPage })));
const UserbotAccountsPage = lazy(() => import('./pages/BotsAccountsPage.jsx').then((module) => ({ default: module.UserbotAccountsPage })));
const OfficialBotsPage = lazy(() => import('./pages/BotsAccountsPage.jsx').then((module) => ({ default: module.OfficialBotsPage })));
const ReferralsPage = lazy(() => import('./pages/ReferralsPage.jsx').then((module) => ({ default: module.ReferralsPage })));
const RetentionPage = lazy(() => import('./pages/RetentionPage.jsx').then((module) => ({ default: module.RetentionPage })));
const AbandonedPage = lazy(() => import('./pages/AbandonedPage.jsx').then((module) => ({ default: module.AbandonedPage })));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage.jsx').then((module) => ({ default: module.AnalyticsPage })));
const PaymentSettingsPage = lazy(() => import('./pages/PaymentSettingsPage.jsx').then((module) => ({ default: module.PaymentSettingsPage })));
const ProxyManagerPage = lazy(() => import('./pages/ProxyManagerPage.jsx').then((module) => ({ default: module.ProxyManagerPage })));
const BroadcastPage = lazy(() => import('./pages/BroadcastPage.jsx').then((module) => ({ default: module.BroadcastPage })));
const McpSettingsPage = lazy(() => import('./pages/McpSettingsPage.jsx').then((module) => ({ default: module.McpSettingsPage })));
const ProjectTreasuryPage = lazy(() => import('./pages/ProjectTreasuryPage.jsx').then((module) => ({ default: module.ProjectTreasuryPage })));
const IntegrationsPage = lazy(() => import('./pages/IntegrationsPage.jsx').then((module) => ({ default: module.IntegrationsPage })));
const ApiN8nPage = lazy(() => import('./pages/ApiN8nPage.jsx').then((module) => ({ default: module.ApiN8nPage })));
const QuickStartPage = lazy(() => import('./pages/QuickStartPage.jsx').then((module) => ({ default: module.QuickStartPage })));
export function App() {
  const { user, profileRole } = useAuth();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const navSections = [
    {
      title: 'Quick Start',
      items: [
        { to: '/autopost', label: 'Автопостер', icon: Zap },
        { to: '/botfather', label: 'Бот продаж', icon: Bot },
      ]
    },
    {
      title: 'Основное',
      items: [
        { to: '/', label: 'Командный центр', icon: LayoutDashboard },
      ]
    },
    {
      title: 'Продажи и Клиенты',
      items: [
        { to: '/customers', label: 'Клиенты', icon: Users },
        ...(profileRole === 'admin' ? [{ to: '/shop', label: 'Магазин', icon: ShoppingBag }] : []),
        { to: '/plans', label: 'Тарифы и доступ', icon: FileText },
      ]
    },
    {
      title: 'Инфраструктура',
      items: [
        { to: '/userbots', label: 'Юзерботы', icon: Rocket },
        { to: '/userbot-center', label: 'Центр юзербота', icon: Target },
        { to: '/proxies', label: 'Прокси', icon: Globe },
        { to: '/integrations', label: 'Интеграции', icon: KeyRound },
      ]
    },
    {
      title: 'Финансы',
      items: [
        { to: '/billing', label: 'Касса', icon: Wallet },
        ...(profileRole === 'admin' ? [{ to: '/treasury', label: 'Казна проекта', icon: Landmark }] : [])
      ]
    },
    {
      title: 'Маркетинг',
      items: [
        { to: '/referrals', label: 'Партнерка', icon: Users },
      ]
    },
    ...(profileRole === 'admin'
      ? [{
        title: 'Для админа',
        items: [
          { to: '/crm', label: 'CRM', icon: Users },
          { to: '/analytics', label: 'Аналитика', icon: Activity },
          { to: '/orders', label: 'Заказы', icon: ShoppingBag },
          { to: '/abandoned', label: 'Брошенные корзины', icon: AlertTriangle },
          { to: '/access', label: 'Доступ', icon: LockKeyhole },
          { to: '/bases', label: 'Базы', icon: Database },
          { to: '/dossier', label: 'Досье', icon: UserPlus },
          { to: '/broadcast', label: 'Рассылки', icon: Send },
          { to: '/retention', label: 'Удержание', icon: RefreshCcw },
          { to: '/observer', label: 'Пульт наблюдения', icon: Eye },
          { to: '/api/mcp', label: 'MCP', icon: Settings },
          { to: '/api/n8n', label: 'n8n', icon: Workflow },
        ]
      }]
      : [])
  ];
  const navItems = navSections.flatMap((section) => section.items);

  const currentNavLabel = useMemo(() => {
    if (location.pathname === '/') return 'Командный центр';
    const current = navItems.find((item) => item.to !== '/' && location.pathname.startsWith(item.to));
    return current?.label || 'Bullgram';
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
        <div className="mb-2 px-2 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm shadow-md shadow-blue-500/20">
            BR
          </div>
          <span className="font-black text-xl tracking-tight text-slate-900">Bullgram</span>
        </div>
        
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
                      <Icon className="w-[18px] h-[18px] flex-shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <div className="workspace-shell">
        <main className="main">
          <AuthGate>
            <Suspense fallback={<LoadingState text="Грузим экран admin-v2..." />}>
              <Routes>
                <Route path="/" element={<CommandCenterPage />} />
                <Route path="/autopost" element={<QuickStartPage />} />
                <Route path="/userbot-center" element={<UserbotCenterPage />} />
                <Route path="/customers" element={<CustomersPage />} />
                <Route path="/crm" element={<CrmPage />} />
                <Route path="/orders" element={<OrdersPage />} />
                <Route path="/access" element={<AccessPage />} />
                <Route path="/bases" element={<CustomerBasesPage />} />
                <Route path="/dossier" element={<ClientDossierPage />} />
                <Route path="/userbots" element={<UserbotAccountsPage />} />
                <Route path="/botfather" element={<OfficialBotsPage />} />
                <Route path="/bots" element={<Navigate to="/userbots" replace />} />
                <Route path="/shop" element={profileRole === 'admin' ? <ShopAdminPage /> : <Navigate to="/" replace />} />
                <Route path="/shop-receipts" element={<Navigate to="/billing" replace />} />
                <Route path="/referrals" element={<ReferralsPage />} />
                <Route path="/retention" element={<RetentionPage />} />
                <Route path="/abandoned" element={<AbandonedPage />} />
                <Route path="/analytics" element={<AnalyticsPage />} />
                <Route path="/broadcast" element={<BroadcastPage />} />
                <Route path="/payments" element={<Navigate to="/billing" replace />} />
                <Route path="/claw" element={<McpSettingsPage />} />
                <Route path="/integrations" element={<IntegrationsPage />} />
                <Route path="/api" element={<Navigate to="/api/mcp" replace />} />
                <Route path="/api/mcp" element={<McpSettingsPage />} />
                <Route path="/api/sms-push" element={<Navigate to="/billing" replace />} />
                <Route path="/api/n8n" element={<ApiN8nPage />} />
                <Route path="/plans" element={<PaymentSettingsPage mode="plans" />} />
                <Route path="/billing" element={<PaymentSettingsPage mode="billing" />} />
                <Route path="/treasury" element={<ProjectTreasuryPage />} />
                <Route path="/proxies" element={<ProxyManagerPage />} />
                <Route path="/admin-groups" element={<Navigate to="/app" replace />} />
                <Route path="/observer" element={<ObserverPage />} />
                <Route path="/p2p/create" element={<Navigate to="/shop" replace />} />
                <Route path="/p2p/orders" element={<Navigate to="/shop" replace />} />
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
