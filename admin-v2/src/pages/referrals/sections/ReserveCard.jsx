import { Activity, Lock, Wallet, Zap } from 'lucide-react';
import { DepositTransferBox, formatTon, formatWhen, refundStatusLabel, shortTxHash } from '../components/TransferBoxes.jsx';
import { useReferralRefund } from '../hooks/useReferralRefund.js';
import { RefundPanel } from './RefundPanel.jsx';

export function ReserveCard({ accessToken, state, setState, refreshReferralState }) {
  const availableReserveTon = Number(state.reserve?.availableReserveTon || 0);
  const adminDebtTon = Number(state.reserve?.adminDebtTon || 0);
  const {
    refundPanel,
    refundForm,
    refundFormErrors,
    setRefundForm,
    closeRefundPanel,
    openRefundRequestForm,
    openRefundSentForm,
    openRefundCancelForm,
    openRefundAutoForm,
    submitRefundRequestForm,
    submitRefundSentForm,
    submitRefundCancelForm,
    sendReserveRefundAutomatically
  } = useReferralRefund({ accessToken, state, setState, refreshReferralState });

  return (
    <>
          {/* STEP 1: RESERVE FUND */}
          <section className="space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center text-sm font-black shadow-md shadow-blue-600/20">
                  1
                </div>
                <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-500">Резервный фонд</h2>
                <p className="text-slate-500 font-medium text-xs">TON-резерв для автоматических и защищенных выплат</p>
              </div>

              <div className="flex items-center gap-2">
                <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold shadow-sm border ${
                  state.settings?.referral_enabled
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                    : 'bg-slate-100 text-slate-600 border-slate-200'
                }`}>
                  <div className={`w-2 h-2 rounded-full animate-pulse ${
                    state.settings?.referral_enabled ? 'bg-emerald-500' : 'bg-slate-400'
                  }`} />
                  {state.settings?.referral_enabled ? 'Партнёрка включена' : 'Партнёрка выключена'}
                </div>
                {!state.reserve?.canEnableReferrals && (
                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold shadow-sm border bg-amber-50 text-amber-700 border-amber-100">
                    <div className="w-2 h-2 rounded-full animate-pulse bg-amber-500" />
                    {state.reserve?.statusLabel || 'Нужен депозит'}
                  </div>
                )}
              </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                { label: 'Минимум', value: formatTon(state.reserve?.minimumDepositTon || state.economics?.minimumDepositTon || 100), icon: Lock, color: 'text-slate-400' },
                { label: 'Пополнено', value: formatTon(state.reserve?.fundedReserveTon ?? state.reserve?.totalDepositedTon), icon: Wallet, color: 'text-blue-500' },
                { label: 'Доступно', value: formatTon(state.reserve?.availableReserveTon), icon: Activity, color: availableReserveTon > 0 ? 'text-emerald-500' : 'text-slate-400', valueColor: availableReserveTon > 0 ? 'text-emerald-600' : 'text-slate-900' },
                { label: 'Долг админа', value: formatTon(state.reserve?.adminDebtTon), icon: Zap, color: adminDebtTon > 0 ? 'text-rose-500' : 'text-slate-400', valueColor: adminDebtTon > 0 ? 'text-rose-600' : 'text-slate-900' },
              ].map((item, idx) => (
                <div key={idx} className="bg-slate-50/50 border border-slate-100 p-6 rounded-3xl">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-xs font-black uppercase tracking-widest text-slate-400">{item.label}</span>
                    <item.icon className={`w-5 h-5 ${item.color} opacity-70`} />
                  </div>
                  <div className={`text-3xl font-black tracking-tighter ${item.valueColor}`}>
                    {item.value}
                  </div>
                </div>
              ))}
            </div>

            <div className="p-5 bg-white border border-slate-100 rounded-2xl shadow-sm space-y-2">
              <div className="text-[11px] font-black uppercase tracking-widest text-slate-400">Лок депозита</div>
              <div className="font-mono text-xs break-all bg-slate-50 p-3 rounded-xl border border-slate-100 text-slate-700 leading-relaxed">
                {state.reserve?.lockedUntil ? formatWhen(state.reserve?.lockedUntil) : 'Без лока'}
              </div>
            </div>

            <DepositTransferBox reserve={state.reserve} />

            {/* Refund Block */}
            <div className="bg-slate-50 border border-slate-200 rounded-3xl p-6 sm:p-8 mt-4 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                <div className="space-y-1">
                  <div className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
                    <Activity className="w-5 h-5 text-blue-500" />
                    Возврат депозита
                  </div>
                  <p className="text-sm text-slate-500 font-medium">
                    {state.reserve?.status === 'refund_requested'
                      ? `Заявка на ${formatTon(state.reserve?.refundRequestedTon)}. Вернем на TON-кошелек из Кассы → Оплаты от подписчиков (/app/billing).`
                      : state.reserve?.canRequestRefund
                        ? `К возврату: ${formatTon(state.reserve?.refundableTon)}. Сеть: ${formatTon(state.reserve?.refundNetworkFeeTon)}.`
                        : state.reserve?.lockedUntil
                          ? `Будет доступно: ${formatWhen(state.reserve?.lockedUntil)}.`
                          : 'До 100 TON можно вернуть сразу при отсутствии обязательств.'}
                  </p>
                </div>
                
                <div className="flex flex-wrap items-center gap-3">
                  {state.reserve?.status === 'refund_requested' ? (
                    <>
                      {state.support?.automaticRefundSender && (
                        <button
                          className="px-6 py-2.5 bg-blue-600 text-white rounded-xl font-bold text-sm shadow-md shadow-blue-500/20 hover:bg-blue-700 transition-all disabled:opacity-50"
                          onClick={openRefundAutoForm}
                          disabled={state.refunding}
                        >
                          Авто TON
                        </button>
                      )}
                      <button
                        className="px-6 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl font-bold text-sm hover:bg-slate-50 transition-all disabled:opacity-50"
                        onClick={openRefundSentForm}
                        disabled={state.refunding}
                      >
                        Отметить отправленным
                      </button>
                      <button
                        className="px-6 py-2.5 bg-white border border-orange-200 text-orange-600 rounded-xl font-bold text-sm hover:bg-orange-50 transition-all disabled:opacity-50"
                        onClick={openRefundCancelForm}
                        disabled={state.refunding}
                      >
                        Отменить заявку
                      </button>
                    </>
                  ) : (
                    <button
                      className="px-6 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl font-bold text-sm hover:bg-slate-50 hover:border-slate-300 transition-all disabled:opacity-30"
                      onClick={openRefundRequestForm}
                      disabled={state.refunding || !state.reserve?.canRequestRefund || Number(state.reserve?.refundableTon || 0) <= 0}
                    >
                      Запросить возврат
                    </button>
                  )}
                </div>
              </div>

              {refundPanel ? <RefundPanel state={state} refundPanel={refundPanel} refundForm={refundForm} refundFormErrors={refundFormErrors} setRefundForm={setRefundForm} closeRefundPanel={closeRefundPanel} submitRefundRequestForm={submitRefundRequestForm} submitRefundSentForm={submitRefundSentForm} submitRefundCancelForm={submitRefundCancelForm} sendReserveRefundAutomatically={sendReserveRefundAutomatically} /> : null}

              {state.reserve?.refundLast && (
                <div className="bg-white border border-slate-100 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400">
                      <Zap className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-0.5">Последний возврат</div>
                      <div className="text-sm font-bold text-slate-900">
                        {refundStatusLabel(state.reserve.refundLast.status)}
                        {Number(state.reserve.refundLast.amountTon || 0) > 0 && ` на ${formatTon(state.reserve.refundLast.amountTon)}`}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex flex-wrap items-center gap-3">
                    {state.reserve.refundLast.chainTxHash && (
                      <div className="font-mono text-[11px] bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100 text-slate-500" title={String(state.reserve.refundLast.chainTxHash)}>
                        TX: {shortTxHash(state.reserve.refundLast.chainTxHash)}
                      </div>
                    )}
                    {state.reserve.refundLast.error && (
                      <div className="text-xs font-bold text-red-700 bg-red-50 px-3 py-1.5 rounded-lg border border-red-100">
                        {state.reserve.refundLast.error}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>
    </>
  );
}
