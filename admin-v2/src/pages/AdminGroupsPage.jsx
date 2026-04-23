import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';
import { StatCard } from '../ui/StatCard.jsx';

const FILTERS = [
  { id: 'all', label: 'Все места' },
  { id: 'ready', label: 'Готовы к продажам' },
  { id: 'need_bot', label: 'Нужен bot-админ' },
  { id: 'no_userbot', label: 'Юзербот без прав' },
  { id: 'unlinked', label: 'Не привязаны к системе' }
];

function downloadCsv(filename, header, rows) {
  const escapeCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = [header, ...rows].map((row) => row.map(escapeCell).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function focusChannel(key, row, href, errorText) {
  if (!row?.linked_channel_id) {
    window.alert(errorText);
    return;
  }

  window.localStorage.setItem(key, JSON.stringify({
    channel_id: row.linked_channel_id,
    title: row.title || ''
  }));
  window.location.href = href;
}

function sendGroupToBroadcast(row) {
  if (!row?.linked_channel_id) {
    window.alert('Эта группа еще не привязана к системе. Без этого и рассылку по ней не собрать.');
    return;
  }

  window.localStorage.setItem('broadcast_manual_selection', JSON.stringify({
    source: 'admin_groups_v2',
    base_name: `Группа: ${row.title || 'без имени'}`,
    channel_id: row.linked_channel_id,
    suggested_title: `Разбор группы: ${row.title || 'без имени'}`,
    suggested_message: row.userbot_admin && !row.official_bot_admin
      ? `По группе "${row.title || 'без имени'}" есть косяк по правам. Если ждешь автоматизацию и доступы без дыр, сначала добей настройку бота.`
      : `Короткий апдейт по группе "${row.title || 'без имени'}". Проверь последние сообщения бота и доступы, если что-то зависло.`
  }));
  window.location.href = '/app/broadcast';
}

function readyBadge(row) {
  if (row.admin_check_skipped && !row.linked_channel_id) {
    return { text: 'Сначала привязать к системе', className: 'pill' };
  }

  if (row.userbot_admin && row.official_bot_admin) {
    return { text: 'Все ок, можно продавать', className: 'pill pill--ok' };
  }

  if (row.userbot_admin) {
    return { text: 'Юзербот есть, нужен bot-админ', className: 'pill pill--warning' };
  }

  return { text: 'Юзербот без прав', className: 'pill pill--danger' };
}

function linkBadge(row) {
  if (row.linked_channel_id) {
    return { text: 'Уже в системе', className: 'pill pill--info' };
  }

  return { text: 'Еще не привязан', className: 'pill' };
}

export function AdminGroupsPage() {
  const { accessToken } = useAuth();
  const [selectedUserbotId, setSelectedUserbotId] = useState('');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [state, setState] = useState({
    loading: true,
    refreshing: false,
    syncing: false,
    scanRequired: false,
    error: '',
    audits: [],
    userbots: [],
    selectedUserbot: null
  });

  useEffect(() => {
    let cancelled = false;

    try {
      const raw = window.localStorage.getItem('admin_groups_filter_preset');
      if (raw) {
        const payload = JSON.parse(raw);
        if (payload?.filter) {
          setFilter(payload.filter);
        }
      }
    } catch (error) {
      console.error('Не удалось загрузить пресет карты прав:', error);
    } finally {
      window.localStorage.removeItem('admin_groups_filter_preset');
    }

    async function loadAudit({ silent = false, scan = false } = {}) {
      if (!silent) {
        setState((prev) => ({
          ...prev,
          loading: !prev.audits.length,
          refreshing: !!prev.audits.length,
          error: ''
        }));
      }

      try {
        const params = new URLSearchParams();
        if (selectedUserbotId) params.set('userbot_id', selectedUserbotId);
        if (scan) params.set('scan', 'true');
        const query = params.toString() ? `?${params.toString()}` : '';
        const data = await apiRequest(`/api/userbot/admin-audit${query}`, { accessToken });
        if (cancelled) return;

        const userbots = data.userbots || [];
        const resolvedUserbotId = data.selected_userbot_id ? String(data.selected_userbot_id) : (selectedUserbotId || String(userbots[0]?.id || ''));
        if (resolvedUserbotId && resolvedUserbotId !== selectedUserbotId) {
          setSelectedUserbotId(resolvedUserbotId);
        }

        setState({
          loading: false,
          refreshing: false,
          syncing: false,
          scanRequired: data.scan_required === true,
          error: '',
          audits: data.audits || [],
          userbots,
          selectedUserbot: userbots.find((item) => String(item.id) === resolvedUserbotId) || null
        });
      } catch (error) {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            loading: false,
            refreshing: false,
            syncing: false,
            scanRequired: false,
            error: error.message,
            audits: [],
            selectedUserbot: null
          }));
        }
      }
    }

    if (accessToken) {
      loadAudit({ scan: false });
    }

    return () => {
      cancelled = true;
    };
  }, [accessToken, selectedUserbotId]);

  const stats = useMemo(() => ({
    total: state.audits.length,
    userbotAdmin: state.audits.filter((row) => row.userbot_admin).length,
    botAdmin: state.audits.filter((row) => row.official_bot_admin).length,
    linked: state.audits.filter((row) => row.linked_channel_id).length,
    ready: state.audits.filter((row) => row.userbot_admin && row.official_bot_admin).length
  }), [state.audits]);

  const filteredAudits = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return state.audits.filter((row) => {
      if (needle) {
        const haystack = `${row.title || ''} ${row.chat_id || ''}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }

      if (filter === 'ready') return row.userbot_admin && row.official_bot_admin;
      if (filter === 'need_bot') return row.userbot_admin && !row.official_bot_admin;
      if (filter === 'no_userbot') return !row.userbot_admin;
      if (filter === 'unlinked') return !row.linked_channel_id;
      return true;
    });
  }, [filter, search, state.audits]);

  const problemGroups = useMemo(
    () => state.audits.filter((row) => !row.userbot_admin || !row.official_bot_admin),
    [state.audits]
  );

  const prioritySignals = useMemo(() => {
    const signals = [];
    if (!state.selectedUserbot && state.userbots.length === 0) {
      signals.push({
        tone: 'warning',
        title: 'Нет юзербота для карты прав',
        text: 'Подключи боевой юзербот. Без него не проверишь, где у команды реальные права на группы и чаты.'
      });
    }
    if (problemGroups.length > 0) {
      signals.push({
        tone: 'warning',
        title: `Есть дыры по правам: ${problemGroups.length}`,
        text: 'Сначала добей эти места. Иначе продажи, инвайты и автоматизация дальше будут течь.'
      });
    }
    if (stats.ready > 0) {
      signals.push({
        tone: 'ok',
        title: `Готовых к продажам мест: ${stats.ready}`,
        text: 'Тут уже есть и юзербот-админ, и official bot. Эти группы можно смело пинать дальше в CRM, доступ и рассылки.'
      });
    }
    return signals;
  }, [problemGroups.length, stats.ready, state.selectedUserbot, state.userbots.length]);

  async function syncChannels() {
    setState((prev) => ({ ...prev, syncing: true }));
    try {
      const data = await apiRequest('/api/userbot/sync-channels', {
        accessToken,
        method: 'POST'
      });
      window.alert(`Синхронизация прошла. Каналов добавлено или обновлено: ${data.count || 0}`);
      const params = new URLSearchParams();
      if (selectedUserbotId) params.set('userbot_id', selectedUserbotId);
      params.set('scan', 'true');
      const query = `?${params.toString()}`;
      const refreshed = await apiRequest(`/api/userbot/admin-audit${query}`, { accessToken });
      setState((prev) => ({
        ...prev,
        syncing: false,
        scanRequired: refreshed.scan_required === true,
        audits: refreshed.audits || [],
        userbots: refreshed.userbots || prev.userbots,
        selectedUserbot: (refreshed.userbots || prev.userbots).find((item) => String(item.id) === String(refreshed.selected_userbot_id || selectedUserbotId)) || prev.selectedUserbot
      }));
    } catch (error) {
      setState((prev) => ({ ...prev, syncing: false }));
      window.alert(error.message);
    }
  }

  function exportFilteredCsv() {
    if (!filteredAudits.length) {
      window.alert('По текущему фильтру карта пустая. Выгружать нечего.');
      return;
    }

    downloadCsv(
      `admin-groups-${filter || 'all'}-${new Date().toISOString().slice(0, 10)}.csv`,
      ['title', 'chat_id', 'userbot_admin', 'official_bot_admin', 'linked_channel_id', 'official_bot_usernames', 'error'],
      filteredAudits.map((row) => [
        row.title || '',
        row.chat_id || '',
        row.userbot_admin ? 'yes' : 'no',
        row.official_bot_admin ? 'yes' : 'no',
        row.linked_channel_id || '',
        Array.isArray(row.official_bot_usernames) ? row.official_bot_usernames.join(' | ') : '',
        row.error || ''
      ])
    );
  }

  function exportProblemsCsv() {
    if (!problemGroups.length) {
      window.alert('Явных дыр по правам сейчас не видно. Выгружать нечего.');
      return;
    }

    downloadCsv(
      `admin-groups-problems-${new Date().toISOString().slice(0, 10)}.csv`,
      ['title', 'chat_id', 'userbot_admin', 'official_bot_admin', 'linked_channel_id', 'official_bot_usernames', 'error'],
      problemGroups.map((row) => [
        row.title || '',
        row.chat_id || '',
        row.userbot_admin ? 'yes' : 'no',
        row.official_bot_admin ? 'yes' : 'no',
        row.linked_channel_id || '',
        Array.isArray(row.official_bot_usernames) ? row.official_bot_usernames.join(' | ') : '',
        row.error || ''
      ])
    );
  }

  if (state.loading) {
    return <LoadingState text="Тянем карту прав по группам..." />;
  }

  if (state.error) {
    return (
      <section className="page">
        <div className="page__header">
          <h1>Права в группах</h1>
          <p>Этот экран уже должен сидеть на живом `/api/userbot/admin-audit`, но backend вернул ошибку.</p>
        </div>
        <div className="error-card">{state.error}</div>
      </section>
    );
  }

  return (
    <section className="page">
      <div className="page__header">
        <h1>Права в группах</h1>
        <p>
          Тут видно, в каких группах и чатах у конкретного юзербота реально есть права, где уже стоят official-боты
          и какие места готовы к продажам без дыр.
        </p>
        <div className="page__meta">
          <span>{state.refreshing ? 'Гоним ручной аудит...' : 'Авто-refresh убран. Telegram трогаем только по явному скану.'}</span>
          <span>Мест в поле: {stats.total}</span>
          <span>Дыр по правам: {problemGroups.length}</span>
        </div>
      </div>

      <div className="hero-panel">
        <div className="hero-panel__body">
          <div className="hero-panel__eyebrow">Группы и чаты</div>
          <div className="hero-panel__title">Здесь сразу видно, где юзербот реально админ, где стоят official-боты и какие места уже готовы к продажам.</div>
          <div className="hero-panel__text">
            Это operational-карта. Сначала смотришь, где у команды реальные права, потом уже пинаешь группу в CRM,
            доступ, заказы или рассылки.
          </div>
          <div className="hero-panel__actions">
            <a className="hero-link" href="/app/userbots">Юзерботы</a>
            <button
              className="hero-link hero-link--button"
              type="button"
              onClick={() => loadAudit({ scan: true })}
              disabled={state.refreshing}
            >
              {state.refreshing ? 'Сканируем права...' : 'Прогнать аудит сейчас'}
            </button>
            <button className="hero-link hero-link--button" type="button" onClick={syncChannels} disabled={state.syncing}>
              {state.syncing ? 'Синкаем каналы...' : 'Синкануть каналы'}
            </button>
          </div>
        </div>
        <div className="hero-panel__grid">
          <div className="priority-chip priority-chip--info">
            <div className="priority-chip__title">Юзербот под лупой</div>
            <div className="priority-chip__value">{state.selectedUserbot?.tg_username ? `@${state.selectedUserbot.tg_username}` : (state.selectedUserbot?.tg_account_id || 'Не выбран')}</div>
            <div className="priority-chip__hint">Если юзерботов несколько, переключай и смотри карту отдельно по каждому.</div>
          </div>
          <div className="priority-chip priority-chip--ok">
            <div className="priority-chip__title">Готово к продажам</div>
            <div className="priority-chip__value">{stats.ready}</div>
            <div className="priority-chip__hint">Места, где уже есть и юзербот-админ, и official bot.</div>
          </div>
        </div>
      </div>

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

      {state.scanRequired ? (
        <div className="warning-card section">
          Этот экран больше не лезет в Telegram сам при открытии. Нажми «Прогнать аудит сейчас», если действительно хочешь
          сделать живой скан групп этим юзерботом.
        </div>
      ) : null}

      <div className="grid">
        <StatCard title="Всего мест нашли" value={stats.total} hint="Все группы и чаты, которые Telegram отдал этому юзерботу." />
        <StatCard title="Юзербот админ" value={stats.userbotAdmin} tone={stats.userbotAdmin ? 'ok' : 'default'} hint="Считаем только уже привязанные рабочие группы, а не любой хвост из диалогов." />
        <StatCard title="Есть bot-админ" value={stats.botAdmin} tone={stats.botAdmin ? 'info' : 'default'} hint="Где уже стоит официальный бот и можно двигать продажи." />
        <StatCard title="Привязаны к системе" value={stats.linked} tone={stats.linked ? 'info' : 'default'} hint="Где место уже заведено в channels и его можно открыть дальше по контуру." />
      </div>

      <div className="grid grid--double section">
        <div className="toolbar-card">
          <div className="toolbar-card__title">Какой юзербот сейчас проверяем</div>
          <div className="toolbar-card__body">
            <select value={selectedUserbotId} onChange={(event) => setSelectedUserbotId(event.target.value)}>
              {state.userbots.map((userbot) => (
                <option key={userbot.id} value={userbot.id}>
                  {userbot.tg_username ? `@${userbot.tg_username}` : `TG ${userbot.tg_account_id}`}
                </option>
              ))}
            </select>
          </div>
          <div className="toolbar-card__hint">
            Тут карта строится по конкретному админскому аккаунту. Если юзерботов несколько, переключай их и смотри,
            у кого какие реальные права.
          </div>
        </div>

        <div className="toolbar-card">
          <div className="toolbar-card__title">Текущий фильтр</div>
          <div className="toolbar-card__body">
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Поиск по группе или chat id"
            />
          </div>
          <div className="toolbar-card__body" style={{ flexWrap: 'wrap' }}>
            {FILTERS.map((item) => (
              <button
                key={item.id}
                className={`filter-chip${filter === item.id ? ' filter-chip--active' : ''}`}
                type="button"
                onClick={() => setFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="toolbar-card__hint">Сначала отрежь хвост по проблеме, потом уже пинай его в нужный operational-экран.</div>
        </div>
      </div>

      <div className="table-card section">
        <div className="table-card__title">Где дыры по правам</div>
        {problemGroups.length === 0 ? (
          <div className="empty-inline">Тут чисто. Явных дыр по админству не нашли.</div>
        ) : (
          <div className="list-stack">
            {problemGroups.map((row) => (
              <div key={`problem-${row.chat_id}`} className="list-item">
                <div className="list-item__head">
                  <div>
                    <div className="list-item__title">{row.title}</div>
                    <div className="table-subtext">{row.chat_id}</div>
                  </div>
                  <span className={readyBadge(row).className}>{readyBadge(row).text}</span>
                </div>
                <div className="list-item__meta">
                  <span className={
                    row.admin_check_skipped
                      ? 'pill'
                      : (row.userbot_admin ? 'pill pill--ok' : 'pill pill--danger')
                  }>
                    {row.admin_check_skipped ? 'Права не проверяли' : (row.userbot_admin ? 'Юзербот админ' : 'Юзербот без прав')}
                  </span>
                  <span className={row.official_bot_admin ? 'pill pill--info' : 'pill pill--warning'}>
                    {row.official_bot_admin ? 'Bot-админ есть' : 'Bot-админ не назначен'}
                  </span>
                  <span className={linkBadge(row).className}>{linkBadge(row).text}</span>
                </div>
                <div className="toolbar-card__body" style={{ padding: 0, marginTop: 12 }}>
                  <button type="button" onClick={() => focusChannel('crm_focus_channel', row, `/app/customers?tab=customers&channel=${encodeURIComponent(row.linked_channel_id || '')}`, 'Эта группа еще не привязана к системе. Сначала синканите каналы или привяжите ее, потом уже будет смысл открывать клиентов.')}>Клиенты</button>
                  <button type="button" onClick={() => focusChannel('orders_focus_channel', row, `/app/customers?tab=orders&channel=${encodeURIComponent(row.linked_channel_id || '')}`, 'Эта группа еще не привязана к системе. Без этого заказы по ней не открыть.')}>Заказы</button>
                  <button type="button" onClick={() => focusChannel('access_focus_channel', row, `/app/customers?tab=access&channel=${encodeURIComponent(row.linked_channel_id || '')}`, 'Эта группа еще не привязана к системе. Без этого и журнал доступа по ней не открыть.')}>Доступ</button>
                  <button type="button" onClick={() => sendGroupToBroadcast(row)}>Пнуть</button>
                  <button type="button" onClick={() => { window.location.href = '/app/userbots'; }}>Юзерботы</button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="toolbar-card__body" style={{ padding: 0, marginTop: 16 }}>
          <button type="button" onClick={exportProblemsCsv}>Дыры CSV</button>
          <button type="button" onClick={syncChannels} disabled={state.syncing}>{state.syncing ? 'Синкаем...' : 'Синкануть каналы'}</button>
        </div>
      </div>

      <div className="table-card section">
        <div className="table-card__title">Полная карта групп и чатов</div>
        <div className="toolbar-card__body" style={{ padding: 0, marginBottom: 16 }}>
          <button type="button" onClick={exportFilteredCsv}>Текущий фильтр CSV</button>
        </div>
        {filteredAudits.length === 0 ? (
          <div className="empty-inline">Под текущий фильтр ничего не попало.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Группа / чат</th>
                <th>Юзербот</th>
                <th>Официальные боты</th>
                <th>Связь с системой</th>
                <th>Итог</th>
                <th>Быстро пнуть</th>
              </tr>
            </thead>
            <tbody>
              {filteredAudits.map((row) => (
                <tr key={row.chat_id}>
                  <td>
                    <div>{row.title}</div>
                    <div className="table-subtext">{row.chat_id}</div>
                    {row.error ? <div className="table-subtext" style={{ color: '#991b1b' }}>{row.error}</div> : null}
                    {row.admin_check_skipped ? <div className="table-subtext">Права юзербота не проверяли: группа еще не заведена в систему.</div> : null}
                  </td>
                  <td>
                    <span className={
                      row.admin_check_skipped
                        ? 'pill'
                        : (row.userbot_admin ? 'pill pill--ok' : 'pill pill--danger')
                    }>
                      {row.admin_check_skipped ? 'Не проверяли' : (row.userbot_admin ? 'Админ' : 'Нет прав')}
                    </span>
                  </td>
                  <td>
                    <span className={row.official_bot_admin ? 'pill pill--info' : 'pill pill--warning'}>
                      {row.official_bot_admin ? 'Есть bot-админ' : 'Не назначен'}
                    </span>
                    {row.official_bot_usernames?.length ? (
                      <div className="table-subtext" style={{ marginTop: 6 }}>
                        {row.official_bot_usernames.map((username) => `@${username}`).join(', ')}
                      </div>
                    ) : null}
                  </td>
                  <td><span className={linkBadge(row).className}>{linkBadge(row).text}</span></td>
                  <td><span className={readyBadge(row).className}>{readyBadge(row).text}</span></td>
                  <td>
                    <div className="toolbar-card__body" style={{ padding: 0 }}>
                      <button type="button" onClick={() => focusChannel('crm_focus_channel', row, `/app/customers?tab=customers&channel=${encodeURIComponent(row.linked_channel_id || '')}`, 'Эта группа еще не привязана к системе. Сначала синканите каналы или привяжите ее, потом уже будет смысл открывать клиентов.')}>Клиенты</button>
                      <button type="button" onClick={() => focusChannel('orders_focus_channel', row, `/app/customers?tab=orders&channel=${encodeURIComponent(row.linked_channel_id || '')}`, 'Эта группа еще не привязана к системе. Без этого заказы по ней не открыть.')}>Заказы</button>
                      <button type="button" onClick={() => focusChannel('access_focus_channel', row, `/app/customers?tab=access&channel=${encodeURIComponent(row.linked_channel_id || '')}`, 'Эта группа еще не привязана к системе. Без этого и журнал доступа по ней не открыть.')}>Доступ</button>
                      <button type="button" onClick={() => sendGroupToBroadcast(row)}>Пнуть</button>
                      <button type="button" onClick={() => { window.location.href = '/app/userbots'; }}>Юзерботы</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
