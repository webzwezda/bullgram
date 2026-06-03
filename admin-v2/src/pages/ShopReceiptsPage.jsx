import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FileText, RefreshCcw, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { apiRequest } from '../api/client.js';
import { APP_CONFIG } from '../config.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { Badge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.jsx';
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

function statusBadge(status) {
  const map = {
    awaiting_receipt: { label: 'Ждет проверки', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    paid: { label: 'Подтверждено', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
    completed: { label: 'Закрыто', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
    rejected: { label: 'Отклонено', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
    failed: { label: 'Ошибка', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
    pending: { label: 'Ждет оплату', cls: 'bg-slate-100 text-slate-600 border-slate-200' }
  };
  const entry = map[status] || { label: status || '—', cls: 'bg-slate-100 text-slate-600 border-slate-200' };
  return <Badge variant="outline" className={entry.cls}>{entry.label}</Badge>;
}

function bankEventBadge(status) {
  if (status === 'confirmed') return <Badge variant="outline" className="bg-emerald-100 text-emerald-800 border-emerald-200">Подтверждено</Badge>;
  if (status === 'ignored') return <Badge variant="outline" className="bg-slate-100 text-slate-600 border-slate-200">Скрыто</Badge>;
  return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">{status}</Badge>;
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
    purchases: [],
    bankEvents: []
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

  const reconciliationStats = useMemo(() => {
    const unresolvedBankEvents = state.bankEvents.filter((event) =>
      ['matched', 'ambiguous', 'unmatched', 'auto_confirm_failed'].includes(event.status)
    ).length;
    const confirmedBankEvents = state.bankEvents.filter((event) => event.status === 'confirmed').length;
    return {
      awaiting: awaitingReceipts.length,
      bankEvents: state.bankEvents.length,
      unresolvedBankEvents,
      confirmedBankEvents
    };
  }, [awaitingReceipts.length, state.bankEvents]);

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
        const [purchasesData, bankEventsData] = await Promise.all([
          apiRequest('/api/shop/seller/purchases', { accessToken }),
          apiRequest('/api/p2p-bank-events', { accessToken })
        ]);
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          refreshing: false,
          error: '',
          purchases: purchasesData.purchases || [],
          bankEvents: bankEventsData.events || []
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
      const [data, bankEventsData] = await Promise.all([
        apiRequest('/api/shop/seller/purchases', { accessToken }),
        apiRequest('/api/p2p-bank-events', { accessToken })
      ]);
      setState((prev) => ({
        ...prev,
        error: '',
        purchases: data.purchases || [],
        bankEvents: bankEventsData.events || []
      }));
      toast.success(action === 'approve' ? 'Оплата подтверждена.' : 'Оплата отклонена.');
    } catch (error) {
      setState((prev) => ({ ...prev, error: error.message }));
      toast.error(error.message);
    }
  }

  async function runBankEventAction(event, action) {
    try {
      if (action === 'ignore') {
        await apiRequest(`/api/p2p-bank-events/${event.id}/ignore`, {
          accessToken,
          method: 'POST'
        });
      }
      if (action === 'confirm') {
        await apiRequest(`/api/p2p-bank-events/${event.id}/confirm`, {
          accessToken,
          method: 'POST',
          body: {
            purchase_ids: event.candidate_purchase_ids || event.matched_purchase_ids || [],
            batch_token: event.candidate_batch_tokens?.[0] || event.matched_batch_token || null
          }
        });
      }
      const [purchasesData, bankEventsData] = await Promise.all([
        apiRequest('/api/shop/seller/purchases', { accessToken }),
        apiRequest('/api/p2p-bank-events', { accessToken })
      ]);
      setState((prev) => ({
        ...prev,
        error: '',
        purchases: purchasesData.purchases || [],
        bankEvents: bankEventsData.events || []
      }));
      toast.success(action === 'confirm' ? 'Банковское уведомление подтверждено.' : 'Банковское уведомление скрыто.');
    } catch (error) {
      setState((prev) => ({ ...prev, error: error.message }));
      toast.error(error.message);
    }
  }

  function renderReceiptLinks(purchase) {
    const receiptEntries = Array.isArray(purchase.payload?.receipt_entries) ? purchase.payload.receipt_entries : [];
    if (!receiptEntries.length && !purchase.payload?.receipt_file_url) {
      return <span className="text-xs text-slate-400">—</span>;
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
      <div className="space-y-1">
        {fallbackEntries.map((entry, index) => (
          <div key={`${entry.purchase_id || purchase.id}-${index}`} className="text-xs text-slate-500">
            {entry.receipt_file_url ? (
              <a href={resolveBackendAssetUrl(entry.receipt_file_url)} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                {fallbackEntries.length > 1 ? `Чек ${index + 1}` : 'Открыть чек'}
              </a>
            ) : <span className="text-slate-400">Файл не приложен</span>}
            {entry.receipt_note ? ` · ${entry.receipt_note}` : ''}
          </div>
        ))}
      </div>
    );
  }

  if (state.loading) {
    return <LoadingState text="Грузим сверку оплат..." />;
  }

  return (
    <section className="page">
      {state.error ? <div className="error-card" style={{ marginTop: 20 }}>{state.error}</div> : null}

      <div className="space-y-6">
        {/* Stats */}
        <Card className="border-slate-200/70 bg-white shadow-sm">
          <CardHeader className="px-6 pt-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20 shrink-0">
                <FileText className="w-6 h-6" />
              </div>
              <div>
                <CardTitle className="text-lg font-bold tracking-tight text-slate-900">Сверка оплат</CardTitle>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
                  Банковские уведомления и оплаты, которые BullRun не закрыл автоматически. Чек помогает, но не обязателен.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
              <div className={`rounded-xl border p-3 ${reconciliationStats.awaiting > 0 ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
                <div className="text-xs font-semibold text-slate-400">Ждут решения</div>
                <div className={`mt-1 text-xl font-bold ${reconciliationStats.awaiting > 0 ? 'text-amber-700' : 'text-slate-900'}`}>{reconciliationStats.awaiting}</div>
                <div className="mt-0.5 text-xs text-slate-500">Покупатель нажал «Я оплатил»</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-400">Уведомления банка</div>
                <div className="mt-1 text-xl font-bold text-slate-900">{reconciliationStats.bankEvents}</div>
                <div className="mt-0.5 text-xs text-slate-500">SMS/Push Forward события</div>
              </div>
              <div className={`rounded-xl border p-3 ${reconciliationStats.unresolvedBankEvents > 0 ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-slate-50'}`}>
                <div className="text-xs font-semibold text-slate-400">Спорные события</div>
                <div className={`mt-1 text-xl font-bold ${reconciliationStats.unresolvedBankEvents > 0 ? 'text-rose-700' : 'text-slate-900'}`}>{reconciliationStats.unresolvedBankEvents}</div>
                <div className="mt-0.5 text-xs text-slate-500">Нужна ручная проверка</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-400">Закрыто банком</div>
                <div className="mt-1 text-xl font-bold text-slate-900">{reconciliationStats.confirmedBankEvents}</div>
                <div className="mt-0.5 text-xs text-slate-500">Подтвержденные события</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Bank events */}
        <Card className="border-slate-200/70 bg-white shadow-sm">
          <CardHeader className="px-6 pt-6">
            <CardTitle className="text-lg font-bold tracking-tight text-slate-900">Входящие уведомления банка</CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            {!state.bankEvents.length ? (
              <p className="text-sm text-slate-500">Пока банк не присылал уведомления через SMS/Push Forward.</p>
            ) : (
              <div className="overflow-x-auto -mx-6 px-6">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Дата</th>
                      <th className="py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Сумма</th>
                      <th className="py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Статус</th>
                      <th className="py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Текст</th>
                      <th className="py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Кандидаты</th>
                      <th className="py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-400">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.bankEvents.slice(0, 30).map((event) => {
                      const candidateCount = (event.candidate_purchase_ids || event.matched_purchase_ids || []).length;
                      const canConfirm = ['matched', 'auto_confirm_failed'].includes(event.status) && candidateCount > 0;
                      return (
                        <tr key={event.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                          <td className="py-3 pr-4 text-slate-700">{formatWhen(event.received_at)}</td>
                          <td className="py-3 pr-4 font-medium text-slate-900">{event.amount_rub ? `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(event.amount_rub)} RUB` : '—'}</td>
                          <td className="py-3 pr-4">{bankEventBadge(event.status)}</td>
                          <td className="py-3 pr-4">
                            <div className="text-xs text-slate-500 max-w-xs truncate">{event.redacted_text || event.raw_text || '—'}</div>
                            {event.match_reason ? <div className="text-xs text-slate-400 mt-0.5">{event.match_reason}</div> : null}
                          </td>
                          <td className="py-3 pr-4 text-slate-700">{candidateCount || '—'}</td>
                          <td className="py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {canConfirm ? (
                                <Button variant="ghost" size="sm" className="h-8 px-2 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50" type="button" onClick={() => runBankEventAction(event, 'confirm')} title="Подтвердить">
                                  <CheckCircle2 className="h-4 w-4" />
                                </Button>
                              ) : null}
                              {!['ignored', 'confirmed'].includes(event.status) ? (
                                <Button variant="ghost" size="sm" className="h-8 px-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100" type="button" onClick={() => runBankEventAction(event, 'ignore')} title="Скрыть">
                                  <XCircle className="h-4 w-4" />
                                </Button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Awaiting receipts */}
        <Card className="border-slate-200/70 bg-white shadow-sm">
          <CardHeader className="px-6 pt-6">
            <CardTitle className="text-lg font-bold tracking-tight text-slate-900">Оплаты ждут решения</CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            {!awaitingReceipts.length ? (
              <p className="text-sm text-slate-500">Сейчас нет оплат, которые нужно вручную подтвердить.</p>
            ) : (
              <div className="space-y-4">
                {awaitingReceipts.map((purchase) => (
                  <div key={purchase.id} className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium text-slate-900">{purchase.item?.title || 'Лот'}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          owner {purchase.buyer_owner_id} · {purchase.payload?.sbp_bank || 'СБП'} · {formatAmount(purchase)}{purchase.purchase_ids?.length > 1 ? ` · ${purchase.purchase_ids.length} счета` : ''}
                        </div>
                        <div className="mt-1 text-xs text-slate-400">
                          Отмечена: {formatWhen(purchase.payload?.receipt_marked_at || purchase.updated_at)}
                        </div>
                      </div>
                      <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 shrink-0">
                        {purchase.purchase_ids?.length > 1 ? 'Оплата отмечена' : 'Ждет проверки'}
                      </Badge>
                    </div>
                    <div className="mt-3">
                      {renderReceiptLinks(purchase)}
                    </div>
                    <div className="flex gap-2 mt-3">
                      <Button size="sm" className="h-8 rounded-lg" type="button" onClick={() => runAction(purchase, 'approve')}>
                        <CheckCircle2 className="h-4 w-4" /> Подтвердить
                      </Button>
                      <Button variant="outline" size="sm" className="h-8 rounded-lg text-rose-600 hover:text-rose-700 hover:bg-rose-50" type="button" onClick={() => runAction(purchase, 'reject')}>
                        <XCircle className="h-4 w-4" /> Отклонить
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent receipts */}
        <Card className="border-slate-200/70 bg-white shadow-sm">
          <CardHeader className="px-6 pt-6">
            <CardTitle className="text-lg font-bold tracking-tight text-slate-900">Последние проверки</CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            {!recentReceipts.length ? (
              <p className="text-sm text-slate-500">Пока тут пусто.</p>
            ) : (
              <div className="overflow-x-auto -mx-6 px-6">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Лот</th>
                      <th className="py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Покупатель</th>
                      <th className="py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Сумма</th>
                      <th className="py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Статус</th>
                      <th className="py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Чек</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentReceipts.slice(0, 30).map((purchase) => (
                      <tr key={purchase.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                        <td className="py-3 pr-4">
                          <div className="font-medium text-slate-900">{purchase.item?.title || 'Лот'}</div>
                          <div className="text-xs text-slate-400">{purchase.item?.item_type || 'shop item'}{purchase.purchase_ids?.length > 1 ? ` · x${purchase.purchase_ids.length}` : ''}</div>
                        </td>
                        <td className="py-3 pr-4">
                          <div className="text-slate-700">owner {purchase.buyer_owner_id}</div>
                          <div className="text-xs text-slate-400">{formatWhen(purchase.created_at)}</div>
                        </td>
                        <td className="py-3 pr-4 font-medium text-slate-900">{formatAmount(purchase)}</td>
                        <td className="py-3 pr-4">{statusBadge(purchase.status)}</td>
                        <td className="py-3">{renderReceiptLinks(purchase)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
