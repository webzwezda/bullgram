import { CheckCircle2, XCircle, AlertCircle, ArrowRight } from 'lucide-react';
import { SALES_LINKS } from '../components/MarketingPrimitives.jsx';
import { useAuth } from '../app/providers/AuthProvider.jsx';

export function PricingPage() {
  const { user, profilePlan } = useAuth();

  return (
    <div className="py-16 md:py-24 px-4 sm:px-6 lg:px-8 w-full max-w-7xl mx-auto">
      <div className="text-center max-w-3xl mx-auto mb-16 space-y-5">
        <div className="inline-flex items-center rounded-full bg-blue-50 px-3.5 py-1.5 text-xs font-bold text-blue-600 uppercase tracking-widest ring-1 ring-inset ring-blue-500/20">
          Тарифы
        </div>
        <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 tracking-tight text-balance">
          Платные доступы к Telegram-каналам без ручной рутины
        </h1>
        <p className="text-lg md:text-xl text-slate-500 font-medium max-w-2xl mx-auto text-balance">
          Автоматический доступ после оплаты, база клиентов, продления и исключение — всё в одном месте.
          Начни с Trial или сразу перейди на Normal.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto items-stretch">
        
        {/* Trial Plan */}
        <div className="relative flex flex-col p-8 sm:p-10 rounded-3xl bg-white border border-slate-200 shadow-sm hover:shadow-md transition-shadow duration-300">
          <div className="mb-6">
            <h2 className="text-2xl font-extrabold text-slate-900 mb-2">Trial</h2>
            <p className="text-slate-500 font-medium">Попробуй платный доступ к своему каналу</p>
          </div>
          
          <div className="mb-8">
            <div className="flex items-baseline gap-2">
              <span className="text-5xl font-extrabold text-slate-900 tracking-tight">Бесплатно</span>
            </div>
            <p className="text-slate-500 mt-2 font-medium">на 14 дней</p>
          </div>

          <div className="bg-amber-50/80 border border-amber-200/80 rounded-2xl p-5 mb-8">
            <div className="flex items-center gap-2.5 mb-3">
              <AlertCircle className="w-5 h-5 text-amber-600" strokeWidth={2.5} />
              <h4 className="text-sm font-bold text-amber-800 uppercase tracking-widest">Ограничения Trial</h4>
            </div>
            <ul className="space-y-2 text-sm text-amber-700/90 font-medium">
              <li className="flex gap-2"><span className="text-amber-500 font-bold">•</span>Ограничение на 50 активных подписчиков</li>
              <li className="flex gap-2"><span className="text-amber-500 font-bold">•</span>Базовые функции для старта</li>
              <li className="flex gap-2"><span className="text-amber-500 font-bold">•</span>Нет CRM и продлений</li>
            </ul>
          </div>

          <ul className="space-y-4 mb-10 flex-1">
            {[
              { text: 'До 50 подписчиков', included: true },
              { text: 'Оплата через бота', included: true },
              { text: 'Автоматический доступ после оплаты', included: true },
              { text: 'Базовая аналитика', included: true },
              { text: 'Больше 50 подписчиков', included: false },
              { text: 'CRM и база клиентов', included: false },
              { text: 'Продления и напоминания', included: false },
              { text: 'Shop для продажи', included: false }
            ].map((feature, idx) => (
              <li key={idx} className={`flex items-start gap-3 ${feature.included ? 'text-slate-700 font-semibold' : 'text-slate-400 font-medium'}`}>
                {feature.included ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" strokeWidth={2.5} />
                ) : (
                  <XCircle className="w-5 h-5 text-slate-300 shrink-0" strokeWidth={2.5} />
                )}
                <span className={feature.included ? '' : 'line-through decoration-slate-300'}>{feature.text}</span>
              </li>
            ))}
          </ul>

          <a
            href={SALES_LINKS.trial}
            className="group relative inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-6 py-4 text-base font-bold text-slate-700 ring-1 ring-inset ring-slate-200 transition-all duration-200 hover:bg-slate-50 hover:text-slate-900 hover:ring-slate-300"
          >
            Начать бесплатно
            <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-slate-600 transition-colors" strokeWidth={2.5} />
          </a>
        </div>

        {/* Normal Plan */}
        <div className="relative flex flex-col p-8 sm:p-10 rounded-3xl bg-white border-2 border-blue-500 shadow-xl shadow-blue-900/5">
          <div className="absolute -top-4 left-1/2 -translate-x-1/2">
            <span className="inline-flex items-center rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-1.5 text-xs font-bold text-white shadow-md uppercase tracking-widest">
              Популярный
            </span>
          </div>

          <div className="mb-6">
            <h2 className="text-2xl font-extrabold text-slate-900 mb-2">Normal</h2>
            <p className="text-slate-500 font-medium">Полноценный бизнес на платных доступах</p>
          </div>
          
          <div className="mb-8">
            <div className="flex items-baseline gap-2">
              <span className="text-5xl font-extrabold text-slate-900 tracking-tight">от 2 900 ₽</span>
            </div>
            <p className="text-slate-500 mt-2 font-medium">в месяц</p>
          </div>

          <ul className="space-y-4 mb-10 flex-1">
            {[
              { text: 'Безлимитные подписчики', included: true },
              { text: 'Оплата через бота', included: true },
              { text: 'Автоматический доступ после оплаты', included: true },
              { text: 'CRM и база клиентов', included: true },
              { text: 'Продления и исключение', included: true },
              { text: 'Напоминания об оплате', included: true },
              { text: 'Shop для продажи', included: true },
              { text: 'Аналитика и отчеты', included: true }
            ].map((feature, idx) => (
              <li key={idx} className="flex items-start gap-3 text-slate-700 font-semibold">
                <CheckCircle2 className="w-5 h-5 text-blue-500 shrink-0" strokeWidth={2.5} />
                <span>{feature.text}</span>
              </li>
            ))}
          </ul>

          <a
            href={SALES_LINKS.ops}
            className="group relative inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-4 text-base font-bold text-white shadow-lg shadow-blue-500/30 transition-all duration-200 hover:bg-blue-700 hover:shadow-blue-600/40"
          >
            Выбрать Normal
            <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-1" strokeWidth={2.5} />
          </a>
        </div>

      </div>
    </div>
  );
}
