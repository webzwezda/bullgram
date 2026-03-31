import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api/client.js';
import { APP_CONFIG } from '../config.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';

function formatWhen(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function formatAmount(purchase) {
  if ((purchase.payload?.payment_method || '') === 'p2p') {
    return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(purchase.payload?.amount_rub || purchase.amount_rub || 0))} RUB`;
  }
  return `${Number(purchase.amount_ton || 0).toFixed(4)} TON`;
}

function resolveBackendAssetUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  if (url.startsWith('/')) return `${APP_CONFIG.backendUrl}${url}`;
  return `${APP_CONFIG.backendUrl}/${url}`;
}

function purchaseBadge(status) {
  if (status === 'awaiting_receipt') return 'pill pill--warning';
  if (status === 'paid' || status === 'completed') return 'pill pill--ok';
  if (status === 'rejected' || status === 'failed') return 'pill pill--danger';
  return 'pill';
}

function purchaseStatusText(status) {
  if (status === 'awaiting_receipt') return 'Ждет проверки';
  if (status === 'paid') return 'Оплата подтверждена';
  if (status === 'completed') return 'Закрыто';
  if (status === 'rejected') return 'Отклонено';
  if (status === 'failed') return 'Ошибка handoff';
  if (status === 'pending') return 'Ждет оплату';
  return status || '—';
}

function normalizeReceiptGroup(rows = []) {
  if (!rows.length) return null;
  const first = rows[0];
  const receiptEntries = rows
    .map((purchase) => ({
      purchase_id: purchase.id,
      receipt_note: purchase.payload?.receipt_note || '',
      receipt_file_url: purchase.payload?.receipt_file_url || '',
      receipt_marked_at: purchase.payload?.receipt_marked_at || purchase.updated_at || null
    }))
    .filter((entry) => entry.receipt_note || entry.receipt_file_url);
  const status = rows.some((purchase) => purchase.status === 'awaiting_receipt')
    ? 'awaiting_receipt'
    : rows.some((purchase) => purchase.ownership_transfer_status === 'failed')
      ? 'failed'
      : rows.some((purchase) => purchase.status === 'rejected')
        ? 'rejected'
        : rows.every((purchase) => purchase.ownership_transfer_status === 'completed')
            ? 'completed'
            : rows.some((purchase) => purchase.status === 'paid')
              ? 'paid'
              : first.status;

  return {
    ...first,
    id: first.payload?.batch_token || first.id,
    purchase_ids: rows.map((purchase) => purchase.id),
    status,
    amount_ton: rows.reduce((sum, purchase) => sum + Number(purchase.amount_ton || 0), 0),
    amount_rub: rows.reduce((sum, purchase) => sum + Number(purchase.payload?.amount_rub || purchase.amount_rub || 0), 0),
    payload: {
      ...(first.payload || {}),
      amount_rub: rows.reduce((sum, purchase) => sum + Number(purchase.payload?.amount_rub || purchase.amount_rub || 0), 0),
      receipt_marked_at: rows.find((purchase) => purchase.payload?.receipt_marked_at)?.payload?.receipt_marked_at || first.payload?.receipt_marked_at || null,
      receipt_note: rows.find((purchase) => purchase.payload?.receipt_note)?.payload?.receipt_note || first.payload?.receipt_note || null,
      receipt_file_url: rows.find((purchase) => purchase.payload?.receipt_file_url)?.payload?.receipt_file_url || first.payload?.receipt_file_url || null,
      receipt_entries: receiptEntries
    },
    item: {
      ...(first.item || {}),
      title: rows.length > 1 ? `${first.item?.title || 'Лот'} x${rows.length}` : (first.item?.title || 'Лот')
    },
    batch: rows.length > 1 || !!first.payload?.batch_token
  };
}

export function ShopReceiptsPage() {
  const { accessToken } = useAuth();
  const [state, setState] = useState({
    loading: true,
    refreshing: false,
    error: '',
    purchases: []
  });

  const groupedPurchases = useMemo(() => {
    const buckets = new Map();
    for (const purchase of state.purchases) {
      const key = purchase.payload?.batch_token || purchase.id;
      const bucket = buckets.get(key) || [];
      bucket.push(purchase);
      buckets.set(key, bucket);
    }
    return Array.from(buckets.values()).map((rows) => normalizeReceiptGroup(rows)).filter(Boolean);
  }, [state.purchases]);

  const awaitingReceipts = useMemo(
    () => groupedPurchases.filter((purchase) => purchase.status === 'awaiting_receipt'),
    [groupedPurchases]
  );

  const recentReceipts = useMemo(
    () => groupedPurchases.filter((purchase) => ['awaiting_receipt', 'paid', 'completed', 'rejected', 'failed'].includes(purchase.status)),
    [groupedPurchases]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadPage({ silent = false } = {}) {
      if (!accessToken) return;
      if (!silent) {
        setState((prev) => ({
          ...prev,
          loading: !prev.purchases.length,
          refreshing: !!prev.purchases.length,
          error: ''
        }));
      }

      try {
        const data = await apiRequest('/api/shop/seller/purchases', { accessToken });
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          refreshing: false,
          error: '',
          purchases: data.purchases || []
        }));
      } catch (error) {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          refreshing: false,
          error: error.message
        }));
      }
    }

    loadPage();
    const intervalId = window.setInterval(() => loadPage({ silent: true }), 30000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [accessToken]);

  async function runAction(target, action) {
    const purchaseIds = Array.isArray(target?.purchase_ids) && target.purchase_ids.length
      ? target.purchase_ids
      : [target?.id || target].filter(Boolean);
    try {
      if (purchaseIds.length > 1) {
        const batchAction = action === 'approve' ? 'approve-batch' : 'reject-batch';
        await apiRequest(`/api/shop/seller/purchases/${batchAction}`, {
          accessToken,
          method: 'POST',
          body: { purchase_ids: purchaseIds }
        });
      } else {
        await apiRequest(`/api/shop/seller/purchases/${purchaseIds[0]}/${action}`, {
          accessToken,
          method: 'POST'
        });
      }
      const data = await apiRequest('/api/shop/seller/purchases', { accessToken });
      setState((prev) => ({
        ...prev,
        error: '',
        purchases: data.purchases || []
      }));
    } catch (error) {
      setState((prev) => ({ ...prev, error: error.message }));
    }
  }

  function renderReceiptLinks(purchase) {
    const receiptEntries = Array.isArray(purchase.payload?.receipt_entries) ? purchase.payload.receipt_entries : [];
    if (!receiptEntries.length && !purchase.payload?.receipt_file_url) {
      return '—';
    }

    const fallbackEntries = receiptEntries.length
      ? receiptEntries
      : [{
          purchase_id: purchase.id,
          receipt_file_url: purchase.payload?.receipt_file_url || '',
          receipt_note: purchase.payload?.receipt_note || '',
          receipt_marked_at: purchase.payload?.receipt_marked_at || purchase.updated_at || null
        }];

    return (
      <div className="list-stack" style={{ gap: 8 }}>
        {fallbackEntries.map((entry, index) => (
          <div key={`${entry.purchase_id || purchase.id}-${index}`} className="table-subtext">
            {entry.receipt_file_url ? (
              <a href={resolveBackendAssetUrl(entry.receipt_file_url)} target="_blank" rel="noreferrer">
                {fallbackEntries.length > 1 ? `Открыть чек ${index + 1}` : 'Открыть чек'}
              </a>
            ) : 'Файл не приложен'}
            {entry.receipt_note ? ` • ${entry.receipt_note}` : ''}
          </div>
        ))}
      </div>
    );
  }

  if (state.loading) {
    return <LoadingState text="Грузим чеки..." />;
  }

  return (
    <div className="page-stack">
      <section className="table-card">
        <div className="table-card__title">Проверка чеков</div>
        <div className="table-subtext">Сюда падают СБП-оплаты, которые покупатель уже отметил и к которым приложил чек.</div>
        {state.error ? <div className="error-inline" style={{ marginTop: 12 }}>{state.error}</div> : null}
      </section>

      <section className="table-card">
        <div className="table-card__title">Ждут решения</div>
        {!awaitingReceipts.length ? (
          <div className="empty-inline">Сейчас нет чеков, которые нужно вручную подтвердить.</div>
        ) : (
          <div className="list-stack">
            {awaitingReceipts.map((purchase) => (
              <div key={purchase.id} className="list-item">
                <div className="list-item__head">
                  <div>
                    <div className="list-item__title">{purchase.item?.title || 'Лот'}</div>
                    <div className="list-item__meta">
                      owner {purchase.buyer_owner_id} • {purchase.payload?.sbp_bank || 'СБП'} • {formatAmount(purchase)}{purchase.purchase_ids?.length > 1 ? ` • ${purchase.purchase_ids.length} счета` : ''}
                    </div>
                  </div>
                  <span className={purchaseBadge(purchase.status)}>{purchase.purchase_ids?.length > 1 && purchase.status === 'awaiting_receipt' ? 'Чеки отправлены' : purchaseStatusText(purchase.status)}</span>
                </div>
                <div className="table-subtext" style={{ marginTop: 8 }}>
                  Отправлен: {formatWhen(purchase.payload?.receipt_marked_at || purchase.updated_at)}
                </div>
                <div style={{ marginTop: 8 }}>
                  {renderReceiptLinks(purchase)}
                </div>
                <div className="table-actions" style={{ marginTop: 12, flexWrap: 'wrap' }}>
                  <button className="inline-action" onClick={() => runAction(purchase, 'approve')}>Подтвердить оплату</button>
                  <button className="inline-action" onClick={() => runAction(purchase, 'reject')}>Отклонить</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="table-card">
        <div className="table-card__title">Последние проверки</div>
        {!recentReceipts.length ? (
          <div className="empty-inline">Пока тут пусто.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Лот</th>
                <th>Покупатель</th>
                <th>Сумма</th>
                <th>Статус</th>
                <th>Чек</th>
              </tr>
            </thead>
            <tbody>
              {recentReceipts.slice(0, 30).map((purchase) => (
                <tr key={purchase.id}>
                  <td>
                    <div>{purchase.item?.title || 'Лот'}</div>
                    <div className="table-subtext">{purchase.item?.item_type || 'shop item'}{purchase.purchase_ids?.length > 1 ? ` • x${purchase.purchase_ids.length}` : ''}</div>
                  </td>
                  <td>
                    <div>owner {purchase.buyer_owner_id}</div>
                    <div className="table-subtext">{formatWhen(purchase.created_at)}</div>
                  </td>
                  <td>{formatAmount(purchase)}</td>
                  <td>
                    <span className={purchaseBadge(purchase.status)}>{purchaseStatusText(purchase.status)}</span>
                  </td>
                  <td>
                    {renderReceiptLinks(purchase)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
