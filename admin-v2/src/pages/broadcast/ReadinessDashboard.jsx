import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../../api/client.js';
import { StatCard } from '../../ui/StatCard.jsx';

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
      <div className="grid section">
        <StatCard title="Достигнем точно" value={stats.confirmed || 0} hint="Есть диалог, контакт в кэше или access hash." tone="ok" />
        <StatCard title="Скорее всего достучимся" value={stats.probable || 0} hint="Только общий чат — приватность может зарезать." tone={(stats.probable || 0) > 0 ? 'warning' : 'default'} />
        <StatCard title="Не достучимся" value={stats.unreachable || 0} hint="Нет ни одной точки прикосновения." tone={(stats.unreachable || 0) > 0 ? 'danger' : 'default'} />
        <StatCard title="Покрытие" value={`${stats.coverage_pct || 0}%`} hint={`Из ${stats.total || 0} человек в базе.`} />
      </div>

      {userbotEntries.length > 0 ? (
        <div className="table-card section">
          <div className="table-card__title">Кому сколько людей доступно</div>
          <table className="table">
            <thead>
              <tr>
                <th>Юзербот</th>
                <th>Доступных людей</th>
              </tr>
            </thead>
            <tbody>
              {userbotEntries.map(([userbotId, count]) => (
                <tr key={userbotId}>
                  <td>{userbotLabel(userbotId, userbots)}</td>
                  <td>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="table-card section">
        <div className="table-card__title">
          Кого не достанем ({unreachable.total})
        </div>
        {unreachable.total === 0 ? (
          <div className="empty-inline">Пробелов нет — база покрыта целиком.</div>
        ) : (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th>Человек</th>
                  <th>TG ID</th>
                </tr>
              </thead>
              <tbody>
                {unreachable.members.map((member) => (
                  <tr key={member.tg_user_id}>
                    <td>{memberLabel(member)}</td>
                    <td>{member.tg_user_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="toolbar-card__body">
              {unreachable.offset > 0 ? (
                <button className="ghost-button" disabled={unreachable.loading} onClick={() => loadUnreachable(Math.max(unreachable.offset - PAGE_SIZE, 0))}>
                  Назад
                </button>
              ) : null}
              {unreachable.offset + PAGE_SIZE < unreachable.total ? (
                <button className="ghost-button" disabled={unreachable.loading} onClick={() => loadUnreachable(unreachable.offset + PAGE_SIZE)}>
                  Дальше
                </button>
              ) : null}
            </div>
          </>
        )}
        <div className="toolbar-card__body">
          <button className="ghost-button" disabled={busy} onClick={onRecheck}>Проверить снова</button>
          <button className="ghost-button" disabled={busy} onClick={() => setShowAddGroups((prev) => !prev)}>
            Добавить группы
          </button>
        </div>
        {showAddGroups ? (
          <div className="toolbar-card__body" style={{ flexDirection: 'column', gap: '8px' }}>
            <textarea
              className="field"
              rows="3"
              value={targetsText}
              onChange={(e) => setTargetsText(e.target.value)}
              placeholder={'@group\nhttps://t.me/+AbCdEf...\nПо одной группе на строку'}
            />
            <button className="ghost-button ghost-button--primary" disabled={busy || !targetsText.trim()} onClick={submitTargets}>
              Вступиться и пересчитать
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}
