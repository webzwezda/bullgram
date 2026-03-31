import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';
import { StatCard } from '../ui/StatCard.jsx';

function formatDate(value) {
  if (!value) return 'Нет ссылки';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

export function ObserverPage() {
  const { accessToken } = useAuth();
  const [state, setState] = useState({
    loading: true,
    refreshing: false,
    error: '',
    summary: {},
    admins: []
  });

  useEffect(() => {
    let cancelled = false;

    async function loadOverview({ silent = false } = {}) {
      if (!silent) {
        setState((prev) => ({
          ...prev,
          loading: !prev.admins.length,
          refreshing: !!prev.admins.length,
          error: ''
        }));
      }

      try {
        const data = await apiRequest('/api/observer/overview', { accessToken });
        if (!cancelled) {
          setState({
            loading: false,
            refreshing: false,
            error: '',
            summary: data.summary || {},
            admins: data.admins || []
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            loading: false,
            refreshing: false,
            error: error.message,
            summary: {},
            admins: []
          });
        }
      }
    }

    if (accessToken) {
      loadOverview();
    }

    const intervalId = accessToken
      ? window.setInterval(() => {
          loadOverview({ silent: true });
        }, 60_000)
      : null;

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [accessToken]);

  const groupedCounts = useMemo(() => ({
    admins: state.summary.admins_count || 0,
    groups: state.summary.groups_count || 0,
    invites: state.summary.groups_with_invites || 0,
    userbots: state.summary.total_userbots || 0
  }), [state.summary]);

  const prioritySignals = useMemo(() => {
    const signals = [];
    const missingInvites = Math.max(0, groupedCounts.groups - groupedCounts.invites);
    if (missingInvites > 0) {
      signals.push({
        tone: 'warning',
        title: `Не на все группы готовы инвайты: ${missingInvites}`,
        text: 'Наблюдатель должен видеть только те места, куда реально можно зайти и посмотреть работу команды живыми глазами.'
      });
    }
    if (groupedCounts.admins === 0) {
      signals.push({
        tone: 'info',
        title: 'Пока нет рабочего поля для наблюдения',
        text: 'Либо у админов еще нет групп с bot-админом, либо контур не прогрет. Пока смотреть просто некуда.'
      });
    }
    return signals;
  }, [groupedCounts]);

  if (state.loading) {
    return <LoadingState text="Тянем пульт наблюдения..." />;
  }

  if (state.error) {
    return (
      <section className="page">
        <div className="page__header">
          <h1>Пульт наблюдения</h1>
          <p>Этот экран доступен только `profiles.role=admin` и уже должен сидеть на живом `/api/observer/overview`.</p>
        </div>
        <div className="error-card">{state.error}</div>
      </section>
    );
  }

  return (
    <section className="page">
      <div className="page__header">
        <h1>Пульт наблюдения</h1>
        <p>
          Read-only экран для наблюдателя: кто из админов что реально администрирует, где есть рабочие инвайты и
          куда можно зайти посмотреть посты глазами.
        </p>
        <div className="page__meta">
          <span>{state.refreshing ? 'Обновляем фон...' : 'Экран обновляется сам раз в минуту.'}</span>
          <span>Админов в поле: {groupedCounts.admins}</span>
          <span>Групп и чатов под наблюдением: {groupedCounts.groups}</span>
        </div>
      </div>

      <section className="hero-panel">
        <div>
          <span className="eyebrow">Observer / Oversight</span>
          <h2>Наблюдатель видит не всё подряд, а только реальные рабочие контуры</h2>
          <p>
            Это read-only пульт контроля админов. Здесь должны быть только те группы и чаты, где команда реально
            администрирует контур и может дать инвайт для просмотра или входа.
          </p>
        </div>
      </section>

      {prioritySignals.length > 0 ? (
        <div className="priority-grid section">
          {prioritySignals.map((signal) => (
            <article key={signal.title} className={`priority-card priority-card--${signal.tone}`}>
              <h3>{signal.title}</h3>
              <p>{signal.text}</p>
            </article>
          ))}
        </div>
      ) : null}

      <div className="grid">
        <StatCard title="Админов" value={groupedCounts.admins} hint="Только те, у кого есть группы с bot-админом." />
        <StatCard title="Групп и чатов" value={groupedCounts.groups} hint="Только рабочие места, где уже можно сгенерить или показать инвайт." />
        <StatCard title="Инвайтов готово" value={groupedCounts.invites} hint="Сколько ссылок уже лежит в кеше и готово к открытию без доп. действий." />
        <StatCard title="Юзерботов в поле" value={groupedCounts.userbots} hint="Сколько всего рабочих userbot-контуров висит у админов." />
      </div>

      <div className="table-card">
        <div className="table-card__title">Админы и их рабочие группы</div>
        {state.admins.length === 0 ? (
          <div className="empty-inline">Пока нет рабочих админов с группами, где уже есть bot-админ.</div>
        ) : (
          <div className="observer-stack">
            {state.admins.map((admin) => (
              <div key={admin.owner_id} className="observer-admin">
                <div className="observer-admin__head">
                  <div>
                    <div className="observer-admin__title">{admin.owner_label}</div>
                    <div className="observer-admin__meta">
                      {admin.owner_email || 'Без email'} • групп: {admin.groups_count} • userbot: {admin.userbots_count} • official bot: {admin.bots_count}
                    </div>
                  </div>
                  <span className="pill pill--info">ops-ботов: {admin.ops_bots_count}</span>
                </div>

                <table className="table">
                  <thead>
                    <tr>
                      <th>Группа / чат</th>
                      <th>Bot admin</th>
                      <th>Инвайт</th>
                      <th>Когда обновлен</th>
                    </tr>
                  </thead>
                  <tbody>
                    {admin.groups.map((group) => (
                      <tr key={group.id}>
                        <td>
                          <div>{group.title}</div>
                          <div className="table-subtext">{group.tg_chat_id}</div>
                        </td>
                        <td>{group.bot_label || 'Нет bot-админа'}</td>
                        <td>
                          {group.observer_invite_link ? (
                            <a href={group.observer_invite_link} target="_blank" rel="noreferrer">
                              Открыть инвайт
                            </a>
                          ) : (
                            <span className="table-subtext">Ссылка еще не готова. Ее нужно сгенерить отдельным действием, а не ждать автозапуск.</span>
                          )}
                        </td>
                        <td>{formatDate(group.observer_invite_generated_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
