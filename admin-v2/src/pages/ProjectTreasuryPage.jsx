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

function formatTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit'
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
  const walletSynced = summary.walletStatus === 'synced';

  return (
    <div className="page project-treasury">
      <div className="page__header">
        <div>
          <h1>Финансы проекта</h1>
          <p>Обновлено: {formatTime(summary.walletCheckedAt)}</p>
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
        <StatCard title="На кошельке" value={formatTon(summary.walletBalanceTon)} hint={walletSynced ? 'Реальный TON-баланс.' : 'Баланс недоступен.'} tone={walletSynced ? 'ok' : 'warning'} />
        <StatCard title="Можно вывести" value={formatTon(summary.availableToWithdrawTon)} hint="Лимит по кошельку и учету." tone={availableTon > 0 ? 'ok' : 'default'} />
        <StatCard title="В резерве" value={formatTon(summary.protectedLiabilityTon)} hint="Партнеры, возвраты, комиссии." tone="warning" />
        <StatCard title="Заявки" value={formatTon(summary.pendingWithdrawalsTon)} hint="Ожидают закрытия." />
      </div>

      <div className="grid grid--double">
        <div className="table-card">
          <div className="table-card__title">Деньги</div>
          <div className="project-treasury__buckets">
            <div><span>Доход сайта</span><strong>{formatTon(buckets.platformRevenueTon)}</strong></div>
            <div><span>Продажи</span><strong>{formatTon(buckets.shopRevenueTon)}</strong></div>
            <div><span>Комиссия BullRun</span><strong>{formatTon(buckets.referralFeeTon)}</strong></div>
            <div><span>Партнерам</span><strong>{formatTon(buckets.partnerLiabilityTon)}</strong></div>
            <div><span>Возвраты</span><strong>{formatTon(buckets.adminReserveLiabilityTon)}</strong></div>
            <div><span>Комиссии сети</span><strong>{formatTon(buckets.networkFeeReserveTon)}</strong></div>
            <div><span>Ожидают оплаты</span><strong>{formatTon(buckets.pendingPaymentTon)}</strong></div>
            <div><span>По учету доступно</span><strong>{formatTon(summary.accountingAvailableTon)}</strong></div>
            <div><span>По кошельку доступно</span><strong>{formatTon(summary.walletAvailableTon)}</strong></div>
          </div>
          <div className="table-subtext" style={{ marginTop: 12 }}>
            Продавцов: {counters.adminOwners || 0} • Оплачено: {counters.paidShopPurchases || 0} • В ожидании: {counters.pendingShopPurchases || 0}
          </div>
        </div>

        <form className="table-card project-treasury__form" onSubmit={requestWithdrawal}>
          <div className="table-card__title">Вывод</div>
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
              placeholder="Заметка"
              rows={3}
            />
          </label>
          <div className="project-treasury__withdraw-preview">
            <span>Комиссия сети: {formatTon(feeTon)}</span>
            <span>Останется: {formatTon(afterWithdrawalTon)}</span>
          </div>
          <button className="button button--primary" type="submit" disabled={state.submitting || availableTon <= 0 || !walletSynced}>
            {state.submitting ? 'Создаем...' : 'Запросить вывод'}
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
