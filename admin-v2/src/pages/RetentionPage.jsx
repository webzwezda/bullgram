import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { supabase } from '../lib/supabase.js';
import { LoadingState } from '../ui/LoadingState.jsx';
import { StatCard } from '../ui/StatCard.jsx';

const FILTERS = [
  { id: 'all', label: 'Все каналы' },
  { id: 'ready', label: 'Готовы' },
  { id: 'fallback_only', label: 'Только fallback' },
  { id: 'no_sender', label: 'Некому писать' },
  { id: 'expiring', label: 'Истекают' }
];

function formatWhen(value) {
  if (!value) return 'Нет данных';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function getReadinessBadge(row) {
  if (row.hasOfficialBot) {
    return { text: 'Готово через official bot', className: 'pill pill--ok' };
  }

  if (row.hasFallback) {
    return { text: 'Только fallback через userbot', className: 'pill pill--warning' };
  }

  return { text: 'Некому писать', className: 'pill pill--danger' };
}

function focusChannel(row, key) {
  if (!row?.id) return false;
  window.localStorage.setItem(key, JSON.stringify({
    channel_id: String(row.id),
    channel_title: row.title || 'Без имени',
    source: 'admin_v2_retention'
  }));
  return true;
}

function openApp(href) {
  if (!href) return;
  window.location.href = href;
}

export function RetentionPage() {
  const { user } = useAuth();
  const [filter, setFilter] = useState('all');
  const [channelFilterId, setChannelFilterId] = useState('');
  const [reminderText, setReminderText] = useState('');
  const [state, setState] = useState({
    loading: true,
    refreshing: false,
    saving: false,
    error: '',
    settings: null,
    overview: {
      officialBotCount: 0,
      hasUserbot: false,
      channelCount: 0,
      channelsWithOfficialBot: 0,
      readyChannels: 0,
      expiringSoonCount: 0,
      activeSubscriptionsCount: 0,
      channelRows: []
    },
    updatedAt: null
  });

  useEffect(() => {
    try {
      const rawPreset = window.localStorage.getItem('retention_filter_preset');
      if (!rawPreset) return;
      const preset = JSON.parse(rawPreset);
      if (preset?.retentionFilter) {
        setFilter(String(preset.retentionFilter));
      }
      if (preset?.channel_id) {
        setChannelFilterId(String(preset.channel_id));
      }
      window.localStorage.removeItem('retention_filter_preset');
    } catch (error) {
      console.warn('Не удалось применить preset retention_filter_preset:', error);
      window.localStorage.removeItem('retention_filter_preset');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadRetention({ silent = false } = {}) {
      if (!user?.id) return;

      if (!silent) {
        setState((prev) => ({
          ...prev,
          loading: !prev.updatedAt,
          refreshing: !!prev.updatedAt,
          error: ''
        }));
      }

      try {
        const [{ data: settings }, { data: channels }, { data: accounts }] = await Promise.all([
          supabase.from('payment_settings').select('*').eq('owner_id', user.id).maybeSingle(),
          supabase.from('channels').select('id, title, bot_id').eq('owner_id', user.id),
          supabase.from('tg_accounts').select('id, account_type, tg_username').eq('owner_id', user.id)
        ]);

        const channelList = channels || [];
        const accountList = accounts || [];
        const officialBots = accountList.filter((account) => account.account_type === 'bot');
        const userbot = accountList.find((account) => account.account_type === 'userbot');
        const channelIds = channelList.map((channel) => channel.id);

        let subscriptions = [];
        if (channelIds.length > 0) {
          const { data } = await supabase
            .from('subscriptions')
            .select('id, channel_id, status, expires_at')
            .in('channel_id', channelIds)
            .eq('status', 'active');
          subscriptions = data || [];
        }

        const now = Date.now();
        const next24h = now + (24 * 60 * 60 * 1000);
        const channelRows = channelList.map((channel) => {
          const channelSubscriptions = subscriptions.filter((subscription) => subscription.channel_id === channel.id);
          const expiringSoon = channelSubscriptions.filter((subscription) => {
            if (!subscription.expires_at) return false;
            const expiresAt = new Date(subscription.expires_at).getTime();
            return expiresAt >= now && expiresAt <= next24h;
          }).length;

          const bot = officialBots.find((item) => item.id === channel.bot_id);
          const hasOfficialBot = !!bot;
          const hasFallback = !!userbot;
          const readiness = hasOfficialBot || hasFallback;

          return {
            id: channel.id,
            title: channel.title || 'Без названия',
            activeSubscribers: channelSubscriptions.length,
            expiringSoon,
            officialBotUsername: bot?.tg_username || null,
            hasOfficialBot,
            hasFallback,
            readiness
          };
        });

        if (!cancelled) {
          setState({
            loading: false,
            refreshing: false,
            saving: false,
            error: '',
            settings: settings || null,
            overview: {
              officialBotCount: officialBots.length,
              hasUserbot: !!userbot,
              channelCount: channelList.length,
              channelsWithOfficialBot: channelRows.filter((row) => row.hasOfficialBot).length,
              readyChannels: channelRows.filter((row) => row.readiness).length,
              expiringSoonCount: channelRows.reduce((sum, row) => sum + row.expiringSoon, 0),
              activeSubscriptionsCount: subscriptions.length,
              channelRows
            },
            updatedAt: new Date().toISOString()
          });
          setReminderText(settings?.reminder_text || '');
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            loading: false,
            refreshing: false,
            saving: false,
            error: error.message,
            settings: null,
            overview: {
              officialBotCount: 0,
              hasUserbot: false,
              channelCount: 0,
              channelsWithOfficialBot: 0,
              readyChannels: 0,
              expiringSoonCount: 0,
              activeSubscriptionsCount: 0,
              channelRows: []
            },
            updatedAt: null
          });
        }
      }
    }

    loadRetention();
    const intervalId = user?.id
      ? window.setInterval(() => {
          loadRetention({ silent: true });
        }, 60_000)
      : null;

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [user?.id]);

  const selectedChannel = useMemo(
    () => state.overview.channelRows.find((row) => String(row.id) === String(channelFilterId)) || null,
    [state.overview.channelRows, channelFilterId]
  );

  const filteredRows = useMemo(() => {
    return state.overview.channelRows.filter((row) => {
      if (channelFilterId && String(row.id) !== String(channelFilterId)) return false;
      if (filter === 'ready' && !row.readiness) return false;
      if (filter === 'fallback_only' && (row.hasOfficialBot || !row.hasFallback)) return false;
      if (filter === 'no_sender' && row.readiness) return false;
      if (filter === 'expiring' && row.expiringSoon <= 0) return false;
      return true;
    });
  }, [channelFilterId, filter, state.overview.channelRows]);

  const prioritySignals = useMemo(() => ([
    {
      title: 'Истекают за 24ч',
      value: state.overview.expiringSoonCount || 0,
      tone: (state.overview.expiringSoonCount || 0) > 0 ? 'warning' : 'ok',
      hint: `Активных подписок в контуре: ${state.overview.activeSubscriptionsCount || 0}`
    },
    {
      title: 'Каналы готовы',
      value: state.overview.readyChannels || 0,
      tone: (state.overview.readyChannels || 0) === (state.overview.channelCount || 0) ? 'ok' : 'warning',
      hint: `Всего каналов в системе: ${state.overview.channelCount || 0}`
    },
    {
      title: 'Fallback only',
      value: state.overview.channelRows.filter((row) => row.hasFallback && !row.hasOfficialBot).length,
      tone: state.overview.channelRows.some((row) => row.hasFallback && !row.hasOfficialBot) ? 'warning' : 'ok',
      hint: 'Тут удержание держится только на userbot'
    },
    {
      title: 'Некому писать',
      value: state.overview.channelRows.filter((row) => !row.readiness).length,
      tone: state.overview.channelRows.some((row) => !row.readiness) ? 'danger' : 'ok',
      hint: 'Эти каналы сейчас не закрыты ни official bot, ни fallback'
    }
  ]), [state.overview]);

  const currentSummary = useMemo(() => {
    if (!filteredRows.length) {
      return 'Под текущий фильтр ничего не попало. Значит либо тут чисто, либо фильтр слишком узкий.';
    }
    const expiringSoon = filteredRows.reduce((sum, row) => sum + (row.expiringSoon || 0), 0);
    return `Сейчас видно ${filteredRows.length} каналов и ${expiringSoon} подписок, которые скоро сгорят. Это и есть рабочий хвост удержания.`;
  }, [filteredRows]);

  const channelSummary = selectedChannel
    ? `Сейчас под лупой только канал "${selectedChannel.title}". Так проще разбирать один конкретный хвост по продлениям.`
    : 'Сейчас удержание смотрит все каналы сразу. Можно сузить экран до одного канала и разбирать хвост точечно.';

  const templatePreview = state.settings?.reminder_text
    ? state.settings.reminder_text.slice(0, 320)
    : 'Текст удержания пока не задан. Настрой его здесь, чтобы cron слал не пустышку.';

  function insertReminderTemplate() {
    setReminderText(`⏳ **Привет!**

Твой доступ в закрытый VIP-канал «**{channel_name}**» заканчивается менее чем через 24 часа.

💎 Чтобы не потерять доступ к эксклюзивным материалам и остаться с нами, пожалуйста, продли подписку.

👉 *Для продления просто перейди в главное меню этого бота и выбери удобный тариф!*`);
  }

  function insertTrialUpsellTemplate() {
    setReminderText(`⏳ **Пробный доступ почти закончился**

Твой доступ в «**{channel_name}**» скоро сгорит.

Если хочешь остаться дальше, переходи в основной тариф:
**{upsell_tariff_name}** — **{upsell_price} {upsell_currency}**

👉 *Зайди в меню бота и оформи полный доступ, пока пробник еще живой.*`);
  }

  async function saveReminderText() {
    setState((prev) => ({ ...prev, saving: true, error: '' }));
    try {
      const { error } = await supabase
        .from('payment_settings')
        .upsert({
          owner_id: user.id,
          reminder_text: reminderText
        }, { onConflict: 'owner_id' });

      if (error) throw error;

      setState((prev) => ({
        ...prev,
        saving: false,
        settings: {
          ...(prev.settings || {}),
          reminder_text: reminderText
        },
        updatedAt: new Date().toISOString()
      }));
      window.alert('Текст удержания сохранен.');
    } catch (error) {
      setState((prev) => ({ ...prev, saving: false, error: error.message }));
    }
  }

  if (state.loading) {
    return <LoadingState text="Тянем живой экран удержания..." />;
  }

  if (state.error) {
    return (
      <section className="page">
        <div className="page__header">
          <h1>Удержание</h1>
          <p>Этот экран уже должен жить на реальных данных по каналам и подпискам, но загрузка упала.</p>
        </div>
        <div className="error-card">{state.error}</div>
      </section>
    );
  }

  return (
    <section className="page">
      <div className="page__header">
        <h1>Удержание</h1>
        <p>
          Экран по продлениям и возврату хвоста. Здесь видно, по каким каналам удержание вообще может сработать,
          где есть только fallback через userbot и какой хвост скоро сгорит. Текст удержания тоже правится прямо тут.
        </p>
        <div className="page__meta">
          <span>Последнее обновление: {formatWhen(state.updatedAt)}</span>
          <span>{state.refreshing ? 'Обновляем фон...' : 'Экран обновляется сам раз в минуту.'}</span>
          <span>{state.settings?.admin_tg_id ? `admin_tg_id ${state.settings.admin_tg_id}` : 'admin_tg_id не задан'}</span>
        </div>
      </div>

      <div className="hero-panel">
        <div className="hero-panel__body">
          <div className="hero-panel__eyebrow">Продления и возврат</div>
          <div className="hero-panel__title">Здесь видно, какие каналы готовы удерживать людей, где держится только fallback и какой хвост скоро сгорит.</div>
          <div className="hero-panel__text">
            Удержание в новом кабинете нужно, чтобы не терять деньги на молчаливой просрочке. Здесь режешь хвост по каналам,
            правишь текст напоминаний и сразу видишь, где контур доставки сообщений уже не тянет.
          </div>
          <div className="hero-panel__actions">
            <a className="hero-link" href="/app/customers?tab=customers">Открыть клиентов</a>
            <a className="hero-link" href="/app/customers?tab=orders">Разобрать заказы</a>
            <a className="hero-link" href="/app/customers?tab=access">Разобрать доступ</a>
            <a className="hero-link" href="/app/broadcast">Пульнуть рассылку</a>
          </div>
        </div>
        <div className="hero-panel__grid">
          {prioritySignals.map((item) => (
            <div key={item.title} className={`priority-chip priority-chip--${item.tone}`}>
              <div className="priority-chip__title">{item.title}</div>
              <div className="priority-chip__value">{item.value}</div>
              <div className="priority-chip__hint">{item.hint}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid">
        <StatCard title="Каналов в системе" value={state.overview.channelCount || 0} hint="Сколько каналов и чатов уже заведено в контур." />
        <StatCard title="Оф. ботов" value={state.overview.officialBotCount || 0} hint={`Каналов с bot-админом: ${state.overview.channelsWithOfficialBot || 0}.`} />
        <StatCard title="Есть userbot" value={state.overview.hasUserbot ? 'Да' : 'Нет'} hint="Fallback через userbot нужен там, где official bot заблокирован." tone={state.overview.hasUserbot ? 'default' : 'warning'} />
        <StatCard title="Истекают за 24ч" value={state.overview.expiringSoonCount || 0} hint={`Активных подписок в контуре: ${state.overview.activeSubscriptionsCount || 0}.`} tone={(state.overview.expiringSoonCount || 0) > 0 ? 'warning' : 'default'} />
        <StatCard title="Каналы готовы" value={state.overview.readyChannels || 0} hint="Где есть хотя бы один путь доставки удержания." tone={(state.overview.readyChannels || 0) === (state.overview.channelCount || 0) ? 'ok' : 'default'} />
      </div>

      <div className="toolbar-card">
        <div className="toolbar-card__title">Что сейчас в фильтре</div>
        <div className="toolbar-card__body">
          <select
            className="field"
            value={channelFilterId}
            onChange={(event) => setChannelFilterId(event.target.value)}
          >
            <option value="">Все каналы</option>
            {state.overview.channelRows.map((row) => (
              <option key={row.id} value={row.id}>{row.title}</option>
            ))}
          </select>
          <a className="ghost-button" href="/app/retention" target="_blank" rel="noreferrer">
            Открыть этот экран отдельно
          </a>
        </div>
        <div className="filter-strip">
          {FILTERS.map((item) => (
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

      <div className="toolbar-card section">
        <div className="toolbar-card__title">Текст удержания</div>
        <div className="toolbar-card__body">
          <textarea
            className="field"
            rows="8"
            value={reminderText}
            onChange={(event) => setReminderText(event.target.value)}
            placeholder="Текст удержания перед окончанием подписки"
          />
        </div>
        <div className="filter-strip">
          <button className="filter-chip" onClick={insertReminderTemplate}>Стандартное удержание</button>
          <button className="filter-chip" onClick={insertTrialUpsellTemplate}>Пробник в апселл</button>
        </div>
        <div className="toolbar-card__body">
          <button className="ghost-button ghost-button--primary" onClick={saveReminderText} disabled={state.saving}>
            {state.saving ? 'Сохраняем...' : 'Сохранить текст'}
          </button>
          <a className="ghost-button" href="/app/retention" target="_blank" rel="noreferrer">
            Открыть этот экран отдельно
          </a>
        </div>
        <div className="toolbar-card__hint">
          Поддерживаются теги вроде {'{channel_name}'}, а для пробников еще {'{upsell_tariff_name}'}, {'{upsell_price}'}, {'{upsell_currency}'}.
        </div>
      </div>

      <div className="grid grid--double">
        <div className="table-card">
          <div className="table-card__title">Фокус экрана</div>
          <div className="table-subtext" style={{ lineHeight: 1.8 }}>{channelSummary}</div>
          <div className="table-subtext" style={{ marginTop: 12, lineHeight: 1.8 }}>{currentSummary}</div>
        </div>
        <div className="table-card">
          <div className="table-card__title">Текст удержания сейчас</div>
          <div className="table-subtext" style={{ lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{templatePreview}</div>
          <div className="table-actions" style={{ marginTop: 14 }}>
            <a href="/app/retention" target="_blank" rel="noreferrer">Открыть отдельно</a>
          </div>
        </div>
      </div>

      <div className="table-card">
        <div className="table-card__title">Операционный статус каналов</div>
        {filteredRows.length === 0 ? (
          <div className="empty-inline">Пока под текущий фильтр ничего не попало.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Канал</th>
                <th>Оф. бот</th>
                <th>Fallback</th>
                <th>Истекают за 24ч</th>
                <th>Статус</th>
                <th>Дальше</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const badge = getReadinessBadge(row);
                return (
                  <tr key={row.id}>
                    <td>
                      <div>{row.title}</div>
                      <div className="table-subtext">Активных подписчиков: {row.activeSubscribers}</div>
                    </td>
                    <td>{row.officialBotUsername ? `@${row.officialBotUsername}` : '—'}</td>
                    <td>
                      <span className={row.hasFallback ? 'pill pill--ok' : 'pill pill--danger'}>
                        {row.hasFallback ? 'userbot есть' : 'нет userbot'}
                      </span>
                    </td>
                    <td>
                      <span className={row.expiringSoon > 0 ? 'pill pill--warning' : 'pill'}>{row.expiringSoon}</span>
                    </td>
                    <td>
                      <span className={badge.className}>{badge.text}</span>
                    </td>
                    <td>
                      <div className="table-actions">
                        <button
                          className="inline-action"
                          onClick={() => {
                            if (!focusChannel(row, 'crm_focus_channel')) return;
                            openApp(`/app/customers?tab=customers&channel=${encodeURIComponent(row.id)}`);
                          }}
                        >
                          CRM
                        </button>
                        <button
                          className="inline-action"
                          onClick={() => {
                            if (!focusChannel(row, 'orders_focus_channel')) return;
                            openApp(`/app/customers?tab=orders&channel=${encodeURIComponent(row.id)}`);
                          }}
                        >
                          Заказы
                        </button>
                        <button
                          className="inline-action"
                          onClick={() => {
                            if (!row?.id) return;
                            window.localStorage.setItem('broadcast_manual_selection', JSON.stringify({
                              source: 'admin_v2_retention_channel',
                              base_name: `Удержание: ${row.title || 'без имени'}`,
                              channel_id: row.id,
                              suggested_title: `Удержание: ${row.title || 'без имени'}`,
                              suggested_message: row.expiringSoon > 0
                                ? `У тебя по каналу "${row.title || 'без имени'}" скоро истекает доступ. Если хочешь остаться внутри без вылета, продли подписку заранее.`
                                : `Короткое напоминание по каналу "${row.title || 'без имени'}". Проверь доступ и продли подписку, если не хочешь потерять место.`
                            }));
                            openApp('/app/broadcast');
                          }}
                        >
                          Пнуть
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
