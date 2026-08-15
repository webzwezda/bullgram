import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Bot, UserX, RefreshCw, Plus } from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { Card, Section, SectionTitle, EmptyNote, StatTile, TableShell, Th, Td, Tr, btnGhost, btnPrimary, inputCls } from './ui.jsx';

const PAGE_SIZE = 25;

function userbotLabel(userbotId, userbots) {
  const found = userbots.find((row) => String(row.id) === String(userbotId));
  return found ? `@${found.tg_username || found.tg_account_id}` : userbotId;
}

function memberLabel(member) {
  if (member.username) return `@${member.username}`;
  if (member.display_name) return member.display_name;
  return `TG ID ${member.tg_user_id}`;
}

export function ReadinessDashboard({ accessToken, preparation, userbots, onRecheck, onAddGroups, busy }) {
  const stats = preparation?.stats || {};
  const perUserbot = stats.per_userbot || {};
  const [unreachable, setUnreachable] = useState({ members: [], total: 0, offset: 0, loading: false });
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
    loadUnreachable(0);
  }, [loadUnreachable, preparation?.updated_at]);

  async function submitTargets() {
    const targets = targetsText.split('\n').map((line) => line.trim()).filter(Boolean);
    if (targets.length === 0) return;
    await onAddGroups(targets);
    setTargetsText('');
    setShowAddGroups(false);
  }

  const userbotEntries = Object.entries(perUserbot);

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Достигнем точно" value={stats.confirmed || 0} hint="Есть диалог, контакт в кэше или access hash." tone="ok" />
        <StatTile label="Скорее всего" value={stats.probable || 0} hint="Только общий чат — приватность может зарезать." tone={(stats.probable || 0) > 0 ? 'warning' : 'default'} />
        <StatTile label="Не достучимся" value={stats.unreachable || 0} hint="Нет ни одной точки прикосновения." tone={(stats.unreachable || 0) > 0 ? 'danger' : 'default'} />
        <StatTile label="Покрытие" value={`${stats.coverage_pct || 0}%`} hint={`Из ${stats.total || 0} человек в базе.`} />
      </div>

      {userbotEntries.length > 0 ? (
        <Card>
          <Section>
            <SectionTitle icon={Bot}>Кому сколько людей доступно</SectionTitle>
            <TableShell>
              <thead>
                <tr>
                  <Th>Юзербот</Th>
                  <Th>Доступных людей</Th>
                </tr>
              </thead>
              <tbody>
                {userbotEntries.map(([userbotId, count]) => (
                  <Tr key={userbotId}>
                    <Td><div className="text-sm font-bold text-slate-900">{userbotLabel(userbotId, userbots)}</div></Td>
                    <Td><div className="text-sm font-black text-slate-900">{count}</div></Td>
                  </Tr>
                ))}
              </tbody>
            </TableShell>
          </Section>
        </Card>
      ) : null}

      <Card>
        <Section>
          <SectionTitle icon={UserX}>Кого не достанем ({unreachable.total})</SectionTitle>
          {unreachable.total === 0 ? (
            <EmptyNote>Пробелов нет — база покрыта целиком.</EmptyNote>
          ) : (
            <>
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
            </>
          )}
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
