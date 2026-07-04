import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { apiRequest } from '../api/client.js';

function formatWhen(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function formatTon(value) {
  return Number(value || 0).toFixed(2);
}

function formatRub(value) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(value || 0));
}

function purchaseAmountSummary(p) {
  if (p?.payload?.payment_method === 'p2p') {
    const rub = Number(p?.amount_rub || p?.payload?.amount_rub || p?.item?.price_rub || 0);
    return rub > 0 ? `${formatRub(rub)} RUB` : 'СБП';
  }
  return `${formatTon(p?.amount_ton || p?.item?.price_ton || 0)} TON`;
}

function paymentMethodLabel(v) {
  if (v === 'p2p') return 'СБП';
  return 'TON';
}

function statusMeta(p) {
  if (p.ownership_transfer_status === 'failed') return { label: 'Ошибка передачи', cls: 'bg-rose-100 text-rose-800' };
  if (p.status === 'awaiting_receipt') return { label: 'Ждёт подтверждения', cls: 'bg-amber-100 text-amber-800' };
  if (p.status === 'rejected') return { label: 'Отклонён', cls: 'bg-rose-100 text-rose-800' };
  if (p.status === 'paid' && p.ownership_transfer_status === 'completed') return { label: 'Завершён', cls: 'bg-emerald-100 text-emerald-800' };
  if (p.status === 'paid') return { label: 'Оплачен', cls: 'bg-emerald-100 text-emerald-800' };
  if (p.status === 'pending') return { label: 'Ожидает оплату', cls: 'bg-amber-100 text-amber-800' };
  if (p.status === 'expired') return { label: 'Срок истёк', cls: 'bg-slate-100 text-slate-600' };
  return { label: p.status || '—', cls: 'bg-slate-100 text-slate-600' };
}

function purchaseNextSteps(p) {
  const t = p?.item?.item_type;
  if (!t || p?.status !== 'paid') return [];
  if (t === 'proxy') return [{ label: 'Прокси', href: '/app/proxies' }, { label: 'Боты', href: '/app/bots' }];
  if (t === 'userbot' || t === 'bundle') return [{ label: 'Боты', href: '/app/bots' }];
  if (t === 'customer_base_asset') return [{ label: 'CRM', href: '/app/crm' }];
  return [{ label: 'Кабинет', href: '/app/' }];
}

const FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'pending', label: 'Ожидает' },
  { id: 'paid', label: 'Оплачено' },
  { id: 'expired', label: 'Истёкло' },
  { id: 'failed', label: 'Ошибка' }
];

export function PurchasesPage() {
  const { accessToken } = useAuth();
  const [purchases, setPurchases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [busyId, setBusyId] = useState('');
  const [receiptDrafts, setReceiptDrafts] = useState({});

  async function loadPurchases() {
    if (!accessToken) return;
    try {
      const data = await apiRequest('/api/shop/public/my-purchases', { accessToken });
      setPurchases(data.purchases || []);
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPurchases();
    const id = window.setInterval(() => loadPurchases(), 30_000);
    return () => window.clearInterval(id);
  }, [accessToken]);

  const filtered = useMemo(() => {
    if (filter === 'all') return purchases;
    if (filter === 'pending') return purchases.filter((p) => p.status === 'pending' || p.status === 'awaiting_receipt');
    if (filter === 'paid') return purchases.filter((p) => p.status === 'paid');
    if (filter === 'expired') return purchases.filter((p) => p.status === 'expired' || p.status === 'rejected');
    if (filter === 'failed') return purchases.filter((p) => p.ownership_transfer_status === 'failed');
    return purchases;
  }, [filter, purchases]);

  async function checkPayment(purchaseId) {
    setBusyId(purchaseId);
    try {
      await apiRequest('/api/shop/public/purchase/check', { accessToken, method: 'POST', body: { purchase_id: purchaseId } });
      await loadPurchases();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId('');
    }
  }

  async function markPaid(purchaseId) {
    setBusyId(purchaseId);
    try {
      const draft = receiptDrafts[purchaseId] || {};
      const formData = new FormData();
      formData.append('purchase_id', purchaseId);
      formData.append('receipt_note', draft.note || '');
      if (draft.file) formData.append('receipt_file', draft.file);
      await apiRequest('/api/shop/public/purchase/mark-paid', { accessToken, method: 'POST', body: formData });
      setReceiptDrafts((prev) => ({ ...prev, [purchaseId]: { note: '', file: null } }));
      await loadPurchases();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId('');
    }
  }

  if (loading) {
    return <div className="text-center py-16 text-slate-400">Загружаем покупки...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Мои покупки</h1>
        <p className="text-sm text-slate-500 mt-1">Статус оплат, оплата и получение товаров.</p>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
      )}

      <div className="flex gap-1.5 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filter === f.id ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-slate-500">Покупок пока нет.</p>
          <a className="inline-block mt-4 text-sm text-indigo-600 hover:underline" href="/shop">Перейти в магазин</a>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((p) => {
            const sm = statusMeta(p);
            const steps = purchaseNextSteps(p);
            const method = p.payload?.payment_method || 'ton';
            const isPending = p.status === 'pending';
            const isAwaiting = p.status === 'awaiting_receipt';
            const isPaid = p.status === 'paid';
            const isExpired = p.status === 'expired';
            const isFailed = p.ownership_transfer_status === 'failed';
            const draft = receiptDrafts[p.id] || { note: '', file: null };

            return (
              <div key={p.id} className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-slate-900">{p.item?.title || 'Товар'}</h3>
                    <div className="text-xs text-slate-500 mt-1">
                      {purchaseAmountSummary(p)} • {paymentMethodLabel(method)} • {formatWhen(p.created_at)}
                    </div>
                    {isPending && p.expires_at && (
                      <div className="text-xs text-amber-600 mt-0.5">Оплатить до {formatWhen(p.expires_at)}</div>
                    )}
                  </div>
                  <span className={`inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-semibold ${sm.cls}`}>
                    {sm.label}
                  </span>
                </div>

                {/* TON payment */}
                {method === 'ton' && (isPending || isAwaiting) && (
                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-2">
                    <div className="text-sm"><span className="font-medium text-slate-700">Кошелек:</span> <code className="text-xs break-all">{p.payload?.seller_wallet || '—'}</code></div>
                    <div className="text-sm"><span className="font-medium text-slate-700">Memo:</span> <code className="text-xs">{p.payload?.memo || '—'}</code></div>
                    {p.payload?.ton_qr && (
                      <div className="pt-2"><img src={p.payload.ton_qr} alt="TON QR" className="w-40 h-40 rounded-lg" /></div>
                    )}
                    <div className="flex gap-2 pt-2">
                      {p.payload?.ton_uri && (
                        <a href={p.payload.ton_uri} className="site-button site-button--primary text-xs">Открыть TON-кошелёк</a>
                      )}
                      <button
                        className="site-button text-xs"
                        type="button"
                        disabled={busyId === p.id}
                        onClick={() => checkPayment(p.id)}
                      >
                        {busyId === p.id ? 'Проверяем...' : 'Проверить оплату'}
                      </button>
                    </div>
                  </div>
                )}

                {/* P2P payment */}
                {method === 'p2p' && isPending && (
                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-3">
                    <div className="text-sm"><span className="font-medium text-slate-700">Карта / СБП:</span> {p.payload?.sbp_phone || '—'}</div>
                    {p.payload?.sbp_fio && <div className="text-sm"><span className="font-medium text-slate-700">Получатель:</span> {p.payload.sbp_fio}</div>}
                    {p.payload?.sbp_bank && <div className="text-sm"><span className="font-medium text-slate-700">Банк:</span> {p.payload.sbp_bank}</div>}
                    <div className="text-sm"><span className="font-medium text-slate-700">Комментарий:</span> <code className="text-xs">{p.payload?.memo || '—'}</code></div>
                    <textarea
                      className="w-full rounded-xl border border-slate-200 bg-white text-sm p-3 mt-2"
                      rows={2}
                      placeholder="Комментарий к оплате, если нужен: банк, сумма, время"
                      value={draft.note || ''}
                      onChange={(e) => setReceiptDrafts((prev) => ({
                        ...prev,
                        [p.id]: { ...(prev[p.id] || {}), note: e.target.value }
                      }))}
                    />
                    <input
                      className="text-sm"
                      type="file"
                      accept="image/*,.pdf"
                      onChange={(e) => setReceiptDrafts((prev) => ({
                        ...prev,
                        [p.id]: { ...(prev[p.id] || {}), file: e.target.files?.[0] || null }
                      }))}
                    />
                    <button
                      className="site-button site-button--primary text-xs"
                      type="button"
                      disabled={busyId === p.id}
                      onClick={() => markPaid(p.id)}
                    >
                      {busyId === p.id ? 'Отправляем...' : 'Я оплатил'}
                    </button>
                    <div className="text-xs text-slate-500">Чек можно не прикладывать. Если у продавца включена автосверка, Bullgram подтвердит оплату по банковскому уведомлению.</div>
                  </div>
                )}



                {/* Awaiting receipt — P2P already sent */}
                {isAwaiting && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    Ждем подтверждение продавца или банковское уведомление. Чек не обязателен, если оплата найдется через автосверку.
                  </div>
                )}

                {/* Expired */}
                {isExpired && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    Срок оплаты истёк. Создайте новый заказ в магазине.
                  </div>
                )}

                {/* Failed transfer */}
                {isFailed && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                    Оплата подтверждена, но передача товара сломалась. Дождитесь решения продавца.
                  </div>
                )}

                {isPaid && !isFailed && p.ownership_transfer_status !== 'completed' && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    Оплата подтверждена. Передача товара еще выполняется.
                  </div>
                )}

                {/* Paid — show result */}
                {isPaid && p.item?.post_purchase_message && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                    <div className="text-xs font-semibold text-emerald-700 mb-2">Результат покупки</div>
                    <div className="text-sm text-emerald-900 whitespace-pre-wrap">{p.item.post_purchase_message}</div>
                  </div>
                )}

                {/* Next steps */}
                {isPaid && steps.length > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    <span className="text-xs text-slate-400">Дальше:</span>
                    {steps.map((s) => (
                      <a key={s.href} href={s.href} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 hover:underline">{s.label}</a>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
