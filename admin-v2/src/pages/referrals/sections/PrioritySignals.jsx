import { useMemo } from 'react';
import { Activity } from 'lucide-react';

export function PrioritySignals({ state, profileRole }) {
  const prioritySignals = useMemo(() => {
    const signals = [];
    if (state.reserve && !state.reserve.canEnableReferrals && profileRole !== 'admin') {
      signals.push({
        tone: 'danger',
        title: state.reserve.statusLabel || 'Резерв не готов',
        text: state.reserve.reason || 'Пополни TON-резерв, чтобы включить защищенную партнерку.'
      });
    } else if (state.reserve && !state.reserve.canEnableReferrals && profileRole === 'admin') {
      signals.push({
        tone: 'warning',
        title: 'Админский запуск без резерва',
        text: 'Роль admin может включить партнерку без 100 TON. Выплаты и долг все равно будут считаться.'
      });
    } else if (state.reserve?.status === 'reserve_low') {
      signals.push({
        tone: 'warning',
        title: 'Резерв на исходе',
        text: 'Новые партнеры пока доступны, но администратору уже пора пополнить TON-резерв.'
      });
    } else if (state.reserve?.canEnableReferrals) {
      signals.push({
        tone: 'ok',
        title: 'Резерв готов',
        text: 'Партнерку можно включать. Деньги зарезервированы под будущие выплаты.'
      });
    }
    if (!state.settings?.referral_enabled) {
      signals.push({
        tone: 'warning',
        title: 'Партнерка выключена',
        text: 'Включите настройки, чтобы пользователи видели партнерку в боте.'
      });
    }
    const totalOutstanding = Number(state.summary.outstandingRub || 0) + Number(state.summary.outstandingTon || 0) + Number(state.summary.outstandingUsdt || 0);
    if (totalOutstanding > 0) {
      signals.push({
        tone: 'danger',
        title: 'К выплате',
        text: `Накоплено ${state.summary.outstandingRub || 0} RUB, ${state.summary.outstandingTon || 0} TON, ${state.summary.outstandingUsdt || 0} USDT`
      });
    }
    return signals;
  }, [profileRole, state.reserve, state.settings, state.summary]);
  return (
    <>
          {prioritySignals.length > 0 && (
            <>
              <div className="h-px bg-slate-100" />
              <section className="space-y-6">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <div className="w-8 h-8 rounded-xl bg-amber-500 text-white flex items-center justify-center text-sm font-black shadow-md shadow-amber-500/20">
                    <Activity className="w-4 h-4" />
                  </div>
                  <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-500">Уведомления</h2>
                  <p className="text-slate-500 font-medium text-xs">Требует вашего внимания</p>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {prioritySignals.slice(0, 3).map((signal, idx) => (
                    <div
                      key={idx}
                      className={`p-5 rounded-[1.5rem] border flex flex-col gap-2 transition-all ${
                        signal.tone === 'danger' 
                          ? 'bg-red-50 border-red-100 shadow-sm' 
                          : 'bg-amber-50 border-amber-100 shadow-sm'
                      }`}
                    >
                      <div className={`text-[10px] font-black uppercase tracking-widest ${
                        signal.tone === 'danger' ? 'text-red-700' : 'text-amber-700'
                      }`}>{signal.title}</div>
                      <div className="text-sm font-bold text-slate-800 leading-snug">{signal.text}</div>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
    </>
  );
}
