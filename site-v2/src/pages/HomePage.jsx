const steps = [
  {
    number: '01',
    title: 'Видно, кто оплатил и кто зашел',
    text: 'Вы сразу видите, кто уже оплатил, кто получил доступ и кто так и не вошел в закрытый канал.',
    icon: 'verified_user'
  },
  {
    number: '02',
    title: 'Продления и вылеты под контролем',
    text: 'Система заранее напоминает об оплате и не дает просроченным подпискам висеть в закрытом канале неделями.',
    icon: 'notifications_active'
  },
  {
    number: '03',
    title: 'База клиентов и отчеты',
    text: 'Можно вести базу клиентов, смотреть оплаты и быстро понимать, где деньги уже пришли, а где люди теряются.',
    icon: 'insights'
  }
];

const features = [
  {
    title: 'Доступ после оплаты',
    text: 'После оплаты видно, кто получил доступ, кто вошел в канал, а кто завис между оплатой и входом.',
    icon: 'verified_user',
    tone: 'primary'
  },
  {
    title: 'База клиентов',
    text: 'Собирайте людей в одну базу и не теряйте, кто уже внутри, кто пропал и кому нужно написать.',
    icon: 'smart_toy',
    tone: 'neutral'
  },
  {
    title: 'Продления и исключение',
    text: 'Напоминания и исключение из канала работают без ручной рутины и постоянных проверок.',
    icon: 'notifications_active',
    tone: 'neutral'
  },
  {
    title: 'Заказы и отчеты',
    text: 'Сразу видно, где оплата уже есть, где доступ не добит и на каком этапе теряются деньги.',
    icon: 'insights',
    tone: 'neutral'
  }
];

const featureBullets = [
  'Каналы, оплаты и доступы в одном месте',
  'История клиента и статусы подписки',
  'Продления, исключение и разбор хвостов'
];

const heroImage =
  '/hero-telegram-mock.svg';

function Icon({ name, className = '', color = 'currentColor' }) {
  const common = {
    width: 24,
    height: 24,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
    className
  };

  switch (name) {
    case 'arrow_forward':
      return <svg {...common}><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>;
    case 'verified_user':
      return <svg {...common}><path d="M12 3 6 5.5v5.4c0 3.7 2.6 7.1 6 8.1 3.4-1 6-4.4 6-8.1V5.5L12 3Z" /><path d="m9.5 12 1.8 1.8 3.7-3.8" /></svg>;
    case 'hourglass_empty':
      return <svg {...common}><path d="M8 3h8" /><path d="M8 21h8" /><path d="M8 3c0 3 2 4.5 4 6 2-1.5 4-3 4-6" /><path d="M8 21c0-3 2-4.5 4-6 2 1.5 4 3 4 6" /></svg>;
    case 'money_off':
      return <svg {...common}><rect x="4" y="6" width="16" height="12" rx="2.5" /><path d="M8 12h.01" /><path d="M16 12h.01" /><path d="m7 7 10 10" /></svg>;
    case 'block':
      return <svg {...common}><circle cx="12" cy="12" r="8" /><path d="m8.5 8.5 7 7" /></svg>;
    case 'smart_toy':
      return <svg {...common}><rect x="7" y="8" width="10" height="9" rx="2" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /><path d="M10 12h.01M14 12h.01" /><path d="M12 12v2" /></svg>;
    case 'payments':
      return <svg {...common}><path d="M12 3v18" /><path d="M16 7c0-1.7-1.8-3-4-3S8 5.3 8 7s1.8 3 4 3 4 1.3 4 3-1.8 3-4 3-4-1.3-4-3" /></svg>;
    case 'rocket_launch':
      return <svg {...common}><path d="M5 19c2.5-5.5 6.5-9.5 12-12 .3 3.2-.7 6.2-3 8.5L11 19l-3-3Z" /><path d="M8 16 5 19" /><path d="m13 11 3-3" /></svg>;
    case 'currency_bitcoin':
      return <svg {...common}><circle cx="12" cy="12" r="8" /><path d="M10 8h3.2a2 2 0 1 1 0 4H10V8Zm0 4h3.8a2 2 0 1 1 0 4H10v-4Zm2-6v2m0 8v2" /></svg>;
    case 'credit_card':
      return <svg {...common}><rect x="3.5" y="6" width="17" height="12" rx="2.5" /><path d="M3.5 10h17" /><path d="M7.5 14h4" /></svg>;
    case 'notifications_active':
      return <svg {...common}><path d="M12 4a4 4 0 0 0-4 4v2.6L6.3 14a1 1 0 0 0 .8 1.6h9.8a1 1 0 0 0 .8-1.6L16 10.6V8a4 4 0 0 0-4-4Z" /><path d="M10 18a2 2 0 0 0 4 0" /></svg>;
    case 'sell':
      return <svg {...common}><path d="M11 4H6a2 2 0 0 0-2 2v5l8.5 8.5a2.1 2.1 0 0 0 3 0l4-4a2.1 2.1 0 0 0 0-3L11 4Z" /><path d="M7.5 8.5h.01" /></svg>;
    case 'check_circle':
      return <svg {...common}><circle cx="12" cy="12" r="8" /><path d="m8.5 12 2.3 2.3 4.7-4.8" /></svg>;
    case 'bolt':
      return <svg {...common}><path d="M13 2 6 13h5l-1 9 7-11h-5l1-9Z" /></svg>;
    case 'insights':
      return <svg {...common}><path d="M4 19V10" /><path d="M10 19V5" /><path d="M16 19v-7" /><path d="M22 19v-4" /></svg>;
    default:
      return null;
  }
}

export function HomePage() {
  return (
    <div className="paywall-home">
      <style>{`
        .paywall-home {
          --primary: #0066FF;
          --on-primary: #ffffff;
          --primary-container: #E5EFFF;
          --on-primary-container: #001D47;
          --background: #F8FAFC;
          --surface: #ffffff;
          --on-surface: #0F172A;
          --on-surface-variant: #475569;
          --outline: #CBD5E1;
          --error: #E11D48;
          --font-title: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Helvetica, Roboto, "Open Sans", FreeSans, sans-serif;
          --font-text: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", Arial, sans-serif;
          min-height: 100vh;
          background: var(--background);
          color: var(--on-surface);
          font-family: var(--font-text);
        }
        .paywall-home * {
          box-sizing: border-box;
        }
        .paywall-home a {
          color: inherit;
          text-decoration: none;
        }
        .paywall-home a.paywall-inline-link {
          color: #43a047;
          text-decoration: none;
        }
        .paywall-home a.paywall-inline-link:hover {
          text-decoration: underline;
        }
        .paywall-home button {
          font: inherit;
        }
        .paywall-icon {
          width: 24px;
          height: 24px;
          flex: 0 0 auto;
        }
        .paywall-shell {
          width: 100%;
          max-width: 1280px;
          margin: 0 auto;
          padding: 0 24px;
        }
        .paywall-footer__list a:hover,
        .paywall-footer__bottom-links a:hover,
        .paywall-inline-link:hover {
          color: var(--primary);
        }
        .paywall-button {
          font-family: var(--font-title);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border: 0;
          border-radius: 8px;
          padding: 10px 24px;
          font-size: 0.875rem;
          font-weight: 700;
          transition: transform 160ms ease, box-shadow 160ms ease, background 160ms ease, color 160ms ease;
          cursor: pointer;
        }
        .paywall-button:hover {
          transform: translateY(-1px);
        }
        .paywall-button--primary {
          background: var(--primary);
          color: var(--on-primary);
          box-shadow: none;
        }
        .paywall-home a.paywall-button--primary,
        .paywall-home a.paywall-button--primary:visited,
        .paywall-home a.paywall-button--primary:hover,
        .paywall-home a.paywall-button--primary:active {
          color: var(--on-primary);
        }
        .paywall-button--primary:hover {
          background: #0b5ae0;
        }
        .paywall-button--hero {
          padding: 20px 40px;
          font-size: 1.125rem;
          border-radius: 12px;
          box-shadow: 0 20px 25px -5px rgba(0, 102, 255, 0.2), 0 8px 10px -6px rgba(0, 102, 255, 0.2);
        }
        .paywall-button--light {
          background: #ffffff;
          color: var(--primary);
          padding: 20px 48px;
          font-size: 1.25rem;
          border-radius: 16px;
          box-shadow: 0 24px 48px rgba(15, 23, 42, 0.16);
        }
        .paywall-home a.paywall-button--light,
        .paywall-home a.paywall-button--light:visited,
        .paywall-home a.paywall-button--light:hover,
        .paywall-home a.paywall-button--light:active {
          color: var(--primary);
        }
        .paywall-main {
          overflow: hidden;
        }
        .paywall-hero {
          padding: 100px 0 128px;
          background: radial-gradient(circle at 100% 0%, #E5EFFF 0%, #F8FAFC 50%);
        }
        .paywall-hero__grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 80px;
          align-items: center;
        }
        .paywall-eyebrow {
          font-family: var(--font-title);
          display: inline-flex;
          justify-self: start;
          align-self: start;
          width: max-content;
          max-width: 100%;
          align-items: center;
          gap: 8px;
          padding: 6px 12px;
          border-radius: 999px;
          background: var(--primary-container);
          color: var(--primary);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }
        .paywall-eyebrow__dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: var(--primary);
        }
        .paywall-hero__copy {
          display: grid;
          gap: 40px;
        }
        .paywall-hero__text {
          display: grid;
          gap: 24px;
        }
        .paywall-hero__copy h1 {
          font-family: var(--font-title);
          margin: 0;
          font-size: clamp(3rem, 5.6vw, 4.5rem);
          font-weight: 800;
          line-height: 1.1;
          letter-spacing: -0.025em;
        }
        .paywall-hero__copy h1 span {
          color: var(--primary);
        }
        .paywall-hero__copy p {
          margin: 0;
          max-width: 576px;
          color: var(--on-surface-variant);
          font-size: 1.125rem;
          line-height: 1.625;
        }
        .paywall-hero__actions {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 24px;
        }
        .paywall-proof {
          display: inline-flex;
          align-items: center;
          gap: 12px;
          color: var(--on-surface-variant);
          font-size: 0.875rem;
          font-weight: 600;
        }
        .paywall-proof .paywall-icon {
          color: var(--primary);
        }
        .paywall-hero__visual {
          position: relative;
        }
        .paywall-hero__glow {
          position: absolute;
          inset: -40px;
          border-radius: 999px;
          background: rgba(0, 102, 255, 0.05);
          filter: blur(120px);
        }
        .paywall-hero__image {
          position: relative;
          overflow: hidden;
          border-radius: 24px;
          border: 1px solid #f1f5f9;
          background: #ffffff;
          box-shadow: 0 32px 64px -16px rgba(0, 0, 0, 0.1);
        }
        .paywall-hero__image img {
          display: block;
          width: 100%;
          height: auto;
        }
        .paywall-section {
          padding: 128px 0;
          background: #ffffff;
        }
        .paywall-section--tint {
          background: #F8FAFC;
        }
        .paywall-section__intro {
          margin: 0 auto 80px;
          max-width: 900px;
          text-align: center;
          display: grid;
          gap: 16px;
        }
        .paywall-section__intro h2,
        .paywall-features__copy h2 {
          font-family: var(--font-title);
          margin: 0;
          font-size: clamp(2.25rem, 4vw, 3rem);
          font-weight: 700;
          line-height: 1.08;
          letter-spacing: -0.045em;
        }
        .paywall-cta__body h2 {
          font-family: var(--font-title);
          margin: 0;
          font-size: clamp(2.5rem, 5vw, 3.75rem);
          font-weight: 800;
          line-height: 1.05;
          letter-spacing: -0.06em;
        }
        .paywall-section__intro p,
        .paywall-features__copy p,
        .paywall-cta__body p,
        .paywall-footer__brand p {
          margin: 0;
          color: var(--on-surface-variant);
          font-size: 1.125rem;
          line-height: 1.65;
        }
        .paywall-steps-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 32px;
        }
        .paywall-step-card {
          display: flex;
          flex-direction: column;
          height: 100%;
          padding: 40px;
          border-radius: 24px;
          border: 1px solid #e2e8f0;
        }
        .paywall-step-card__icon,
        .paywall-feature-card__icon {
          width: 64px;
          height: 64px;
          border-radius: 16px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 32px;
          border: 1px solid #e2e8f0;
          background: #ffffff;
          box-shadow: 0 2px 6px rgba(15, 23, 42, 0.04);
        }
        .paywall-feature-card__icon .paywall-icon {
          width: 32px;
          height: 32px;
        }
        .paywall-step-card h3 {
          font-family: var(--font-title);
          margin: 0 0 16px;
          font-size: 1.5rem;
          font-weight: 700;
          line-height: 1.15;
        }
        .paywall-step-card p,
        .paywall-feature-card p,
        .paywall-footer__list a,
        .paywall-footer__bottom {
          margin: 0;
          color: var(--on-surface-variant);
          font-size: 0.9375rem;
          line-height: 1.7;
        }
        .paywall-step-card {
          position: relative;
          overflow: hidden;
          background: #ffffff;
          box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
        }
        .paywall-step-card__number {
          font-family: var(--font-title);
          position: absolute;
          top: -32px;
          left: -8px;
          color: #e2e8f0;
          font-size: 7rem;
          font-weight: 900;
          line-height: 1;
          pointer-events: none;
          user-select: none;
        }
        .paywall-step-card__body {
          position: relative;
          z-index: 1;
        }
        .paywall-step-card__icon {
          width: 48px;
          height: 48px;
          margin-bottom: 32px;
          border-radius: 12px;
          border-color: var(--primary);
          background: var(--primary);
          box-shadow: none;
        }
        .paywall-step-card__icon .paywall-icon {
          color: #ffffff;
        }
        .paywall-features {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(320px, 0.92fr);
          gap: 96px;
          align-items: center;
        }
        .paywall-features__grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 40px;
        }
        .paywall-feature-card__icon--primary {
          background: rgba(0, 102, 255, 0.1);
        }
        .paywall-feature-card__icon--primary .paywall-icon {
          color: var(--primary);
        }
        .paywall-feature-card__icon--neutral {
          background: #F1F5F9;
        }
        .paywall-feature-card__icon--neutral .paywall-icon {
          color: #334155;
        }
        .paywall-feature-card h4 {
          font-family: var(--font-title);
          margin: 0 0 16px;
          font-size: 1.25rem;
          font-weight: 700;
          line-height: 1.2;
        }
        .paywall-features__copy {
          display: grid;
          gap: 24px;
        }
        .paywall-features__bullets {
          margin: 0;
          padding: 0;
          list-style: none;
          display: grid;
          gap: 20px;
        }
        .paywall-features__bullets li {
          font-family: var(--font-title);
          display: flex;
          align-items: center;
          gap: 16px;
          font-size: 1.125rem;
          font-weight: 600;
        }
        .paywall-features__bullets .paywall-icon {
          color: var(--primary);
        }
        .paywall-cta {
          padding: 96px 0;
          background: #ffffff;
        }
        .paywall-cta__shell {
          width: min(1152px, 100%);
          margin: 0 auto;
        }
        .paywall-cta__panel {
          position: relative;
          overflow: hidden;
          border-radius: 24px;
          padding: 96px 64px;
          background: var(--primary);
          text-align: center;
        }
        .paywall-cta__panel::before {
          content: "";
          position: absolute;
          inset: 0;
          opacity: 0.9;
          background:
            radial-gradient(circle at top right, rgba(255,255,255,0.16), transparent 26%),
            radial-gradient(circle at bottom left, rgba(255,255,255,0.12), transparent 24%);
        }
        .paywall-cta__body {
          position: relative;
          z-index: 1;
          display: grid;
          gap: 24px;
          justify-items: center;
        }
        .paywall-cta__body h2 { color: #ffffff; }
        .paywall-cta__body p {
          max-width: 760px;
          color: rgba(255, 255, 255, 0.8);
        }
        .paywall-button--light .paywall-icon {
          width: 20px;
          height: 20px;
        }
        .paywall-footer {
          border-top: 1px solid #e2e8f0;
          background: #F8FAFC;
          padding: 80px 0;
        }
        .paywall-footer__grid {
          display: grid;
          grid-template-columns: minmax(280px, 0.85fr) minmax(0, 1.15fr);
          gap: 48px;
          margin-bottom: 56px;
        }
        .paywall-footer__brand {
          display: grid;
          gap: 18px;
        }
        .paywall-footer__brand strong {
          font-family: var(--font-title);
          font-size: 1.75rem;
          font-weight: 700;
          letter-spacing: -0.04em;
        }
        .paywall-footer__brand p {
          max-width: 260px;
          font-size: 1rem;
        }
        .paywall-footer__columns {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 32px;
        }
        .paywall-footer__title {
          font-family: var(--font-title);
          margin: 0 0 24px;
          font-size: 0.75rem;
          font-weight: 700;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }
        .paywall-footer__list {
          margin: 0;
          padding: 0;
          list-style: none;
          display: grid;
          gap: 16px;
        }
        .paywall-footer__list a {
          font-size: 0.875rem;
          font-weight: 600;
          transition: color 160ms ease;
        }
        .paywall-footer__bottom {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 24px;
          padding-top: 28px;
          border-top: 1px solid #e2e8f0;
          font-size: 0.875rem;
          font-weight: 500;
        }
        .paywall-footer__bottom-links {
          display: flex;
          gap: 32px;
        }
        .paywall-footer__bottom-links a {
          transition: color 160ms ease;
        }
        @media (min-width: 640px) {
          .paywall-hero__actions {
            flex-direction: row;
          }
          .paywall-button--hero {
            width: auto;
          }
        }
        @media (min-width: 768px) {
          .paywall-hero__copy p {
            font-size: 1.25rem;
          }
        }
        @media (min-width: 1024px) {
          .paywall-hero__grid,
          .paywall-features,
          .paywall-footer__grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .paywall-hero__image {
            transform: scale(1.1) translateX(48px);
          }
        }
        @media (max-width: 1023px) {
          .paywall-features,
          .paywall-footer__grid {
            grid-template-columns: 1fr;
          }
          .paywall-footer__brand,
          .paywall-footer__columns {
            grid-column: auto;
          }
        }
        @media (max-width: 767px) {
          .paywall-section,
          .paywall-cta,
          .paywall-footer {
            padding: 72px 0;
          }
          .paywall-steps-grid,
          .paywall-features__grid,
          .paywall-footer__columns {
            grid-template-columns: 1fr;
          }
          .paywall-cta__panel {
            padding: 64px 24px;
          }
          .paywall-footer__bottom {
            flex-direction: column;
            align-items: flex-start;
          }
          .paywall-footer__bottom-links {
            flex-direction: column;
            gap: 12px;
          }
        }
        @media (max-width: 639px) {
          .paywall-button {
            padding: 12px 16px;
            font-size: 0.8125rem;
          }
          .paywall-button--hero,
          .paywall-button--light {
            width: 100%;
            padding: 18px 20px;
            font-size: 1rem;
          }
          .paywall-hero__copy h1,
          .paywall-section__intro h2,
          .paywall-features__copy h2,
          .paywall-cta__body h2 {
            font-size: clamp(2.4rem, 11vw, 3.6rem);
          }
          .paywall-hero__copy p,
          .paywall-section__intro p,
          .paywall-features__copy p,
          .paywall-cta__body p {
            font-size: 1rem;
          }
          .paywall-step-card {
            padding: 32px 24px;
          }
        }
      `}</style>

      <main className="paywall-main">
        <section className="paywall-hero">
          <div className="paywall-shell paywall-hero__grid">
            <div className="paywall-hero__copy">
              <div className="paywall-eyebrow">
                <span className="paywall-eyebrow__dot" />
                Автоматизация 2.0
              </div>
              <div className="paywall-hero__text">
                <h1>
                  Монетизируйте свой Telegram-канал на <span>автопилоте</span>
                </h1>
                <p>
                  Вставьте токен из{' '}
                  <a className="paywall-inline-link" href="https://t.me/BotFather" target="_blank" rel="noreferrer">
                    @BotFather
                  </a>
                  . И ваш бот сам начнет принимать оплату, выдавать доступ, следить за продлением и исключением из
                  закрытого канала.
                </p>
              </div>
              <div className="paywall-hero__actions">
                <a
                  className="paywall-button paywall-button--primary paywall-button--hero"
                  href="/app/botfather"
                  target="_blank"
                  rel="noreferrer"
                >
                  Вставить токен
                  <Icon name="arrow_forward" className="paywall-icon" />
                </a>
                <div className="paywall-proof">
                  <Icon name="verified_user" className="paywall-icon" />
                  Без комиссии сервиса
                </div>
              </div>
            </div>

            <div className="paywall-hero__visual">
              <div className="paywall-hero__glow" />
              <div className="paywall-hero__image">
                <img alt="Telegram interface" src={heroImage} />
              </div>
            </div>
          </div>
        </section>

        <section className="paywall-section paywall-section--tint" id="how-it-works">
          <div className="paywall-shell">
            <div className="paywall-section__intro">
              <h2>Аудитория под контролем</h2>
              <p>После оплаты видно, что происходит с доступом, продлением и клиентской базой.</p>
            </div>
            <div className="paywall-steps-grid">
              {steps.map((item) => (
                <article key={item.number} className="paywall-step-card">
                  <span className="paywall-step-card__number">{item.number}</span>
                  <div className="paywall-step-card__body">
                    <div className="paywall-step-card__icon">
                      <Icon name={item.icon} className="paywall-icon" color="#ffffff" />
                    </div>
                    <h3>{item.title}</h3>
                    <p>{item.text}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="paywall-section" id="features">
          <div className="paywall-shell paywall-features">
            <div className="paywall-features__grid">
              {features.map((item) => (
                <article key={item.title} className="paywall-feature-card">
                  <div className={`paywall-feature-card__icon paywall-feature-card__icon--${item.tone}`}>
                    <Icon
                      name={item.icon}
                      className="paywall-icon"
                      color={item.tone === 'primary' ? '#0066FF' : '#334155'}
                    />
                  </div>
                  <h4>{item.title}</h4>
                  <p>{item.text}</p>
                </article>
              ))}
            </div>

            <div className="paywall-features__copy">
              <h2>Не только бот, а весь рабочий контур</h2>
              <p>
                После подключения токена вы не просто принимаете оплату. У вас появляется понятный контур по
                доступам, клиентам, продлениям и заказам, где видно, что происходит с аудиторией и деньгами.
              </p>
              <ul className="paywall-features__bullets">
                {featureBullets.map((item) => (
                  <li key={item}>
                    <Icon name="check_circle" className="paywall-icon" color="#0066FF" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="paywall-cta" id="pricing">
          <div className="paywall-shell">
            <div className="paywall-cta__shell">
              <div className="paywall-cta__panel">
                <div className="paywall-cta__body">
                  <h2>Запустите продажи за 5 минут</h2>
                  <p>Запустите первый рабочий контур монетизации канала и перестаньте админить оплаты руками.</p>
                  <a className="paywall-button paywall-button--light" href="/pricing">
                    <Icon name="bolt" className="paywall-icon" color="#0066FF" />
                    Запустить BullRun
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="paywall-footer">
        <div className="paywall-shell">
          <div className="paywall-footer__grid">
            <div className="paywall-footer__brand">
              <strong>BullRun</strong>
              <p>Система для запуска и администрирования платных Telegram-каналов без ручной возни.</p>
            </div>

            <div className="paywall-footer__columns">
              <div>
                <h5 className="paywall-footer__title">Продукт</h5>
                <ul className="paywall-footer__list">
                  <li>
                    <a href="#features">Функции</a>
                  </li>
                  <li>
                    <a href="#pricing">Тарифы</a>
                  </li>
                  <li>
                    <a href="#">API</a>
                  </li>
                </ul>
              </div>
              <div>
                <h5 className="paywall-footer__title">Ресурсы</h5>
                <ul className="paywall-footer__list">
                  <li>
                    <a href="#">Документация</a>
                  </li>
                  <li>
                    <a href="#">YouTube</a>
                  </li>
                  <li>
                    <a href="#">Блог</a>
                  </li>
                </ul>
              </div>
              <div>
                <h5 className="paywall-footer__title">Поддержка</h5>
                <ul className="paywall-footer__list">
                  <li>
                    <a href="#">Telegram</a>
                  </li>
                  <li>
                    <a href="#">Контакты</a>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <div className="paywall-footer__bottom">
            <div>© 2024 BullRun. Все права защищены.</div>
            <div className="paywall-footer__bottom-links">
              <a href="#">Политика конфиденциальности</a>
              <a href="#">Публичная оферта</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
