import { Suspense, lazy, useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { User } from 'lucide-react';
import { useAuth } from './app/providers/AuthProvider.jsx';
import { AuthGate } from './ui/AuthGate.jsx';
import { ErrorBoundary } from './ui/ErrorBoundary.jsx';
import { LoadingState } from './ui/LoadingState.jsx';
import { Toaster } from './components/ui/sonner.jsx';

const ProfilePage = lazy(() => import('./pages/ProfilePage.jsx').then((module) => ({ default: module.ProfilePage })));

// Единый стиль пунктов сайдбара.
const NAV_ICON_CLASS = 'w-4.5 h-4.5 shrink-0';

function navItemClassName(isActive) {
  return `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
    isActive
      // `!` обязателен: unlayered `a { color: inherit }` в app.css перебивает цветовые утилиты на анкорах
      ? 'bg-action-primary text-action-primary-text!'
      : 'text-ink-body hover:bg-surface-subtle hover:text-ink-strong'
  }`;
}

// Профиль — отдельное приложение (2026-09-28, вынесено из userbot-v2):
// один экран (идентичность, кошелёк, Telegram, покупки), без рельс OpsRail
// и без админ-гейта казны. Лейаут и стиль сайдбара — как в userbot-v2.
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
        className={`sidebar bg-surface-card border-r border-border-default flex flex-col gap-6 p-5 sticky top-0 h-screen overflow-y-auto${mobileNavOpen ? ' sidebar--mobile-open' : ''}`}
      >
        <NavLink
          to="/"
          end
          onClick={() => setMobileNavOpen(false)}
          className="mb-2 px-2 flex items-center gap-3 rounded-xl transition-transform hover:scale-[1.02]"
          aria-label="Bullgram — Профиль"
        >
          <div className="w-8 h-8 rounded-lg bg-action-primary flex items-center justify-center text-action-primary-text font-bold text-sm shadow-md">
            BR
          </div>
          <span className="font-black text-xl tracking-tight text-ink-strong">Bullgram</span>
        </NavLink>

        <nav className="flex flex-col gap-6 flex-1 min-h-0 overflow-y-auto pr-1 -mr-1" style={{ scrollbarWidth: 'none' }}>
          {navSections.map((section) => (
            <div key={section.title} className="flex flex-col gap-1.5">
              <div className="px-3 text-xs font-bold tracking-wider uppercase text-ink-muted mb-1">
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

        <div className="px-3 pt-4 border-t border-border-default">
          <div className="flex items-center gap-3 text-xs font-medium text-ink-muted">
            <a href="/" className="transition-colors hover:text-ink-body">
              На сайт
            </a>
            <span className="text-ink-faint">·</span>
            <a href="/userbot" className="transition-colors hover:text-ink-body">
              Юзербот
            </a>
            <span className="text-ink-faint">·</span>
            <a href="/paywall" className="transition-colors hover:text-ink-body">
              Paywall
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

        <Toaster position="bottom-right" richColors duration={4000} />
      </div>
    </div>
  );
}

export default App;
