import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './app/providers/AuthProvider.jsx';
import { AuthGate } from './ui/AuthGate.jsx';
import { LoadingState } from './ui/LoadingState.jsx';
import { OpsChecklistRail } from './ui/OpsChecklistRail.jsx';

const CommandCenterPage = lazy(() => import('./pages/CommandCenterPage.jsx').then((module) => ({ default: module.CommandCenterPage })));
const UserbotCenterPage = lazy(() => import('./pages/UserbotCenterPage.jsx').then((module) => ({ default: module.UserbotCenterPage })));
const CrmPage = lazy(() => import('./pages/CrmPage.jsx').then((module) => ({ default: module.CrmPage })));
const OrdersPage = lazy(() => import('./pages/OrdersPage.jsx').then((module) => ({ default: module.OrdersPage })));
const AccessPage = lazy(() => import('./pages/AccessPage.jsx').then((module) => ({ default: module.AccessPage })));
const CustomerBasesPage = lazy(() => import('./pages/CustomerBasesPage.jsx').then((module) => ({ default: module.CustomerBasesPage })));
const ClientDossierPage = lazy(() => import('./pages/ClientDossierPage.jsx').then((module) => ({ default: module.ClientDossierPage })));
const ObserverPage = lazy(() => import('./pages/ObserverPage.jsx').then((module) => ({ default: module.ObserverPage })));
const AdminGroupsPage = lazy(() => import('./pages/AdminGroupsPage.jsx').then((module) => ({ default: module.AdminGroupsPage })));
const ShopAdminPage = lazy(() => import('./pages/ShopAdminPage.jsx').then((module) => ({ default: module.ShopAdminPage })));
const ShopReceiptsPage = lazy(() => import('./pages/ShopReceiptsPage.jsx').then((module) => ({ default: module.ShopReceiptsPage })));
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
export function App() {
  const { profileRole } = useAuth();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const navSections = [
    {
      title: 'Telegram контур',
      items: [
        { to: '/proxies', label: 'Прокси' },
        { to: '/userbots', label: 'Юзерботы' },
        { to: '/botfather', label: 'Бот продаж' },
        { to: '/admin-groups', label: 'Группы и права' },
        { to: '/claw', label: 'Клешня / MCP' },
        { to: '/billing', label: 'Касса / webhook' },
        { to: '/plans', label: 'Тарифы и планы' },
        { to: '/shop-receipts', label: 'Проверка чеков' },
        { to: '/orders', label: 'Заказы' },
        { to: '/access', label: 'Доступ' }
      ]
    },
    {
      title: 'Приватные группы',
      items: [
        { to: '/', label: 'Командный центр' },
        { to: '/userbot-center', label: 'Центр юзербота' },
        { to: '/crm', label: 'CRM' },
        { to: '/bases', label: 'Базы' },
        { to: '/dossier', label: 'Досье' },
        { to: '/retention', label: 'Удержание' },
        { to: '/abandoned', label: 'Брошенные корзины' },
        { to: '/analytics', label: 'Аналитика' },
        { to: '/broadcast', label: 'Рассылки' },
        ...(profileRole === 'admin' ? [{ to: '/observer', label: 'Пульт наблюдения' }] : [])
      ]
    }
  ];
  const navItems = navSections.flatMap((section) => section.items);

  const currentNavLabel = useMemo(() => {
    if (location.pathname === '/') return 'Командный центр';
    const current = navItems.find((item) => item.to !== '/' && location.pathname.startsWith(item.to));
    return current?.label || 'BullRun';
  }, [location.pathname, navItems]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

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

      <aside className={`sidebar${mobileNavOpen ? ' sidebar--mobile-open' : ''}`}>
        <nav className="nav">
          {navSections.map((section) => (
            <div key={section.title} className="nav__section">
              <div className="nav__section-title">{section.title}</div>
              <div className="nav__section-items">
                {section.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    onClick={() => setMobileNavOpen(false)}
                    className={({ isActive }) => `nav__item${isActive ? ' nav__item--active' : ''}`}
                  >
                    {item.label}
                  </NavLink>
                ))}
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
                <Route path="/userbot-center" element={<UserbotCenterPage />} />
                <Route path="/crm" element={<CrmPage />} />
                <Route path="/orders" element={<OrdersPage />} />
                <Route path="/access" element={<AccessPage />} />
                <Route path="/bases" element={<CustomerBasesPage />} />
                <Route path="/dossier" element={<ClientDossierPage />} />
                <Route path="/userbots" element={<UserbotAccountsPage />} />
                <Route path="/botfather" element={<OfficialBotsPage />} />
                <Route path="/bots" element={<Navigate to="/userbots" replace />} />
                <Route path="/shop" element={<ShopAdminPage />} />
                <Route path="/shop-receipts" element={<ShopReceiptsPage />} />
                <Route path="/referrals" element={<ReferralsPage />} />
                <Route path="/retention" element={<RetentionPage />} />
                <Route path="/abandoned" element={<AbandonedPage />} />
                <Route path="/analytics" element={<AnalyticsPage />} />
                <Route path="/broadcast" element={<BroadcastPage />} />
                <Route path="/payments" element={<PaymentSettingsPage mode="requisites" />} />
                <Route path="/claw" element={<McpSettingsPage />} />
                <Route path="/plans" element={<PaymentSettingsPage mode="plans" />} />
                <Route path="/billing" element={<PaymentSettingsPage mode="billing" />} />
                <Route path="/proxies" element={<ProxyManagerPage />} />
                <Route path="/admin-groups" element={<AdminGroupsPage />} />
                <Route path="/observer" element={<ObserverPage />} />
                <Route path="/p2p/create" element={<Navigate to="/shop" replace />} />
                <Route path="/p2p/orders" element={<Navigate to="/shop" replace />} />
              </Routes>
            </Suspense>
          </AuthGate>
        </main>

        <OpsChecklistRail />
      </div>
    </div>
  );
}
