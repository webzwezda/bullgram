import { ArrowRight, ShieldCheck, BellRing, BarChart3, Bot, CheckCircle2, Zap, Rocket, Sparkles, Activity, Users, Lock, CreditCard } from 'lucide-react';

export function TestPage() {
  return (
    <div className="min-h-screen bg-white font-sans text-slate-900 selection:bg-blue-200 selection:text-blue-900">
      <main className="overflow-hidden">
        
        {/* ================= HERO SECTION (Vercel / Linear inspired) ================= */}
        <section className="relative pt-28 pb-20 lg:pt-40 lg:pb-32 flex flex-col items-center text-center px-4 sm:px-6">
          {/* Abstract Background Elements */}
          <div className="absolute inset-0 -z-10 h-full w-full bg-white bg-[linear-gradient(to_right,#f0f0f0_1px,transparent_1px),linear-gradient(to_bottom,#f0f0f0_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
          <div className="absolute top-0 -z-10 w-full h-[600px] bg-[radial-gradient(circle_800px_at_50%_-200px,#e0e7ff,transparent)]" />
          <div className="absolute top-40 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-blue-400/20 blur-[100px] rounded-full mix-blend-multiply pointer-events-none -z-10" />

          {/* Badge */}
          <div className="group inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-slate-200/60 shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] mb-8 transition-all hover:shadow-[0_2px_15px_-3px_rgba(6,81,237,0.2)] hover:border-blue-200 cursor-pointer">
            <span className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center">
              <Sparkles className="w-3 h-3 text-white" />
            </span>
            <span className="text-[13px] font-bold tracking-wide text-slate-700 uppercase pr-1 group-hover:text-blue-600 transition-colors">
              BullRun 2.0 Автоматизация
            </span>
          </div>
          
          {/* Main Headline */}
          <h1 className="text-6xl sm:text-7xl lg:text-[5.5rem] font-black tracking-tighter text-slate-900 leading-[0.95] max-w-5xl mb-8">
            Монетизируйте Telegram <br className="hidden sm:block" />
            на <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 via-indigo-500 to-violet-500">абсолютном автопилоте</span>
          </h1>
          
          {/* Subheadline */}
          <p className="text-xl sm:text-2xl text-slate-500 font-medium max-w-2xl leading-relaxed mb-12 tracking-tight">
            Вставьте токен от <span className="text-slate-800 font-bold">@BotFather</span> и забудьте о рутине. Система сама принимает оплату, выдает доступы, контролирует продления и исключает должников.
          </p>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto z-10">
            <a
              href="/app/botfather"
              target="_blank"
              rel="noreferrer"
              className="group relative inline-flex items-center justify-center gap-2 rounded-full bg-blue-600 px-8 py-4 text-base font-bold !text-white transition-all hover:bg-blue-700 hover:shadow-[0_8px_30px_rgba(37,99,235,0.24)] hover:-translate-y-0.5 w-full sm:w-auto"
            >
              Подключить токен
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </a>
            <a
              href="#bento"
              className="group inline-flex items-center justify-center gap-2 rounded-full bg-white px-8 py-4 text-base font-bold !text-slate-700 transition-all border border-slate-200 hover:bg-slate-50 hover:!text-slate-900 hover:shadow-sm w-full sm:w-auto"
            >
              Смотреть функции
            </a>
          </div>

          {/* Subtle Trust Indicators */}
          <div className="mt-12 flex items-center justify-center gap-6 text-sm font-semibold text-slate-400">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" /> Без комиссий платформы
            </div>
            <div className="hidden sm:flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" /> Настройка за 5 минут
            </div>
          </div>
        </section>

        {/* ================= BENTO BOX GRID (The core features) ================= */}
        <section id="bento" className="py-20 lg:py-28 relative">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-16">
              <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-slate-900 mb-4">
                Весь рабочий контур <br className="hidden sm:block" />в одном дашборде
              </h2>
              <p className="text-lg text-slate-500 font-medium">Больше никаких таблиц и ручных сверок.</p>
            </div>

            {/* Bento Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6 auto-rows-[280px]">
              
              {/* Card 1: Large (Span 2x2) */}
              <div className="group md:col-span-2 lg:col-span-2 row-span-2 relative overflow-hidden rounded-[2rem] bg-slate-50 border border-slate-200/80 p-8 flex flex-col transition-all hover:shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:border-blue-200">
                <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-gradient-to-bl from-blue-100/50 to-transparent rounded-full blur-3xl -z-10 group-hover:from-blue-200/50 transition-colors duration-700" />
                <div className="w-12 h-12 rounded-2xl bg-white border border-slate-200/60 shadow-sm flex items-center justify-center mb-6">
                  <ShieldCheck className="w-6 h-6 text-blue-600" />
                </div>
                <h3 className="text-2xl font-extrabold text-slate-900 mb-3 tracking-tight">Полная видимость</h3>
                <p className="text-slate-500 font-medium leading-relaxed max-w-sm mb-8">
                  Вы сразу видите, кто уже оплатил, кто получил доступ и кто так и не вошел в закрытый канал. Все статусы обновляются в реальном времени.
                </p>
                {/* Abstract UI representation */}
                <div className="mt-auto relative w-full h-48 bg-white rounded-t-2xl border-t border-l border-r border-slate-200/60 shadow-[0_-8px_30px_rgb(0,0,0,0.04)] overflow-hidden flex flex-col">
                  <div className="flex items-center gap-2 p-4 border-b border-slate-100">
                    <div className="w-3 h-3 rounded-full bg-slate-200" />
                    <div className="w-3 h-3 rounded-full bg-slate-200" />
                    <div className="w-3 h-3 rounded-full bg-slate-200" />
                  </div>
                  <div className="p-4 flex flex-col gap-3">
                    <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center"><Bot className="w-4 h-4 text-blue-600" /></div>
                        <div className="h-2 w-24 bg-slate-200 rounded-full" />
                      </div>
                      <div className="h-6 w-16 bg-emerald-100 rounded-full border border-emerald-200/60" />
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100 opacity-50">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-200" />
                        <div className="h-2 w-32 bg-slate-200 rounded-full" />
                      </div>
                      <div className="h-6 w-16 bg-slate-200 rounded-full" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Card 2: Medium Dark (Span 2x1) */}
              <div className="group md:col-span-1 lg:col-span-2 row-span-1 relative overflow-hidden rounded-[2rem] bg-slate-900 border border-slate-800 p-8 flex flex-col justify-center transition-all hover:shadow-[0_8px_30px_rgba(0,0,0,0.2)] hover:border-slate-700">
                <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:24px_24px]" />
                <div className="absolute bottom-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl -z-10 group-hover:bg-indigo-500/20 transition-colors duration-700" />
                <div className="flex items-center gap-4 mb-4 relative z-10">
                  <div className="w-12 h-12 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center backdrop-blur-md">
                    <BellRing className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="text-2xl font-extrabold text-white tracking-tight">Умный контроль</h3>
                </div>
                <p className="text-slate-400 font-medium leading-relaxed relative z-10">
                  Система заранее напоминает об оплате и <strong className="text-slate-200 font-semibold">автоматически исключает</strong> должников. Просроченные подписки больше не висят неделями.
                </p>
              </div>

              {/* Card 3: Medium Square (Span 1x1) */}
              <div className="group md:col-span-1 lg:col-span-1 row-span-1 relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-blue-500 to-indigo-600 p-8 flex flex-col transition-all hover:shadow-[0_8px_30px_rgba(37,99,235,0.2)] hover:scale-[1.02]">
                <div className="w-12 h-12 rounded-2xl bg-white/20 border border-white/20 flex items-center justify-center mb-auto backdrop-blur-md">
                  <CreditCard className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="text-xl font-extrabold text-white mb-2 tracking-tight">Оплата прямо в боте</h3>
                  <p className="text-blue-100 font-medium text-sm">Без переходов на сторонние сайты. Максимальная конверсия.</p>
                </div>
              </div>

              {/* Card 4: Medium Square (Span 1x1) */}
              <div className="group md:col-span-1 lg:col-span-1 row-span-1 relative overflow-hidden rounded-[2rem] bg-white border border-slate-200/80 p-8 flex flex-col transition-all hover:shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:border-slate-300">
                <div className="w-12 h-12 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center mb-auto group-hover:scale-110 transition-transform">
                  <Users className="w-6 h-6 text-slate-700" />
                </div>
                <div>
                  <h3 className="text-xl font-extrabold text-slate-900 mb-2 tracking-tight">База клиентов</h3>
                  <p className="text-slate-500 font-medium text-sm">Собирайте контакты, анализируйте отток и пишите целевой аудитории.</p>
                </div>
              </div>

            </div>
          </div>
        </section>

        {/* ================= DETAILS SECTION (Clean Typography) ================= */}
        <section className="py-24 bg-white border-t border-slate-100">
          <div className="max-w-7xl mx-auto px-6 lg:px-8">
            <div className="grid lg:grid-cols-2 gap-16 lg:gap-24 items-center">
              
              <div className="order-2 lg:order-1 relative">
                {/* Modern Abstract Graphic */}
                <div className="aspect-[4/3] rounded-[2.5rem] bg-slate-50 border border-slate-100 overflow-hidden relative flex items-center justify-center">
                   <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,#f8fafc,#f1f5f9)]" />
                   
                   {/* Floating Cards */}
                   <div className="relative z-10 w-full max-w-sm flex flex-col gap-4">
                     <div className="bg-white p-4 rounded-2xl border border-slate-200/60 shadow-[0_8px_30px_rgb(0,0,0,0.08)] flex items-center gap-4 transform -rotate-2 hover:rotate-0 transition-transform">
                       <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0"><CheckCircle2 className="w-5 h-5 text-emerald-600" /></div>
                       <div>
                         <div className="text-sm font-bold text-slate-900">Оплата получена</div>
                         <div className="text-xs text-slate-500">Доступ в канал открыт</div>
                       </div>
                       <div className="ml-auto font-bold text-slate-900">2 900 ₽</div>
                     </div>
                     
                     <div className="bg-white p-4 rounded-2xl border border-slate-200/60 shadow-[0_8px_30px_rgb(0,0,0,0.08)] flex items-center gap-4 transform translate-x-8 rotate-1 hover:rotate-0 transition-transform">
                       <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0"><Lock className="w-5 h-5 text-red-600" /></div>
                       <div>
                         <div className="text-sm font-bold text-slate-900">Подписка истекла</div>
                         <div className="text-xs text-slate-500">Пользователь исключен</div>
                       </div>
                     </div>
                   </div>
                </div>
              </div>

              <div className="flex flex-col gap-8 order-1 lg:order-2">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-xs font-bold uppercase tracking-widest w-fit">
                  <Activity className="w-4 h-4" />
                  Никаких ручных сверок
                </div>
                
                <h2 className="text-4xl lg:text-5xl font-black text-slate-900 tracking-tight leading-[1.1]">
                  Делегируйте рутину <br className="hidden lg:block"/>и масштабируйтесь
                </h2>
                
                <p className="text-lg text-slate-500 font-medium leading-relaxed">
                  Перестаньте проверять переводы на карту и удалять людей из канала вручную. BullRun берет весь жизненный цикл клиента на себя — от первого платежа до автоматического продления или исключения.
                </p>
                
                <div className="flex flex-col gap-5 mt-4">
                  {['Единый дашборд для каналов, оплат и доступов', 'Полная история клиента и статусы подписок', 'Бесшовная интеграция с @BotFather'].map((item) => (
                    <div key={item} className="flex items-center gap-4">
                      <div className="w-6 h-6 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" strokeWidth={3} />
                      </div>
                      <span className="text-base font-bold text-slate-700">{item}</span>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>
        </section>

        {/* ================= ULTRA MODERN CTA ================= */}
        <section className="py-24 lg:py-32 bg-white relative">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
            <div className="relative overflow-hidden rounded-[3rem] bg-slate-900 p-10 sm:p-16 lg:p-24 text-center shadow-2xl">
              
              {/* Complex Glowing Background */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full max-w-3xl max-h-[300px] bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.3)_0%,transparent_70%)] blur-2xl pointer-events-none" />
              <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMSIgY3k9IjEiIHI9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4wNSkiLz48L3N2Zz4=')] opacity-50" />
              
              <div className="relative z-10 flex flex-col items-center gap-8">
                <div className="w-20 h-20 rounded-3xl bg-white/10 border border-white/20 flex items-center justify-center backdrop-blur-xl shadow-inner mb-2 ring-1 ring-white/10">
                  <Zap className="w-10 h-10 text-amber-400 fill-amber-400 drop-shadow-[0_0_15px_rgba(251,191,36,0.5)]" />
                </div>
                <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black text-white tracking-tight leading-tight">
                  Запустите продажи <br className="hidden sm:block" />за 5 минут
                </h2>
                <p className="text-lg sm:text-xl text-slate-300 font-medium max-w-2xl leading-relaxed">
                  Разверните свой первый рабочий контур монетизации прямо сейчас.
                </p>
                <div className="mt-4 flex flex-col sm:flex-row items-center gap-4">
                  <a
                    href="/pricing"
                    className="group relative inline-flex items-center justify-center gap-3 rounded-full bg-white px-10 py-5 text-lg font-bold !text-slate-900 shadow-[0_0_40px_-10px_rgba(255,255,255,0.5)] transition-all hover:scale-105 w-full sm:w-auto"
                  >
                    Перейти к тарифам
                    <ArrowRight className="w-5 h-5 text-slate-400 group-hover:text-slate-900 transition-colors group-hover:translate-x-1" strokeWidth={2.5} />
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

      </main>
    </div>
  );
}