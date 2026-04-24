import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';
import { StatCard } from '../ui/StatCard.jsx';

function formatWhen(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function formatMoney(value, currency) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return `0 ${currency || ''}`.trim();
  return `${amount.toLocaleString('ru-RU', { maximumFractionDigits: currency === 'RUB' ? 2 : 6 })} ${currency || ''}`.trim();
}

function invoiceBadge(status) {
  if (status === 'paid') return 'pill pill--ok';
  if (status === 'awaiting_receipt' || status === 'wait_admin') return 'pill pill--warning';
  if (status === 'rejected') return 'pill pill--danger';
  return 'pill';
}

function customerBasePaymentBadge(status) {
  if (status === 'active_paid') return 'pill pill--ok';
  if (status === 'expired_paid' || status === 'unpaid_lead') return 'pill pill--warning';
  if (status === 'expired_paid_inside' || status === 'free_rider') return 'pill pill--danger';
  return 'pill';
}

function accessEventBadge(type) {
  if (type === 'join_approved') return 'pill pill--ok';
  if (type === 'join_declined' || type === 'kicked') return 'pill pill--danger';
  if (type === 'join_requested' || type === 'invite_issued') return 'pill pill--warning';
  return 'pill';
}

function paymentStatusText(value) {
  const map = {
    active_paid: 'Платит и живой',
    expired_paid: 'Платил, но сгорел',
    expired_paid_inside: 'Сгорел, но сидит',
    unpaid_lead: 'Жал, но не оплатил',
    free_rider: 'Сидит зайцем'
  };
  return map[value] || 'Пока непонятно';
}

function referralStatusText(value) {
  const map = {
    none: 'Не привязан',
    partner: 'Сам партнер',
    referred: 'Пришел по рефке',
    both: 'И партнер, и реф-клиент'
  };
  return map[value] || 'Пока непонятно';
}

export function ClientDossierPage() {
  const { accessToken } = useAuth();
  const [lookup, setLookup] = useState('');
  const [tgUserId, setTgUserId] = useState('');
  const [state, setState] = useState({
    loading: false,
    error: '',
    summary: null,
    orders: [],
    subscriptions: [],
    invites: [],
    accessEvents: [],
    paymentEvents: [],
    baseMemberships: [],
    updatedAt: null
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tg = params.get('tg');
    if (tg) {
      setLookup(String(tg));
      setTgUserId(String(tg));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadDossier() {
      if (!tgUserId || !accessToken) return;
      setState((prev) => ({ ...prev, loading: true, error: '' }));

      try {
        const data = await apiRequest(`/api/client-dossier/${encodeURIComponent(tgUserId)}`, { accessToken });
        if (!cancelled) {
          setState({
            loading: false,
            error: '',
            summary: data.summary || null,
            orders: data.orders || [],
            subscriptions: data.subscriptions || [],
            invites: data.invites || [],
            accessEvents: data.accessEvents || [],
            paymentEvents: data.paymentEvents || [],
            baseMemberships: data.baseMemberships || [],
            updatedAt: new Date().toISOString()
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            loading: false,
            error: error.message,
            summary: null,
            orders: [],
            subscriptions: [],
            invites: [],
            accessEvents: [],
            paymentEvents: [],
            baseMemberships: [],
            updatedAt: null
          });
        }
      }
    }

    loadDossier();
    return () => {
      cancelled = true;
    };
  }, [accessToken, tgUserId]);

  const dossierAlerts = useMemo(() => {
    if (!state.summary) return [];
    const alerts = [];
    if (state.summary.pendingJoins > 0) {
      alerts.push({
        title: 'Оплата есть, но вход висит',
        text: `У человека ${state.summary.pendingJoins} активных доступов, где он еще не зашел.`,
        className: 'error-inline'
      });
    }
    if (state.summary.paymentStatus === 'free_rider' || state.summary.paymentStatus === 'expired_paid_inside') {
      alerts.push({
        title: 'Есть мутный доступ',
        text: 'По деньгам этот человек уже не должен быть внутри, но след по доступу выглядит мутно.',
        className: 'error-inline'
      });
    }
    return alerts;
  }, [state.summary]);

  if (state.loading && !state.summary) {
    return <LoadingState text="Тянем досье клиента..." />;
  }

  return (
    <section className="page">
      <div className="page__header">
        <h1>Досье клиента</h1>
        <div className="page__meta">
          <span>Последнее обновление: {formatWhen(state.updatedAt)}</span>
          <span>{tgUserId ? `Разбираем TG ID ${tgUserId}` : 'Сначала вбей Telegram ID'}</span>
        </div>
      </div>

      <div className="toolbar-card">
        <div className="toolbar-card__title">Кого разбираем</div>
        <div className="toolbar-card__body">
          <input
            className="field"
            type="text"
            value={lookup}
            onChange={(event) => setLookup(event.target.value)}
            placeholder="Вбей Telegram ID"
          />
          <button
            className="ghost-button"
            onClick={() => {
              const next = lookup.trim();
              if (!next) return;
              setTgUserId(next);
              const url = `/app/dossier?tg=${encodeURIComponent(next)}`;
              window.history.replaceState({}, '', url);
            }}
          >
            Открыть
          </button>
        </div>
      </div>

      {state.error ? <div className="error-card">{state.error}</div> : null}

      {state.summary ? (
        <>
          <div className="grid">
            <StatCard title="Заказов" value={state.summary.totalOrders || 0} />
            <StatCard title="Оплачено" value={state.summary.paidOrders || 0} />
            <StatCard title="Живые подписки" value={state.summary.activeSubscriptions || 0} />
            <StatCard title="В общих базах" value={state.summary.baseMemberships || 0} />
          </div>

          <div className="grid grid--double">
            <div className="toolbar-card">
              <div className="toolbar-card__title">Что видно с порога</div>
              <div className="list-stack">
                <div className="list-item">
                  <div className="list-item__title">{state.summary.display_name || state.summary.username || state.summary.tg_user_id}</div>
                  <div className="list-item__meta">
                    Последний канал: {state.summary.latestChannelTitle || '—'} • Последний access-event: {state.summary.latestAccessEvent || '—'}{state.summary.latestAccessSourceLabel ? ` • Источник: ${state.summary.latestAccessSourceLabel}` : ''}
                  </div>
                </div>
                <div className="list-item">
                  <div className="list-item__title">Деньги</div>
                  <div className="list-item__meta">{paymentStatusText(state.summary.paymentStatus)}</div>
                </div>
                <div className="list-item">
                  <div className="list-item__title">Рефералка</div>
                  <div className="list-item__meta">
                    {referralStatusText(state.summary.referralRole)}
                    {state.summary.referredBy ? ` • привел TG ${state.summary.referredBy}` : ''}
                    {state.summary.referralClientDiscountPercentSnapshot ? ` • скидка ${state.summary.referralClientDiscountPercentSnapshot}%` : ''}
                    {state.summary.referralAttributionExpiresAt ? ` • до ${formatWhen(state.summary.referralAttributionExpiresAt)}` : ''}
                  </div>
                  {state.summary.referralRole === 'partner' || state.summary.referralRole === 'both' ? (
                    <div className="list-item__meta">
                      Партнерский баланс: {formatMoney(state.summary.referralBalanceTon, 'TON')} • конверсий: {state.summary.referralConversions || 0}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="toolbar-card">
              <div className="toolbar-card__title">Куда дальше пнуть</div>
              <div className="toolbar-card__body">
                <a className="ghost-button" href="/app/customers?tab=orders" target="_blank" rel="noreferrer">Заказы</a>
                <a className="ghost-button" href="/app/customers?tab=access" target="_blank" rel="noreferrer">Доступ</a>
                <a className="ghost-button" href="/app/customers?tab=customers" target="_blank" rel="noreferrer">Клиенты</a>
                <a className="ghost-button" href="/app/broadcast" target="_blank" rel="noreferrer">Рассылки</a>
                <a className="ghost-button" href="/app/referrals" target="_blank" rel="noreferrer">Рефералка</a>
              </div>
            </div>
          </div>

          {dossierAlerts.length ? (
            <div className="section">
              {dossierAlerts.map((alert) => (
                <div key={alert.title} className={alert.className}>
                  <strong>{alert.title}</strong>
                  <div>{alert.text}</div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="section table-card">
            <div className="table-card__title">Заказы и оплаты</div>
            {state.orders.length === 0 ? (
              <div className="empty-inline">Заказов по этому человеку пока не нашли.</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Тариф / канал</th>
                    <th>Счет</th>
                    <th>Оплата</th>
                    <th>Доступ</th>
                  </tr>
                </thead>
                <tbody>
                  {state.orders.slice(0, 30).map((row) => (
                    <tr key={row.invoice_id}>
                      <td>{formatWhen(row.created_at)}</td>
                      <td>
                        <div>{row.tariff_title}</div>
                        <div className="table-subtext">{row.channel_title}</div>
                        {Number(row.referral_discount_percent || 0) > 0 ? (
                          <div className="table-subtext">
                            Рефка: -{row.referral_discount_percent}% • было {formatMoney(row.referral_original_amount, row.currency)}
                          </div>
                        ) : null}
                      </td>
                      <td><span className={invoiceBadge(row.invoice_status)}>{row.invoice_status}</span></td>
                      <td>
                        <div>{row.payment_event_type || 'Нет сигнала кассы'}</div>
                        {row.access_source_label ? (
                          <div className="table-subtext">Источник доступа: {row.access_source_label}</div>
                        ) : null}
                        {Number(row.referral_reward_ton || 0) > 0 ? (
                          <div className="table-subtext">
                            Партнеру: {formatMoney(row.referral_reward_ton, 'TON')} • {row.referral_reward_status || 'ждет'}
                          </div>
                        ) : Number(row.referral_discount_percent || 0) > 0 ? (
                          <div className="table-subtext">
                            Партнер: {row.referral_referrer_tg_user_id ? `TG ${row.referral_referrer_tg_user_id}` : row.referral_code || 'по коду'}
                          </div>
                        ) : null}
                      </td>
                      <td>{row.joined ? 'Зашел' : row.access_invite_status || row.last_access_event || 'Пока мутно'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="grid grid--double section">
            <div className="table-card">
              <div className="table-card__title">Подписки и входы</div>
              {state.subscriptions.length === 0 ? (
                <div className="empty-inline">Подписок по этому человеку пока нет.</div>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Канал</th>
                      <th>Статус</th>
                      <th>Источник</th>
                      <th>Истекает</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.subscriptions.slice(0, 20).map((row) => (
                      <tr key={row.id}>
                        <td>{row.channel_title}</td>
                        <td><span className={row.status === 'active' ? 'pill pill--ok' : 'pill pill--warning'}>{row.status}</span></td>
                        <td>{row.access_source_label || '—'}</td>
                        <td>{formatWhen(row.expires_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="table-card">
              <div className="table-card__title">След в общих базах</div>
              {state.baseMemberships.length === 0 ? (
                <div className="empty-inline">В базах этого человека не нашли.</div>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>База</th>
                      <th>Деньги</th>
                      <th>Покрытие</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.baseMemberships.slice(0, 20).map((row) => (
                      <tr key={row.id}>
                        <td>{row.base_name}</td>
                        <td><span className={customerBasePaymentBadge(row.payment_status)}>{paymentStatusText(row.payment_status)}</span></td>
                        <td>{row.coverage_status || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="section table-card">
            <div className="table-card__title">События доступа</div>
            {state.accessEvents.length === 0 ? (
              <div className="empty-inline">Событий доступа по этому человеку нет.</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Когда</th>
                      <th>Канал</th>
                      <th>Событие</th>
                      <th>Источник</th>
                      <th>Нота</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.accessEvents.slice(0, 30).map((row) => (
                      <tr key={row.id}>
                        <td>{formatWhen(row.created_at)}</td>
                        <td>{row.channel_title}</td>
                        <td><span className={accessEventBadge(row.event_type)}>{row.event_type}</span></td>
                        <td>{row.access_source_label || '—'}</td>
                        <td>{row.note || '—'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : (
        <div className="empty-inline section">Сначала открой досье по конкретному Telegram ID.</div>
      )}
    </section>
  );
}
