import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';
import { StatCard } from '../ui/StatCard.jsx';

function formatTon(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return '0 TON';
  return `${amount.toLocaleString('ru-RU', { maximumFractionDigits: 6 })} TON`;
}

function formatWhen(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function withdrawalStatusLabel(status) {
  if (status === 'queued') return 'В очереди';
  if (status === 'sending') return 'Отправляется';
  if (status === 'sent') return 'Отправлена';
  if (status === 'confirmed') return 'Подтверждена';
  if (status === 'failed') return 'Ошибка';
  if (status === 'cancelled') return 'Отменена';
  return 'Запрошена';
}

function withdrawalStatusClass(status) {
  if (status === 'confirmed' || status === 'sent') return 'pill pill--ok';
  if (status === 'failed') return 'pill pill--danger';
  if (status === 'cancelled') return 'pill pill--warning';
  return 'pill pill--info';
}

export function ProjectTreasuryPage() {
  const { accessToken, profileRole } = useAuth();
  const [state, setState] = useState({
    loading: true,
    refreshing: false,
    submitting: false,
    error: '',
    data: null
  });
  const [form, setForm] = useState({
    to_wallet: '',
    amount_ton: '',
    note: ''
  });

  const availableTon = Number(state.data?.summary?.availableToWithdrawTon || 0);
  const requestedAmountTon = Number(form.amount_ton || 0);
  const feeTon = 0.05;
  const afterWithdrawalTon = useMemo(() => (
    Math.max(0, availableTon - requestedAmountTon - feeTon)
  ), [availableTon, requestedAmountTon]);

  async function loadTreasury({ refreshing = false } = {}) {
    if (!accessToken) return;
    setState((prev) => ({ ...prev, loading: !refreshing, refreshing, error: '' }));

    try {
      const data = await apiRequest('/api/project-admin/treasury', { accessToken });
      setState({
        loading: false,
        refreshing: false,
        submitting: false,
        error: '',
        data
      });
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        refreshing: false,
        submitting: false,
        error: error.message
      }));
    }
  }

  useEffect(() => {
    loadTreasury();
  }, [accessToken]);

  async function requestWithdrawal(event) {
    event.preventDefault();
    setState((prev) => ({ ...prev, submitting: true, error: '' }));

    try {
      const data = await apiRequest('/api/project-admin/treasury/withdrawals', {
        accessToken,
        method: 'POST',
        body: {
          to_wallet: form.to_wallet,
          amount_ton: Number(form.amount_ton || 0),
          network_fee_ton: feeTon,
          note: form.note
        }
      });
      setState({
        loading: false,
        refreshing: false,
        submitting: false,
        error: '',
        data: data.treasury || state.data
      });
      setForm((prev) => ({ ...prev, amount_ton: '', note: '' }));
    } catch (error) {
      setState((prev) => ({ ...prev, submitting: false, error: error.message }));
    }
  }

  if (profileRole !== 'admin') {
    return (
      <div className="page">
        <div className="empty-state">
          <h2>Доступ закрыт</h2>
          <p>Казна проекта доступна только пользователю с ролью admin.</p>
        </div>
      </div>
    );
  }

  if (state.loading) {
    return <LoadingState text="Считаем деньги проекта..." />;
  }

  const summary = state.data?.summary || {};
  const buckets = state.data?.buckets || {};
  const counters = state.data?.counters || {};
  const withdrawals = state.data?.withdrawals || [];

  return (
    <div className="page project-treasury">
      <div className="page__header">
        <div>
          <div className="eyebrow">Project Admin</div>
          <h1>Казна BullRun</h1>
          <p>Сколько сайт заработал, что зарезервировано, и сколько можно запросить на вывод.</p>
        </div>
        <button className="inline-action" onClick={() => loadTreasury({ refreshing: true })} disabled={state.refreshing}>
          {state.refreshing ? 'Обновляем...' : 'Обновить'}
        </button>
      </div>

      {state.error ? (
        <div className="error-card">
          <strong>Ошибка</strong>
          <p>{state.error}</p>
        </div>
      ) : null}

      <div className="grid">
        <StatCard title="Сайт заработал" value={formatTon(summary.grossRevenueTon)} hint="Shop продажи admin-инвентаря + BullRun fee 1%." tone="ok" />
        <StatCard title="Можно вывести" value={formatTon(summary.availableToWithdrawTon)} hint="Расчетная сумма после pending выводов." tone={availableTon > 0 ? 'ok' : 'default'} />
        <StatCard title="Защищено" value={formatTon(summary.protectedLiabilityTon)} hint="Партнеры, резервы админов и network fee." tone="warning" />
        <StatCard title="Заявки на вывод" value={formatTon(summary.pendingWithdrawalsTon)} hint="Запрошено, но еще не закрыто." />
      </div>

      <div className="table-card project-treasury__notice">
        <div className="table-card__title">Правило вывода</div>
        <p>
          Не выводим весь баланс кошелька. Сначала вычитаем деньги партнеров, резервы админов,
          seller liabilities, pending оплаты и комиссии сети. Эта страница уже считает по этому правилу,
          но автоматическая отправка TON будет отдельным шагом после treasury wallet sender.
        </p>
        <span className="pill pill--warning">Статус сверки: {summary.reconciliationStatus || 'estimated'}</span>
      </div>

      <div className="grid grid--double">
        <div className="table-card">
          <div className="table-card__title">Bucket'ы денег</div>
          <div className="project-treasury__buckets">
            <div><span>Platform revenue</span><strong>{formatTon(buckets.platformRevenueTon)}</strong></div>
            <div><span>Shop revenue</span><strong>{formatTon(buckets.shopRevenueTon)}</strong></div>
            <div><span>BullRun fee 1%</span><strong>{formatTon(buckets.referralFeeTon)}</strong></div>
            <div><span>Partner liability</span><strong>{formatTon(buckets.partnerLiabilityTon)}</strong></div>
            <div><span>Admin reserve liability</span><strong>{formatTon(buckets.adminReserveLiabilityTon)}</strong></div>
            <div><span>Network fee reserve</span><strong>{formatTon(buckets.networkFeeReserveTon)}</strong></div>
            <div><span>Pending payments</span><strong>{formatTon(buckets.pendingPaymentTon)}</strong></div>
          </div>
          <div className="table-subtext" style={{ marginTop: 12 }}>
            Admin sellers: {counters.adminOwners || 0} • Paid shop purchases: {counters.paidShopPurchases || 0} • Pending: {counters.pendingShopPurchases || 0}
          </div>
        </div>

        <form className="table-card project-treasury__form" onSubmit={requestWithdrawal}>
          <div className="table-card__title">Запросить вывод</div>
          <label className="project-treasury__field">
            <span>TON-кошелек</span>
            <input
              className="field"
              value={form.to_wallet}
              onChange={(event) => setForm((prev) => ({ ...prev, to_wallet: event.target.value }))}
              placeholder="UQ... или 0:..."
            />
          </label>
          <label className="project-treasury__field">
            <span>Сумма</span>
            <input
              className="field"
              type="number"
              min="0"
              step="0.000001"
              value={form.amount_ton}
              onChange={(event) => setForm((prev) => ({ ...prev, amount_ton: event.target.value }))}
              placeholder="0"
            />
          </label>
          <label className="project-treasury__field">
            <span>Заметка</span>
            <textarea
              className="field"
              value={form.note}
              onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))}
              placeholder="Куда и зачем выводим"
              rows={3}
            />
          </label>
          <div className="project-treasury__withdraw-preview">
            <span>Комиссия сети: {formatTon(feeTon)}</span>
            <span>Останется: {formatTon(afterWithdrawalTon)}</span>
          </div>
          <button className="button button--primary" type="submit" disabled={state.submitting || availableTon <= 0}>
            {state.submitting ? 'Создаем...' : 'Создать заявку'}
          </button>
        </form>
      </div>

      <div className="table-card">
        <div className="table-card__title">Последние заявки на вывод</div>
        {withdrawals.length === 0 ? (
          <div className="empty-inline">Заявок на вывод пока нет.</div>
        ) : (
          <div className="responsive-table">
            <table>
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Сумма</th>
                  <th>Кошелек</th>
                  <th>Статус</th>
                  <th>Tx</th>
                </tr>
              </thead>
              <tbody>
                {withdrawals.map((row) => (
                  <tr key={row.id}>
                    <td>{formatWhen(row.requested_at)}</td>
                    <td>{formatTon(row.amount_ton)}</td>
                    <td><span className="project-treasury__wallet">{row.to_wallet}</span></td>
                    <td><span className={withdrawalStatusClass(row.status)}>{withdrawalStatusLabel(row.status)}</span></td>
                    <td>{row.chain_tx_hash || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
