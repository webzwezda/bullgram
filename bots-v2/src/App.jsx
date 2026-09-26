import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { CalendarClock, LayoutDashboard } from 'lucide-react';
import { useAuth } from './app/providers/AuthProvider.jsx';
import { AuthGate } from './ui/AuthGate.jsx';
import { ErrorBoundary } from './ui/ErrorBoundary.jsx';
import { LoadingState } from './ui/LoadingState.jsx';
import { Toaster } from './components/ui/sonner.jsx';
import { OpsRail } from './ui/OpsRail.jsx';

// Экраны приложения (план 2026-09-27-bots-app-split, Фаза 3): хаб живой,
// автопостер перенесён из admin-v2 (QuickStartPage → AutopostManagePage).
const HubPage = lazy(() => import('./pages/HubPage.jsx'));
const AutopostManagePage = lazy(() => import('./pages/autopost/AutopostManagePage.jsx'));

export function App() {
  const { user } = useAuth();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const navSections = [
    {
      title: 'Боты',
      items: [
        { to: '/', label: 'Хаб', icon: LayoutDashboard },
        { to: '/autopost', label: 'Автопостер', icon: CalendarClock },
      ]
    }
  ];
  const navItems = navSections.flatMap((section) => section.items);

  const currentNavLabel = useMemo(() => {
    if (location.pathname === '/') return 'Хаб';
    const exact = navItems.find((item) => item.to === location.pathname);
    if (exact) return exact.label;
    const prefix = navItems.find((item) => item.to !== '/' && location.pathname.startsWith(`${item.to}/`));
    return prefix?.label || 'Боты';
  }, [location.pathname, navItems]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  if (!user) {
    return (
      <>
        <AuthGate />
        <OpsRail showPaywall={false} />

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
          aria-label="Bullgram — Боты"
        >
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-sm shadow-md shadow-indigo-600/20">
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
                          ? 'bg-indigo-50 text-indigo-700'
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
          <div className="flex items-center gap-3 text-[11px] font-medium text-slate-500">
            <a href="/" className="transition-colors hover:text-slate-700">
              На сайт
            </a>
            <span className="text-slate-300">·</span>
            <a href="/userbot" className="transition-colors hover:text-slate-700">
              Юзербот
            </a>
          </div>
        </div>
      </aside>

      <div className="workspace-shell">
        <main className="main">
          <AuthGate>
            <ErrorBoundary>
              <Suspense fallback={<LoadingState text="Грузим экран..." />}>
                <Routes>
                  <Route path="/" element={<HubPage />} />
                  <Route path="/autopost" element={<AutopostManagePage />} />
                  <Route path="*" element={<HubPage />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </AuthGate>
        </main>

        <OpsRail showPaywall={false} />

        <Toaster position="bottom-right" richColors duration={4000} />
      </div>
    </div>
  );
}
