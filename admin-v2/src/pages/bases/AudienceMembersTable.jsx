import { Fragment } from 'react';
import { Plus } from 'lucide-react';
import { coverageLabel, paymentBadge } from './shared.js';

function AudienceMemberRow({ member, onCopyToBase, disabled }) {
  const badge = paymentBadge(member.payment_status);
  const sourceBadge = member.source === 'manual'
    ? { text: 'Вбит руками', cls: 'bg-slate-100 text-slate-600' }
    : { text: 'Из групп', cls: 'bg-emerald-50 text-emerald-700' };

  return (
    <tr className="border-b border-slate-50 last:border-0 hover:bg-slate-50/30 transition-colors">
      <td className="px-4 py-3">
        <div className="text-sm font-bold text-slate-900">
          {member.display_name || `ID ${member.tg_user_id}`}
        </div>
        <div className="text-xs text-slate-500 font-mono">
          {member.username ? `@${member.username}` : 'без username'} · {member.tg_user_id}
        </div>
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex px-2 py-1 rounded-md text-[11px] font-black ${badge.cls}`}>
          {badge.text}
        </span>
        <div className="text-xs text-slate-500 font-medium mt-1">
          {member.active_subscription_count || 0} активн. · {member.expired_subscription_count || 0} истекш.
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="text-sm font-medium text-slate-700">{coverageLabel(member)}</div>
        <div className="text-xs text-slate-500 font-medium">
          {member.channels_count || 0} мест · {member.present_now ? 'сейчас найден' : 'сейчас не найден'}
        </div>
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex px-2 py-1 rounded-md text-[11px] font-bold ${sourceBadge.cls}`}>
          {sourceBadge.text}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        <button
          type="button"
          onClick={() => onCopyToBase?.(member)}
          disabled={disabled}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Добавить в базу клиентов"
        >
          <Plus className="w-3 h-3" />
          В базу
        </button>
      </td>
    </tr>
  );
}

export function AudienceMembersTable({ members, onCopyToBase, addToBaseDisabled }) {
  if (!members || members.length === 0) {
    return (
      <div className="p-4 rounded-2xl bg-slate-50/50 border border-slate-100 text-sm text-slate-500 font-medium">
        Под текущий фильтр ничего не попало.
      </div>
    );
  }

  const visible = members.slice(0, 100);

  return (
    <div className="overflow-x-auto -mx-2">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50/50">
            <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-400">Кто</th>
            <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-400">Деньги</th>
            <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-400">Покрытие</th>
            <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-400">Источник</th>
            <th className="px-4 py-3 text-right text-[11px] font-black uppercase tracking-widest text-slate-400">В базу</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((member) => (
            <AudienceMemberRow
              key={member.id || member.tg_user_id}
              member={member}
              onCopyToBase={onCopyToBase}
              disabled={addToBaseDisabled}
            />
          ))}
        </tbody>
      </table>
      {members.length > 100 ? (
        <div className="px-4 py-3 text-xs font-medium text-slate-500">
          Показываем первые 100 из {members.length}. Уточните фильтр или поиск, чтобы увидеть остальных.
        </div>
      ) : null}
    </div>
  );
}
