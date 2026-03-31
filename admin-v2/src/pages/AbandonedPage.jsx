import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { supabase } from '../lib/supabase.js';
import { LoadingState } from '../ui/LoadingState.jsx';
import { PlanBanner } from '../ui/PlanBanner.jsx';
import { StatCard } from '../ui/StatCard.jsx';
import { UpgradeCallout } from '../ui/UpgradeCallout.jsx';

const FILTERS = [
  { id: 'all', label: 'Весь хвост' },
  { id: 'fresh', label: 'Свежие' },
  { id: 'queued', label: 'В очереди' },
  { id: 'awaiting_receipt', label: 'Ждут чек' },
  { id: 'reminded', label: 'Уже дожаты' },
  { id: 'stale', label: 'Протухшие' },
  { id: 'trial', label: 'Пробники' },
  { id: 'regular', label: 'Обычные тарифы' }
];

function formatWhen(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function getInvoiceStatus(inv) {
  const createdAt = new Date(inv.created_at).getTime();
  const ageHours = (Date.now() - createdAt) / (1000 * 60 * 60);

  if (inv.status === 'awaiting_receipt') {
    return { key: 'awaiting_receipt', text: 'Ждет чек', className: 'pill pill--warning' };
  }
  if (inv.reminded) {
    return { key: 'reminded', text: 'Уже дожат', className: 'pill pill--ok' };
  }
  if (ageHours < 2) {
    return { key: 'fresh', text: 'Свежий', className: 'pill' };
  }
  if (ageHours < 24) {
    return { key: 'queued', text: 'В очереди', className: 'pill pill--warning' };
  }
  return { key: 'stale', text: 'Протух', className: 'pill pill--danger' };
}

function openApp(href) {
  if (!href) return;
  window.location.href = href;
}

function downloadCsv(filename, header, rows) {
  const escapeCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = [header, ...rows].map((line) => line.map(escapeCell).join(',')).join('\n');
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

export function AbandonedPage() {
  const { user, profilePlan, trialEndsAt } = useAuth();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [settingsDraft, setSettingsDraft] = useState({
    abandoned_text: '',
    abandoned_discount_percent: 0
  });
  const [state, setState] = useState({
    loading: true,
    refreshing: false,
    saving: false,
    error: '',
    settings: null,
    invoices: [],
    updatedAt: null
  });
  const trialHoursLeft = useMemo(() => {
    if (!trialEndsAt) return null;
    const diffMs = new Date(trialEndsAt).getTime() - Date.now();
    if (diffMs <= 0) return 0;
    return Math.ceil(diffMs / (1000 * 60 * 60));
  }, [trialEndsAt]);
  const trialUpgradeUrgent = profilePlan === 'trial' && trialHoursLeft !== null && trialHoursLeft > 0 && trialHoursLeft <= 72;

  useEffect(() => {
    try {
      const rawPreset = window.localStorage.getItem('abandoned_filter_preset');
      if (!rawPreset) return;
      const preset = JSON.parse(rawPreset);
      if (preset?.filter) {
        setFilter(String(preset.filter));
      }
      window.localStorage.removeItem('abandoned_filter_preset');
    } catch (error) {
      console.warn('Не удалось применить preset abandoned_filter_preset:', error);
      window.localStorage.removeItem('abandoned_filter_preset');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadAbandoned({ silent = false } = {}) {
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
        const { data: settings } = await supabase
          .from('payment_settings')
          .select('abandoned_text, abandoned_discount_percent')
          .eq('owner_id', user.id)
          .maybeSingle();

        const { data: tariffs, error: tariffsError } = await supabase
          .from('tariffs')
          .select('id')
          .eq('owner_id', user.id);

        if (tariffsError) throw tariffsError;

        const tariffIds = (tariffs || []).map((item) => item.id);
        let invoices = [];

        if (tariffIds.length > 0) {
          const { data, error } = await supabase
            .from('invoices')
            .select('*, tariffs(title, is_trial, trial_label)')
            .in('tariff_id', tariffIds)
            .in('status', ['pending', 'awaiting_receipt'])
            .order('created_at', { ascending: false })
            .limit(100);

          if (error) throw error;
          invoices = data || [];
        }

        if (!cancelled) {
          setState({
            loading: false,
            refreshing: false,
            saving: false,
            error: '',
            settings: settings || null,
            invoices,
            updatedAt: new Date().toISOString()
          });
          setSettingsDraft({
            abandoned_text: settings?.abandoned_text || '',
            abandoned_discount_percent: Number(settings?.abandoned_discount_percent || 0)
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            loading: false,
            refreshing: false,
            saving: false,
            error: error.message,
            settings: null,
            invoices: [],
            updatedAt: null
          });
        }
      }
    }

    loadAbandoned();
    const intervalId = user?.id
      ? window.setInterval(() => {
          loadAbandoned({ silent: true });
        }, 60_000)
      : null;

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [user?.id]);

  const filteredInvoices = useMemo(() => {
    const needle = search.trim();
    return state.invoices.filter((inv) => {
      const invoiceStatus = getInvoiceStatus(inv).key;
      const isTrial = !!inv.tariffs?.is_trial;

      if (needle && !String(inv.tg_user_id || '').includes(needle)) {
        return false;
      }

      switch (filter) {
        case 'fresh':
          return invoiceStatus === 'fresh';
        case 'queued':
          return invoiceStatus === 'queued';
        case 'awaiting_receipt':
          return inv.status === 'awaiting_receipt';
        case 'reminded':
          return invoiceStatus === 'reminded';
        case 'stale':
          return invoiceStatus === 'stale';
        case 'trial':
          return isTrial;
        case 'regular':
          return !isTrial;
        default:
          return true;
      }
    });
  }, [filter, search, state.invoices]);

  const radarStats = useMemo(() => {
    return state.invoices.reduce((stats, inv) => {
      const invoiceStatus = getInvoiceStatus(inv).key;
      stats.total += 1;
      if (invoiceStatus === 'fresh') stats.fresh += 1;
      if (invoiceStatus === 'queued') stats.queued += 1;
      if (inv.status === 'awaiting_receipt') stats.awaitingReceipt += 1;
      if (invoiceStatus === 'reminded') stats.reminded += 1;
      if (invoiceStatus === 'stale') stats.stale += 1;
      if (inv.tariffs?.is_trial) stats.trial += 1;
      return stats;
    }, {
      total: 0,
      fresh: 0,
      queued: 0,
      awaitingReceipt: 0,
      reminded: 0,
      stale: 0,
      trial: 0
    });
  }, [state.invoices]);

  const prioritySignals = useMemo(() => ([
    {
      title: 'Свежие неоплаты',
      value: radarStats.fresh,
      tone: radarStats.fresh > 0 ? 'warning' : 'ok',
      hint: 'Самый горячий хвост: люди только что ткнули в тариф'
    },
    {
      title: 'В очереди на дожим',
      value: radarStats.queued,
      tone: radarStats.queued > 0 ? 'warning' : 'default',
      hint: 'Их уже пора пинать сообщением или уносить в заказы'
    },
    {
      title: 'Ждут чек',
      value: radarStats.awaitingReceipt,
      tone: radarStats.awaitingReceipt > 0 ? 'warning' : 'ok',
      hint: 'Тут нельзя молча ждать: это хвост на ручной разбор оплаты'
    },
    {
      title: 'Пробники',
      value: radarStats.trial,
      tone: radarStats.trial > 0 ? 'ok' : 'default',
      hint: 'Отдельный хвост под быстрый апселл и мягкий дожим'
    }
  ]), [radarStats]);

  const currentTgUserIds = useMemo(
    () => Array.from(new Set(filteredInvoices.map((inv) => String(inv.tg_user_id || '')).filter(Boolean))),
    [filteredInvoices]
  );

  const segmentSummary = useMemo(() => {
    if (!filteredInvoices.length) {
      return 'Сейчас в фильтре пусто. Значит некого дожимать или фильтр слишком узкий.';
    }
    return `Сейчас в таблице ${filteredInvoices.length} счетов и ${currentTgUserIds.length} уникальных Telegram ID. Этот хвост можно быстро отправить в заказы или добивку.`;
  }, [currentTgUserIds.length, filteredInvoices.length]);

  const settingsSummary = state.settings?.abandoned_text
    ? `Скидка ${state.settings.abandoned_discount_percent || 0}% • текст дожима уже настроен.`
    : 'Текст дожима пока пустой. Настрой его здесь, чтобы бот не стрелял в пустоту.';

  function insertDefaultTemplate() {
    setSettingsDraft({
      abandoned_discount_percent: 15,
      abandoned_text: `🛒 **Привет!**

Ты хотел купить тариф «**{tariff_name}**», но не завершил оплату.

🎁 Только сейчас я даю тебе **скидку {discount_percent}%** на этот тариф!

Новая цена: **{discount_price} {currency}** (вместо {old_price} {currency}).

👉 *Жми кнопку ниже, чтобы забрать доступ со скидкой!*`
    });
  }

  function insertTrialTemplate() {
    setSettingsDraft({
      abandoned_discount_percent: 0,
      abandoned_text: `🧪 **Ты почти залетел на пробник**

Ты нажал на «**{tariff_name}**», но не добил оплату.

Если хочешь быстро посмотреть, что внутри, просто вернись в бота и забери пробный доступ.

👉 *Пробник нужен как быстрый вход. Не тяни, пока интерес горячий.*`
    });
  }

  async function saveSettings() {
    setState((prev) => ({ ...prev, saving: true, error: '' }));
    try {
      const { error } = await supabase
        .from('payment_settings')
        .upsert({
          owner_id: user.id,
          abandoned_text: settingsDraft.abandoned_text,
          abandoned_discount_percent: Number(settingsDraft.abandoned_discount_percent || 0)
        }, { onConflict: 'owner_id' });

      if (error) throw error;

      setState((prev) => ({
        ...prev,
        saving: false,
        settings: { ...settingsDraft },
        updatedAt: new Date().toISOString()
      }));
      window.alert('Настройки дожима сохранены.');
    } catch (error) {
      setState((prev) => ({ ...prev, saving: false, error: error.message }));
    }
  }

  if (state.loading) {
    return <LoadingState text="Тянем радар неоплат..." />;
  }

  if (state.error) {
    return (
      <section className="page">
        <div className="page__header">
          <h1>Брошенные корзины</h1>
          <p>Экран должен сидеть на живых `invoices`, но загрузка вернула ошибку.</p>
        </div>
        <div className="error-card">{state.error}</div>
      </section>
    );
  }

  return (
    <section className="page">
      <div className="page__header">
        <h1>Брошенные корзины</h1>
        <p>
          Тут лежат люди, которые уже почти занесли деньги, но где-то отвалились между интересом и оплатой.
          Это triage по теплым неоплатам: режь хвост, смотри пробники, правь текст дожима и быстро пинай теплых в добивку.
        </p>
        <div className="page__meta">
          <span>Последнее обновление: {formatWhen(state.updatedAt)}</span>
          <span>{state.refreshing ? 'Обновляем фон...' : 'Экран обновляется сам раз в минуту.'}</span>
          <span>{settingsSummary}</span>
        </div>
      </div>

      {profilePlan === 'trial' ? (
        <>
          <PlanBanner
            tone="warning"
            title="Trial: тут уже видно деньги, но рабочий дожим начинается на Normal"
            text="На Trial этот экран помогает увидеть почти-оплаты, чеки и пробники. Как только дожим становится регулярной задачей по выручке, нужен рабочий слой без trial-стопоров."
          />
          <UpgradeCallout
            title={trialUpgradeUrgent ? `Trial скоро сгорит: осталось около ${trialHoursLeft} ч` : undefined}
            text={trialUpgradeUrgent
              ? 'Если здесь уже лежат живые деньги и теплый хвост, не тяни до конца trial. Переходи на Normal и добивай неоплаты в боевом режиме.'
              : 'Как только дожим перестал быть разведкой и стал регулярной задачей по деньгам, следующий шаг — Normal.'}
          />
        </>
      ) : null}

      <div className="hero-panel">
        <div className="hero-panel__body">
          <div className="hero-panel__eyebrow">Неоплаты и дожим</div>
          <div className="hero-panel__title">Здесь лежат почти-оплаты: люди уже ткнули в тариф, но не дожали деньги до конца.</div>
          <div className="hero-panel__text">
            Этот экран нужен, чтобы не терять теплых клиентов. Здесь режешь хвост по свежести, пробникам и чекам,
            настраиваешь текст дожима и быстро отправляешь людей в заказы, рассылки или ручной разбор.
          </div>
          <div className="hero-panel__actions">
            <a className="hero-link" href="/app/orders">Разобрать заказы</a>
            <a className="hero-link" href="/app/broadcast">Пульнуть рассылку</a>
            <a className="hero-link" href="/app/crm">Открыть CRM</a>
            <a className="hero-link" href="/app/analytics">Смотреть цифры</a>
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
        <StatCard title="Всего лидов" value={radarStats.total} hint="Все неоплаты и хвосты под дожим." />
        <StatCard title="Свежие" value={radarStats.fresh} hint="Только что нажали на тариф." />
        <StatCard title="В очереди" value={radarStats.queued} hint="Пора долбить автоматикой или руками." tone={radarStats.queued > 0 ? 'warning' : 'default'} />
        <StatCard title="Ждут чек" value={radarStats.awaitingReceipt} hint="Ручной хвост по подтверждению оплаты." tone={radarStats.awaitingReceipt > 0 ? 'warning' : 'default'} />
        <StatCard title="Дожаты" value={radarStats.reminded} hint="Система уже стреляла сообщением." />
        <StatCard title="Пробники" value={radarStats.trial} hint="Отдельный быстрый хвост для апселла." />
      </div>

      <div className="toolbar-card">
        <div className="toolbar-card__title">Радар неоплат</div>
        <div className="toolbar-card__body">
          <input
            className="field"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Ищи по Telegram ID"
          />
          <button
            className="ghost-button"
            onClick={() => downloadCsv(
              `abandoned-${filter}-${new Date().toISOString().slice(0, 10)}.csv`,
              ['invoice_id', 'created_at', 'tg_user_id', 'tariff_title', 'is_trial', 'status', 'radar_status', 'amount', 'currency'],
              filteredInvoices.map((inv) => [
                inv.id,
                inv.created_at,
                inv.tg_user_id,
                inv.tariffs?.title || '',
                inv.tariffs?.is_trial ? 'yes' : 'no',
                inv.status || '',
                getInvoiceStatus(inv).key,
                inv.amount || 0,
                inv.currency || ''
              ])
            )}
          >
            Выгрузить CSV
          </button>
          <a className="ghost-button" href="/app/abandoned" target="_blank" rel="noreferrer">
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
        <div className="toolbar-card__title">Текст дожима и скидка</div>
        <div className="toolbar-card__body">
          <input
            className="field"
            type="number"
            min="0"
            max="99"
            value={settingsDraft.abandoned_discount_percent}
            onChange={(event) => setSettingsDraft((prev) => ({
              ...prev,
              abandoned_discount_percent: Number(event.target.value || 0)
            }))}
            placeholder="Скидка %"
          />
        </div>
        <div className="filter-strip">
          <button className="filter-chip" onClick={insertDefaultTemplate}>Обычный дожим</button>
          <button className="filter-chip" onClick={insertTrialTemplate}>Пробник</button>
        </div>
        <div className="toolbar-card__body">
          <textarea
            className="field"
            rows="8"
            value={settingsDraft.abandoned_text}
            onChange={(event) => setSettingsDraft((prev) => ({ ...prev, abandoned_text: event.target.value }))}
            placeholder="Текст дожима после брошенной оплаты"
          />
        </div>
        <div className="toolbar-card__body">
          <button className="ghost-button ghost-button--primary" onClick={saveSettings} disabled={state.saving}>
            {state.saving ? 'Сохраняем...' : 'Сохранить дожим'}
          </button>
          <a className="ghost-button" href="/app/abandoned" target="_blank" rel="noreferrer">
            Открыть этот экран отдельно
          </a>
        </div>
        <div className="toolbar-card__hint">
          Поддерживаются теги `{tariff_name}`, `{discount_percent}`, `{discount_price}`, `{old_price}`, `{currency}`.
        </div>
      </div>

      <div className="grid grid--double">
        <div className="table-card">
          <div className="table-card__title">Что сейчас в фильтре</div>
          <div className="table-subtext" style={{ lineHeight: 1.8 }}>{segmentSummary}</div>
        </div>
        <div className="table-card">
          <div className="table-card__title">Куда пинать дальше</div>
          <div className="table-actions" style={{ marginTop: 10 }}>
            <button
              className="inline-action"
              onClick={() => {
                window.localStorage.setItem('orders_manual_selection', JSON.stringify({
                  source: 'admin_v2_abandoned',
                  tg_user_ids: currentTgUserIds
                }));
                openApp('/app/orders');
              }}
            >
              Разобрать в заказах
            </button>
            <button
              className="inline-action"
              onClick={() => {
                window.localStorage.setItem('broadcast_manual_selection', JSON.stringify({
                  source: 'admin_v2_abandoned',
                  tg_user_ids: currentTgUserIds,
                  base_name: `Брошенные корзины • ${filter}`,
                  suggested_title: `Дожим: ${filter}`,
                  suggested_message: 'Ты уже почти купил, но не добил оплату. Если еще актуально, вернись и закрой оплату сейчас.'
                }));
                openApp('/app/broadcast');
              }}
            >
              Пнуть в добивку
            </button>
          </div>
        </div>
      </div>

      <div className="table-card">
        <div className="table-card__title">Хвост неоплат</div>
        {filteredInvoices.length === 0 ? (
          <div className="empty-inline">Под текущий фильтр ничего не попало.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Telegram ID</th>
                <th>Тариф</th>
                <th>Тип</th>
                <th>Сумма</th>
                <th>Время</th>
                <th>Статус</th>
                <th>Дальше</th>
              </tr>
            </thead>
            <tbody>
              {filteredInvoices.slice(0, 80).map((inv) => {
                const invoiceStatus = getInvoiceStatus(inv);
                return (
                  <tr key={inv.id}>
                    <td>{inv.tg_user_id}</td>
                    <td>
                      <div>{inv.tariffs?.title || 'Неизвестно'}</div>
                      <div className="table-subtext">{inv.id}</div>
                    </td>
                    <td>
                      <span className={inv.tariffs?.is_trial ? 'pill pill--warning' : 'pill'}>
                        {inv.tariffs?.is_trial ? (inv.tariffs?.trial_label || 'Пробник') : 'Обычный тариф'}
                      </span>
                    </td>
                    <td>{inv.amount} {inv.currency}</td>
                    <td>{formatWhen(inv.created_at)}</td>
                    <td>
                      <span className={invoiceStatus.className}>{invoiceStatus.text}</span>
                    </td>
                    <td>
                      <div className="table-actions">
                        <a
                          href={`/app/dossier?tg=${encodeURIComponent(inv.tg_user_id)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Досье
                        </a>
                        <button
                          className="inline-action"
                          onClick={() => {
                            window.localStorage.setItem('orders_search_preset', JSON.stringify({
                              search: String(inv.tg_user_id),
                              source: 'admin_v2_abandoned_row'
                            }));
                            openApp('/app/orders');
                          }}
                        >
                          Заказы
                        </button>
                        <button
                          className="inline-action"
                          onClick={() => {
                            window.localStorage.setItem('broadcast_manual_selection', JSON.stringify({
                              source: 'admin_v2_abandoned_row',
                              tg_user_ids: [String(inv.tg_user_id)],
                              base_name: `Неоплата ${inv.tg_user_id}`,
                              suggested_title: `Дожим ${inv.tg_user_id}`,
                              suggested_message: inv.tariffs?.is_trial
                                ? 'Ты почти залетел на пробник. Если еще актуально, просто вернись в бота и закрой оплату.'
                                : 'Ты почти купил тариф, но не добил оплату. Если еще актуально, вернись и закрой платеж.'
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
