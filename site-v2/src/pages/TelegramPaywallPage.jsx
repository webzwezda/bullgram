import { useState } from 'react';
import { ArrowRight, ShieldCheck, Bot, CheckCircle2, Sparkles, Timer, Wallet, UserX, AlertTriangle, CreditCard, Send, TrendingUp, MessageSquare, GraduationCap, CircleDollarSign, Repeat, Users, Settings, ChevronDown } from 'lucide-react';

const painPoints = [
  {
    icon: Timer,
    color: 'amber',
    title: 'Проверяете чеки руками',
    text: 'Каждый перевод нужно сверить, каждый чек — найти в переписке. На 50 подписчиков это 10 минут, на 500 — вы уже не справляетесь.'
  },
  {
    icon: Wallet,
    color: 'red',
    title: 'Теряете платежи',
    text: 'Кто-то прислал скриншот не того перевода, кто-то оплатил не те реквизиты, кто-то просто ничего не прислал — и вы об этом не знаете.'
  },
  {
    icon: UserX,
    color: 'slate',
    title: 'Забываете кикнуть должников',
    text: 'Подписка кончилась, человек остался в канале. Через месяц вы обнаруживаете 30 бесплатников и не помните, кто из них платил.'
  },
  {
    icon: AlertTriangle,
    color: 'orange',
    title: 'Продления живут в хаосе',
    text: 'Кто продлил, кто нет — всё в голове или в таблице, которую никто не обновляет. В итоге одни платят дважды, другие сидят бесплатно.'
  }
];

const steps = [
  {
    icon: Bot,
    title: 'Подключаете бота',
    text: 'Создаёте бота через @BotFather, вставляете токен в Bullgram. 30 секунд, настройка закончена.'
  },
  {
    icon: CreditCard,
    title: 'Создаёте тариф',
    text: 'Устанавливаете цену, период, реквизиты P2P или TON-кошелёк. Клиенты видят оформленную страницу оплаты.'
  },
  {
    icon: Send,
    title: 'Клиент оплачивает',
    text: 'Клиент переходит по ссылке, оплачивает по реквизитам, присылает чек. Bullgram фиксирует и проверяет.'
  },
  {
    icon: TrendingUp,
    title: 'Получаете деньги',
    text: 'Доступ в канал выдаётся автоматически. Продления, напоминания, исключения — без вашего участия.'
  }
];

const audiences = [
  {
    icon: MessageSquare,
    color: 'violet',
    label: 'Криптоканалы',
    title: 'Трейд-сигналы, аналитика, ЦА',
    text: 'Закрытый канал с почасовыми сигналами, on-chain анализом или торговыми советами. Подписчики платят за доступ, а вы — за то, чтобы не проверять каждый перевод вручную.'
  },
  {
    icon: GraduationCap,
    color: 'blue',
    label: 'Образовательные сообщества',
    title: 'Курсы, менторства, онбординг',
    text: 'Закрытая группа для учеников, где доступ — это часть продукта. Описание тарифов, автоматический доступ и исключение после окончания обучения.'
  },
  {
    icon: CircleDollarSign,
    color: 'emerald',
    label: 'Экспертные группы',
    title: 'Консультации, клубы, closed community',
    text: 'Платный чат с экспертами, закрытое сообщество предпринимателей или клуб по интересам. Вы продаёте доступ, Bullgram ведёт базу и контролирует продления.'
  }
];

const outcomes = [
  {
    icon: Wallet,
    title: 'Касса идёт напрямую вам',
    text: 'Деньги от клиентов поступают на ваши P2P-реквизиты или TON-кошелёк. Bullgram не держит деньги, не берёт процент — ведёт только статус и чек.'
  },
  {
    icon: Bot,
    title: 'Доступ выдаётся автоматически',
    text: 'Клиент оплатил — получил приглашение в канал. Клиент не продлил — исключён без ручных действий. Вы контролирующий, не исполняющий.'
  },
  {
    icon: Repeat,
    title: 'Продления без напоминаний вам',
    text: 'Bullgram сам напоминает об истекающем доступе, ведёт статус продления и фиксирует новую оплату. Вы просто видите: кто продлил, а кто нет.'
  },
  {
    icon: Users,
    title: 'База клиентов — не таблица, а система',
    text: 'История платежей, статусы подписок, оттоков и возвращений. Вы знаете каждого клиента, а не только его последний чек.'
  },
  {
    icon: Settings,
    title: 'Тарифы под ваш сценарий',
    text: 'День, неделя, месяц, год — любой период. Несколько тарифов для одного канала. Цена, описание и реквизиты — всё в одном месте.'
  },
  {
    icon: ShieldCheck,
    title: 'Контроль данных и оплат',
    text: 'Каждый чек привязан к человеку, тарифу и статусу. Вся история сохраняется, и вы можете проверить её в любой момент.'
  }
];

const faqItems = [
  {
    question: 'Деньги идут через Bullgram?',
    answer: 'Нет. Bullgram не держит ваши деньги и не берёт процент. Клиенты оплачивают по вашим P2P-реквизитам или на ваш TON-кошелёк. Bullgram только фиксирует оплату и выдаёт доступ.'
  },
  {
    question: 'Можно использовать с несколькими каналами?',
    answer: 'Да. Normal-тариф позволяет вести несколько каналов, настраивать разные тарифы и вести единую базу клиентов.'
  },
  {
    question: 'Что происходит, когда подписка у клиента истекает?',
    answer: 'Bullgram напоминает о продлении. Если клиент не продлевает, доступ автоматически закрывается. Вам не нужно вручную исключать людей.'
  },
  {
    question: 'Нужен ли мне свой сервер или хостинг?',
    answer: 'Нет. Bullgram работает облачно. Вы создаёте бота через @BotFather, вставляете токен — и всё. Настройка занимает меньше минуты.'
  },
  {
    question: 'Что если у меня уже есть бот для оплаты?',
    answer: 'Bullgram не конфликтует с существующими ботами. Вы можете использовать его как основной инструмент для кассы и доступа, а старый бот — оставить для других задач.'
  },
  {
    question: 'Какая цена и есть ли скидки?',
    answer: 'Trial — 14 дней бесплатно. Normal — 900 руб./год. Подробности на странице тарифов. Скидок и сигнальщиков нет — цена фиксирована.'
  }
];

function PainCard({ icon: Icon, color, title, text }) {
  const colorMap = {
    amber: { bg: 'bg-amber-50', border: 'border-amber-100', text: 'text-amber-600' },
    red: { bg: 'bg-red-50', border: 'border-red-100', text: 'text-red-500' },
    slate: { bg: 'bg-slate-100', border: 'border-slate-200', text: 'text-slate-600' },
    orange: { bg: 'bg-orange-50', border: 'border-orange-100', text: 'text-orange-500' }
  };
  const c = colorMap[color];
  return (
    <div className="rounded-[2rem] bg-slate-50 border border-slate-200/80 p-8">
      <div className={`w-12 h-12 rounded-2xl ${c.bg} border ${c.border} flex items-center justify-center mb-5`}>
        <Icon className={`w-6 h-6 ${c.text}`} />
      </div>
      <h3 className="text-xl font-extrabold text-slate-900 tracking-tight mb-2">{title}</h3>
      <p className="text-slate-500 font-medium leading-relaxed">{text}</p>
    </div>
  );
}

function StepCard({ icon: Icon, title, text, step }) {
  return (
    <div className="rounded-[2rem] bg-white border border-slate-200/80 p-8 relative">
      <div className="absolute top-6 right-6 text-5xl font-black text-slate-100">{step}</div>
      <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center mb-5">
        <Icon className="w-6 h-6 text-blue-600" />
      </div>
      <h3 className="text-xl font-extrabold text-slate-900 tracking-tight mb-2">{title}</h3>
      <p className="text-slate-500 font-medium leading-relaxed">{text}</p>
    </div>
  );
}

function AudienceCard({ icon: Icon, color, label, title, text }) {
  const colorMap = {
    violet: { bg: 'bg-violet-50', border: 'border-violet-100', text: 'text-violet-600', label: 'text-violet-600' },
    blue: { bg: 'bg-blue-50', border: 'border-blue-100', text: 'text-blue-600', label: 'text-blue-600' },
    emerald: { bg: 'bg-emerald-50', border: 'border-emerald-100', text: 'text-emerald-600', label: 'text-emerald-600' }
  };
  const c = colorMap[color];
  return (
    <div className="rounded-[2rem] bg-white border border-slate-200/80 p-8 transition-all hover:shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:border-slate-300">
      <div className={`text-xs font-bold uppercase tracking-widest ${c.label} mb-4`}>{label}</div>
      <div className={`w-14 h-14 rounded-2xl ${c.bg} border ${c.border} flex items-center justify-center mb-5`}>
        <Icon className={`w-7 h-7 ${c.text}`} />
      </div>
      <h3 className="text-xl font-extrabold text-slate-900 tracking-tight mb-2">{title}</h3>
      <p className="text-slate-500 font-medium leading-relaxed">{text}</p>
    </div>
  );
}

function OutcomeCard({ icon: Icon, title, text }) {
  return (
    <div className="rounded-[2rem] bg-white/5 border border-white/10 p-8 backdrop-blur-sm">
      <div className="w-12 h-12 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center mb-5">
        <Icon className="w-6 h-6 text-white" />
      </div>
      <h3 className="text-xl font-extrabold text-white tracking-tight mb-2">{title}</h3>
      <p className="text-slate-400 font-medium leading-relaxed">{text}</p>
    </div>
  );
}

export function TelegramPaywallPage() {
  const [faqOpen, setFaqOpen] = useState(null);

  return (
    <div className="min-h-screen overflow-hidden rounded-3xl bg-white font-sans text-slate-900 selection:bg-blue-200 selection:text-blue-900">
      <main className="overflow-hidden">

        {/* ================= HERO SECTION (unchanged) ================= */}
        <section className="relative pt-28 pb-20 lg:pt-40 lg:pb-32 flex flex-col items-center text-center px-4 sm:px-6">
          <div className="absolute inset-0 -z-10 h-full w-full bg-white bg-[linear-gradient(to_right,#f0f0f0_1px,transparent_1px),linear-gradient(to_bottom,#f0f0f0_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
          <div className="absolute top-0 -z-10 w-full h-[600px] bg-[radial-gradient(circle_800px_at_50%_-200px,#e0e7ff,transparent)]" />
          <div className="absolute top-40 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-blue-400/20 blur-[100px] rounded-full mix-blend-multiply pointer-events-none -z-10" />

          <div className="group inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-slate-200/60 shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] mb-8 transition-all hover:shadow-[0_2px_15px_-3px_rgba(6,81,237,0.2)] hover:border-blue-200 cursor-pointer">
            <span className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center">
              <Sparkles className="w-3 h-3 text-white" />
            </span>
            <span className="text-[13px] font-bold tracking-wide text-slate-700 uppercase pr-1 group-hover:text-blue-600 transition-colors">
              Bullgram 2.0 Автоматизация
            </span>
          </div>

          <h1 className="text-6xl sm:text-7xl lg:text-[5.5rem] font-black tracking-tighter text-slate-900 leading-[0.95] max-w-5xl mb-8">
            P2P-касса для Telegram <br className="hidden sm:block" />
            без <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 via-indigo-500 to-violet-500">ручной сверки</span>
          </h1>

          <p className="text-xl sm:text-2xl text-slate-500 font-medium max-w-2xl leading-relaxed mb-12 tracking-tight">
            Подключите <span className="text-slate-800 font-bold">@BotFather</span> и соберите кассу для своего проекта: реквизиты продавца, чеки, заявки, выдача доступа и контроль продлений в одном месте.
          </p>

          <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto z-10">
            <a
              href="/pricing"
              className="group relative inline-flex items-center justify-center gap-2 rounded-full bg-blue-600 px-8 py-4 text-base font-bold !text-white transition-all hover:bg-blue-700 hover:shadow-[0_8px_30px_rgba(37,99,235,0.24)] hover:-translate-y-0.5 w-full sm:w-auto"
            >
              Смотреть тарифы
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </a>
            <a
              href="#pain"
              className="group inline-flex items-center justify-center gap-2 rounded-full bg-white px-8 py-4 text-base font-bold !text-slate-700 transition-all border border-slate-200 hover:bg-slate-50 hover:!text-slate-900 hover:shadow-sm w-full sm:w-auto"
            >
              Смотреть функции
            </a>
          </div>

          <div className="mt-12 flex items-center justify-center gap-6 text-sm font-semibold text-slate-400">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" /> P2P/TON-поток продавцу
            </div>
            <div className="hidden sm:flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" /> Normal оплачивается отдельно
            </div>
          </div>
        </section>

        {/* ================= PROBLEM / PAIN POINTS ================= */}
        <section id="pain" className="py-20 lg:py-28 border-t border-slate-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mb-14">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-50 text-red-700 text-xs font-bold uppercase tracking-widest mb-6">
                Знакомо?
              </div>
              <h2 className="text-4xl lg:text-5xl font-black tracking-tight text-slate-900 leading-tight">
                Ручная касса в Telegram — это потерянные деньги и выгорание
              </h2>
              <p className="text-lg text-slate-500 font-medium mt-4">
                Каждый админ закрытого канала проходит через одни и те же проблемы.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {painPoints.map((point) => (
                <PainCard key={point.title} {...point} />
              ))}
            </div>
          </div>
        </section>

        {/* ================= HOW IT WORKS ================= */}
        <section className="py-20 lg:py-28 bg-slate-50/50 border-t border-b border-slate-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mb-14">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 text-blue-700 text-xs font-bold uppercase tracking-widest mb-6">
                Как это работает
              </div>
              <h2 className="text-4xl lg:text-5xl font-black tracking-tight text-slate-900 leading-tight">
                Четыре шага от бота до денежного канала
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {steps.map((step, index) => (
                <StepCard key={step.title} {...step} step={`0${index + 1}`} />
              ))}
            </div>
          </div>
        </section>

        {/* ================= WHO IT'S FOR ================= */}
        <section className="py-20 lg:py-28 border-t border-slate-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mb-14">
              <h2 className="text-4xl lg:text-5xl font-black tracking-tight text-slate-900 leading-tight">
                Для кого Bullgram
              </h2>
              <p className="text-lg text-slate-500 font-medium mt-4">
                Не для всех. Для тех, кто монетизирует Telegram через закрытый доступ.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {audiences.map((audience) => (
                <AudienceCard key={audience.label} {...audience} />
              ))}
            </div>
          </div>
        </section>

        {/* ================= WHAT YOU GET (dark section) ================= */}
        <section className="py-20 lg:py-28 bg-slate-900 relative overflow-hidden">
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:24px_24px]" />
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
            <div className="max-w-3xl mb-14">
              <div className="text-xs font-bold uppercase tracking-widest text-blue-400 mb-4">
                Что вы получаете
              </div>
              <h2 className="text-4xl lg:text-5xl font-black tracking-tight text-white leading-tight">
                Не набор функций, а готовый рабочий контур
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {outcomes.map((outcome) => (
                <OutcomeCard key={outcome.title} {...outcome} />
              ))}
            </div>
          </div>
        </section>

        {/* ================= FAQ ================= */}
        <section className="py-20 lg:py-28 bg-slate-50/50 border-t border-slate-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mb-14">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 text-blue-700 text-xs font-bold uppercase tracking-widest mb-6">
                FAQ
              </div>
              <h2 className="text-4xl lg:text-5xl font-black tracking-tight text-slate-900 leading-tight">
                Ответы на вопросы
              </h2>
              <p className="text-lg text-slate-500 font-medium mt-4">
                То, что обычно спрашивают перед подключением.
              </p>
            </div>
            <div className="max-w-3xl flex flex-col gap-3">
              {faqItems.map((item, index) => (
                <div
                  key={item.question}
                  className={`rounded-[2rem] border overflow-hidden transition-colors ${faqOpen === index ? 'bg-white border-blue-200 shadow-[0_8px_30px_rgb(0,0,0,0.04)]' : 'bg-white border-slate-200/80 hover:border-slate-300'}`}
                >
                  <button
                    type="button"
                    className="flex items-center justify-between w-full p-6 sm:p-8 text-left gap-4"
                    onClick={() => setFaqOpen(faqOpen === index ? null : index)}
                  >
                    <span className="text-base sm:text-lg font-extrabold text-slate-900">{item.question}</span>
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-colors ${faqOpen === index ? 'bg-blue-50' : 'bg-slate-50'}`}>
                      <ChevronDown className={`w-4 h-4 transition-transform ${faqOpen === index ? 'rotate-180 text-blue-600' : 'text-slate-400'}`} />
                    </div>
                  </button>
                  <div className={`grid transition-all duration-200 ${faqOpen === index ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                    <div className="overflow-hidden">
                      <div className="px-6 sm:px-8 pb-6 sm:pb-8 pt-0">
                        <div className="border-t border-slate-100 pt-5">
                          <p className="text-slate-500 font-medium leading-relaxed">{item.answer}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

      </main>
    </div>
  );
}
