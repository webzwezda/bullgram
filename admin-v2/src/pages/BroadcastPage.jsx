import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { getProductTierRules } from '../app/productTier.js';
import { supabase } from '../lib/supabase.js';
import { LoadingState } from '../ui/LoadingState.jsx';
import { PlanBanner } from '../ui/PlanBanner.jsx';
import { StatCard } from '../ui/StatCard.jsx';
import { UpgradeCallout } from '../ui/UpgradeCallout.jsx';

const AUDIENCES = [
  { id: 'active_subscribers', label: 'Активные подписчики' },
  { id: 'expired_subscribers', label: 'Ушедшие / просроченные' },
  { id: 'viewed_no_invoice', label: 'Смотрели тариф, но не создали счет' },
  { id: 'unpaid_leads', label: 'Нажали тариф, но не оплатили' },
  { id: 'paid_not_joined', label: 'Вход не подтвержден' },
  { id: 'customer_base_members', label: 'Вся база по нескольким группам' },
  { id: 'manual_list', label: 'Ручная выборка' },
  { id: 'trial_active', label: 'Пробники внутри' },
  { id: 'trial_expiring', label: 'Пробник скоро сгорит' },
  { id: 'trial_unpaid', label: 'Пробник нажали, но не оплатили' },
  { id: 'channel_active', label: 'Активные по конкретному каналу' }
];

function formatWhen(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function senderLabel(campaign) {
  if (campaign?.meta?.sender_usernames?.length) {
    return campaign.meta.sender_usernames.map((name) => `@${name}`).join(', ');
  }
  if (campaign?.meta?.sender_username) {
    return `@${campaign.meta.sender_username}`;
  }
  return 'Официальный бот';
}

function audienceHint(type) {
  const map = {
    active_subscribers: 'Живые платники. Тут анонсы, апдейты и то, что должно долетать до тех, кто уже внутри.',
    expired_subscribers: 'Те, кто уже сгорел. Этот хвост надо возвращать.',
    viewed_no_invoice: 'Открыли тарифы, но не дошли до счета. Это верх воронки для мягкого касания.',
    unpaid_leads: 'Нажали тариф, но слились до оплаты. Тут лежат быстрые деньги.',
    paid_not_joined: 'Оплата есть, а входа нет. Тут надо дотащить до доступа.',
    customer_base_members: 'Общая база по нескольким местам. Особенно полезно для дырявого хвоста.',
    manual_list: 'Ручная выборка, которую ты собрал сам на другом экране.',
    trial_active: 'Сидят на пробнике прямо сейчас.',
    trial_expiring: 'Пробники скоро сгорят. Самый горячий момент на апселл.',
    trial_unpaid: 'Даже дешевый вход не добили. Тут нужен отдельный дожим.',
    channel_active: 'Живые подписчики только по одному выбранному каналу.'
  };
  return map[type] || 'Выбери сегмент и смотри, кого реально зацепишь.';
}

function previewClientLabel(row) {
  if (row.username) return `@${row.username}`;
  if (row.tariff_title) return row.tariff_title;
  return `TG ID ${row.tg_user_id}`;
}

function loadManualSelection() {
  try {
    const raw = window.localStorage.getItem('broadcast_manual_selection');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function consumeManualSelection() {
  const selection = loadManualSelection();
  if (selection) {
    window.localStorage.removeItem('broadcast_manual_selection');
  }
  return selection;
}

function senderTypeUsesUserbot(senderType = '') {
  return [
    'userbot_only',
    'official_then_userbot',
    'userbot_pool_round_robin',
    'official_then_userbot_pool'
  ].includes(String(senderType || '').trim());
}

function senderTypeUsesUserbotPool(senderType = '') {
  return [
    'userbot_pool_round_robin',
    'official_then_userbot_pool'
  ].includes(String(senderType || '').trim());
}

export function BroadcastPage() {
  const { accessToken, user, profilePlan, trialEndsAt } = useAuth();
  const [state, setState] = useState({
    loading: true,
    refreshing: false,
    sending: false,
    previewing: false,
    error: '',
    channels: [],
    bases: [],
    userbots: [],
    campaigns: [],
    failures: [],
    summary: {},
    preview: [],
    previewCount: 0,
    updatedAt: null
  });
  const [form, setForm] = useState({
    title: '',
    audience_type: 'active_subscribers',
    channel_id: '',
    base_id: '',
    base_filter: 'all_members',
    manual_tg_user_ids: [],
    manual_members: [],
    sender_type: 'official_only',
    sender_userbot_id: '',
    sender_userbot_ids: [],
    delay_ms: 1500,
    message_text: ''
  });
  const [showRiskySenderModes, setShowRiskySenderModes] = useState(false);

  const requiresChannel = form.audience_type === 'channel_active';
  const requiresBase = form.audience_type === 'customer_base_members';
  const requiresManual = form.audience_type === 'manual_list';
  const usesPool = senderTypeUsesUserbotPool(form.sender_type);
  const usesUserbot = senderTypeUsesUserbot(form.sender_type);
  const planRules = useMemo(() => getProductTierRules(profilePlan), [profilePlan]);
  const trialHoursLeft = useMemo(() => {
    if (!trialEndsAt) return null;
    const diffMs = new Date(trialEndsAt).getTime() - Date.now();
    if (diffMs <= 0) return 0;
    return Math.ceil(diffMs / (1000 * 60 * 60));
  }, [trialEndsAt]);
  const trialUpgradeUrgent = profilePlan === 'trial' && trialHoursLeft !== null && trialHoursLeft > 0 && trialHoursLeft <= 72;

  useEffect(() => {
    let cancelled = false;

    async function loadAll({ silent = false } = {}) {
      if (!accessToken || !user?.id) return;
      if (!silent) {
        setState((prev) => ({
          ...prev,
          loading: !prev.updatedAt,
          refreshing: !!prev.updatedAt,
          error: ''
        }));
      }

      try {
        const manualSelection = consumeManualSelection();
        const [{ data: channels }, { data: rawUserbots }, reserved, bases, campaigns] = await Promise.all([
          supabase.from('channels').select('id, title').eq('owner_id', user.id).order('created_at', { ascending: false }),
          supabase
            .from('tg_accounts')
            .select('id, tg_username, tg_account_id, proxy_id, proxies(id, name, is_working, last_check_country, host, port)')
            .eq('owner_id', user.id)
            .eq('account_type', 'userbot')
            .order('created_at', { ascending: false }),
          apiRequest('/api/shop/seller/reserved-assets', { accessToken }),
          apiRequest('/api/customer-bases', { accessToken }),
          apiRequest('/api/broadcast/campaigns', { accessToken })
        ]);

        const reservedIds = new Set((reserved.userbot_ids || []).map(String));
        const userbots = (rawUserbots || []).filter((row) => !reservedIds.has(String(row.id)));

        if (!cancelled) {
          setState({
            loading: false,
            refreshing: false,
            sending: false,
            previewing: false,
            error: '',
            channels: channels || [],
            bases: bases.bases || [],
            userbots,
            campaigns: campaigns.campaigns || [],
            failures: campaigns.failures || [],
            summary: campaigns.summary || {},
            preview: [],
            previewCount: 0,
            updatedAt: new Date().toISOString()
          });

          setForm((prev) => {
            const next = {
              ...prev,
              sender_userbot_id: prev.sender_userbot_id || userbots[0]?.id || '',
              sender_userbot_ids: prev.sender_userbot_ids?.length ? prev.sender_userbot_ids : (userbots[0] ? [userbots[0].id] : [])
            };

            if (manualSelection?.tg_user_ids?.length) {
              next.audience_type = 'manual_list';
              next.manual_tg_user_ids = manualSelection.tg_user_ids || [];
              next.manual_members = manualSelection.members || [];
              next.title = prev.title || manualSelection.suggested_title || '';
              next.message_text = prev.message_text || manualSelection.suggested_message || '';
            }
            return next;
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            loading: false,
            refreshing: false,
            sending: false,
            previewing: false,
            error: error.message
          }));
        }
      }
    }

    loadAll();
    const intervalId = accessToken ? window.setInterval(() => loadAll({ silent: true }), 60_000) : null;
    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [accessToken, user?.id]);

  useEffect(() => {
    let cancelled = false;
    async function runPreview() {
      if (!accessToken || !form.audience_type) return;
      setState((prev) => ({ ...prev, previewing: true }));
      try {
        const data = await apiRequest('/api/broadcast/preview', {
          accessToken,
          method: 'POST',
          body: {
            audience_type: form.audience_type,
            channel_id: form.channel_id || null,
            base_id: form.base_id || null,
            manual_tg_user_ids: form.manual_tg_user_ids || [],
            manual_members: form.manual_members || [],
            base_filter: form.base_filter || 'all_members'
          }
        });
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            previewing: false,
            preview: data.audience || [],
            previewCount: data.count || 0
          }));
        }
      } catch (error) {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            previewing: false,
            preview: [],
            previewCount: 0,
            error: error.message
          }));
        }
      }
    }
    runPreview();
    return () => {
      cancelled = true;
    };
  }, [
    accessToken,
    form.audience_type,
    form.channel_id,
    form.base_id,
    form.base_filter,
    JSON.stringify(form.manual_tg_user_ids),
    JSON.stringify(form.manual_members)
  ]);

  const selectedUserbots = useMemo(() => {
    const ids = (form.sender_userbot_ids || []).map(String);
    return state.userbots.filter((row) => ids.includes(String(row.id)));
  }, [form.sender_userbot_ids, state.userbots]);

  const prioritySignals = useMemo(() => {
    const signals = [];
    if (!state.userbots.length) {
      signals.push({
        tone: 'warning',
        title: 'Нет живых юзерботов для ручного добива',
        text: 'Это не ломает safe-режим через официального бота, но ручной дожим через userbot сейчас недоступен.'
      });
    }
    if ((state.summary.totalFailed || 0) > 0) {
      signals.push({
        tone: 'danger',
        title: `Есть хвост недоставки: ${state.summary.totalFailed}`,
        text: 'Часть сообщений уже не дошла. Разбери failures и добей людей, пока они не остыли окончательно.'
      });
    }
    if (requiresManual && !(form.manual_tg_user_ids || []).length) {
      signals.push({
        tone: 'info',
        title: 'Ручная выборка пока пустая',
        text: 'Сначала собери хвост на другом экране, потом бей по manual-сегменту. Иначе тут будет холостой выстрел.'
      });
    }
    return signals;
  }, [form.manual_tg_user_ids, requiresManual, state.summary.totalFailed, state.userbots.length]);

  function setField(key, value) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'sender_type') {
        if (!senderTypeUsesUserbot(value)) {
          next.delay_ms = 1500;
        } else if (Number(next.delay_ms || 0) < 5000) {
          next.delay_ms = 5000;
        }
      }
      return next;
    });
  }

  function togglePoolUserbot(id) {
    setForm((prev) => {
      const current = new Set((prev.sender_userbot_ids || []).map(String));
      if (current.has(String(id))) current.delete(String(id));
      else current.add(String(id));
      return { ...prev, sender_userbot_ids: Array.from(current) };
    });
  }

  function clearManualSelection() {
    window.localStorage.removeItem('broadcast_manual_selection');
    setForm((prev) => ({
      ...prev,
      audience_type: 'active_subscribers',
      manual_tg_user_ids: [],
      manual_members: [],
      title: '',
      message_text: ''
    }));
  }

  async function sendCampaign() {
    if (!planRules.canSendBroadcasts) {
      window.alert(`На ${planRules.label} рассылки закрыты. Здесь можно только собрать аудиторию и понять, кого будешь добивать после апгрейда на Normal.`);
      return;
    }
    if (!form.message_text.trim()) {
      window.alert('Без текста рассылка не поедет.');
      return;
    }
    if (requiresChannel && !form.channel_id) {
      window.alert('Выбери канал.');
      return;
    }
    if (requiresBase && !form.base_id) {
      window.alert('Выбери базу.');
      return;
    }
    if (requiresManual && !(form.manual_tg_user_ids || []).length) {
      window.alert('Ручная выборка пустая.');
      return;
    }
    if (usesUserbot && !usesPool && !form.sender_userbot_id && form.sender_type !== 'official_then_userbot_pool') {
      window.alert('Выбери юзербота.');
      return;
    }
    if (usesUserbot && usesPool && !(form.sender_userbot_ids || []).length) {
      window.alert('Выбери хотя бы одного юзербота в пул.');
      return;
    }
    if (usesUserbot) {
      const confirmed = window.confirm(
        'Запустить рискованную рассылку через юзерботов? Telegram может ограничить аккаунт, если аудитория холодная или sender не знает людей.'
      );
      if (!confirmed) return;
    }

    setState((prev) => ({ ...prev, sending: true }));
    try {
      await apiRequest('/api/broadcast/send', {
        accessToken,
        method: 'POST',
        body: {
          title: form.title,
          audience_type: form.audience_type,
          channel_id: form.channel_id || null,
          base_id: form.base_id || null,
          base_filter: form.base_filter || 'all_members',
          manual_tg_user_ids: form.manual_tg_user_ids || [],
          manual_members: form.manual_members || [],
          sender_type: form.sender_type,
          sender_userbot_id: form.sender_userbot_id || null,
          sender_userbot_ids: form.sender_userbot_ids || [],
          delay_ms: Number(form.delay_ms || 0),
          message_text: form.message_text.trim(),
          manual_confirmed_userbot_risk: usesUserbot ? true : undefined
        }
      });
      window.alert('Рассылка ушла. Экран сам подтянет результат.');
      const campaigns = await apiRequest('/api/broadcast/campaigns', { accessToken });
      setState((prev) => ({
        ...prev,
        sending: false,
        campaigns: campaigns.campaigns || [],
        failures: campaigns.failures || [],
        summary: campaigns.summary || {},
        updatedAt: new Date().toISOString()
      }));
    } catch (error) {
      setState((prev) => ({ ...prev, sending: false }));
      window.alert(error.message);
    }
  }

  if (state.loading) {
    return <LoadingState text="Тянем боевую рассылку..." />;
  }

  return (
    <section className="page">
      <div className="page__header">
        <h1>Рассылки</h1>
        <p>
          Тут собираешь аудиторию, видишь хвост до отправки и бьешь по нему сначала безопасным контуром, а не фоновым userbot-автоматом.
        </p>
        <div className="page__meta">
          <span>Последнее обновление: {formatWhen(state.updatedAt)}</span>
          <span>{state.refreshing ? 'Обновляем фон...' : 'Экран обновляется сам раз в минуту.'}</span>
          <span>{state.previewing ? 'Считаем аудиторию...' : `Под ударом: ${state.previewCount}`}</span>
        </div>
      </div>

      <section className="hero-panel">
        <div>
          <span className="eyebrow">Broadcast / Outreach</span>
          <h2>Здесь ты добиваешь хвосты, а не просто шлешь текст</h2>
          <p>
            Экран нужен, чтобы собрать нужную аудиторию, выбрать безопасный sender-контур и не потерять людей между
            неоплатой, доступом, базой и личками. По умолчанию рассылка идет только через официального бота.
          </p>
        </div>
        <div className="hero-actions">
          <button className="ghost-button ghost-button--primary" onClick={sendCampaign} disabled={state.sending || state.previewCount === 0}>
            {state.sending ? 'Шлем...' : !planRules.canSendBroadcasts ? 'Нужен Normal' : 'Пульнуть рассылку'}
          </button>
        </div>
      </section>

      {!planRules.canSendBroadcasts ? (
        <>
          <PlanBanner
            tone="warning"
            title="Trial: рассылки пока в режиме разведки"
            text="На Trial этот экран нужен, чтобы собрать аудиторию, посмотреть хвост и понять, кого будешь дожимать. Сам выстрел откроется уже на Normal."
          />
          <UpgradeCallout
            title={trialUpgradeUrgent ? `Trial скоро сгорит: осталось около ${trialHoursLeft} ч` : undefined}
            text={trialUpgradeUrgent
              ? 'Если уже видишь живой хвост и готов добивать людей, не упирайся в trial-лимит до дедлайна. Переходи на Normal и запускай реальные рассылки.'
              : 'Если уже видишь живой хвост и понимаешь, что пора дожимать людей по-настоящему, переходи на Normal. Там этот экран становится боевым, а не просто разведкой.'}
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

      {state.error ? <div className="error-card">{state.error}</div> : null}

      <div className="grid">
        <StatCard title="Всего кампаний" value={state.summary.totalCampaigns || 0} hint="Все рассылки по текущему владельцу." />
        <StatCard title="Ушли нормально" value={state.summary.sentCampaigns || 0} hint="Кампании без ошибок." tone="ok" />
        <StatCard title="С косяками" value={state.summary.partialCampaigns || 0} hint="Есть хвост недоставки." tone={(state.summary.partialCampaigns || 0) > 0 ? 'warning' : 'default'} />
        <StatCard title="Сообщений дошло" value={state.summary.totalSent || 0} hint="Суммарная доставка." />
        <StatCard title="Не достучались" value={state.summary.totalFailed || 0} hint="Главный хвост на ручную добивку." tone={(state.summary.totalFailed || 0) > 0 ? 'danger' : 'default'} />
      </div>

      <div className="toolbar-card section">
        <div className="toolbar-card__title">Собери аудиторию</div>
        <div className="toolbar-card__body">
          <input className="field" type="text" value={form.title} onChange={(e) => setField('title', e.target.value)} placeholder="Название кампании" />
          <select className="field" value={form.audience_type} onChange={(e) => setField('audience_type', e.target.value)}>
            {AUDIENCES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          {requiresChannel ? (
            <select className="field" value={form.channel_id} onChange={(e) => setField('channel_id', e.target.value)}>
              <option value="">Выбери канал</option>
              {state.channels.map((row) => <option key={row.id} value={row.id}>{row.title}</option>)}
            </select>
          ) : null}
          {requiresBase ? (
            <>
              <select className="field" value={form.base_id} onChange={(e) => setField('base_id', e.target.value)}>
                <option value="">Выбери базу</option>
                {state.bases.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
              <select className="field" value={form.base_filter} onChange={(e) => setField('base_filter', e.target.value)}>
                <option value="all_members">Вся база</option>
                <option value="partial_only">Есть только в части базы</option>
                <option value="present_only">Только найденные сейчас</option>
                <option value="missing_only">Только пропавшие</option>
                <option value="multi_channel_only">Есть сразу в нескольких местах</option>
              </select>
            </>
          ) : null}
        </div>
        <div className="toolbar-card__hint">{audienceHint(form.audience_type)}</div>
      </div>

      <div className="toolbar-card section">
        <div className="toolbar-card__title">Кто пишет людям</div>
        <div className="toolbar-card__body">
          <select className="field" value={form.sender_type} onChange={(e) => setField('sender_type', e.target.value)}>
            <option value="official_only">Только официальный бот</option>
            {showRiskySenderModes ? <option value="official_then_userbot_pool">Официальный бот, если не пробьет — пул админов</option> : null}
            {showRiskySenderModes ? <option value="userbot_pool_round_robin">Пул админов по кругу</option> : null}
            {showRiskySenderModes ? <option value="userbot_only">Только один выбранный юзербот</option> : null}
          </select>
          {!usesPool && usesUserbot ? (
            <select className="field" value={form.sender_userbot_id} onChange={(e) => setField('sender_userbot_id', e.target.value)}>
              <option value="">Выбери юзербота</option>
              {state.userbots.map((row) => (
                <option key={row.id} value={row.id}>
                  @{row.tg_username || row.tg_account_id}{row.proxies?.last_check_country ? ` • ${row.proxies.last_check_country}` : ''}
                </option>
              ))}
            </select>
          ) : null}
          <input
            className="field"
            type="number"
            min={usesUserbot ? '5000' : '0'}
            max="30000"
            step="250"
            value={form.delay_ms}
            onChange={(e) => setField('delay_ms', e.target.value)}
            placeholder="Пауза, мс"
          />
        </div>
        <div className="toolbar-card__body">
          <button className="ghost-button" onClick={() => {
            setShowRiskySenderModes((prev) => {
              const next = !prev;
              if (!next && senderTypeUsesUserbot(form.sender_type)) {
                setForm((current) => ({ ...current, sender_type: 'official_only', delay_ms: 1500 }));
              }
              return next;
            });
          }}>
            {showRiskySenderModes ? 'Скрыть рискованные режимы' : 'Показать рискованные режимы'}
          </button>
        </div>
        <div className="toolbar-card__hint">
          Safe-first режим: по умолчанию шлет только официальный бот. Userbot-режимы открывай только для ручного дожима теплого хвоста.
        </div>
        {usesUserbot ? (
          <div className="toolbar-card__hint" style={{ color: '#b45309' }}>
            Рискованный режим: Telegram может ограничить sender-аккаунт. Используй только если userbot уже знает человека или сидит с ним в общем чате.
          </div>
        ) : null}
        {usesPool ? (
          <div className="list-stack">
            {state.userbots.map((row) => (
              <label key={row.id} className="list-item" style={{ cursor: 'pointer' }}>
                <div className="list-item__head">
                  <div className="list-item__title">@{row.tg_username || row.tg_account_id}</div>
                  <input type="checkbox" checked={(form.sender_userbot_ids || []).map(String).includes(String(row.id))} onChange={() => togglePoolUserbot(row.id)} />
                </div>
                <div className="list-item__meta">
                  {row.proxies?.host ? `${row.proxies.host}:${row.proxies.port}` : 'Прокси не найден'}
                  {row.proxies?.last_check_country ? ` • ${row.proxies.last_check_country}` : ''}
                </div>
              </label>
            ))}
          </div>
        ) : null}
        {requiresManual ? (
          <div className="toolbar-card__body">
            <button className="ghost-button" onClick={clearManualSelection}>Очистить ручную выборку</button>
          </div>
        ) : null}
      </div>

      <div className="toolbar-card section">
        <div className="toolbar-card__title">Сообщение</div>
        <div className="toolbar-card__body">
          <textarea
            className="field"
            rows="8"
            value={form.message_text}
            onChange={(e) => setField('message_text', e.target.value)}
            placeholder="Пиши как будто реально хочешь вернуть человека или дотащить его до оплаты."
          />
        </div>
        <div className="toolbar-card__body">
          <button className="ghost-button ghost-button--primary" onClick={sendCampaign} disabled={state.sending || state.previewCount === 0}>
            {state.sending ? 'Шлем...' : !planRules.canSendBroadcasts ? 'Нужен Normal' : 'Пульнуть рассылку'}
          </button>
        </div>
      </div>

      <div className="table-card section">
        <div className="table-card__title">Кто сейчас попадет под удар</div>
        {!state.preview.length ? (
          <div className="empty-inline">Тут пока пусто. Или аудитория нулевая, или надо выбрать канал/базу.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Клиент</th>
                <th>Канал</th>
                <th>Сегмент</th>
                <th>Источник</th>
              </tr>
            </thead>
            <tbody>
              {state.preview.map((row) => (
                <tr key={`${row.tg_user_id}-${row.channel_id || 'global'}`}>
                  <td>
                    <div>{previewClientLabel(row)}</div>
                    <div className="table-subtext">{row.tg_user_id}</div>
                  </td>
                  <td>{row.channel_title}</td>
                  <td>{row.segment_label || (row.is_trial ? 'Пробник' : 'Обычный')}</td>
                  <td>{row.source_type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="grid grid--double section">
        <div className="table-card">
          <div className="table-card__title">Последние рассылки</div>
          {state.campaigns.length === 0 ? (
            <div className="empty-inline">Рассылок еще не было.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Название</th>
                  <th>Аудитория</th>
                  <th>Кто слал</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {state.campaigns.slice(0, 20).map((campaign) => (
                  <tr key={campaign.id}>
                    <td>{formatWhen(campaign.created_at)}</td>
                    <td>{campaign.title}</td>
                    <td>{campaign.audience_type}</td>
                    <td>{senderLabel(campaign)}</td>
                    <td>
                      <span className={campaign.status === 'sent' ? 'pill pill--ok' : campaign.status === 'completed_with_errors' ? 'pill pill--warning' : 'pill'}>
                        {campaign.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="table-card">
          <div className="table-card__title">Куда не пробились</div>
          {state.failures.length === 0 ? (
            <div className="empty-inline">По последним кампаниям фейлов не видно.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>TG ID</th>
                  <th>Кампания</th>
                  <th>Ошибка</th>
                </tr>
              </thead>
              <tbody>
                {state.failures.slice(0, 20).map((row) => (
                  <tr key={row.id}>
                    <td>{formatWhen(row.created_at)}</td>
                    <td>{row.tg_user_id}</td>
                    <td>{row.campaign_id}</td>
                    <td>{row.error_text || 'Без текста ошибки'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}
