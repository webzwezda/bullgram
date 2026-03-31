import { useMemo } from 'react';
import { SALES_LINKS } from '../components/MarketingPrimitives.jsx';
import { useAuth } from '../app/providers/AuthProvider.jsx';

const PLANS = [
  {
    id: 'trial',
    eyebrow: 'Старт',
    title: 'Trial',
    text: 'Подходит, чтобы вставить токен, подключить своего бота и проверить первый рабочий сценарий на своем канале.',
    bullets: [
      'Быстрый старт без тяжелого внедрения',
      'Первый платежный сценарий',
      'Проверка доступа и входа в канал'
    ],
    cta: { label: 'Начать Trial', href: SALES_LINKS.trial }
  },
  {
    id: 'normal',
    eyebrow: 'Основной пакет',
    title: 'Normal',
    text: 'Подходит, когда канал уже живет: нужно вести оплаты, доступ, продления, клиентов и заказы без ручного хаоса.',
    bullets: [
      'Рабочий контур для платного канала',
      'Клиенты, продления и отчеты',
      'Режим для постоянной работы, а не теста'
    ],
    cta: { label: 'Открыть Normal', href: SALES_LINKS.ops },
    highlight: true
  }
];

const NEXT_STEP = {
  title: 'Seller и остальные сложные сценарии',
  text: 'Это уже следующий слой после рабочего канала. Сначала запускается понятный поток оплаты и доступа, а потом уже подключаются более широкие контуры.'
};

export function PricingPage() {
  const { user, profilePlan } = useAuth();

  const footerCta = useMemo(() => {
    if (user && profilePlan === 'trial') {
      return {
        title: 'Trial уже идет. Следующий шаг — перевести канал в рабочий режим.',
        text: 'Если первый сценарий уже собран, не зависай на тестовом входе. Переходи на Normal и работай с оплатой, доступом и клиентами без ограничений.',
        primary: { label: 'Открыть Normal', href: SALES_LINKS.ops },
        secondary: { label: 'Открыть кабинет', href: '/app/' }
      };
    }

    if (user && profilePlan === 'normal') {
      return {
        title: 'Основной пакет уже должен работать внутри кабинета.',
        text: 'Если канал уже на Normal, дальше вопрос не в тарифах, а в том, чтобы вести клиентов, доступы и заказы в одном месте.',
        primary: { label: 'Открыть кабинет', href: '/app/' },
        secondary: { label: 'Открыть Shop', href: '/shop' }
      };
    }

    return {
      title: 'Начни с простого пакета и не покупай вслепую.',
      text: 'Сначала можно зайти через Trial. Если быстро упираешься в ограничения, следующий шаг уже Normal.',
      primary: { label: 'Начать Trial', href: SALES_LINKS.trial },
      secondary: { label: 'Открыть Shop', href: '/shop' }
    };
  }, [profilePlan, user]);

  return (
    <section className="pricing-v2">
      <style>{`
        .pricing-v2 {
          display: grid;
          gap: 24px;
        }
        .pricing-v2__hero,
        .pricing-v2__next,
        .pricing-v2__cta {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 24px;
          box-shadow: var(--shadow);
        }
        .pricing-v2__hero,
        .pricing-v2__next,
        .pricing-v2__cta {
          padding: 28px;
        }
        .pricing-v2__eyebrow,
        .pricing-v2__card-eyebrow,
        .pricing-v2__cta-eyebrow {
          font-size: 12px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--accent);
          font-weight: 800;
        }
        .pricing-v2__hero {
          display: grid;
          gap: 14px;
          background:
            radial-gradient(circle at top right, rgba(15, 118, 110, 0.08), transparent 28%),
            linear-gradient(180deg, rgba(255, 253, 248, 0.98), rgba(255, 253, 248, 0.98));
        }
        .pricing-v2__hero h1,
        .pricing-v2__next h2,
        .pricing-v2__cta-copy h2 {
          margin: 0;
          font-size: clamp(32px, 4vw, 48px);
          line-height: 1.04;
        }
        .pricing-v2__hero p,
        .pricing-v2__next p,
        .pricing-v2__card p,
        .pricing-v2__cta-copy p {
          margin: 0;
          color: var(--muted);
          line-height: 1.8;
        }
        .pricing-v2__grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
        }
        .pricing-v2__card {
          display: grid;
          gap: 14px;
          padding: 24px;
          border-radius: 24px;
          border: 1px solid var(--border);
          background: linear-gradient(180deg, #fffdf8, #f8f4ea);
          box-shadow: var(--shadow);
        }
        .pricing-v2__card--highlight {
          border-color: rgba(15, 118, 110, 0.34);
          background: linear-gradient(180deg, rgba(15, 118, 110, 0.08), rgba(255, 253, 248, 0.98));
        }
        .pricing-v2__card h2 {
          margin: 0;
          font-size: 30px;
          line-height: 1.05;
        }
        .pricing-v2__list {
          margin: 0;
          padding: 0;
          list-style: none;
          display: grid;
          gap: 10px;
        }
        .pricing-v2__list li {
          color: var(--muted);
          line-height: 1.7;
        }
        .pricing-v2__actions,
        .pricing-v2__cta-actions {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
        }
        .pricing-v2__cta {
          display: flex;
          justify-content: space-between;
          gap: 20px;
          align-items: flex-end;
          background: linear-gradient(135deg, rgba(15, 118, 110, 0.12), rgba(255, 253, 248, 0.98));
        }
        .pricing-v2__cta-copy {
          display: grid;
          gap: 10px;
          max-width: 760px;
        }
        @media (max-width: 1023px) {
          .pricing-v2__grid {
            grid-template-columns: 1fr;
          }
          .pricing-v2__cta {
            flex-direction: column;
            align-items: flex-start;
          }
        }
      `}</style>

      <section className="pricing-v2__hero">
        <div className="pricing-v2__eyebrow">Тарифы</div>
        <h1>Снаружи вам нужны только два понятных пакета.</h1>
        <p>
          Один пакет, чтобы быстро запуститься и проверить свой канал. Второй, чтобы вести оплату, доступ,
          продления и клиентов уже как нормальную рабочую систему.
        </p>
      </section>

      <section className="pricing-v2__grid">
        {PLANS.map((plan) => (
          <article key={plan.id} className={`pricing-v2__card${plan.highlight ? ' pricing-v2__card--highlight' : ''}`}>
            <div className="pricing-v2__card-eyebrow">{plan.eyebrow}</div>
            <h2>{plan.title}</h2>
            <p>{plan.text}</p>
            <ul className="pricing-v2__list">
              {plan.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
            <div className="pricing-v2__actions">
              <a className="site-button site-button--primary" href={plan.cta.href}>
                {plan.cta.label}
              </a>
              <a className="site-button" href="/shop">
                Открыть Shop
              </a>
            </div>
          </article>
        ))}
      </section>

      <section className="pricing-v2__next">
        <div className="pricing-v2__eyebrow">Следующий слой</div>
        <h2>{NEXT_STEP.title}</h2>
        <p>{NEXT_STEP.text}</p>
      </section>

      <section className="pricing-v2__cta">
        <div className="pricing-v2__cta-copy">
          <div className="pricing-v2__cta-eyebrow">Следующий шаг</div>
          <h2>{footerCta.title}</h2>
          <p>{footerCta.text}</p>
        </div>
        <div className="pricing-v2__cta-actions">
          <a className="site-button site-button--primary" href={footerCta.primary.href}>
            {footerCta.primary.label}
          </a>
          <a className="site-button" href={footerCta.secondary.href}>
            {footerCta.secondary.label}
          </a>
        </div>
      </section>
    </section>
  );
}
