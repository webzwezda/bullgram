import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Plus } from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { Card, Section, SectionTitle, EmptyNote, StatTile, TableShell, Th, Td, Tr, btnGhost, btnPrimary, inputCls } from './ui.jsx';

const PAGE_SIZE = 25;

function memberLabel(member) {
  if (member.username) return `@${member.username}`;
  if (member.display_name) return member.display_name;
  return `TG ID ${member.tg_user_id}`;
}

export function ReadinessDashboard({ accessToken, preparation, onRecheck, onAddGroups, busy, readOnly = false }) {
  const stats = preparation?.stats || {};
  const [unreachable, setUnreachable] = useState({ members: [], total: 0, offset: 0, loading: false });
  const [showUnreachable, setShowUnreachable] = useState(false);
  const [targetsText, setTargetsText] = useState('');
  const [showAddGroups, setShowAddGroups] = useState(false);

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

  async function submitTargets() {
    const targets = targetsText.split('\n').map((line) => line.trim()).filter(Boolean);
    if (targets.length === 0) return;
    await onAddGroups(targets);
    setTargetsText('');
    setShowAddGroups(false);
  }

  const tiles = (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <StatTile label="Доставим точно" value={stats.confirmed || 0} tone="ok" />
      <StatTile label="Возможна доставка" value={stats.probable || 0} tone={(stats.probable || 0) > 0 ? 'warning' : 'default'} />
      <StatTile label="Недоступны" value={stats.unreachable || 0} tone={(stats.unreachable || 0) > 0 ? 'danger' : 'default'} />
      <StatTile label="Покрытие" value={`${stats.coverage_pct || 0}%`} hint={`Из ${stats.total || 0} человек`} />
    </div>
  );

  if (readOnly) return tiles;

  return (
    <>
      {tiles}

      <Card>
        <Section>
          <SectionTitle icon={RefreshCw}>Готовность</SectionTitle>
          {unreachable.total === 0 && (stats.unreachable || 0) === 0 ? (
            <EmptyNote>База покрыта целиком.</EmptyNote>
          ) : (
            <button
              type="button"
              className="text-sm font-bold text-slate-700 hover:text-slate-900 transition-colors"
              onClick={() => setShowUnreachable((prev) => !prev)}
            >
              Недоступные: {stats.unreachable ?? unreachable.total} {showUnreachable ? '▾' : '▸'}
            </button>
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
            <button type="button" className={btnGhost} disabled={busy} onClick={() => setShowAddGroups((prev) => !prev)}>
              <Plus className="w-4 h-4" /> Добавить группы
            </button>
          </div>
          {showAddGroups ? (
            <div className="mt-4 space-y-3">
              <textarea
                className={`${inputCls} resize-none min-h-[90px] font-medium`}
                rows="3"
                value={targetsText}
                onChange={(e) => setTargetsText(e.target.value)}
                placeholder={'@group\nhttps://t.me/+AbCdEf...\nПо одной группе на строку'}
              />
              <button type="button" className={btnPrimary} disabled={busy || !targetsText.trim()} onClick={submitTargets}>
                Вступиться и пересчитать
              </button>
            </div>
          ) : null}
        </Section>
      </Card>
    </>
  );
}
