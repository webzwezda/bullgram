import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ChevronRight, ChevronDown } from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { TableShell, Th, Td, Tr, btnGhost } from './ui.jsx';

const PAGE_SIZE = 25;

function memberLabel(member) {
  if (member.username) return `@${member.username}`;
  if (member.display_name) return member.display_name;
  return `TG ID ${member.tg_user_id}`;
}

function viaBadge(member) {
  const touchpoints = Array.isArray(member.reachable_by) ? member.reachable_by : [];
  if (touchpoints.some((tp) => tp.confirmed)) {
    return <span className="px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-black">напрямую</span>;
  }
  return <span className="px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-[10px] font-black">общий чат</span>;
}

function MemberToggleList({ accessToken, preparationId, filter, label, updatedAnchor }) {
  const [state, setState] = useState({ members: [], total: 0, offset: 0, loading: false });
  const [open, setOpen] = useState(false);

  const load = useCallback(async (offset) => {
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const data = await apiRequest(`/api/broadcast/preparations/${preparationId}/members?filter=${filter}&limit=${PAGE_SIZE}&offset=${offset}`, { accessToken });
      setState({ members: data.members || [], total: data.total || 0, offset, loading: false });
    } catch {
      setState((prev) => ({ ...prev, loading: false }));
    }
  }, [accessToken, preparationId, filter]);

  useEffect(() => {
    if (open) load(0);
  }, [open, load, updatedAnchor]);

  return (
    <div className="mt-3">
      <button
        type="button"
        className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-600 hover:text-slate-900 transition-colors"
        onClick={() => setOpen((prev) => !prev)}
      >
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        {label}
      </button>
      {open && state.total > 0 ? (
        <div className="mt-3">
          <TableShell>
            <thead>
              <tr>
                <Th>Человек</Th>
                <Th>TG ID</Th>
                {filter === 'reachable' ? <Th>Как допишемся</Th> : null}
              </tr>
            </thead>
            <tbody>
              {state.members.map((member) => (
                <Tr key={member.tg_user_id}>
                  <Td><div className="text-sm font-bold text-slate-900">{memberLabel(member)}</div></Td>
                  <Td><div className="text-xs text-slate-500 font-mono">{member.tg_user_id}</div></Td>
                  {filter === 'reachable' ? <Td>{viaBadge(member)}</Td> : null}
                </Tr>
              ))}
            </tbody>
          </TableShell>
          <div className="flex items-center gap-2 mt-3">
            {state.offset > 0 ? (
              <button type="button" className={btnGhost} disabled={state.loading} onClick={() => load(Math.max(state.offset - PAGE_SIZE, 0))}>
                Назад
              </button>
            ) : null}
            {state.offset + PAGE_SIZE < state.total ? (
              <button type="button" className={btnGhost} disabled={state.loading} onClick={() => load(state.offset + PAGE_SIZE)}>
                Дальше
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {open && !state.loading && state.total === 0 ? (
        <div className="mt-2 text-xs text-slate-400 font-medium">Список пуст.</div>
      ) : null}
    </div>
  );
}

export function ReadinessDashboard({ accessToken, preparation, onRecheck, busy }) {
  const stats = preparation?.stats || {};
  const coverageReady = preparation?.status === 'ready';
  const confirmed = stats.confirmed || 0;
  const probable = stats.probable || 0;
  const unreachableCount = stats.unreachable || 0;
  const total = stats.total || 0;
  const reachableCount = confirmed + probable;

  return (
    <div className="mt-6 pt-5 border-t border-slate-100">
      <div className="flex items-center gap-2 mb-4">
        <RefreshCw className="w-4 h-4 text-slate-400" />
        <div className="text-xs font-black uppercase tracking-widest text-slate-400">Готовность</div>
      </div>
      {coverageReady ? (
        <>
          <div className="p-4 rounded-2xl bg-slate-50/60 border border-slate-100">
            <div className="text-sm font-black text-slate-900">
              Допишемся: {reachableCount} из {total}
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold">
              <span className="px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700">напрямую {confirmed}</span>
              <span className="px-2.5 py-1 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700">через общий чат {probable}</span>
              {unreachableCount > 0 ? (
                <span className="px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700">не допишемся {unreachableCount}</span>
              ) : null}
            </div>
            {unreachableCount === 0 ? (
              <div className="mt-2 text-xs text-slate-400 font-medium">База покрыта целиком.</div>
            ) : null}
          </div>
          <MemberToggleList
            accessToken={accessToken}
            preparationId={preparation.id}
            filter="reachable"
            label={`Кому допишемся: ${reachableCount}`}
            updatedAnchor={preparation.updated_at}
          />
          {unreachableCount > 0 ? (
            <MemberToggleList
              accessToken={accessToken}
              preparationId={preparation.id}
              filter="unreachable"
              label={`Кому не допишемся: ${unreachableCount}`}
              updatedAnchor={preparation.updated_at}
            />
          ) : null}
        </>
      ) : (
        <div className="text-sm text-amber-700 font-medium">
          Подготовка упала — добавь группы и нажми «Проверить снова».
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 mt-5">
        <button type="button" className={btnGhost} disabled={busy} onClick={onRecheck}>
          <RefreshCw className="w-4 h-4" /> Проверить снова
        </button>
      </div>
    </div>
  );
}
