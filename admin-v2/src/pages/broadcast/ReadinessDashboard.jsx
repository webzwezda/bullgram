import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { EmptyNote, TableShell, Th, Td, Tr, btnGhost } from './ui.jsx';

const PAGE_SIZE = 25;

function memberLabel(member) {
  if (member.username) return `@${member.username}`;
  if (member.display_name) return member.display_name;
  return `TG ID ${member.tg_user_id}`;
}

export function ReadinessDashboard({ accessToken, preparation, onRecheck, busy }) {
  const stats = preparation?.stats || {};
  const coverageReady = preparation?.status === 'ready';
  const [unreachable, setUnreachable] = useState({ members: [], total: 0, offset: 0, loading: false });
  const [showUnreachable, setShowUnreachable] = useState(false);

  const loadUnreachable = useCallback(async (offset) => {
    if (!accessToken || !preparation?.id) return;
    setUnreachable((prev) => ({ ...prev, loading: true }));
    try {
      const data = await apiRequest(`/api/broadcast/preparations/${preparation.id}/members?filter=unreachable&limit=${PAGE_SIZE}&offset=${offset}`, { accessToken });
      setUnreachable({ members: data.members || [], total: data.total || 0, offset, loading: false });
    } catch {
      setUnreachable((prev) => ({ ...prev, loading: false }));
    }
  }, [accessToken, preparation?.id]);

  useEffect(() => {
    if (showUnreachable) {
      loadUnreachable(0);
    }
  }, [loadUnreachable, showUnreachable, preparation?.updated_at]);

  return (
    <div className="mt-6 pt-5 border-t border-slate-100">
      <div className="flex items-center gap-2 mb-4">
        <RefreshCw className="w-4 h-4 text-slate-400" />
        <div className="text-xs font-black uppercase tracking-widest text-slate-400">Готовность</div>
      </div>
      {coverageReady ? (
        unreachable.total === 0 && (stats.unreachable || 0) === 0 ? (
          <EmptyNote>База покрыта целиком.</EmptyNote>
        ) : (
          <button
            type="button"
            className="text-sm font-bold text-slate-700 hover:text-slate-900 transition-colors"
            onClick={() => setShowUnreachable((prev) => !prev)}
          >
            Недоступные: {stats.unreachable ?? unreachable.total} {showUnreachable ? '▾' : '▸'}
          </button>
        )
      ) : (
        <div className="text-sm text-amber-700 font-medium">
          Подготовка упала — добавь группы и нажми «Проверить снова».
        </div>
      )}
      {showUnreachable && unreachable.total > 0 ? (
        <div className="mt-4">
          <TableShell>
            <thead>
              <tr>
                <Th>Человек</Th>
                <Th>TG ID</Th>
              </tr>
            </thead>
            <tbody>
              {unreachable.members.map((member) => (
                <Tr key={member.tg_user_id}>
                  <Td><div className="text-sm font-bold text-slate-900">{memberLabel(member)}</div></Td>
                  <Td><div className="text-xs text-slate-500 font-mono">{member.tg_user_id}</div></Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
          <div className="flex items-center gap-2 mt-4">
            {unreachable.offset > 0 ? (
              <button type="button" className={btnGhost} disabled={unreachable.loading} onClick={() => loadUnreachable(Math.max(unreachable.offset - PAGE_SIZE, 0))}>
                Назад
              </button>
            ) : null}
            {unreachable.offset + PAGE_SIZE < unreachable.total ? (
              <button type="button" className={btnGhost} disabled={unreachable.loading} onClick={() => loadUnreachable(unreachable.offset + PAGE_SIZE)}>
                Дальше
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 mt-5">
        <button type="button" className={btnGhost} disabled={busy} onClick={onRecheck}>
          <RefreshCw className="w-4 h-4" /> Проверить снова
        </button>
      </div>
    </div>
  );
}
