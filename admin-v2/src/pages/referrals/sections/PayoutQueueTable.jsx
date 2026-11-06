import { Fragment } from 'react';
import { Activity, CheckCircle2, CreditCard, XCircle, Zap } from 'lucide-react';
import { PayoutChainDetails, PayoutTransferBox, TableEmptyState, formatTon, payoutStatusLabel, payoutStatusTone } from '../components/TransferBoxes.jsx';
import { PayoutPanel } from './PayoutPanel.jsx';

export function PayoutQueueTable({ state, payoutForm, payoutFormErrors, setPayoutForm, closePayoutPanel, openAutoSendConfirm, openPayoutForm, openPayoutNoteForm, updatePayoutRequest, submitPayoutForm, submitPayoutNoteForm, submitAutoSend, payoutPanelForRow }) {
  return (
    <>
        {/* PENDING PAYOUTS */}
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl shadow-slate-200/40 overflow-hidden flex flex-col border-amber-200/60 shadow-amber-500/5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between p-8 gap-4 border-b border-slate-100 bg-slate-50/30">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-amber-500" />
                Заявки на выплату
              </h3>
              <p className="text-xs text-slate-500 font-medium">Очередь выплат для ручной или автоматической отправки</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`px-4 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider border ${
                state.pendingPayouts.length > 0
                  ? 'bg-amber-100 text-amber-700 border-amber-200'
                  : 'bg-slate-100 text-slate-600 border-slate-200'
              }`}>
                {state.pendingPayouts.length} активных
              </span>
            </div>
          </div>

          {state.pendingPayouts.length === 0 ? (
            <TableEmptyState
              icon={CreditCard}
              title="Активных заявок на выплату нет"
              hint="Заявка появится здесь, когда партнер запросит выплату или накопит баланс."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-100">
                    <th className="px-8 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px]">Партнер</th>
                    <th className="px-8 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px]">Кошелек</th>
                    <th className="px-8 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px]">Сумма / Статус</th>
                    <th className="px-8 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px] text-right">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {state.pendingPayouts.map((row) => {
                    const payoutStatus = row.pending_payout_status || 'requested';
                    const payoutTone = payoutStatusTone(payoutStatus);
                    const canQueue = payoutStatus === 'requested';
                    const canStartSending = ['requested', 'queued'].includes(payoutStatus);
                    const maxAutoPayoutTon = Number(state.support?.automaticPayoutSenderMaxAmountTon || 0);
                    const overAutoLimit = maxAutoPayoutTon > 0 && Number(row.pending_payout_ton || 0) > maxAutoPayoutTon;
                    const canAutoSend = state.support?.automaticPayoutSender && !overAutoLimit && ['requested', 'queued'].includes(payoutStatus);
                    const canMarkSent = ['requested', 'queued', 'sending'].includes(payoutStatus);
                    const canFail = ['requested', 'queued', 'sending'].includes(payoutStatus);
                    const canCancel = ['requested', 'queued'].includes(payoutStatus);
                    const panel = payoutPanelForRow(row);

                    return (
                      <Fragment key={row.pending_payout_id || row.tg_user_id}>
                        <tr className="hover:bg-slate-50/50 transition-colors group">
                        <td className="px-8 py-6">
                          <div className="font-black text-slate-900 text-base mb-0.5">{row.display_name || row.username || row.tg_user_id}</div>
                          <div className="text-xs text-slate-500 font-bold">ID: {row.tg_user_id}</div>
                        </td>
                        <td className="px-8 py-6">
                          <div className="font-mono text-[11px] text-slate-600 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100 inline-block mb-2 max-w-[200px] truncate" title={row.pending_payout_wallet || row.payout_wallet}>
                            {row.pending_payout_wallet || row.payout_wallet || 'кошелек не указан'}
                          </div>
                          <PayoutTransferBox row={row} />
                          <PayoutChainDetails row={row} />
                        </td>
                        <td className="px-8 py-6">
                          <div className="text-lg font-black text-blue-600 mb-1">{formatTon(row.pending_payout_ton)}</div>
                          <div className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wide border ${
                            payoutTone === 'sent' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                            payoutTone === 'failed' ? 'bg-red-50 text-red-700 border-red-100' :
                            payoutTone === 'cancelled' ? 'bg-amber-50 text-amber-700 border-amber-100' :
                            'bg-slate-100 text-slate-600 border-slate-200'
                          }`}>
                            {payoutStatusLabel(payoutStatus)}
                          </div>
                        </td>
                        <td className="px-8 py-6 text-right">
                          <div className="flex justify-end gap-2 group-hover:opacity-100 focus-within:opacity-100 focus-visible:opacity-100 focus-visible:translate-x-0 transition-opacity">
                            {canAutoSend && (
                              <button
                                className="px-3 py-1.5 bg-blue-600 text-white rounded-lg font-bold text-xs shadow-md shadow-blue-500/20 hover:bg-blue-700"
                                onClick={() => openAutoSendConfirm(row)}
                                disabled={state.payouting}
                              >
                                Авто TON
                              </button>
                            )}
                            {canMarkSent && (
                              <button
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-lg font-bold text-xs shadow-sm hover:bg-emerald-700 transition-all"
                                onClick={() => openPayoutForm(row, 'TON')}
                                disabled={state.payouting}
                                title="Отметить TON-выплату отправленной"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Выплата TON
                              </button>
                            )}
                            <div className="flex items-center gap-1">
                              {canQueue && (
                                <button className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all" onClick={() => updatePayoutRequest(row, 'queued')} title="В очередь">
                                  <Activity className="w-4 h-4" />
                                </button>
                              )}
                              {canFail && (
                                <button className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-all" onClick={() => openPayoutNoteForm(row, 'failed')} title="Ошибка">
                                  <Zap className="w-4 h-4" />
                                </button>
                              )}
                              {canCancel && (
                                <button className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all" onClick={() => openPayoutNoteForm(row, 'cancelled')} title="Отклонить">
                                  <XCircle className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        </td>
                        </tr>
                        {panel && (
                          <tr>
                            <td colSpan={4} className="px-8 pb-6">
                              <PayoutPanel panel={panel} state={state} payoutForm={payoutForm} payoutFormErrors={payoutFormErrors} setPayoutForm={setPayoutForm} closePayoutPanel={closePayoutPanel} submitPayoutForm={submitPayoutForm} submitPayoutNoteForm={submitPayoutNoteForm} submitAutoSend={submitAutoSend} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
    </>
  );
}
