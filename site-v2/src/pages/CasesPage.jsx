import { useMemo } from 'react';
import { CTASection, LeadPathGrid, SALES_LINKS, SectionIntro } from '../components/MarketingPrimitives.jsx';
import { useAuth } from '../app/providers/AuthProvider.jsx';

const CASES = [
  {
    title: 'Принимали TON руками',
    before: 'Люди писали, кидали чеки, ждали ответа и терялись по пути.',
    after: 'TON/P2P-контур, memo, QR и выдача после оплаты без ручной возни на каждом шаге.'
  },
  {
    title: 'Теряли горячих людей в личках',
    before: 'Входящие шли вразнобой, админы забывали отвечать, теплые люди остывали.',
    after: 'Userbot center, ops-бот и быстрый triage по горячим сообщениям.'
  },
  {
    title: 'Продажи и доступ в группу жили отдельно',
    before: 'Оплатил, но не зашел. Или сидит внутри уже без живой подписки.',
    after: 'Orders, access, retention и command center держат это в одном контуре.'
  },
  {
    title: 'Продавцы и админы работали в хаосе',
    before: 'Непонятно, кто чем управляет и где реально есть bot-админ.',
    after: 'Command center показывает, что у команды происходит на самом деле.'
  }
];

const CASE_PATHS = [
  {
    eyebrow: 'Кейс оплаты',
    title: 'Устал принимать TON руками',
    text: 'Если чек, memo и выдача сейчас живут в хаосе, начинаем с кассы и скрытой выдачи.',
    primary: { label: 'Открыть P2P checkout', href: SALES_LINKS.p2p }
  },
  {
    eyebrow: 'Кейс команды',
    title: 'Админы и лички разваливают операционку',
    text: 'Если команда уже есть, но работать вслепую больше нельзя, ведем в контур CRM и command center.',
    primary: { label: 'Открыть checkout Normal', href: SALES_LINKS.ops }
  }
];

export function CasesPage() {
  const { user, profilePlan, sellerPulse } = useAuth();

  const paths = useMemo(() => {
    if (user && profilePlan === 'trial') {
      return [
        {
          eyebrow: 'Кейс Trial',
          title: 'Хватит читать кейсы — добей свой первый сценарий',
          text: 'У тебя уже есть Trial. Следующий шаг — не смотреть на чужие переломы, а закрыть свой первый checkout и пойти в Normal.',
          primary: { label: 'Открыть checkout Normal', href: SALES_LINKS.ops }
        },
        {
          eyebrow: 'Кейс магазина',
          title: 'Хочу сразу посмотреть живые офферы',
          text: 'Открывай Shop и смотри, как эти сценарии уже выглядят внутри витрины и on-site checkout.',
          primary: { label: 'Открыть Shop', href: '/shop' }
        }
      ];
    }

    if (user && profilePlan === 'normal') {
      const sellerCase = sellerPulse?.paidCount
        ? {
            eyebrow: 'Кейс seller',
            title: 'Seller mode уже куплен. Пора превращать его в первую живую сделку.',
            text: 'Если seller уже активен, следующий шаг не в покупке заново, а в seller admin: inventory, лоты и handoff.',
            primary: { label: 'Открыть seller admin', href: '/app/shop' }
          }
        : sellerPulse?.pendingCount || sellerPulse?.awaitingReceiptCount || sellerPulse?.failedCount
          ? {
              eyebrow: 'Кейс seller',
              title: 'Seller checkout уже открыт. Сначала закрой его.',
              text: 'У тебя уже есть seller-хвост. Вернись в Shop, закрой чек или handoff, а потом строй seller-flow дальше.',
              primary: { label: 'Вернуться к seller checkout', href: '/shop?offer=seller' }
            }
          : {
              eyebrow: 'Кейс seller',
              title: 'Собрать свой seller-flow',
              text: 'Если базовый контур уже жив, пора строить свою витрину, seller page и поток сделок через Shop.',
              primary: { label: 'Открыть Shop', href: SALES_LINKS.seller }
            };

      return [
        {
          eyebrow: 'Кейс запуска',
          title: 'Открыть кабинет и превратить кейс в работу',
          text: 'Normal уже активен. Значит кейсы больше не для вдохновения, а для того, чтобы повторить контур у себя в кабинете.',
          primary: { label: 'Открыть /app', href: '/app/' }
        },
        sellerCase
      ];
    }

    return CASE_PATHS;
  }, [profilePlan, user]);

  const cta = useMemo(() => {
    if (user && profilePlan === 'trial') {
      return {
        title: 'Кейсы уже посмотрел. Теперь нужен свой первый закрытый сценарий.',
        text: 'Trial должен быстро привести тебя в рабочий checkout, а не застрять на чтении. Закрывай первый оффер и переходи на Normal.',
        primary: { label: 'Перейти на Normal', href: SALES_LINKS.ops },
        secondary: { label: 'Открыть Normal', href: SALES_LINKS.ops }
      };
    }

    if (user && profilePlan === 'normal') {
      return {
        title: 'Кейсы теперь не для чтения, а для повторения.',
        text: 'Иди в кабинет, запускай свой seller-flow, P2P или CRM-контур и превращай кейсы сайта в собственную операционку.',
        primary: { label: 'Открыть кабинет', href: '/app/' },
        secondary: {
          label: sellerPulse?.paidCount ? 'Открыть seller admin' : sellerPulse?.hasAny ? 'Вернуться к seller checkout' : 'Открыть Shop',
          href: sellerPulse?.paidCount ? '/app/shop' : sellerPulse?.hasAny ? '/shop?offer=seller' : '/shop'
        }
      };
    }

    return {
      title: 'Если у тебя похожий перелом — не тяни с первым запуском',
      text: 'Дальше вопрос не в том, нужен ли тебе еще один бот, а в том, какой контур подключать первым: Trial, платную группу или Telegram CRM.',
      primary: { label: 'Начать Trial', href: SALES_LINKS.trial },
      secondary: { label: 'Смотреть Shop', href: '/shop' }
    };
  }, [profilePlan, sellerPulse, user]);

  return (
    <section className="marketing-page">
      <SectionIntro
        eyebrow="Кейсы"
        title="Типовые переломы, где Bullgram превращает ручной хаос в систему."
        text="Здесь не “успешный успех”, а реальные переломы вокруг трех офферов: TON/P2P, платных групп и Telegram CRM."
      />

      <section className="case-summary">
        <div className="case-summary__stat">
          <strong>4</strong>
          <span>типовых перелома</span>
        </div>
        <div className="case-summary__stat">
          <strong>1</strong>
          <span>общая причина</span>
        </div>
        <div className="case-summary__text">
          Telegram давно стал рабочим стеком, а управление им у большинства все еще на ручниках. Bullgram зарабатывает
          там, где кто-то уже устал сшивать деньги, лички, доступы и админов руками.
        </div>
      </section>

      <div className="marketing-grid">
        {CASES.map((item) => (
          <div key={item.title} className="marketing-card case-card">
            <div className="marketing-card__title">{item.title}</div>
            <div className="case-card__label">Было</div>
            <div className="marketing-card__text">{item.before}</div>
            <div className="case-card__label">Стало</div>
            <div className="marketing-card__text">{item.after}</div>
          </div>
        ))}
      </div>

      <LeadPathGrid items={paths} />

      <CTASection {...cta} />
    </section>
  );
}
