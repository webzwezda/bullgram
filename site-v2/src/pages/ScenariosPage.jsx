import { useMemo } from 'react';
import { SALES_LINKS } from '../components/MarketingPrimitives.jsx';
import { useAuth } from '../app/providers/AuthProvider.jsx';

const FLOW_STEPS = [
  {
    eyebrow: 'Шаг 1',
    title: 'Человек оплачивает доступ',
    text: 'Оплата приходит в ваш рабочий контур, а не теряется в переписке и ручных проверках.'
  },
  {
    eyebrow: 'Шаг 2',
    title: 'Доступ и вход не теряются',
    text: 'Сразу видно, кто уже оплатил, кто получил доступ и кто так и не вошел в закрытый канал.'
  },
  {
    eyebrow: 'Шаг 3',
    title: 'Дальше работает вся аудитория',
    text: 'Продления, база клиентов, заказы и отчеты помогают не терять деньги после первой оплаты.'
  }
];

const AUDIENCE_CARDS = [
  {
    title: 'Оплатили, но не зашли',
    text: 'Самый горячий хвост. Здесь важно быстро увидеть, у кого есть оплата, но нет нормального входа в канал.'
  },
  {
    title: 'Скоро истекает подписка',
    text: 'Напоминания и продления нужны не ради красоты, а чтобы люди не вылетали молча и не уносили деньги.'
  },
  {
    title: 'Клиенты и история по ним',
    text: 'Удобно видеть не только факт оплаты, но и кто человек, где он был, что продлевал и где потерялся.'
  }
];

const CONTROL_CARDS = [
  {
    title: 'Заказы',
    text: 'Показывают, где деньги уже есть, а доступ еще не добит.'
  },
  {
    title: 'Доступ',
    text: 'Показывает, кто внутри, кто вне канала и где зависло движение.'
  },
  {
    title: 'База клиентов',
    text: 'Собирает людей в один список, чтобы не искать их по чатам и табличкам.'
  },
  {
    title: 'Отчеты',
    text: 'Помогают увидеть, где канал реально зарабатывает, а где деньги теряются.'
  }
];

export function ScenariosPage() {
  const { user, profilePlan, sellerPulse } = useAuth();

  const cta = useMemo(() => {
    if (user && profilePlan === 'trial') {
      return {
        title: 'У тебя уже есть Trial. Пора собирать рабочий контур.',
        text: 'Если первый сценарий уже понятен, следующий шаг не смотреть страницы дальше, а закрыть Normal и перевести оплату, доступ и аудиторию в рабочий режим.',
        primary: { label: 'Открыть Normal', href: SALES_LINKS.ops },
        secondary: { label: 'Открыть Normal', href: SALES_LINKS.ops }
      };
    }

    if (user && profilePlan === 'normal') {
      return {
        title: 'Рабочий контур уже должен быть внутри кабинета.',
        text: 'Открывай кабинет, подключай каналы, доводи доступы и разбирай хвост по клиентам уже в боевом режиме.',
        primary: { label: 'Открыть кабинет', href: '/app/' },
        secondary: {
          label: sellerPulse?.paidCount ? 'Открыть seller admin' : sellerPulse?.hasAny ? 'Вернуться к seller checkout' : 'Открыть Shop',
          href: sellerPulse?.paidCount ? '/app/shop' : sellerPulse?.hasAny ? '/shop?offer=seller' : '/shop'
        }
      };
    }

    return {
      title: 'Начни с оплаты и доступа, а не с хаоса в личке.',
      text: 'Сначала подключи бота, запусти закрытый канал и собери первый рабочий поток. Все остальное уже докрутится внутри.',
      primary: { label: 'Вставить токен', href: '/app/botfather', target: '_blank', rel: 'noreferrer' },
      secondary: { label: 'Начать Trial', href: SALES_LINKS.trial }
    };
  }, [profilePlan, sellerPulse, user]);

  return (
    <section className="scenarios-v2">
      <style>{`
        .scenarios-v2 {
          display: grid;
          gap: 24px;
        }
        .scenarios-v2__hero,
        .scenarios-v2__section,
        .scenarios-v2__cta {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 24px;
          box-shadow: var(--shadow);
        }
        .scenarios-v2__hero {
          padding: 28px;
          display: grid;
          gap: 20px;
          background:
            radial-gradient(circle at top right, rgba(15, 118, 110, 0.08), transparent 28%),
            linear-gradient(180deg, rgba(255, 253, 248, 0.98), rgba(255, 253, 248, 0.98));
        }
        .scenarios-v2__eyebrow,
        .scenarios-v2__card-eyebrow,
        .scenarios-v2__cta-eyebrow {
          font-size: 12px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--accent);
          font-weight: 800;
        }
        .scenarios-v2__hero h1,
        .scenarios-v2__section-head h2,
        .scenarios-v2__cta-copy h2 {
          margin: 0;
          font-size: clamp(32px, 4vw, 48px);
          line-height: 1.04;
        }
        .scenarios-v2__hero p,
        .scenarios-v2__section-head p,
        .scenarios-v2__card p,
        .scenarios-v2__cta-copy p {
          margin: 0;
          color: var(--muted);
          line-height: 1.8;
        }
        .scenarios-v2__hero-actions,
        .scenarios-v2__cta-actions {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
        }
        .scenarios-v2__section {
          padding: 28px;
          display: grid;
          gap: 22px;
        }
        .scenarios-v2__section-head {
          display: grid;
          gap: 10px;
          max-width: 760px;
        }
        .scenarios-v2__grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 16px;
        }
        .scenarios-v2__grid--four {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .scenarios-v2__card {
          display: grid;
          gap: 10px;
          padding: 20px;
          border-radius: 20px;
          border: 1px solid var(--border);
          background: linear-gradient(180deg, #fffdf8, #f8f4ea);
        }
        .scenarios-v2__card h3 {
          margin: 0;
          font-size: 22px;
          line-height: 1.15;
        }
        .scenarios-v2__cta {
          padding: 28px;
          display: flex;
          justify-content: space-between;
          gap: 20px;
          align-items: flex-end;
          background: linear-gradient(135deg, rgba(15, 118, 110, 0.12), rgba(255, 253, 248, 0.98));
        }
        .scenarios-v2__cta-copy {
          display: grid;
          gap: 10px;
          max-width: 760px;
        }
        @media (max-width: 1023px) {
          .scenarios-v2__grid,
          .scenarios-v2__grid--four {
            grid-template-columns: 1fr;
          }
          .scenarios-v2__cta {
            flex-direction: column;
            align-items: flex-start;
          }
        }
      `}</style>

      <section className="scenarios-v2__hero">
        <div className="scenarios-v2__eyebrow">Сценарий работы</div>
        <h1>Сайт приводит оплату. Дальше нужно нормально вести аудиторию.</h1>
        <p>
          Главный сценарий здесь не про набор функций. Он про простую вещь: человек платит за доступ, попадает в
          закрытый канал, потом продлевает подписку, а вы видите, что происходит с деньгами и людьми на каждом этапе.
        </p>
        <div className="scenarios-v2__hero-actions">
          <a className="site-button site-button--primary" href="/app/botfather" target="_blank" rel="noreferrer">
            Вставить токен
          </a>
          <a className="site-button" href="/pricing">
            Посмотреть тарифы
          </a>
        </div>
      </section>

      <section className="scenarios-v2__section">
        <div className="scenarios-v2__section-head">
          <h2>Как выглядит рабочая цепочка</h2>
          <p>Сначала человек оплачивает доступ. Потом важно не потерять его на входе, в продлении и в общей базе клиентов.</p>
        </div>
        <div className="scenarios-v2__grid">
          {FLOW_STEPS.map((item) => (
            <article key={item.title} className="scenarios-v2__card">
              <div className="scenarios-v2__card-eyebrow">{item.eyebrow}</div>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="scenarios-v2__section">
        <div className="scenarios-v2__section-head">
          <h2>Что чаще всего нужно держать под рукой</h2>
          <p>После первых оплат начинается реальная работа: доступы, продления, вылеты и люди, которые где-то потерялись.</p>
        </div>
        <div className="scenarios-v2__grid">
          {AUDIENCE_CARDS.map((item) => (
            <article key={item.title} className="scenarios-v2__card">
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="scenarios-v2__section">
        <div className="scenarios-v2__section-head">
          <h2>Из чего состоит этот контур</h2>
          <p>Это уже не один бот. Это несколько рабочих экранов, которые помогают не терять доступы, людей и деньги.</p>
        </div>
        <div className="scenarios-v2__grid scenarios-v2__grid--four">
          {CONTROL_CARDS.map((item) => (
            <article key={item.title} className="scenarios-v2__card">
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="scenarios-v2__cta">
        <div className="scenarios-v2__cta-copy">
          <div className="scenarios-v2__cta-eyebrow">Следующий шаг</div>
          <h2>{cta.title}</h2>
          <p>{cta.text}</p>
        </div>
        <div className="scenarios-v2__cta-actions">
          <a className="site-button site-button--primary" href={cta.primary.href} target={cta.primary.target || undefined} rel={cta.primary.rel || undefined}>
            {cta.primary.label}
          </a>
          {cta.secondary ? (
            <a className="site-button" href={cta.secondary.href} target={cta.secondary.target || undefined} rel={cta.secondary.rel || undefined}>
              {cta.secondary.label}
            </a>
          ) : null}
        </div>
      </section>
    </section>
  );
}
