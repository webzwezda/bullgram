import { ArrowRight, Bitcoin, Gamepad2, MessageCircle, Newspaper } from 'lucide-react';

const markets = [
  {
    title: 'Крипта',
    text: 'TON, P2P, платежи, цифровые активы и комьюнити вокруг рынка.',
    href: '/blog/crypto/',
    icon: Bitcoin
  },
  {
    title: 'Steam',
    text: 'Скины, ликвидность, комиссии, трейдинг и переход между цифровыми рынками.',
    href: '/blog/steam/',
    icon: Gamepad2
  },
  {
    title: 'Telegram',
    text: 'Платный доступ, закрытые каналы, боты, подписки и монетизация аудитории.',
    href: '/telegram',
    icon: MessageCircle
  }
];

export function TestPage() {
  return (
    <div className="min-h-screen overflow-hidden rounded-3xl bg-white font-sans text-slate-900 selection:bg-blue-200 selection:text-blue-900">
      <main>
        <section className="relative flex min-h-[calc(100vh-2rem)] flex-col justify-between px-5 py-10 sm:px-8 lg:px-12">
          <div className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,#f1f5f9_1px,transparent_1px),linear-gradient(to_bottom,#f1f5f9_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_78%_54%_at_50%_0%,#000_58%,transparent_100%)]" />
          <div className="absolute left-1/2 top-0 -z-10 h-[520px] w-[min(900px,100%)] -translate-x-1/2 rounded-full bg-blue-100/70 blur-3xl" />

          <div className="max-w-5xl pt-10 sm:pt-16 lg:pt-24">
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-black uppercase tracking-[0.18em] text-slate-500 shadow-sm">
              <Newspaper className="h-4 w-4 text-blue-600" />
              Bullgram
            </div>

            <h1 className="max-w-4xl text-5xl font-black leading-[0.95] tracking-tight text-slate-950 sm:text-7xl lg:text-[6.5rem]">
              Исследуем цифровые рынки
            </h1>

            <p className="mt-8 max-w-2xl text-lg font-semibold leading-8 text-slate-500 sm:text-xl">
              Крипта, Steam-скины, Telegram-комьюнити и способы превращать знания о цифровых рынках в продукты, курсы и закрытые клубы.
            </p>
          </div>

          <div className="mt-16 grid gap-4 lg:grid-cols-3">
            {markets.map((market) => {
              const Icon = market.icon;
              return (
                <a
                  key={market.title}
                  href={market.href}
                  className="group flex min-h-44 flex-col justify-between rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-blue-200 hover:shadow-xl hover:shadow-slate-950/5"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-50 text-slate-800 ring-1 ring-slate-200 transition-colors group-hover:bg-blue-50 group-hover:text-blue-700">
                      <Icon className="h-5 w-5" strokeWidth={2.4} />
                    </div>
                    <ArrowRight className="h-5 w-5 text-slate-300 transition-all group-hover:translate-x-1 group-hover:text-blue-600" strokeWidth={2.4} />
                  </div>
                  <div>
                    <h2 className="text-2xl font-black tracking-tight text-slate-950">{market.title}</h2>
                    <p className="mt-3 text-sm font-semibold leading-6 text-slate-500">{market.text}</p>
                  </div>
                </a>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
