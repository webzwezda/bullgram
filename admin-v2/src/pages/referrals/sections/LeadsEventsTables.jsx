import { Activity, CheckCircle2, Users } from 'lucide-react';
import { PayoutChainDetails, TableEmptyState, eventBadge, formatWhen, leadStatus } from '../components/TransferBoxes.jsx';

export function LeadsEventsTables({ filteredEvents, filteredLeads }) {
  return (
    <>
          {/* EVENTS TABLE */}
          <div className="order-3 bg-white rounded-[2.5rem] border border-slate-200 shadow-xl shadow-slate-200/40 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-8 border-b border-slate-100 bg-slate-50/30">
              <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
                <Activity className="w-4 h-4 text-purple-500" />
                История начислений
              </h3>
              <span className={`px-4 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider border ${
                filteredEvents.length > 0
                  ? 'bg-purple-50 text-purple-700 border-purple-100'
                  : 'bg-slate-100 text-slate-600 border-slate-200'
              }`}>
                {filteredEvents.length} записей
              </span>
            </div>

            {filteredEvents.length === 0 ? (
              <TableEmptyState
                icon={Activity}
                title="Событий нет"
                hint="События — после первых начислений."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-slate-50/80 border-b border-slate-100">
                      <th className="px-8 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px]">Когда</th>
                      <th className="px-8 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px]">Тип / Партнер</th>
                      <th className="px-8 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px] text-right">Сумма</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filteredEvents.slice(0, 30).map((event) => {
                      const badge = eventBadge(event);
                      const isReward = event.event_type === 'reward_granted';
                      return (
                        <tr key={event.id} className="hover:bg-slate-50/50 transition-colors group">
                          <td className="px-8 py-5">
                            <div className="text-xs font-bold text-slate-500">{formatWhen(event.created_at)}</div>
                          </td>
                          <td className="px-8 py-5">
                            <div className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wide border mb-1 ${
                              isReward ? 'bg-purple-50 text-purple-700 border-purple-100' : 'bg-blue-50 text-blue-700 border-blue-100'
                            }`}>
                              {badge.text}
                            </div>
                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">ID: {event.referrer_tg_user_id}</div>
                          </td>
                          <td className="px-8 py-5 text-right">
                            <div className={`text-base font-black tracking-tight ${isReward ? 'text-emerald-600' : 'text-slate-900'}`}>
                              {event.reward_amount || 0} {event.reward_currency || ''}
                            </div>
                            {!isReward && <PayoutChainDetails row={event} />}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* LEADS TABLE (FULL WIDTH) */}
          <div className="order-2 bg-white rounded-[2.5rem] border border-slate-200 shadow-xl shadow-slate-200/40 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-8 border-b border-slate-100 bg-slate-50/30">
              <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-500" />
                Лиды
              </h3>
              <span className={`px-4 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider border ${
                filteredLeads.length > 0
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                  : 'bg-slate-100 text-slate-600 border-slate-200'
              }`}>
                {filteredLeads.length} показано
              </span>
            </div>

            {filteredLeads.length === 0 ? (
              <TableEmptyState
                icon={Users}
                title="Лидов не найдено"
                hint="Лиды — после перехода по реферальной ссылке."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-slate-50/80 border-b border-slate-100">
                      <th className="px-8 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px]">Лид</th>
                      <th className="px-8 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px]">Партнер</th>
                      <th className="px-8 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px]">Активность</th>
                      <th className="px-8 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px] text-right">Статус / Награда</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filteredLeads.slice(0, 50).map((lead) => {
                      const status = leadStatus(lead);
                      const rewardAmount = lead.reward_ton_amount || lead.reward_amount;
                      const rewardCurrency = lead.reward_ton_amount ? 'TON' : lead.reward_currency;
                      return (
                        <tr key={lead.id} className="hover:bg-slate-50/50 transition-colors group">
                          <td className="px-8 py-6">
                            <div className="font-black text-slate-900 text-base mb-0.5">{lead.referred_display_name || lead.referred_username || lead.referred_tg_user_id}</div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-black uppercase text-slate-400 tracking-tight">ID: {lead.referred_tg_user_id}</span>
                            </div>
                          </td>
                          <td className="px-8 py-6">
                            <div className="font-bold text-slate-800 text-sm mb-0.5">{lead.referrer_display_name || lead.referrer_username || lead.referrer_tg_user_id}</div>
                            <div className="text-[10px] font-black uppercase text-slate-400 tracking-tight">
                              ID: {lead.referrer_tg_user_id} • <span className="text-blue-600 font-bold">{lead.referral_code || '—'}</span>
                            </div>
                          </td>
                          <td className="px-8 py-6">
                            <div className="text-[11px] font-bold text-slate-500 mb-1 flex items-center gap-2">
                              <div className="w-1 h-1 rounded-full bg-slate-300" />
                              Вход: {formatWhen(lead.first_seen_at)}
                            </div>
                            <div className="text-[11px] font-bold text-slate-500 flex items-center gap-2">
                              <div className="w-1 h-1 rounded-full bg-slate-300" />
                              Истекает: {formatWhen(lead.expires_at)}
                            </div>
                            {lead.converted_at && (
                              <div className="text-[11px] font-black text-emerald-600 mt-1 flex items-center gap-2 uppercase">
                                <CheckCircle2 className="w-3 h-3" />
                                Оплата: {formatWhen(lead.converted_at)}
                              </div>
                            )}
                          </td>
                          <td className="px-8 py-6 text-right">
                            <div className={`inline-flex px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wide border mb-2 ${
                              status.tone === 'ok' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                              status.tone === 'warning' ? 'bg-amber-50 text-amber-700 border-amber-100' :
                              'bg-slate-100 text-slate-500 border-slate-200'
                            }`}>{status.text}</div>
                            {rewardAmount ? (
                              <div className="font-black text-lg text-emerald-600 tracking-tight">
                                +{rewardAmount} <span className="text-xs uppercase ml-0.5 font-black">{rewardCurrency}</span>
                              </div>
                            ) : (
                              <div className="text-[10px] font-bold text-slate-300 uppercase tracking-widest italic">Без начисления</div>
                            )}
                          </td>
                        </tr>
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
