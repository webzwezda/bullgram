import { Suspense, lazy, useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Landmark } from 'lucide-react';
import { useAuth } from './app/providers/AuthProvider.jsx';
import { AuthGate } from './ui/AuthGate.jsx';
import { ErrorBoundary } from './ui/ErrorBoundary.jsx';
import { LoadingState } from './ui/LoadingState.jsx';
import { Toaster } from './components/ui/sonner.jsx';
import { OpsRail } from './ui/OpsRail.jsx';

const TreasuryPage = lazy(() => import('./pages/treasury/TreasuryPage.jsx').then((module) => ({ default: module.TreasuryPage })));

// Казна — внутренний инструмент платформы (учёт TON, резервы, выводы).
// Отдельное приложение вне продуктовых поверхностей; доступ — только
// у платформенного админа (role в profiles), гейт ниже.
export function App() {
  const { profileRole, profileLoading } = useAuth();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  return (
    <div className="app-shell">
      <div className="mobile-bar">
        <div className="mobile-bar__title">Казна</div>
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
          aria-label="Bullgram — Казна"
        >
          <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white font-black text-sm shrink-0">BR</span>
          <span className="text-base font-black tracking-tight text-slate-900">Bullgram</span>
        </NavLink>

        <nav className="flex flex-col gap-6 flex-1 min-h-0 overflow-y-auto pr-1 -mr-1" style={{ scrollbarWidth: 'none' }}>
          <div className="flex flex-col gap-1.5">
            <div className="px-3 text-[11px] font-bold tracking-wider uppercase text-slate-500 mb-1">
              Платформа
            </div>
            <NavLink
              to="/"
              end
              className={({ isActive }) => `
                flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200
                ${isActive
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }
              `}
            >
              <Landmark className="w-[18px] h-[18px] flex-shrink-0" />
              <span className="truncate">Казна</span>
            </NavLink>
          </div>
        </nav>

        <div className="px-3 pt-4 border-t border-slate-100">
          <div className="flex items-center gap-3 text-[11px] font-medium text-slate-500">
            <a href="/" className="transition-colors hover:text-slate-700">
              На сайт
            </a>
            <span className="text-slate-300">·</span>
            <a href="/paywall" className="transition-colors hover:text-slate-700">
              Paywall
            </a>
          </div>
        </div>
      </aside>

      <div className="workspace-shell">
        <main className="main">
          <AuthGate>
            <ErrorBoundary>
              {profileLoading ? (
                <LoadingState text="Проверяем доступ..." />
              ) : profileRole === 'admin' ? (
                <Suspense fallback={<LoadingState text="Грузим казну..." />}>
                  <TreasuryPage />
                </Suspense>
              ) : (
                <section className="page page--flush">
                  <div className="error-card">
                    Казна — внутренний инструмент платформы. Доступ есть только у платформенного админа.
                  </div>
                </section>
              )}
            </ErrorBoundary>
          </AuthGate>
        </main>

        <OpsRail showPaywall={false} />

        <Toaster position="bottom-right" richColors duration={4000} />
      </div>
    </div>
  );
}

export default App;
