import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { User } from 'lucide-react';
import { useAuth } from './app/providers/AuthProvider.jsx';
import { AuthGate } from './ui/AuthGate.jsx';
import { ErrorBoundary } from './ui/ErrorBoundary.jsx';
import { LoadingState } from './ui/LoadingState.jsx';
import { Toaster } from './components/ui/sonner.jsx';
import { OpsRail } from './ui/OpsRail.jsx';

const ProfilePage = lazy(() => import('./pages/ProfilePage.jsx').then((module) => ({ default: module.ProfilePage })));

// Единый стиль пунктов сайдбара — байт-в-байт как в userbot-v2.
const NAV_ICON_CLASS = 'w-[18px] h-[18px] flex-shrink-0';

function navItemClassName(isActive) {
  return `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
    isActive
      ? 'bg-indigo-50 text-indigo-700'
      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
  }`;
}

// Профиль — отдельное приложение (2026-09-28, вынесено из userbot-v2):
// идентичность, тариф, кошелёк, Telegram, покупки. Шелл и правый рельс —
// как в остальных приложениях (2026-09-29: рельс возвращён, меню выровнено).
export function App() {
  const { user } = useAuth();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const navSections = [
    {
      title: 'Профиль',
      items: [
        { to: '/', label: 'Профиль', icon: User },
      ]
    }
  ];
  const navItems = navSections.flatMap((section) => section.items);

  // Экран один: и «/», и неизвестный путь рендерят ProfilePage — заголовок константный.
  const currentNavLabel = 'Профиль';

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
          aria-label="Bullgram — Профиль"
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
                      className={({ isActive }) => navItemClassName(isActive)}
                    >
                      <Icon className={NAV_ICON_CLASS} />
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
              Home
            </a>
            <span className="text-slate-300">·</span>
            <a href="/userbot/mcp" className="transition-colors hover:text-slate-700">
              MCP
            </a>
            <span className="text-slate-300">·</span>
            <a href="/userbot/api" className="transition-colors hover:text-slate-700">
              API
            </a>
          </div>
        </div>
      </aside>

      <div className="workspace-shell">
        <main className="main">
          <AuthGate>
            <ErrorBoundary>
              <Suspense fallback={<LoadingState text="Грузим профиль..." />}>
                <Routes>
                  <Route path="/" element={<ProfilePage />} />
                  <Route path="*" element={<ProfilePage />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </AuthGate>
        </main>

        <OpsRail showPaywall={false} showAllPromos />

        <Toaster position="bottom-right" richColors duration={4000} />
      </div>
    </div>
  );
}

export default App;
