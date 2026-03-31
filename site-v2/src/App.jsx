import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { HomePage } from './pages/HomePage.jsx';
import { PricingPage } from './pages/PricingPage.jsx';
import { ShopPage } from './pages/ShopPage.jsx';
import { SALES_LINKS } from './components/MarketingPrimitives.jsx';
import { useAuth } from './app/providers/AuthProvider.jsx';

const navSections = [
  {
    title: 'BullRun',
    items: [
      { to: '/', label: 'Главная' },
      { to: '/pricing', label: 'Тарифы' },
      { to: '/shop', label: 'Shop' }
    ]
  }
];

export function App() {
  const location = useLocation();
  const isHomeRoute = location.pathname === '/';
  const { user, login, logout, profilePlan, profileRole, trialEndsAt, checkoutPulse, sellerPulse, packagePulse } = useAuth();
  const sellerIsAssetMarketplace = profileRole === 'admin';
  const checkoutSignal = (() => {
    if (!user || !checkoutPulse) return null;

    if (checkoutPulse.failedCount > 0) {
      return {
        eyebrow: 'Handoff сломан',
        title: 'Оплата уже есть, но передача прав где-то споткнулась',
        text: 'Не начинай новые сделки вслепую. Сначала добей проблемный handoff в Shop, потом возвращайся к следующему офферу.',
        href: '/shop',
        label: 'Открыть мои покупки'
      };
    }

    if (checkoutPulse.awaitingReceiptCount > 0) {
      return {
        eyebrow: 'Ждет чек',
        title: 'Есть P2P-покупка, которая ждет ручной проверки',
        text: 'Продавец уже должен увидеть этот платеж. Открой покупки и не дублируй оплату.',
        href: '/shop',
        label: 'Открыть мои покупки'
      };
    }

    if (checkoutPulse.pendingCount > 0) {
      return {
        eyebrow: 'Открытый checkout',
        title: 'У тебя уже есть незакрытый счет',
        text: 'Не плодить новые корзины. Сначала закрой текущий TON/P2P checkout и потом переходи к следующему шагу.',
        href: '/shop',
        label: 'Вернуться к checkout'
      };
    }

    if (profilePlan === 'trial' && checkoutPulse.paidCount > 0) {
      return {
        eyebrow: 'Пора апгрейдиться',
        title: 'Первый checkout закрыт, Trial уже сделал свою работу',
        text: 'Теперь логичный следующий шаг — переход на Normal, чтобы открыть рабочий контур без trial-стопоров.',
        href: '/shop?offer=normal',
        label: 'Перейти на Normal'
      };
    }

    return null;
  })();
  const trialUrgencySignal = (() => {
    if (!user || profilePlan !== 'trial' || !trialEndsAt) return null;

    const endsAt = new Date(trialEndsAt).getTime();
    const diffMs = endsAt - Date.now();
    if (Number.isNaN(endsAt) || diffMs <= 0 || diffMs > 1000 * 60 * 60 * 72) return null;

    const hoursLeft = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60)));
    const deadlineLabel = new Intl.DateTimeFormat('ru-RU', {
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(new Date(trialEndsAt));

    return {
      eyebrow: 'Trial скоро сгорит',
      title: `До конца trial осталось около ${hoursLeft} ч`,
      text: `Дедлайн trial: ${deadlineLabel}. Если уже собрал первый контур, не тяни — переходи на Normal и снимай trial-лимиты до того, как входной режим начнет тормозить работу.`,
      href: '/shop?offer=normal',
      label: 'Открыть Normal'
    };
  })();
  const sellerSignal = (() => {
    if (!user || profilePlan !== 'normal' || !sellerPulse?.hasAny) return null;

    if (sellerPulse.failedCount > 0) {
      return {
        eyebrow: 'Seller handoff сломан',
        title: 'Seller checkout уже был, но передача прав споткнулась',
        text: 'Не открывай новый seller-flow поверх сломанного хвоста. Сначала добей handoff в Shop, потом возвращайся к seller mode.',
        href: '/shop?offer=seller',
        label: 'Добить seller checkout'
      };
    }

    if (sellerPulse.awaitingReceiptCount > 0) {
      return {
        eyebrow: 'Seller ждет чек',
        title: 'Есть seller-покупка, которая ждет ручной проверки',
        text: 'Продавец уже должен увидеть этот seller checkout. Не начинай новый апгрейд, пока этот хвост не закроется.',
        href: '/shop?offer=seller',
        label: 'Вернуться к seller checkout'
      };
    }

    if (sellerPulse.pendingCount > 0) {
      return {
        eyebrow: 'Seller checkout открыт',
        title: 'Seller mode уже открыт и ждет оплаты',
        text: 'Сначала закрой текущий seller checkout, потом уже двигайся дальше по каталогу и кабинетам.',
        href: '/shop?offer=seller',
        label: 'Открыть seller checkout'
      };
    }

    return null;
  })();
  const shellSignal = checkoutSignal || trialUrgencySignal || sellerSignal;
  const primaryShellAction = (() => {
    if (shellSignal) {
      return {
        href: shellSignal.href,
        label: shellSignal.label
      };
    }

    if (user && profilePlan === 'trial') {
      return {
        href: SALES_LINKS.ops,
        label: 'Перейти на Normal'
      };
    }

    return {
      href: SALES_LINKS.trial,
      label: 'Начать Trial'
    };
  })();
  const accountShellAction = (() => {
    if (!user) return null;
    if (shellSignal) {
      return {
        href: '/shop',
        label: 'Мои покупки'
      };
    }

    if (profilePlan === 'normal') {
      if (sellerPulse?.failedCount || sellerPulse?.awaitingReceiptCount || sellerPulse?.pendingCount) {
        return {
          href: '/shop?offer=seller',
          label: 'Вернуться к seller checkout'
        };
      }

      if (sellerPulse?.paidCount) {
        return {
          href: '/app/shop',
          label: sellerIsAssetMarketplace ? 'Открыть seller admin' : 'Открыть P2P seller'
        };
      }

      return {
        href: '/app/',
        label: 'Открыть кабинет'
      };
    }

    return {
      href: '/shop',
      label: 'Мои покупки'
    };
  })();
  const packageShellCards = user && packagePulse ? [
    { id: 'trial', title: 'Trial', href: '/shop?offer=trial', signal: packagePulse.trial },
    { id: 'normal', title: 'Normal', href: '/shop?offer=normal', signal: packagePulse.normal },
    { id: 'seller', title: 'Seller', href: '/shop?offer=seller', signal: packagePulse.seller }
  ] : [];
  const appRoutes = (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/shop" element={<ShopPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );

  if (isHomeRoute) {
    return <main className="site-main site-main--home">{appRoutes}</main>;
  }

  return (
    <div className="site-shell">
      <aside className="site-sidebar">
        <div className="site-brand">
          <div className="site-brand__eyebrow">BullRun</div>
          <div className="site-brand__title">Платные Telegram-каналы без ручной возни</div>
          <div className="site-brand__text">
            Публичный сайт объясняет базовый сценарий монетизации. Админка и широкая операционка остаются внутри, а не
            бьют человека по голове с первого экрана.
          </div>
        </div>

        <nav className="site-nav">
          {navSections.map((section) => (
            <div key={section.title} className="site-nav__section">
              <div className="site-nav__section-title">{section.title}</div>
              <div className="site-nav__section-items">
                {section.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) => `site-nav__item${isActive ? ' site-nav__item--active' : ''}`}
                  >
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="site-sidebar__cta">
          <a className="site-button site-button--primary" href={primaryShellAction.href}>
            {primaryShellAction.label}
          </a>
          <a className="site-button" href="/pricing">
            Тарифы
          </a>
          <a className="site-button" href="/shop">
            Shop
          </a>
          {user ? (
            <>
              {accountShellAction ? (
                <a className="site-button" href={accountShellAction.href}>
                  {accountShellAction.label}
                </a>
              ) : null}
              <button className="site-button" type="button" onClick={() => logout()}>
                Выйти
              </button>
            </>
          ) : (
            <button className="site-button" type="button" onClick={() => login()}>
              Войти через Google
            </button>
          )}
          <a className="site-button" href="/app/" target="_blank" rel="noreferrer">
            Открыть admin v2
          </a>
        </div>
      </aside>

      <main className="site-main">
        <header className="site-topbar">
          <div>
            <div className="site-topbar__title">BullRun: запуск платного Telegram-канала</div>
            <div className="site-topbar__text">
              Сначала продаем понятный результат: оплата, доступ и продление. Широкие контуры BullRun остаются ниже и не
              мешают первому впечатлению.
            </div>
          </div>
          <div className="site-topbar__actions">
            <a className="site-button site-button--primary" href={primaryShellAction.href}>
              {primaryShellAction.label}
            </a>
            <a className="site-button" href="/pricing">
              Тарифы
            </a>
            <a className="site-button" href="/shop">
              Shop
            </a>
            {user ? (
              <>
                {accountShellAction ? (
                  <a className="site-button site-button--primary" href={accountShellAction.href}>
                    {accountShellAction.label}
                  </a>
                ) : null}
                <a className="site-button" href="/app/" target="_blank" rel="noreferrer">
                  Кабинет
                </a>
              </>
            ) : (
              <button className="site-button site-button--primary" type="button" onClick={() => login()}>
                Войти через Google
              </button>
            )}
          </div>
        </header>

        {shellSignal ? (
          <section className="site-live-signal">
            <div>
              <div className="site-live-signal__eyebrow">{shellSignal.eyebrow}</div>
              <div className="site-live-signal__title">{shellSignal.title}</div>
              <div className="site-live-signal__text">{shellSignal.text}</div>
            </div>
            <div className="site-live-signal__actions">
              <a className="site-button site-button--primary" href={shellSignal.href}>
                {shellSignal.label}
              </a>
            </div>
          </section>
        ) : null}

        {packageShellCards.length ? (
          <section className="package-progress-grid" style={{ marginTop: 20 }}>
            {packageShellCards.map((pkg) => (
              <a
                key={pkg.id}
                href={pkg.href}
                className={`package-progress-card package-progress-card--${pkg.signal.state}`}
              >
                <div className="package-progress-card__topline">
                  <div className="marketing-card__title">{pkg.title}</div>
                  <div className="package-badge">{pkg.signal.label}</div>
                </div>
                <div className="marketing-card__text">
                  {pkg.id === 'trial'
                    ? 'Входной слой: первый checkout и первый Telegram-контур.'
                    : pkg.id === 'normal'
                      ? 'Основной рабочий контур без trial-стопоров.'
                      : 'Seller mode для витрины, handoff и продажи активов.'}
                </div>
              </a>
            ))}
          </section>
        ) : null}

        {appRoutes}
      </main>
    </div>
  );
}
