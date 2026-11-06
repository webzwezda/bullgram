import { Fragment, useRef } from 'react';
import { Activity, Bot, CreditCard, Users } from 'lucide-react';
import { apiRequest } from '../../../api/client.js';
import { FILTERS, TableEmptyState, formatTon } from '../components/TransferBoxes.jsx';
import { useReferralPayout } from '../hooks/useReferralPayout.js';
import { LeadsEventsTables } from './LeadsEventsTables.jsx';
import { PayoutPanel } from './PayoutPanel.jsx';
import { PayoutQueueTable } from './PayoutQueueTable.jsx';

export function DashboardTables({ accessToken, state, setState, filter, setFilter, search, setSearch, filteredPartners, filteredLeads, filteredEvents }) {
  const dmCenterRef = useRef(null);

  // Тот же источник юзербот-данных, что и в центре юзерботов (UserbotCenterSection):
  // кэш ops-center без live-скана — юзерботы, общие чаты и известные диалоги.
  async function loadUserbotCenterForDm() {
    if (dmCenterRef.current) return dmCenterRef.current;
    try {
      const data = await apiRequest('/api/userbot/ops-center', { accessToken });
      const payload = {
        userbotId: String(data.selected_userbot_id || data.userbots?.[0]?.id || ''),
        userbotLabel: data.selected_userbot_username || '',
        groups: (data.groups || []).filter((group) => group.chat_id),
        knownDialogIds: new Set((data.conversations || []).map((item) => String(item.tg_user_id)))
      };
      if (!payload.userbotId) {
        window.alert('Нет рабочего юзербота, который напишет. Подключи и активируй юзербота в приложении «Юзербот» (/userbot/accounts).');
        return null;
      }
      dmCenterRef.current = payload;
      return payload;
    } catch (error) {
      window.alert(`Юзербот недоступен: ${error.message}`);
      return null;
    }
  }

  async function sendMessagePrompt(row) {
    if (!row?.tg_user_id) {
      window.alert('Нет Telegram ID.');
      return;
    }

    const center = await loadUserbotCenterForDm();
    if (!center) return;

    const partnerId = String(row.tg_user_id);
    const partnerName = row.display_name || row.username || partnerId;
    const userbotName = center.userbotLabel ? `@${center.userbotLabel}` : 'юзербот';
    const deliveryWarning = 'ЛС через юзербота доходит, только если у него есть общий чат с этим человеком (например, админ-группа воронки). Админ-права юзербота в этой группе повышают шансы доставки.';

    let commonChatId = '';
    if (center.knownDialogIds.has(partnerId)) {
      const confirmed = window.confirm(`Написать ${partnerName} через юзербота ${userbotName}?\n\nЮзербот уже знает этого человека — диалог есть.\n${deliveryWarning}`);
      if (!confirmed) return;
    } else if (center.groups.length > 0) {
      const confirmed = window.confirm(`Написать ${partnerName} через юзербота ${userbotName}?\n\nОбщего чата не найдено — доставка не гарантирована.\n${deliveryWarning}\n\nДальше укажи общий чат вручную.`);
      if (!confirmed) return;
      const groupList = center.groups.map((group, idx) => `${idx + 1}. ${group.title || group.chat_id}`).join('\n');
      const rawPick = window.prompt(`Общий чат с этим человеком — номер из списка юзербота:\n${groupList}`, '1');
      if (rawPick === null) return;
      const picked = center.groups[Number(String(rawPick).trim()) - 1];
      if (!picked) {
        window.alert('Такого номера нет в списке. Отправка отменена.');
        return;
      }
      commonChatId = String(picked.chat_id);
    } else {
      window.alert(`Общего чата не найдено — доставка не гарантирована. Юзербот ${userbotName} не знает этого человека и не состоит с ним ни в одном чате — Telegram такое ЛС не пропустит. Добавь юзербота в общую группу с партнёром (админ-права повышают шансы) и попробуй снова.`);
      return;
    }

    const message = window.prompt(`Сообщение для ${partnerName}:`);
    if (!message || !message.trim()) return;

    try {
      await apiRequest('/api/userbot/send-message', {
        accessToken,
        method: 'POST',
        body: {
          tg_user_id: partnerId,
          message: message.trim(),
          userbot_id: center.userbotId,
          ...(commonChatId ? { common_chat_id: commonChatId } : { known_dialog: true }),
          manual_confirmed: true
        }
      });
      window.alert('Отправлено.');
    } catch (error) {
      window.alert(`Ошибка: ${error.message}`);
    }
  }
  const {
    payoutForm,
    payoutFormErrors,
    setPayoutForm,
    closePayoutPanel,
    openPayoutForm,
    openPayoutNoteForm,
    updatePayoutRequest,
    openAutoSendConfirm,
    submitPayoutForm,
    submitPayoutNoteForm,
    submitAutoSend,
    payoutPanelForRow
  } = useReferralPayout({ accessToken, state, setState });

  return (
      <div className="mt-8 space-y-8">
        <PayoutQueueTable state={state} payoutForm={payoutForm} payoutFormErrors={payoutFormErrors} setPayoutForm={setPayoutForm} closePayoutPanel={closePayoutPanel} openAutoSendConfirm={openAutoSendConfirm} openPayoutForm={openPayoutForm} openPayoutNoteForm={openPayoutNoteForm} updatePayoutRequest={updatePayoutRequest} submitPayoutForm={submitPayoutForm} submitPayoutNoteForm={submitPayoutNoteForm} submitAutoSend={submitAutoSend} payoutPanelForRow={payoutPanelForRow} />
        {/* FILTERS BAR */}
        <div className="flex flex-col md:flex-row items-center gap-6 p-4 bg-white rounded-[2rem] border border-slate-200 shadow-sm">
          <div className="relative flex-1 w-full">
            <input
              className="w-full pl-12 pr-6 py-3.5 bg-slate-50 border border-slate-100 rounded-2xl text-slate-900 font-bold focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all shadow-inner"
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Поиск по TG ID, @username или коду..."
            />
            <Activity className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300" />
          </div>
          <div className="flex gap-2 p-1.5 bg-slate-100 rounded-2xl w-full md:w-auto">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                className={`flex-1 md:flex-none px-5 py-2 text-xs font-black uppercase tracking-wider rounded-xl transition-all ${
                  filter === item.id 
                    ? 'bg-white text-blue-600 shadow-sm' 
                    : 'text-slate-500 hover:text-slate-700'
                }`}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-8">
          {/* PARTNERS TABLE */}
          <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl shadow-slate-200/40 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-8 border-b border-slate-100 bg-slate-50/30">
              <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
                <Users className="w-4 h-4 text-blue-500" />
                Партнеры и баланс
              </h3>
              <span className={`px-4 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider border ${
                filteredPartners.length > 0
                  ? 'bg-blue-50 text-blue-700 border-blue-100'
                  : 'bg-slate-100 text-slate-600 border-slate-200'
              }`}>
                {filteredPartners.length} показано
              </span>
            </div>

            {filteredPartners.length === 0 ? (
              <TableEmptyState
                icon={Users}
                title="Никого не найдено"
                hint="Партнёры появятся здесь после первой оплаты по реферальной ссылке."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-slate-50/80 border-b border-slate-100">
                      <th className="px-8 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px]">Партнер</th>
                      <th className="px-8 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px] text-center">Лиды</th>
                      <th className="px-8 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px]">Баланс</th>
                      <th className="px-8 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px] text-right">Действия</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filteredPartners.map((row) => {
                      // RUB не выплачивается: кнопка выплаты только при реальных TON/USDT-балансах
                      const hasBalance = Number(row.balance_ton) > 0 || Number(row.balance_usdt) > 0;
                      const panel = payoutPanelForRow(row);
                      return (
                        <Fragment key={row.tg_user_id}>
                          <tr className="hover:bg-slate-50/50 transition-colors group">
                          <td className="px-8 py-6">
                            <div className="font-black text-slate-900 text-base mb-0.5">{row.display_name || row.username || row.tg_user_id}</div>
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-[10px] font-black uppercase text-slate-400 tracking-tight">ID: {row.tg_user_id}</span>
                              <span className="w-1 h-1 rounded-full bg-slate-200" />
                              <span className="font-mono text-[10px] text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md font-bold uppercase">{row.referral_code}</span>
                            </div>
                            <div className="flex flex-col gap-1">
                              {row.payout_wallet ? (
                                <div className="text-xs font-mono text-slate-500 truncate max-w-[150px]">{row.payout_wallet}</div>
                              ) : (
                                <div className="text-[10px] font-bold text-slate-300 italic uppercase">Кошелек не указан</div>
                              )}
                            </div>
                            {Number(row.pending_payout_ton || 0) > 0 && (
                              <div className="inline-flex px-2 py-0.5 rounded-md bg-orange-50 text-orange-600 border border-orange-100 text-[10px] font-black uppercase mt-2">
                                Ожидает: {formatTon(row.pending_payout_ton)}
                              </div>
                            )}
                          </td>
                          <td className="px-8 py-6 text-center">
                            <span className={`inline-flex w-10 h-10 items-center justify-center rounded-2xl font-black text-sm border shadow-sm ${
                              (row.total_referrals || 0) > 0 
                                ? 'bg-emerald-50 text-emerald-600 border-emerald-100' 
                                : 'bg-slate-50 text-slate-500 border-slate-200'
                            }`}>
                              {row.total_referrals || 0}
                            </span>
                          </td>
                          <td className="px-8 py-6">
                            <div className={`text-base font-black tracking-tight ${hasBalance ? 'text-slate-900' : 'text-slate-500'}`}>
                              {formatTon(row.balance_ton)}
                            </div>
                            {Number(row.balance_usdt || 0) > 0 && (
                              <div className="text-xs font-bold text-slate-600 mt-0.5">{row.balance_usdt} USDT</div>
                            )}
                            <div className="text-xs text-slate-500 mt-0.5">{row.balance_rub || 0} RUB</div>
                          </td>
                          <td className="px-8 py-6 text-right">
                            <div className="flex justify-end gap-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 focus-visible:opacity-100 focus-visible:translate-x-0 transition-opacity">
                              <button className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all" onClick={() => sendMessagePrompt(row)} title="Написать">
                                <Bot className="w-4 h-4" />
                              </button>
                              {hasBalance && (
                                <button className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all" onClick={() => openPayoutForm(row, 'TON')} title="Выплатить TON">
                                  <CreditCard className="w-4 h-4" />
                                </button>
                              )}
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

          <LeadsEventsTables filteredEvents={filteredEvents} filteredLeads={filteredLeads} />
        </div>
      </div>
  );
}
