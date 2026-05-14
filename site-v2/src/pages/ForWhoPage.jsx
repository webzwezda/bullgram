import { useMemo } from 'react';
import { CTASection, FeatureGrid, SALES_LINKS, SectionIntro } from '../components/MarketingPrimitives.jsx';
import { useAuth } from '../app/providers/AuthProvider.jsx';

const SEGMENTS = [
  {
    title: 'Админы платных групп',
    text: 'Принимают оплату, выдают доступ, держат подписки и не хотят больше возиться с ручной проверкой.',
    meta: 'TON + доступ + удержание'
  },
  {
    title: 'Продавцы офферов и услуг',
    text: 'Хотят продавать через TON и после оплаты сразу отдавать скрытое сообщение или актив.',
    meta: 'P2P + hidden message + shop'
  },
  {
    title: 'Крипто-команды и closers',
    text: 'Нужны userbot center, быстрые ответы и контроль за входящими, чтобы не терять горячие лички.',
    meta: 'Лички + triage + дожим'
  },
  {
    title: 'Команды с несколькими админами',
    text: 'Нужен command center, контроль групп и понимание, кто реально работает, а кто просто висит в системе.',
    meta: 'Command center + Telegram ops'
  }
];

export function ForWhoPage() {
  const { user, profilePlan, sellerPulse } = useAuth();

  const cta = useMemo(() => {
    if (user && profilePlan === 'trial') {
      return {
        title: 'Ты уже внутри Trial. Следующий шаг — собрать первый контур и перейти на Normal.',
        text: 'Не читай сайт по кругу. Закрой первый checkout, доведи P2P или группу до живого сценария и открывай Normal.',
        primary: { label: 'Перейти на Normal', href: SALES_LINKS.ops },
        secondary: { label: 'Открыть Normal', href: SALES_LINKS.ops }
      };
    }

    if (user && profilePlan === 'normal') {
      return {
        title: 'Ты уже на Normal. Дальше не читать, а запускать живой контур.',
        text: 'Открывай кабинет, добивай CRM и seller-flow, а сайт используй как витрину сценариев для команды и клиентов.',
        primary: { label: 'Открыть кабинет', href: '/app/' },
        secondary: {
          label: sellerPulse?.paidCount ? 'Открыть seller admin' : sellerPulse?.hasAny ? 'Вернуться к seller checkout' : 'Открыть Shop',
          href: sellerPulse?.paidCount ? '/app/shop' : sellerPulse?.hasAny ? '/shop?offer=seller' : '/shop'
        }
      };
    }

    return {
      title: 'Узнал себя в одном из сценариев?',
      text: 'Тогда тебе не нужен еще один “ботик”. Тебе нужен один из трех контуров: TON/P2P, платная группа или Telegram CRM/дожим.',
      primary: { label: 'Начать Trial', href: SALES_LINKS.trial },
      secondary: { label: 'Смотреть сценарии', href: '/scenarios' }
    };
  }, [profilePlan, sellerPulse, user]);

  return (
    <section className="marketing-page">
      <SectionIntro
        eyebrow="Сегменты"
        title="BullRun не для всех. Он для тех, у кого Telegram уже стал основным рабочим каналом."
        text="Если у тебя продажи, доступ, общение с клиентами и координация админов живут в Telegram, BullRun собирает это в один нормальный контур."
      />

      <FeatureGrid items={SEGMENTS} />

      <CTASection {...cta} />
    </section>
  );
}
