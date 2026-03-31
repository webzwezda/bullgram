import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';
import { PlanBanner } from '../ui/PlanBanner.jsx';
import { StatCard } from '../ui/StatCard.jsx';
import { UpgradeCallout } from '../ui/UpgradeCallout.jsx';

function formatWhen(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function formatMoney(value, suffix = '') {
  return `${Number(value || 0)}${suffix}`;
}

function openApp(href) {
  if (!href) return;
  window.location.href = href;
}

function getLeadStatus(invoice) {
  if (invoice.reminded) {
    return { text: 'Дожим ушел', className: 'pill pill--ok' };
  }
  if (invoice.status === 'awaiting_receipt') {
    return { text: 'Ждет чек', className: 'pill pill--warning' };
  }

  const createdAt = new Date(invoice.date).getTime();
  const ageHours = (Date.now() - createdAt) / (1000 * 60 * 60);
  if (ageHours < 2) {
    return { text: 'Свежий', className: 'pill' };
  }
  if (ageHours <= 3) {
    return { text: 'В очереди', className: 'pill pill--warning' };
  }
  return { text: 'Старый неоплат', className: 'pill pill--danger' };
}

function getTariffLabel(invoice) {
  if (invoice?.is_trial) {
    return invoice.trial_label || `${invoice.tariff_title} (пробник)`;
  }
  return invoice?.tariff_title || 'Неизвестно';
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

export function AnalyticsPage() {
  const { accessToken, profilePlan, trialEndsAt } = useAuth();
  const [state, setState] = useState({
    loading: true,
    refreshing: false,
    error: '',
    data: null,
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
    let cancelled = false;

    async function loadAnalytics({ silent = false } = {}) {
      if (!silent) {
        setState((prev) => ({
          ...prev,
          loading: !prev.data,
          refreshing: !!prev.data,
          error: ''
        }));
      }

      try {
        const data = await apiRequest('/api/analytics', { accessToken });
        if (!cancelled) {
          setState({
            loading: false,
            refreshing: false,
            error: '',
            data,
            updatedAt: new Date().toISOString()
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            loading: false,
            refreshing: false,
            error: error.message,
            data: null,
            updatedAt: null
          });
        }
      }
    }

    if (accessToken) {
      loadAnalytics();
    }

    const intervalId = accessToken
      ? window.setInterval(() => {
          loadAnalytics({ silent: true });
        }, 60_000)
      : null;

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [accessToken]);

  const stats = state.data || {};

  const focusItems = useMemo(() => {
    const items = [];

    if ((stats.pendingInvoicesCount || 0) > 0) {
      items.push({
        id: 'unpaid_leads',
        title: 'Деньги лежат в неоплатах',
        text: `Сейчас висит ${stats.pendingInvoicesCount} неоплат. Иди в брошенные корзины или в рассылки и добивай тех, кто почти занес.`,
        action: 'Открыть дожим',
        run() {
          window.localStorage.setItem('abandoned_filter_preset', JSON.stringify({ filter: 'queued' }));
          openApp('/app/abandoned');
        }
      });
    }

    if ((stats.trialExpiringCount || 0) > 0) {
      items.push({
        id: 'trial_expiring',
        title: 'Пробники вот-вот сгорят',
        text: `Сейчас ${stats.trialExpiringCount} пробников скоро закончатся. Это лучший момент дожать их в основной тариф.`,
        action: 'Открыть удержание',
        run() {
          window.localStorage.setItem('retention_filter_preset', JSON.stringify({ retentionFilter: 'expiring' }));
          openApp('/app/retention');
        }
      });
    }

    if ((stats.paidNotJoinedCount || 0) > 0) {
      items.push({
        id: 'paid_not_joined',
        title: 'Оплатили, но не зашли',
        text: `Сейчас ${stats.paidNotJoinedCount} человек оплатили, но так и не вошли. Разбирай доступ и дожим.`,
        action: 'Открыть доступ',
        run() {
          openApp('/app/access');
        }
      });
    }

    if ((stats.expiredButStillInsideCount || 0) > 0) {
      items.push({
        id: 'expired_inside',
        title: 'Просрочка висит внутри',
        text: `Есть ${stats.expiredButStillInsideCount} просроченных, которые могли остаться внутри. Это хвост на удержание и auto-kick.`,
        action: 'Открыть удержание',
        run() {
          window.localStorage.setItem('retention_filter_preset', JSON.stringify({ retentionFilter: 'expiring' }));
          openApp('/app/retention');
        }
      });
    }

    if (items.length === 0) {
      items.push({
        id: 'all_good',
        title: 'Сейчас цифры выглядят ровно',
        text: 'Явной жопы по цифрам не видно. Значит можно смотреть рост: трафик, тарифы и повторные продажи.',
        action: 'Открыть shop admin',
        run() {
          window.location.href = '/app/shop';
        }
      });
    }

    return items.slice(0, 4);
  }, [stats]);

  const prioritySignals = useMemo(() => ([
    {
      title: 'Выручка TON',
      value: formatMoney(stats.revenueTON, ' TON'),
      tone: Number(stats.revenueTON || 0) > 0 ? 'ok' : 'default',
      hint: `MRR TON: ${formatMoney(stats.mrrTON, ' TON')}`
    },
    {
      title: 'Неоплаты',
      value: stats.pendingInvoicesCount || 0,
      tone: (stats.pendingInvoicesCount || 0) > 0 ? 'warning' : 'ok',
      hint: `Ждут чек: ${stats.awaitingReceiptCount || 0}`
    },
    {
      title: 'Оплатили, но не зашли',
      value: stats.paidNotJoinedCount || 0,
      tone: (stats.paidNotJoinedCount || 0) > 0 ? 'warning' : 'ok',
      hint: `Конверсия входа: ${stats.joinConversion || 0}%`
    },
    {
      title: 'Просрочка внутри',
      value: stats.expiredButStillInsideCount || 0,
      tone: (stats.expiredButStillInsideCount || 0) > 0 ? 'danger' : 'ok',
      hint: `Churn: ${stats.churnRate || 0}%`
    }
  ]), [stats]);

  if (state.loading) {
    return <LoadingState text="Тянем живую аналитику..." />;
  }

  if (state.error) {
    return (
      <section className="page">
        <div className="page__header">
          <h1>Аналитика</h1>
          <p>Этот экран уже сидит на живом `/api/analytics`, но backend вернул ошибку.</p>
        </div>
        <div className="error-card">{state.error}</div>
      </section>
    );
  }

  return (
    <section className="page">
      <div className="page__header">
        <h1>Аналитика</h1>
        <p>
          Это уже не просто цифры ради цифр. Здесь видно, где деньги, где отвал, кто оплатил но не зашел,
          и какой хвост надо разбирать первым.
        </p>
        <div className="page__meta">
          <span>Последнее обновление: {formatWhen(state.updatedAt)}</span>
          <span>{state.refreshing ? 'Обновляем фон...' : 'Экран обновляется сам раз в минуту.'}</span>
          <span>Всего счетов: {stats.totalInvoices || 0}</span>
        </div>
      </div>

      {profilePlan === 'trial' ? (
        <>
          <PlanBanner
            tone="warning"
            title="Trial: аналитика уже показывает деньги, но не весь рабочий контур"
            text="На Trial цифры нужны, чтобы увидеть первый money loop: оплаты, неоплаты, пробники и доступ. Когда начинаешь реально жить по этим сигналам каждый день, это уже Normal."
          />
          <UpgradeCallout
            title={trialUpgradeUrgent ? `Trial скоро сгорит: осталось около ${trialHoursLeft} ч` : undefined}
            text={trialUpgradeUrgent
              ? 'Если аналитика уже показывает, где лежат деньги и что нужно добивать, не доводи до жесткого стопора. Переходи на Normal и закрывай эти сигналы в боевом режиме.'
              : 'Как только аналитика стала для тебя не обзором, а рабочим пультом денег, следующий шаг — Normal.'}
          />
        </>
      ) : null}

      <div className="hero-panel">
        <div className="hero-panel__body">
          <div className="hero-panel__eyebrow">Деньги и потери</div>
          <div className="hero-panel__title">Здесь видно не просто цифры, а где именно сейчас теряются деньги и какой хвост нужно разбирать первым.</div>
          <div className="hero-panel__text">
            Аналитика в новом кабинете нужна не для графиков ради графиков. Она показывает, где виснут неоплаты,
            кто уже заплатил, но не зашел, где течет доступ и какие пробники пора дожимать в основной тариф.
          </div>
          <div className="hero-panel__actions">
            <a className="hero-link" href="/app/orders">Разобрать заказы</a>
            <a className="hero-link" href="/app/access">Разобрать доступ</a>
            <a className="hero-link" href="/app/abandoned">Открыть неоплаты</a>
            <a className="hero-link" href="/app/retention">Открыть удержание</a>
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
        <StatCard title="Активные подписчики" value={stats.activeSubscribers || 0} hint="Кто прямо сейчас внутри платного контура." />
        <StatCard title="Конверсия в оплату" value={`${stats.conversion || 0}%`} hint="Сколько счетов реально доезжает до денег." />
        <StatCard title="Выручка TON" value={formatMoney(stats.revenueTON, ' TON')} hint={`MRR TON: ${formatMoney(stats.mrrTON, ' TON')}.`} tone="ok" />
        <StatCard title="Выручка RUB" value={formatMoney(stats.revenueRUB, ' ₽')} hint={`MRR RUB: ${formatMoney(stats.mrrRUB, ' ₽')}.`} tone="ok" />
        <StatCard title="Churn rate" value={`${stats.churnRate || 0}%`} hint="Сколько людей отваливается за месяц." tone={(stats.churnRate || 0) >= 20 ? 'warning' : 'default'} />
        <StatCard title="Конверсия входа" value={`${stats.joinConversion || 0}%`} hint="Сколько оплат реально превращаются во вход в группу." tone={(stats.joinConversion || 0) < 60 ? 'warning' : 'default'} />
      </div>

      <div className="grid">
        <StatCard title="Оплатили, но не зашли" value={stats.paidNotJoinedCount || 0} hint="Горячий хвост по доступу." tone={(stats.paidNotJoinedCount || 0) > 0 ? 'warning' : 'default'} />
        <StatCard title="Истекли, но хвост мутный" value={stats.expiredButStillInsideCount || 0} hint="Просрочка могла остаться внутри." tone={(stats.expiredButStillInsideCount || 0) > 0 ? 'danger' : 'default'} />
        <StatCard title="Пробники внутри" value={stats.trialActiveCount || 0} hint="Активные пробные доступы." />
        <StatCard title="Пробник скоро сгорит" value={stats.trialExpiringCount || 0} hint="Лучший момент на апселл." tone={(stats.trialExpiringCount || 0) > 0 ? 'warning' : 'default'} />
        <StatCard title="Авто-подтверждения" value={stats.autoConfirmedPayments || 0} hint="Сколько оплат закрыла автоматика." />
        <StatCard title="Ручные подтверждения" value={stats.manualConfirmedPayments || 0} hint="Сколько раз приходилось закрывать руками." />
      </div>

      <div className="section">
        <div className="section__title">Что делать прямо сейчас</div>
        <div className="grid">
          {focusItems.map((item) => (
            <div key={item.id} className="action-card">
              <div className="action-card__head">
                <div className="action-card__title">{item.title}</div>
              </div>
              <div className="action-card__hint">{item.text}</div>
              <div className="table-actions" style={{ marginTop: 14 }}>
                <button className="inline-action" onClick={item.run}>{item.action}</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid--double">
        <div className="table-card">
          <div className="table-card__title">Неоплаты и дожим</div>
          <div className="table-actions" style={{ marginBottom: 12 }}>
            <button
              className="inline-action"
              onClick={() => downloadCsv(
                `analytics-pending-${new Date().toISOString().slice(0, 10)}.csv`,
                ['invoice_id', 'date', 'tg_user_id', 'tariff', 'is_trial', 'status', 'reminded', 'amount', 'currency'],
                (stats.recentPendingInvoices || []).map((inv) => [
                  inv.id,
                  inv.date,
                  inv.tg_user_id,
                  getTariffLabel(inv),
                  inv.is_trial ? 'yes' : 'no',
                  inv.status,
                  inv.reminded ? 'yes' : 'no',
                  inv.amount,
                  inv.currency
                ])
              )}
            >
              Выгрузить хвост CSV
            </button>
            <button
              className="inline-action"
              onClick={() => {
                window.localStorage.setItem('abandoned_filter_preset', JSON.stringify({ filter: 'queued' }));
                openApp('/app/abandoned');
              }}
            >
              Открыть дожим
            </button>
          </div>
          {!(stats.recentPendingInvoices || []).length ? (
            <div className="empty-inline">Сейчас хвост неоплат пустой.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Тариф</th>
                  <th>Клиент</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {(stats.recentPendingInvoices || []).slice(0, 8).map((inv) => {
                  const leadStatus = getLeadStatus(inv);
                  return (
                    <tr key={inv.id}>
                      <td>{formatWhen(inv.date)}</td>
                      <td>{getTariffLabel(inv)}</td>
                      <td>{inv.tg_user_id}</td>
                      <td><span className={leadStatus.className}>{leadStatus.text}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="table-card">
          <div className="table-card__title">Последние оплаты</div>
          <div className="table-actions" style={{ marginBottom: 12 }}>
            <button
              className="inline-action"
              onClick={() => downloadCsv(
                `analytics-paid-${new Date().toISOString().slice(0, 10)}.csv`,
                ['invoice_id', 'date', 'tg_user_id', 'tariff', 'is_trial', 'amount', 'currency'],
                (stats.recentInvoices || []).map((inv) => [
                  inv.id,
                  inv.date,
                  inv.tg_user_id,
                  getTariffLabel(inv),
                  inv.is_trial ? 'yes' : 'no',
                  inv.amount,
                  inv.currency
                ])
              )}
            >
              Выгрузить оплаты CSV
            </button>
            <a className="inline-action" href="/app/orders" target="_blank" rel="noreferrer">
              Открыть заказы
            </a>
          </div>
          {!(stats.recentInvoices || []).length ? (
            <div className="empty-inline">Пока нет последних оплат.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Тариф</th>
                  <th>Клиент</th>
                  <th>Сумма</th>
                </tr>
              </thead>
              <tbody>
                {(stats.recentInvoices || []).slice(0, 8).map((inv) => (
                  <tr key={inv.id}>
                    <td>{formatWhen(inv.date)}</td>
                    <td>{getTariffLabel(inv)}</td>
                    <td>{inv.tg_user_id}</td>
                    <td>{inv.amount} {inv.currency}</td>
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
