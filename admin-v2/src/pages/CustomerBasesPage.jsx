import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';
import { PlanBanner } from '../ui/PlanBanner.jsx';
import { StatCard } from '../ui/StatCard.jsx';
import { UpgradeCallout } from '../ui/UpgradeCallout.jsx';

const MEMBER_FILTERS = [
  { id: 'humans', label: 'Люди' },
  { id: 'all', label: 'Все' },
  { id: 'active_paid', label: 'Активно платят' },
  { id: 'expired_paid', label: 'Сгорели' },
  { id: 'unpaid_leads', label: 'Не оплатили' },
  { id: 'free_riders', label: 'Зайцы' },
  { id: 'all_channels', label: 'Есть везде' },
  { id: 'partial_channels', label: 'Есть не везде' },
  { id: 'manual_only', label: 'Вбиты руками' },
  { id: 'synced_only', label: 'Из групп' }
];

function formatWhen(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function paymentBadgeClass(member) {
  if (member.payment_status === 'active_paid') return 'pill pill--ok';
  if (member.payment_status === 'expired_paid' || member.payment_status === 'expired_paid_inside') return 'pill pill--warning';
  if (member.payment_status === 'free_rider') return 'pill pill--danger';
  if (member.payment_status === 'unpaid_lead') return 'pill';
  return 'pill';
}

function paymentLabel(member) {
  if (member.payment_status === 'active_paid') return 'Платит и живой';
  if (member.payment_status === 'expired_paid') return 'Платил, но сгорел';
  if (member.payment_status === 'expired_paid_inside') return 'Сгорел, но сидит внутри';
  if (member.payment_status === 'free_rider') return 'Сидит зайцем';
  if (member.payment_status === 'unpaid_lead') return 'Жал, но не оплатил';
  return 'Пока пусто';
}

function coverageLabel(member) {
  if (member.coverage_status === 'all_channels') return 'Есть во всех';
  if (member.coverage_status === 'partial_channels') return 'Есть не везде';
  if (member.coverage_status === 'missing_everywhere') return 'Вообще не найден';
  return '—';
}

function needsUserbotRecovery(message = '') {
  const value = String(message || '').toLowerCase();
  return value.includes('юзербот') ||
    value.includes('сессия') ||
    value.includes('прокси') ||
    value.includes('expired') ||
    value.includes('auth_key_unregistered');
}

export function CustomerBasesPage() {
  const { accessToken, profilePlan, trialEndsAt } = useAuth();
  const [baseId, setBaseId] = useState('');
  const [filter, setFilter] = useState('humans');
  const [search, setSearch] = useState('');
  const [baseForm, setBaseForm] = useState({ id: '', name: '', description: '' });
  const [selectedChannelIds, setSelectedChannelIds] = useState([]);
  const [selectedUserbotId, setSelectedUserbotId] = useState('');
  const [manualImportText, setManualImportText] = useState('');
  const [state, setState] = useState({
    loading: true,
    refreshing: false,
    error: '',
    bases: [],
    channels: [],
    userbots: [],
    selectedBase: null,
    members: [],
    memberSummary: {},
    updatedAt: null
  });
  const [actionState, setActionState] = useState({
    savingBase: false,
    savingChannels: false,
    syncing: false,
    manualAdding: false
  });
  const trialHoursLeft = useMemo(() => {
    if (!trialEndsAt) return null;
    const diffMs = new Date(trialEndsAt).getTime() - Date.now();
    if (diffMs <= 0) return 0;
    return Math.ceil(diffMs / (1000 * 60 * 60));
  }, [trialEndsAt]);
  const trialUpgradeUrgent = profilePlan === 'trial' && trialHoursLeft !== null && trialHoursLeft > 0 && trialHoursLeft <= 72;

  useEffect(() => {
    let cancelled = false;

    async function loadBases({ silent = false } = {}) {
      if (!silent) {
        setState((prev) => ({
          ...prev,
          loading: !prev.bases.length,
          refreshing: !!prev.bases.length,
          error: ''
        }));
      }

      try {
        const data = await apiRequest('/api/customer-bases', { accessToken });
        if (cancelled) return;

        const bases = data.bases || [];
        const nextBaseId = baseId || bases[0]?.id || '';
        setBaseId(String(nextBaseId || ''));
        setState((prev) => ({
          ...prev,
          loading: false,
          refreshing: false,
          error: '',
          bases,
          channels: data.channels || [],
          userbots: data.userbots || [],
          updatedAt: new Date().toISOString()
        }));
      } catch (error) {
        if (!cancelled) {
          setState({
            loading: false,
            refreshing: false,
            error: error.message,
            bases: [],
            channels: [],
            userbots: [],
            selectedBase: null,
            members: [],
            memberSummary: {},
            updatedAt: null
          });
        }
      }
    }

    if (accessToken) {
      loadBases();
    }

    const intervalId = accessToken
      ? window.setInterval(() => {
          loadBases({ silent: true });
        }, 60_000)
      : null;

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [accessToken, baseId]);

  useEffect(() => {
    let cancelled = false;

    async function loadMembers({ silent = false } = {}) {
      if (!baseId) {
        setState((prev) => ({
          ...prev,
          selectedBase: null,
          members: [],
          memberSummary: {}
        }));
        return;
      }

      if (!silent) {
        setState((prev) => ({
          ...prev,
          refreshing: !!prev.members.length,
          error: ''
        }));
      }

      try {
        const data = await apiRequest(`/api/customer-bases/${baseId}/members`, { accessToken });
        if (cancelled) return;

        setState((prev) => ({
          ...prev,
          refreshing: false,
          error: '',
          selectedBase: prev.bases.find((base) => String(base.id) === String(baseId)) || null,
          members: data.members || [],
          memberSummary: data.summary || {},
          updatedAt: new Date().toISOString()
        }));
      } catch (error) {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            refreshing: false,
            error: error.message,
            selectedBase: prev.bases.find((base) => String(base.id) === String(baseId)) || null,
            members: [],
            memberSummary: {}
          }));
        }
      }
    }

    if (accessToken && baseId) {
      loadMembers();
    }

    const intervalId = accessToken && baseId
      ? window.setInterval(() => {
          loadMembers({ silent: true });
        }, 60_000)
      : null;

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [accessToken, baseId, state.bases]);

  useEffect(() => {
    if (!state.selectedBase) {
      setBaseForm({ id: '', name: '', description: '' });
      setSelectedChannelIds([]);
      return;
    }

    setBaseForm({
      id: state.selectedBase.id,
      name: state.selectedBase.name || '',
      description: state.selectedBase.description || ''
    });
    setSelectedChannelIds((state.selectedBase.channels || []).map((channel) => String(channel.id)));
  }, [state.selectedBase]);

  useEffect(() => {
    if (!state.userbots.length) {
      setSelectedUserbotId('');
      return;
    }
    if (!selectedUserbotId || !state.userbots.find((userbot) => String(userbot.id) === String(selectedUserbotId))) {
      setSelectedUserbotId(String(state.userbots[0].id));
    }
  }, [selectedUserbotId, state.userbots]);

  const filteredMembers = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return state.members.filter((member) => {
      if (filter === 'humans' && member.is_bot) return false;
      if (filter === 'active_paid' && member.payment_status !== 'active_paid') return false;
      if (filter === 'expired_paid' && !['expired_paid', 'expired_paid_inside'].includes(member.payment_status)) return false;
      if (filter === 'unpaid_leads' && member.payment_status !== 'unpaid_lead') return false;
      if (filter === 'free_riders' && !['free_rider', 'expired_paid_inside'].includes(member.payment_status)) return false;
      if (filter === 'all_channels' && member.coverage_status !== 'all_channels') return false;
      if (filter === 'partial_channels' && member.coverage_status !== 'partial_channels') return false;
      if (filter === 'manual_only' && member.source !== 'manual') return false;
      if (filter === 'synced_only' && member.source === 'manual') return false;

      if (!needle) return true;

      return [
        member.display_name || '',
        member.username ? `@${member.username}` : '',
        String(member.tg_user_id || ''),
        member.payment_status || '',
        coverageLabel(member)
      ].join(' ').toLowerCase().includes(needle);
    });
  }, [filter, search, state.members]);

  const coverageStats = useMemo(() => {
    return state.members.reduce((stats, member) => {
      stats.total += 1;
      if (member.coverage_status === 'all_channels') stats.all += 1;
      if (member.coverage_status === 'partial_channels') stats.partial += 1;
      if (member.coverage_status === 'missing_everywhere') stats.missing += 1;
      return stats;
    }, { total: 0, all: 0, partial: 0, missing: 0 });
  }, [state.members]);

  const prioritySignals = useMemo(() => {
    const signals = [];
    if ((state.memberSummary.free_riders || 0) > 0) {
      signals.push({
        tone: 'danger',
        title: `Есть зайцы: ${state.memberSummary.free_riders}`,
        text: 'Это люди внутри контура без живой подписки. Их нужно быстро разбирать через CRM, Access или Broadcast.'
      });
    }
    if (coverageStats.partial > 0) {
      signals.push({
        tone: 'warning',
        title: `Есть дырявый хвост: ${coverageStats.partial}`,
        text: 'Часть людей есть не во всех местах экосистемы. Это главный сегмент для дожима и ручной работы.'
      });
    }
    if (!state.userbots.length) {
      signals.push({
        tone: 'warning',
        title: 'Нет живого юзербота для синка',
        text: 'Без юзербота базы по группам слепы. Сначала оживи аккаунт в разделе "Боты и аккаунты".'
      });
    }
    return signals;
  }, [coverageStats, state.memberSummary, state.userbots.length]);

  async function reloadBases() {
    const data = await apiRequest('/api/customer-bases', { accessToken });
    const bases = data.bases || [];
    const nextBaseId = baseId || bases[0]?.id || '';
    setBaseId(String(nextBaseId || ''));
    setState((prev) => ({
      ...prev,
      error: '',
      bases,
      channels: data.channels || [],
      userbots: data.userbots || [],
      updatedAt: new Date().toISOString()
    }));
    return data;
  }

  async function reloadMembers(targetBaseId = baseId) {
    if (!targetBaseId) return;
    const data = await apiRequest(`/api/customer-bases/${targetBaseId}/members`, { accessToken });
    setState((prev) => ({
      ...prev,
      selectedBase: prev.bases.find((base) => String(base.id) === String(targetBaseId)) || prev.selectedBase,
      members: data.members || [],
      memberSummary: data.summary || {},
      updatedAt: new Date().toISOString()
    }));
  }

  async function saveBase() {
    if (!baseForm.name.trim()) {
      window.alert('Назови базу, а то нечего сохранять.');
      return;
    }

    setActionState((prev) => ({ ...prev, savingBase: true }));
    try {
      await apiRequest('/api/customer-bases', {
        accessToken,
        method: 'POST',
        body: {
          id: baseForm.id || undefined,
          name: baseForm.name.trim(),
          description: baseForm.description.trim()
        }
      });
      const data = await reloadBases();
      const savedBase = (data.bases || []).find((base) => (
        String(base.id) === String(baseForm.id) || base.name === baseForm.name.trim()
      )) || (data.bases || [])[0];
      if (savedBase) setBaseId(String(savedBase.id));
      window.alert('База сохранена.');
    } catch (error) {
      window.alert(error.message);
    } finally {
      setActionState((prev) => ({ ...prev, savingBase: false }));
    }
  }

  async function saveChannels() {
    if (!baseId) {
      window.alert('Сначала выбери или создай базу.');
      return;
    }

    setActionState((prev) => ({ ...prev, savingChannels: true }));
    try {
      await apiRequest(`/api/customer-bases/${baseId}/channels`, {
        accessToken,
        method: 'POST',
        body: { channel_ids: selectedChannelIds }
      });
      await reloadBases();
      window.alert('Группы и чаты привязаны.');
    } catch (error) {
      window.alert(error.message);
    } finally {
      setActionState((prev) => ({ ...prev, savingChannels: false }));
    }
  }

  async function syncBase() {
    if (!baseId) {
      window.alert('Сначала выбери базу.');
      return;
    }
    if (!selectedUserbotId) {
      window.alert('Сначала выбери живой юзербот для синка.');
      return;
    }

    setActionState((prev) => ({ ...prev, syncing: true }));
    try {
      const data = await apiRequest(`/api/customer-bases/${baseId}/sync`, {
        accessToken,
        method: 'POST',
        body: { userbot_id: selectedUserbotId }
      });
      await reloadBases();
      await reloadMembers(baseId);
      window.alert(`Синк прошел. Подняли ${data.synced_count || 0} человек.`);
    } catch (error) {
      window.alert(error.message);
    } finally {
      setActionState((prev) => ({ ...prev, syncing: false }));
    }
  }

  async function manualAddMembers() {
    if (!baseId) {
      window.alert('Сначала выбери базу.');
      return;
    }
    if (!manualImportText.trim()) {
      window.alert('Вставь хотя бы один TG ID.');
      return;
    }

    const entries = manualImportText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [tg_user_id = '', username = '', display_name = ''] = line.split(',').map((part) => part.trim());
        return { tg_user_id, username, display_name };
      });

    setActionState((prev) => ({ ...prev, manualAdding: true }));
    try {
      const data = await apiRequest(`/api/customer-bases/${baseId}/actions/manual-add`, {
        accessToken,
        method: 'POST',
        body: { entries }
      });
      setManualImportText('');
      await reloadMembers(baseId);
      window.alert(`Разобрали ${data.received_count || 0} строк. Новых: ${data.inserted_count || 0}, обновили: ${data.updated_count || 0}.`);
    } catch (error) {
      window.alert(error.message);
    } finally {
      setActionState((prev) => ({ ...prev, manualAdding: false }));
    }
  }

  if (state.loading) {
    return <LoadingState text="Тянем базы и хвосты..." />;
  }

  if (state.error && !state.bases.length) {
    return (
      <section className="page">
        <div className="page__header">
          <h1>Базы по группам</h1>
          <p>Этот экран уже сидит на живом backend, но загрузка баз вернула ошибку.</p>
        </div>
        <div className="error-card">{state.error}</div>
        {needsUserbotRecovery(state.error) ? (
          <div className="toolbar-card" style={{ marginTop: 16 }}>
            <div className="toolbar-card__title">Сначала оживи юзербота</div>
            <div className="list-stack">
              <div className="list-item">
                <div className="list-item__title">Без боевого юзербота этот экран слепой</div>
                <div className="list-item__meta">
                  Базы по группам тянут людей через живого юзербота. Если сессия умерла или прокси сдох, сначала переподключи аккаунт в `Боты и аккаунты`.
                </div>
              </div>
            </div>
            <div className="toolbar-card__body">
              <a className="ghost-button ghost-button--primary" href="/app/userbots">
                Открыть Боты и аккаунты
              </a>
              <a className="ghost-button" href="/app/userbot-center">
                Открыть Центр юзербота
              </a>
            </div>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="page">
      <div className="page__header">
        <h1>Базы по группам</h1>
        <p>
          Новый read-first экран по общей базе. Здесь видно, что лежит в базе, кто платит, кто сидит зайцем,
          где дырки по группам и куда дальше пнуть этот хвост.
        </p>
        <div className="page__meta">
          <span>Последнее обновление: {formatWhen(state.updatedAt)}</span>
          <span>{state.refreshing ? 'Обновляем фон...' : 'Экран обновляется сам раз в минуту.'}</span>
          <span>Баз в контуре: {state.bases.length}</span>
        </div>
      </div>

      <section className="hero-panel">
        <div>
          <span className="eyebrow">Customer Bases / Coverage</span>
          <h2>Здесь видно, кто дает деньги, кто выпал и где дыра в экосистеме</h2>
          <p>
            Это не просто таблица TG ID. Экран нужен, чтобы держать общую базу по группам, видеть платящее ядро,
            выявлять зайцев и быстро пинать нужный хвост в CRM, Orders, Access или Broadcast.
          </p>
        </div>
        <div className="hero-actions">
          <button className="ghost-button ghost-button--primary" onClick={saveBase} disabled={actionState.savingBase}>
            {actionState.savingBase ? 'Сохраняем...' : (baseForm.id ? 'Сохранить базу' : 'Создать базу')}
          </button>
          <button className="ghost-button" onClick={syncBase} disabled={!baseId || !selectedUserbotId || actionState.syncing}>
            {actionState.syncing ? 'Синк идет...' : 'Синкнуть базу'}
          </button>
        </div>
      </section>
      {profilePlan === 'trial' ? (
        <>
          <PlanBanner
            tone={trialUpgradeUrgent ? 'warning' : 'info'}
            title={trialUpgradeUrgent ? 'Trial догорает: базы пора переводить на Normal' : 'Базы на Trial нужны, чтобы собрать первую экосистему'}
            text={trialUpgradeUrgent
              ? `До конца trial осталось около ${trialHoursLeft} ч. Если уже тянешь людей из групп и режешь хвосты по покрытию, не оставляй базу в ознакомительном режиме — ей уже нужен Normal.`
              : 'На Trial можно собрать первую базу и понять, как устроена экосистема. Как только база становится рабочим активом под CRM и дожим, переводись на Normal.'}
          />
          <UpgradeCallout
            compact
            title="База уже стала рабочим активом — пора на Normal."
            text="Если здесь уже живут люди, хвосты и сегменты под дожим, не жди конца trial. Normal нужен, чтобы эта база стала основой для CRM, заказов и рассылок."
          />
        </>
      ) : null}

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
        <StatCard title="Баз всего" value={state.bases.length} hint="Все базы, заведенные у владельца." />
        <StatCard title="Людей в базе" value={state.memberSummary.total || 0} hint="Одна запись = один TG ID, даже если он сидит в нескольких местах." />
        <StatCard title="Платят и живые" value={state.memberSummary.active_paid || 0} hint="Это ядро, которое уже дает деньги." />
        <StatCard title="Зайцы" value={state.memberSummary.free_riders || 0} hint="Сидят без живой подписки." tone={(state.memberSummary.free_riders || 0) > 0 ? 'danger' : 'default'} />
      </div>

      <div className="grid grid--double">
        <div className="toolbar-card">
          <div className="toolbar-card__title">Твои базы</div>
          <div className="list-stack">
            {state.bases.length ? (
              state.bases.map((base) => (
                <button
                  key={base.id}
                  className={`list-item-button${String(baseId) === String(base.id) ? ' list-item-button--active' : ''}`}
                  onClick={() => setBaseId(String(base.id))}
                >
                  <div className="list-item__head">
                    <div className="list-item__title">{base.name}</div>
                    <span className="pill">{base.channels?.length || 0} мест</span>
                  </div>
                  <div className="list-item__meta">
                    {base.description || 'Без описания'} • {base.stats?.humans || 0} людей
                  </div>
                </button>
              ))
            ) : (
              <div className="empty-inline">Баз пока нет. Но теперь их можно поднять прямо тут.</div>
            )}
          </div>
          <div className="toolbar-card__body">
            <button className="ghost-button" onClick={() => {
              setBaseId('');
              setBaseForm({ id: '', name: '', description: '' });
              setSelectedChannelIds([]);
            }}>
              Новая база
            </button>
            <a className="ghost-button" href="/app/shop" target="_blank" rel="noreferrer">
              Открыть shop admin
            </a>
          </div>
        </div>

        <div className="toolbar-card">
          <div className="toolbar-card__title">Покрытие экосистемы</div>
          <div className="grid">
            <StatCard title="Во всех местах" value={coverageStats.all} hint="Есть во всех привязанных группах и чатах." />
            <StatCard title="Есть не везде" value={coverageStats.partial} hint="Главный дырявый хвост для дожима и ручной работы." tone={coverageStats.partial ? 'warning' : 'default'} />
            <StatCard title="Вообще не найден" value={coverageStats.missing} hint="Этих людей база уже не видит в привязанных местах." />
          </div>
          <div className="toolbar-card__body">
            <a className="ghost-button" href="/app/broadcast" target="_blank" rel="noreferrer">
              Пнуть хвост в рассылки
            </a>
            <a className="ghost-button" href="/app/customers?tab=customers" target="_blank" rel="noreferrer">
              Открыть хвост в клиентах
            </a>
          </div>
        </div>
      </div>

      <div className="toolbar-card section">
        <div className="toolbar-card__title">
          {state.selectedBase ? `База: ${state.selectedBase.name}` : 'Выбери базу'}
        </div>
        <div className="toolbar-card__body">
          <input
            className="field"
            type="text"
            value={baseForm.name}
            onChange={(event) => setBaseForm((prev) => ({ ...prev, name: event.target.value }))}
            placeholder="Название базы"
          />
          <input
            className="field"
            type="text"
            value={baseForm.description}
            onChange={(event) => setBaseForm((prev) => ({ ...prev, description: event.target.value }))}
            placeholder="Описание базы"
          />
          <button className="ghost-button ghost-button--primary" onClick={saveBase} disabled={actionState.savingBase}>
            {actionState.savingBase ? 'Сохраняем...' : (baseForm.id ? 'Сохранить базу' : 'Создать базу')}
          </button>
        </div>
        <div className="toolbar-card__body">
          <select
            className="field"
            multiple
            value={selectedChannelIds}
            onChange={(event) => setSelectedChannelIds(Array.from(event.target.selectedOptions).map((option) => option.value))}
            style={{ minHeight: 160 }}
          >
            {state.channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.title} • {channel.tg_chat_id}
              </option>
            ))}
          </select>
          <button className="ghost-button" onClick={saveChannels} disabled={!baseId || actionState.savingChannels}>
            {actionState.savingChannels ? 'Привязываем...' : 'Сохранить группы и чаты'}
          </button>
        </div>
        <div className="toolbar-card__body">
          <input
            className="field"
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Имя, @username, TG ID"
          />
        </div>
        <div className="toolbar-card__body">
          <select
            className="field"
            value={selectedUserbotId}
            onChange={(event) => setSelectedUserbotId(event.target.value)}
          >
            {state.userbots.map((userbot) => (
              <option key={userbot.id} value={userbot.id}>
                {userbot.tg_username ? `@${userbot.tg_username}` : `ID ${userbot.tg_account_id}`}
                {userbot.proxy_name ? ` • ${userbot.proxy_name}` : ''}
                {userbot.proxy_country ? ` • ${userbot.proxy_country}` : ''}
              </option>
            ))}
          </select>
          <button className="ghost-button" onClick={syncBase} disabled={!baseId || !selectedUserbotId || actionState.syncing}>
            {actionState.syncing ? 'Синк идет...' : 'Синкнуть базу из групп'}
          </button>
        </div>
        <div className="toolbar-card__body">
          <textarea
            className="field"
            rows="5"
            value={manualImportText}
            onChange={(event) => setManualImportText(event.target.value)}
            placeholder={'TG_ID,@username,Имя\n488609412,@user,Иван\n123456789'}
          />
          <button className="ghost-button" onClick={manualAddMembers} disabled={!baseId || actionState.manualAdding}>
            {actionState.manualAdding ? 'Разбираем...' : 'Добавить людей руками'}
          </button>
        </div>
        <div className="filter-strip">
          {MEMBER_FILTERS.map((item) => (
            <button
              key={item.id}
              className={`filter-chip${filter === item.id ? ' filter-chip--active' : ''}`}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="table-card section">
        <div className="table-card__title">Участники базы</div>
        {state.error && state.bases.length ? <div className="error-inline">{state.error}</div> : null}
        {!baseId ? (
          <div className="empty-inline">Слева выбери базу, чтобы увидеть ее хвост.</div>
        ) : filteredMembers.length === 0 ? (
          <div className="empty-inline">Под текущий фильтр ничего не попало.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Кто</th>
                <th>Деньги</th>
                <th>Покрытие</th>
                <th>Источник</th>
                <th>Дальше</th>
              </tr>
            </thead>
            <tbody>
              {filteredMembers.slice(0, 100).map((member) => (
                <tr key={member.id}>
                  <td>
                    <div>{member.display_name || `ID ${member.tg_user_id}`}</div>
                    <div className="table-subtext">
                      {member.username ? `@${member.username}` : 'без username'} • TG ID {member.tg_user_id}
                    </div>
                  </td>
                  <td>
                    <span className={paymentBadgeClass(member)}>{paymentLabel(member)}</span>
                    <div className="table-subtext">
                      Активных: {member.active_subscription_count || 0} • Истекших: {member.expired_subscription_count || 0}
                    </div>
                  </td>
                  <td>
                    <div>{coverageLabel(member)}</div>
                    <div className="table-subtext">
                      {member.channels_count || 0} мест • {member.present_now ? 'Сейчас найден' : 'Сейчас не найден'}
                    </div>
                  </td>
                  <td>
                    <span className="pill">{member.source === 'manual' ? 'Вбит руками' : 'Из групп'}</span>
                    <div className="table-subtext">{member.updated_at ? `Обновлен: ${formatWhen(member.updated_at)}` : 'Без даты'}</div>
                  </td>
                  <td>
                    <div className="table-actions">
                      <a
                        href={`/app/dossier?tg=${encodeURIComponent(member.tg_user_id)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Досье
                      </a>
                      <a href="/app/customers?tab=customers" target="_blank" rel="noreferrer">Клиенты</a>
                      <a href="/app/customers?tab=orders" target="_blank" rel="noreferrer">Заказы</a>
                      <a href="/app/customers?tab=access" target="_blank" rel="noreferrer">Доступ</a>
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
