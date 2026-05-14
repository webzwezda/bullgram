import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileText,
  Mail,
  Phone,
  ReceiptText,
  RotateCcw,
  ShieldCheck,
  Truck
} from 'lucide-react';
import { SALES_LINKS } from '../components/MarketingPrimitives.jsx';

const sellerDetails = {
  name: 'BullRun',
  sellerType: 'Самозанятый',
  legalName: 'Козель Илья Сергеевич',
  taxId: '270415104864',
  address: 'Хабаровский край',
  email: 'webzwezda@gmail.com',
  phone: '+7 908 461-04-34',
  telegram: '+7 908 461-04-34'
};

const offerHref = '/docs/oferta_270415104864.docx';

const plans = [
  {
    id: 'trial',
    label: 'Пробный вход',
    title: 'Trial',
    price: '0 ₽',
    period: 'на 14 дней',
    description: 'Пробный доступ к BullRun, чтобы проверить сценарий платного Telegram-доступа без оплаты.',
    href: SALES_LINKS.trial,
    action: 'Начать Trial',
    features: [
      'до 50 активных подписчиков',
      'первый checkout и доступ после оплаты',
      'базовая проверка Telegram-сценария',
      'ограничения пробного режима'
    ]
  },
  {
    id: 'normal',
    label: 'Первый платный вход',
    title: 'Normal',
    price: '900 ₽',
    period: 'за 365 дней доступа',
    description: 'Основной платный тариф для доступа к BullRun: P2P/TON-касса, доступ, CRM, продления и Shop.',
    href: SALES_LINKS.ops,
    action: 'Оформить Normal',
    highlighted: true,
    features: [
      'доступ к кабинету BullRun на 365 дней',
      'P2P/TON-касса для Telegram-канала или группы',
      'CRM, заказы, продления и исключение из доступа',
      'Shop/P2P-сценарий с прямым денежным потоком продавцу'
    ]
  },
  {
    id: 'custom',
    label: 'Индивидуально',
    title: 'Под заказ',
    price: 'по согласованию',
    period: 'после брифа',
    description: 'Индивидуальная настройка, миграция или отдельный запуск. Пока тариф не принимает оплату на сайте.',
    action: 'Временно недоступно',
    disabled: true,
    features: [
      'состав работ фиксируется до оплаты',
      'срок и результат согласуются в заказе',
      'подходит для нестандартной Telegram-инфраструктуры',
      'будет включен после готовности ручного процесса'
    ]
  }
];

const normalDelivery = [
  'Покупатель выбирает тариф Normal на странице оплаты BullRun.',
  'Перед оплатой видит стоимость, срок доступа и состав услуги.',
  'После оплаты через Robokassa получает доступ к рабочему кабинету BullRun.',
  'Услуга оказывается дистанционно в течение оплаченного периода 365 дней.'
];

const complianceBlocks = [
  {
    icon: FileText,
    title: 'Оферта',
    text: 'Оплата означает согласие с условиями публичной оферты. В оферте указаны состав услуги, цена, срок оказания, отказ и возврат.',
    href: offerHref,
    linkLabel: 'Скачать публичную оферту'
  },
  {
    icon: Truck,
    title: 'Получение услуги',
    text: 'Normal открывает дистанционный доступ к сервису BullRun и рабочим сценариям для Telegram-проекта на оплаченный срок.'
  },
  {
    icon: RotateCcw,
    title: 'Отказ и возврат',
    text: 'До начала оказания услуги покупатель может отказаться от заказа и получить полный возврат. После начала доступного периода возврат рассчитывается по неоказанной части услуги.'
  },
  {
    icon: ShieldCheck,
    title: 'Персональные данные',
    text: 'Контакты покупателя используются для связи по заказу, выдачи доступа, чеков и поддержки. Данные не передаются третьим лицам без законного основания.'
  }
];

function PlanCard({ plan }) {
  const cardClass = plan.highlighted
    ? 'relative flex flex-col rounded-lg border-2 border-blue-600 bg-white p-6 shadow-xl shadow-blue-600/10'
    : plan.disabled
      ? 'relative flex flex-col rounded-lg border border-slate-200 bg-slate-100/80 p-6 text-slate-500'
      : 'relative flex flex-col rounded-lg border border-slate-200 bg-white p-6 shadow-sm';

  return (
    <article className={cardClass}>
      {plan.highlighted ? (
        <div className="absolute -top-4 left-6 rounded-lg bg-blue-600 px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-white shadow-md">
          {plan.label}
        </div>
      ) : (
        <div className="mb-4 text-xs font-black uppercase tracking-[0.16em] text-slate-400">{plan.label}</div>
      )}

      {plan.highlighted ? <div className="mb-4 h-2" /> : null}
      <div className="mb-5">
        <h2 className={`text-2xl font-black ${plan.disabled ? 'text-slate-500' : 'text-slate-950'}`}>{plan.title}</h2>
        <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{plan.description}</p>
      </div>

      <div className="mb-6">
        <div className={`text-4xl font-black tracking-tight ${plan.disabled ? 'text-slate-500' : 'text-slate-950'}`}>
          {plan.price}
        </div>
        <div className="mt-1 text-sm font-bold text-slate-500">{plan.period}</div>
      </div>

      <ul className="mb-8 space-y-3">
        {plan.features.map((feature) => (
          <li key={feature} className="flex gap-3 text-sm font-semibold leading-6 text-slate-700">
            {plan.disabled ? (
              <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" strokeWidth={2.5} />
            ) : (
              <CheckCircle2 className={`mt-0.5 h-5 w-5 shrink-0 ${plan.highlighted ? 'text-blue-600' : 'text-emerald-500'}`} strokeWidth={2.5} />
            )}
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      {plan.disabled ? (
        <button
          type="button"
          disabled
          className="mt-auto inline-flex w-full cursor-not-allowed items-center justify-center rounded-lg bg-slate-200 px-5 py-4 text-base font-black text-slate-500"
        >
          {plan.action}
        </button>
      ) : (
        <a
          href={plan.href}
          className={`mt-auto inline-flex w-full items-center justify-center gap-2 rounded-lg px-5 py-4 text-base font-black transition ${
            plan.highlighted
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700'
              : 'bg-white text-slate-800 ring-1 ring-inset ring-slate-200 hover:bg-slate-50 hover:ring-slate-300'
          }`}
        >
          {plan.action}
          <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
        </a>
      )}
    </article>
  );
}

export function PricingPage() {
  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-12 sm:px-6 md:py-16 lg:px-8">
      <section className="border-b border-slate-200 pb-12">
        <div className="grid gap-5 lg:grid-cols-3 lg:items-stretch">
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} />
          ))}
        </div>
      </section>

      <section className="grid gap-8 border-b border-slate-200 py-12 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <div className="text-sm font-black uppercase tracking-[0.16em] text-blue-700">Что оплачивает покупатель</div>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">Normal на 365 дней</h2>
          <p className="mt-4 text-base font-medium leading-7 text-slate-600">
            Это услуга дистанционного доступа к сервису BullRun для управления платным Telegram-проектом:
            P2P/TON-касса, заявки, чеки, выдача доступа, CRM, продления, исключения и Shop/P2P-сценарии.
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <div className="flex items-center gap-3 text-slate-950">
            <ReceiptText className="h-6 w-6 text-blue-600" strokeWidth={2.5} />
            <h3 className="text-2xl font-black tracking-tight">Порядок оказания услуги</h3>
          </div>
          <ol className="mt-6 space-y-4">
            {normalDelivery.map((step, index) => (
              <li key={step} className="flex gap-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-sm font-black text-blue-700">
                  {index + 1}
                </span>
                <span className="pt-1 text-sm font-semibold leading-6 text-slate-700">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-b border-slate-200 py-12">
        <div className="max-w-3xl">
          <div className="text-sm font-black uppercase tracking-[0.16em] text-blue-700">Правила покупки</div>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">Информация для оплаты через Robokassa</h2>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {complianceBlocks.map(({ icon: Icon, title, text, href, linkLabel }) => (
            <article key={title} className="rounded-lg border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-3">
                <Icon className="h-5 w-5 text-blue-600" strokeWidth={2.5} />
                <h3 className="text-lg font-black text-slate-950">{title}</h3>
              </div>
              <p className="mt-3 text-sm font-medium leading-6 text-slate-600">{text}</p>
              {href ? (
                <a
                  href={href}
                  className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-50 px-4 py-3 text-sm font-black text-blue-700 ring-1 ring-inset ring-blue-200 transition hover:bg-blue-100"
                >
                  <FileText className="h-4 w-4" strokeWidth={2.5} />
                  {linkLabel}
                </a>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-8 py-12 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <div className="text-sm font-black uppercase tracking-[0.16em] text-blue-700">Контакты и реквизиты</div>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">Продавец и поддержка</h2>
          <p className="mt-4 text-base font-medium leading-7 text-slate-600">
            Для самозанятого Robokassa ожидает полные ФИО, ИНН и регион/город продавца.
            Паспортные данные на публичной странице не размещаются.
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <dl className="grid gap-4 text-sm">
            {[
              ['Наименование ресурса', sellerDetails.name],
              ['Статус продавца', sellerDetails.sellerType],
              ['Продавец', sellerDetails.legalName],
              ['ИНН', sellerDetails.taxId],
              ['Регион', sellerDetails.address]
            ].map(([label, value]) => (
              <div key={label} className="grid gap-1 border-b border-slate-100 pb-4 last:border-b-0 last:pb-0 sm:grid-cols-[160px_1fr]">
                <dt className="font-black text-slate-400">{label}</dt>
                <dd className="font-semibold text-slate-800">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <a className="inline-flex items-center gap-2 rounded-lg bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-100" href={`mailto:${sellerDetails.email}`}>
              <Mail className="h-4 w-4" strokeWidth={2.5} />
              {sellerDetails.email}
            </a>
            <div className="inline-flex items-center gap-2 rounded-lg bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700">
              <Phone className="h-4 w-4" strokeWidth={2.5} />
              {sellerDetails.phone}
            </div>
          </div>
          <div className="mt-3 rounded-lg bg-blue-50 px-4 py-3 text-sm font-bold text-blue-800">
            Telegram поддержки: {sellerDetails.telegram}
          </div>
        </div>
      </section>
    </div>
  );
}
