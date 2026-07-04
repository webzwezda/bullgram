import { useMemo } from 'react';
import { CTASection, FeatureGrid, HighlightBand, LeadPathGrid, SALES_LINKS, SectionIntro } from '../components/MarketingPrimitives.jsx';
import { useAuth } from '../app/providers/AuthProvider.jsx';

const FEATURES = [
  { title: 'TON / P2P-касса', text: 'Платежный контур с memo, QR и авто-проверкой без ручной возни.', meta: 'Для офферов, групп и сервисов' },
  { title: 'Платные группы', text: 'Выдача доступа, join request, auto-kick и удержание в одном контуре.', meta: 'Когда продаешь клуб, чат или закрытый канал' },
  { title: 'Telegram CRM и дожим', text: 'Брошенные корзины, рассылки, базы клиентов и сценарии возврата хвостов.', meta: 'Видно, кого дожимать прямо сейчас' },
  { title: 'Userbot Center', text: 'Лички, группы, горячие входящие и быстрые ответы из одного центра.', meta: 'Чтобы теплые лички не умирали' },
  { title: 'Shop и seller mode', text: 'Витрина офферов, активов и seller storefront с прямой оплатой продавцу.', meta: 'Лоты, скрытые офферы, seller page' },
  { title: 'Command Center', text: 'Где деньги, где отвал и где косяк по доступу прямо сейчас.', meta: 'Для владельца и команды' }
];

const FEATURE_PATHS = [
  {
    eyebrow: 'Продажи',
    title: 'Хочу быстро продавать через TON',
    text: 'Начинаем с Shop и P2P-офферов, если тебе важно быстро завернуть оплату и скрытую выдачу.',
    primary: { label: 'Открыть P2P checkout', href: SALES_LINKS.p2p }
  },
  {
    eyebrow: 'Операционка',
    title: 'Хочу держать Telegram под контролем',
    text: 'Идем в Normal-контур с userbot center, command center и CRM, если проблема уже не в продаже, а в хаосе после нее.',
    primary: { label: 'Открыть Normal checkout', href: SALES_LINKS.ops }
  }
];

export function FeaturesPage() {
  const { user, profilePlan, profileRole, sellerPulse } = useAuth();
  const sellerIsAssetMarketplace = profileRole === 'admin';

  const paths = useMemo(() => {
    if (user && profilePlan === 'trial') {
      return [
        {
          eyebrow: 'Апгрейд',
          title: 'Trial уже идет. Пора в Normal',
          text: 'У тебя уже есть вход в продукт. Следующий шаг — закрыть живой контур и открыть Normal без старых лимитов.',
          primary: { label: 'Открыть checkout Normal', href: SALES_LINKS.ops }
        },
        {
          eyebrow: 'Практика',
          title: 'Хочу дожать первый реальный сценарий',
          text: 'Иди в Shop, добей P2P или группу, а потом возвращайся в /app и запускай операционку по-человечески.',
          primary: { label: 'Открыть Normal', href: SALES_LINKS.ops }
        }
      ];
    }

    if (user && profilePlan === 'normal') {
      const sellerPath = sellerPulse?.paidCount
        ? {
            eyebrow: 'Seller admin',
            title: 'Seller mode уже жив. Открывай seller admin и добивай inventory и handoff.',
            text: 'Если seller уже куплен, сайт больше не должен слать тебя в общий апгрейд. Следующий шаг — работа в seller admin.',
            primary: { label: 'Открыть seller admin', href: '/app/shop' }
          }
        : sellerPulse?.pendingCount || sellerPulse?.awaitingReceiptCount || sellerPulse?.failedCount
          ? {
              eyebrow: 'Seller checkout',
              title: 'Seller mode уже открыт. Сначала добей текущий seller checkout.',
              text: 'У тебя уже есть seller-счет, чек или сломанный handoff. Сначала закрой его, потом строй следующий seller-слой.',
              primary: { label: 'Вернуться к seller checkout', href: '/shop?offer=seller' }
            }
          : {
              eyebrow: 'Seller mode',
              title: sellerIsAssetMarketplace ? 'Дожать seller-flow и свои офферы' : 'Дожать P2P seller и скрытые офферы',
              text: sellerIsAssetMarketplace
                ? 'Если базовый контур уже жив, пора строить seller-поток, витрину и прямую монетизацию через Shop.'
                : 'Если базовый контур уже жив, пора включать P2P seller: скрытые офферы, TON/P2P checkout и выдачу результата прямо на сайте.',
              primary: { label: sellerIsAssetMarketplace ? 'Открыть Shop' : 'Открыть P2P seller', href: SALES_LINKS.seller }
            };

      return [
        {
          eyebrow: 'Операционка',
          title: 'Открыть основной кабинет',
          text: 'У тебя уже есть Normal. Значит вопрос теперь не в маркетинге, а в том, что первым делом запускать в кабинете.',
          primary: { label: 'Открыть /app', href: '/app/' }
        },
        sellerPath
      ];
    }

    return FEATURE_PATHS;
  }, [profilePlan, profileRole, sellerPulse, user]);

  const cta = useMemo(() => {
    if (user && profilePlan === 'trial') {
      return {
        title: 'Не смотри возможности как каталог. Используй их как аргумент для апгрейда.',
        text: 'Trial уже дал вход. Теперь нужен Normal, чтобы довести контур до боевой CRM, seller-flow и регулярной работы команды.',
        primary: { label: 'Перейти на Normal', href: SALES_LINKS.ops },
        secondary: { label: 'Открыть Normal', href: SALES_LINKS.ops }
      };
    }

    if (user && profilePlan === 'normal') {
      return {
        title: 'Возможности уже куплены. Дальше — запуск и дисциплина.',
        text: 'Возвращайся в кабинет, запускай userbot center, CRM, рассылки и shop seller-flow как один контур, а не как набор разрозненных экранов.',
        primary: { label: 'Открыть кабинет', href: '/app/' },
        secondary: {
          label: sellerPulse?.paidCount
            ? (sellerIsAssetMarketplace ? 'Открыть seller admin' : 'Открыть P2P seller')
            : sellerPulse?.hasAny
              ? 'Вернуться к seller checkout'
              : (sellerIsAssetMarketplace ? 'Открыть Shop' : 'Открыть P2P seller'),
          href: sellerPulse?.paidCount ? '/app/shop' : sellerPulse?.hasAny ? '/shop?offer=seller' : '/shop'
        }
      };
    }

    return {
      title: 'Хочешь не смотреть в теории, а зайти в продукт?',
      text: 'Для большинства правильнее начать с Trial. Если тебе уже нужен командный разбор под продавцов, группы и Telegram-хаос, тогда идем в внедрение.',
      primary: { label: 'Начать Trial', href: SALES_LINKS.trial },
      secondary: { label: 'Смотреть кейсы', href: '/cases' }
    };
  }, [profilePlan, profileRole, sellerPulse, user]);

  return (
    <section className="marketing-page">
      <SectionIntro
        eyebrow="Что умеет"
        title="Мы продаем не набор кнопок, а конкретный результат: деньги, дожим и порядок в Telegram-операционке."
        text="Bullgram нужен там, где обычный “бот для оплаты” уже не справляется, потому что поверх оплаты надо еще контролировать доступ, входящие, базу и работу команды."
      />

      <FeatureGrid items={FEATURES} />

      <HighlightBand
        title="Где Bullgram выигрывает"
        text="Когда в Telegram уже есть деньги, люди и админы, но все это пока живет на ручных действиях и разрозненных ботах."
        items={[
          'Продажа офферов после TON/P2P',
          'Платные группы и retention',
          'Telegram CRM и дожим',
          'Контроль команды и прав по группам'
        ]}
      />

      <LeadPathGrid items={paths} />

      <CTASection {...cta} />
    </section>
  );
}
