import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FileText, XCircle, Sliders, Search, Info } from 'lucide-react';
import { toast } from 'sonner';
import { apiRequest } from '../api/client.js';
import { APP_CONFIG } from '../config.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { supabase } from '../lib/supabase.js';
import { LoadingState } from '../ui/LoadingState.jsx';
import { Badge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';
import { DEFAULT_SETTINGS } from './payment-settings/payment-settings.constants.js';
import { BillingWebhookSection } from './payment-settings/BillingWebhookSection.jsx';
import { PrioritySignalsGrid } from './payment-settings/PrioritySignalsGrid.jsx';
import { RequisitesSection } from './payment-settings/RequisitesSection.jsx';
import { ReceiptVerificationSection } from './payment-settings/ReceiptVerificationSection.jsx';
import { CryptoPurchasesSection } from './payment-settings/CryptoPurchasesSection.jsx';
import { TariffsSection } from './payment-settings/TariffsSection.jsx';
import { usePaymentSettingsController } from './payment-settings/usePaymentSettingsController.js';
import { usePaymentSettingsDerivedState } from './payment-settings/usePaymentSettingsDerivedState.js';
import { useTariffsController } from './payment-settings/useTariffsController.js';

function formatWhen(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function formatAmount(purchase) {
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
    payload: {
      ...(first.payload || {}),
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
            <a href={resolveBackendAssetUrl(entry.receipt_file_url)} target="_blank" rel="noreferrer" className="text-indigo-600 hover:text-indigo-700 hover:underline">
              {fallbackEntries.length > 1 ? `Чек ${index + 1}` : 'Открыть чек'}
            </a>
          ) : <span className="text-slate-400">Файл не приложен</span>}
          {entry.receipt_note ? ` · ${entry.receipt_note}` : ''}
        </div>
      ))}
    </div>
  );
}


export function PaymentSettingsPage({ mode = 'requisites' }) {
  const { user, accessToken, profileRole } = useAuth();
  const [activeTab, setActiveTab] = useState('reconciliation');
  const [activeSubtab, setActiveSubtab] = useState('bots');
  const [search, setSearch] = useState('');
  const [state, setState] = useState({
    loading: true,
    refreshing: false,
    saving: false,
    error: '',
    settings: DEFAULT_SETTINGS,
    userbots: [],
    channels: [],
    tariffs: [],
    officialBots: [],
    bundleItems: [],
    bundleSupport: true,
    billingHealth: null,
    paymentEvents: [],
    invoices: [],
    members: [],
    selectedBotId: null,
    updatedAt: null,
    purchases: []
  });
  const {
    fieldErrors,
    patchSettings,
    saveSettings,
    validatePaymentFields
  } = usePaymentSettingsController({
    accessToken,
    setState,
    settings: state.settings
  });
  const {
    addBundleItem,
    bundleDrafts,
    createTariff,
    deleteBundleItem,
    deleteTariff,
    ensureBundleDraft,
    getTariffBundleItems,
    newTariff,
    setBundleDrafts,
    setNewTariff
  } = useTariffsController({
    bundleItems: state.bundleItems,
    bundleSupport: state.bundleSupport,
    tariffs: state.tariffs,
    userId: user?.id
  });

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
      toast.success(action === 'approve' ? 'Оплата подтверждена.' : 'Оплата отклонена.');
      const purchasesData = await apiRequest('/api/shop/seller/purchases', { accessToken });
      setState((prev) => ({
        ...prev,
        error: '',
        purchases: purchasesData.purchases || []
      }));
    } catch (error) {
      setState((prev) => ({ ...prev, error: error.message }));
      toast.error(error.message);
    }
  }

  async function handleConfirmBotInvoice(invoiceId) {
    try {
      await apiRequest(`/api/payment/invoices/${invoiceId}/confirm`, {
        accessToken,
        method: 'POST'
      });
      toast.success('Оплата подтверждена, подписка активирована.');

      const tariffIds = state.tariffs.map((t) => t.id);

      const [paymentEventsRes, invoicesRes] = await Promise.all([
        supabase
          .from('payment_events')
          .select('*')
          .eq('owner_id', user.id)
          .order('created_at', { ascending: false })
          .limit(30),
        tariffIds.length > 0
          ? supabase
              .from('invoices')
              .select('*')
              .in('tariff_id', tariffIds)
              .order('created_at', { ascending: false })
              .limit(200)
          : Promise.resolve({ data: [], error: null })
      ]);

      if (paymentEventsRes.error) throw paymentEventsRes.error;
      if (invoicesRes.error) throw invoicesRes.error;

      const invoicesData = invoicesRes.data || [];
      const tgUserIds = Array.from(new Set(invoicesData.map((inv) => String(inv.tg_user_id)).filter(Boolean)));
      let membersData = [];
      if (tgUserIds.length > 0) {
        const membersResult = await supabase
          .from('customer_base_members')
          .select('tg_user_id, username, first_name, display_name')
          .in('tg_user_id', tgUserIds);
        if (!membersResult.error) {
          membersData = membersResult.data || [];
        }
      }

      setState((prev) => ({
        ...prev,
        error: '',
        paymentEvents: paymentEventsRes.data || [],
        invoices: invoicesData,
        members: membersData
      }));
    } catch (error) {
      toast.error(error.message || 'Ошибка подтверждения оплаты');
    }
  }

  async function handleRejectBotInvoice(invoiceId) {
    try {
      await apiRequest(`/api/payment/invoices/${invoiceId}/reject`, {
        accessToken,
        method: 'POST'
      });
      toast.success('Оплата отклонена.');

      const tariffIds = state.tariffs.map((t) => t.id);

      const [paymentEventsRes, invoicesRes] = await Promise.all([
        supabase
          .from('payment_events')
          .select('*')
          .eq('owner_id', user.id)
          .order('created_at', { ascending: false })
          .limit(30),
        tariffIds.length > 0
          ? supabase
              .from('invoices')
              .select('*')
              .in('tariff_id', tariffIds)
              .order('created_at', { ascending: false })
              .limit(200)
          : Promise.resolve({ data: [], error: null })
      ]);

      if (paymentEventsRes.error) throw paymentEventsRes.error;
      if (invoicesRes.error) throw invoicesRes.error;

      const invoicesData = invoicesRes.data || [];
      const tgUserIds = Array.from(new Set(invoicesData.map((inv) => String(inv.tg_user_id)).filter(Boolean)));
      let membersData = [];
      if (tgUserIds.length > 0) {
        const membersResult = await supabase
          .from('customer_base_members')
          .select('tg_user_id, username, first_name, display_name')
          .in('tg_user_id', tgUserIds);
        if (!membersResult.error) {
          membersData = membersResult.data || [];
        }
      }

      setState((prev) => ({
        ...prev,
        error: '',
        paymentEvents: paymentEventsRes.data || [],
        invoices: invoicesData,
        members: membersData
      }));
    } catch (error) {
      toast.error(error.message || 'Ошибка отклонения оплаты');
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadPage({ silent = false } = {}) {
      if (!user?.id || !accessToken) return;

      if (!silent) {
        setState((prev) => ({
          ...prev,
          loading: !prev.updatedAt,
          refreshing: !!prev.updatedAt,
          error: ''
        }));
      }

      try {
        const [
          { data: settings },
          { data: userbots, error: userbotsError },
          { data: channels, error: channelsError },
          { data: officialBots, error: officialBotsError },
          health,
          { data: paymentEvents, error: paymentEventsError },
          purchasesData
        ] = await Promise.all([
          supabase.from('payment_settings').select('*').eq('owner_id', user.id).maybeSingle(),
          supabase
            .from('tg_accounts')
            .select('id, tg_account_id, tg_username')
            .eq('owner_id', user.id)
            .eq('account_type', 'userbot')
            .order('created_at', { ascending: false }),
          supabase
            .from('channels')
            .select('id, title, tg_chat_id, chat_type, bot_id, visibility, username')
            .eq('owner_id', user.id)
            .order('created_at', { ascending: false }),
          supabase
            .from('tg_accounts')
            .select('id, tg_account_id, tg_username')
            .eq('owner_id', user.id)
            .eq('account_type', 'bot')
            .order('created_at', { ascending: false }),
          apiRequest('/api/payment/health', { accessToken }),
          supabase
            .from('payment_events')
            .select('*')
            .eq('owner_id', user.id)
            .order('created_at', { ascending: false })
            .limit(30),
          apiRequest('/api/shop/seller/purchases', { accessToken }).catch(() => ({ purchases: [] }))
        ]);

        if (userbotsError) throw userbotsError;
        if (channelsError) throw channelsError;
        if (paymentEventsError && !(paymentEventsError.message || '').includes('payment_events')) {
          throw paymentEventsError;
        }

        let tariffs = [];
        let bundleItems = [];
        let bundleSupport = true;

        const tariffsResult = await supabase
          .from('tariffs')
          .select('*, channels(title)')
          .eq('owner_id', user.id)
          .eq('is_active', true)
          .order('created_at', { ascending: false });

        if (tariffsResult.error) throw tariffsResult.error;
        tariffs = tariffsResult.data || [];
        const tariffIds = tariffs.map((t) => t.id);

        let invoicesData = [];
        if (tariffIds.length > 0) {
          const invoicesResult = await supabase
            .from('invoices')
            .select('*')
            .in('tariff_id', tariffIds)
            .order('created_at', { ascending: false })
            .limit(200);

          if (invoicesResult.error && !(invoicesResult.error.message || '').includes('invoices')) {
            throw invoicesResult.error;
          }
          invoicesData = invoicesResult.data || [];
        }

        const tgUserIds = Array.from(new Set(invoicesData.map((inv) => String(inv.tg_user_id)).filter(Boolean)));
        let membersData = [];
        if (tgUserIds.length > 0) {
          const membersResult = await supabase
            .from('customer_base_members')
            .select('tg_user_id, username, first_name, display_name')
            .in('tg_user_id', tgUserIds);
          if (!membersResult.error) {
            membersData = membersResult.data || [];
          }
        }

        const bundleItemsResult = await supabase
          .from('tariff_bundle_items')
          .select('*, channels(id, title)')
          .eq('owner_id', user.id)
          .eq('is_active', true)
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true });

        if (bundleItemsResult.error) {
          if ((bundleItemsResult.error.message || '').includes('tariff_bundle_items')) {
            bundleSupport = false;
          } else {
            throw bundleItemsResult.error;
          }
        } else {
          bundleItems = bundleItemsResult.data || [];
        }

        if (!cancelled) {
          const nextUserbots = userbots || [];
          const nextTariffs = tariffs || [];
          setState({
            loading: false,
            refreshing: false,
            saving: false,
            error: '',
            settings: {
              ...DEFAULT_SETTINGS,
              ...(settings || {})
            },
            userbots: nextUserbots,
            channels: channels || [],
            officialBots: officialBots || [],
            tariffs: nextTariffs,
            bundleItems,
            bundleSupport,
            billingHealth: health || null,
            paymentEvents: paymentEvents || [],
            invoices: invoicesData,
            members: membersData,
            updatedAt: new Date().toISOString(),
            purchases: purchasesData?.purchases || []
          });

          setBundleDrafts((prev) => {
            const nextDrafts = { ...prev };
            nextTariffs.forEach((tariff) => {
              if (!nextDrafts[tariff.id]) {
                nextDrafts[tariff.id] = {
                  item_type: 'channel',
                  channel_id: '',
                  resource_title: '',
                  resource_url: ''
                };
              }
            });
            return nextDrafts;
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            loading: false,
            refreshing: false,
            saving: false,
            error: error.message
          }));
        }
      }
    }

    loadPage();
    const intervalId = user?.id && accessToken
      ? window.setInterval(() => {
          loadPage({ silent: true });
        }, 60_000)
      : null;

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [user?.id, accessToken]);

  const {
    prioritySignals,
    isRequisitesMode,
    isPlansMode,
    isBillingMode,
    pageCopy
  } = usePaymentSettingsDerivedState({ mode, paymentEventFilter: 'all', state });

  const bots = useMemo(() => {
    const botIds = new Set(state.tariffs.map((t) => t.bot_id).filter(Boolean));
    return state.officialBots.filter((b) => botIds.has(b.id));
  }, [state.tariffs, state.officialBots]);

  const tariffBotMap = useMemo(() => {
    const map = new Map();
    for (const t of state.tariffs) {
      if (t.bot_id) map.set(t.id, t.bot_id);
    }
    return map;
  }, [state.tariffs]);

  const invoiceMap = useMemo(() => {
    const map = new Map();
    for (const inv of state.invoices) {
      map.set(inv.id, inv);
    }
    return map;
  }, [state.invoices]);

  const filteredPaymentEvents = useMemo(() => {
    if (!state.selectedBotId) return state.paymentEvents;
    return state.paymentEvents.filter((ev) => {
      const inv = invoiceMap.get(ev.invoice_id);
      const tariffId = inv?.tariff_id || ev.payload?.tariff_id;
      return tariffBotMap.get(tariffId) === state.selectedBotId;
    });
  }, [state.paymentEvents, state.selectedBotId, invoiceMap, tariffBotMap]);

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
    () => groupedPurchases.filter((purchase) => ['paid', 'completed', 'rejected', 'failed'].includes(purchase.status)),
    [groupedPurchases]
  );

  const awaitingBotEventsCount = useMemo(() => {
    return filteredPaymentEvents.filter((ev) => {
      const isAwaitingEvent = ['awaiting_receipt', 'wait_admin'].includes(ev.status) || 
                              ['receipt_requested', 'receipt_uploaded'].includes(ev.event_type);
      if (!isAwaitingEvent) return false;
      const inv = invoiceMap.get(ev.invoice_id);
      const invStatus = inv?.status;
      return !invStatus || invStatus === 'awaiting_receipt' || invStatus === 'wait_admin' || invStatus === 'pending';
    }).length;
  }, [filteredPaymentEvents, invoiceMap]);

  const reconciliationStats = useMemo(() => {
    return {
      awaiting: (profileRole === 'admin' ? awaitingReceipts.length : 0) + awaitingBotEventsCount
    };
  }, [awaitingReceipts.length, awaitingBotEventsCount, profileRole]);

  const filteredAwaitingReceipts = useMemo(() => {
    let list = awaitingReceipts;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p =>
        (p.item?.title || '').toLowerCase().includes(q) ||
        String(p.buyer_owner_id).includes(q) ||
        (p.payload?.parsed_receipt_metadata?.transactionId || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [awaitingReceipts, search]);

  const filteredRecentReceipts = useMemo(() => {
    let list = recentReceipts;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p =>
        (p.item?.title || '').toLowerCase().includes(q) ||
        String(p.buyer_owner_id).includes(q) ||
        (p.payload?.parsed_receipt_metadata?.transactionId || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [recentReceipts, search]);

  if (state.loading) {
    return <LoadingState text="Тянем реквизиты и кассу..." />;
  }

  return (
    <section className={`page${isRequisitesMode ? ' payment-page' : ''}`}>
      {!isRequisitesMode && prioritySignals.length > 0 ? (
        <PrioritySignalsGrid signals={prioritySignals} />
      ) : null}

      {state.error ? <div className="error-card" style={{ marginTop: 20 }}>{state.error}</div> : null}

      {isRequisitesMode ? (
        <RequisitesSection
          fieldErrors={fieldErrors}
          patchSettings={patchSettings}
          saveSettings={saveSettings}
          saving={state.saving}
          settings={state.settings}
          validatePaymentFields={validatePaymentFields}
        />
      ) : null}

      {isBillingMode ? (
        <section className="page page--flush space-y-6">
          <div className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden transition-all hover:border-slate-300/60">
            {/* Header & Stats Segment */}
            <section className="p-6 md:p-8 border-b border-slate-100">
              {/* Stats Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="bg-slate-50/50 border border-slate-100 p-6 rounded-3xl text-left transition-all hover:border-slate-200 hover:bg-slate-50">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-xs font-black uppercase tracking-widest text-slate-400">Ждут решения</span>
                    <div className={`p-1.5 rounded-lg ${reconciliationStats.awaiting > 0 ? 'text-amber-500 bg-amber-500/10' : 'text-slate-400 bg-slate-100'}`}>
                      <FileText className="w-4 h-4" />
                    </div>
                  </div>
                  <div className={`text-3xl font-black tracking-tighter ${reconciliationStats.awaiting > 0 ? 'text-amber-700' : 'text-slate-900'}`}>{reconciliationStats.awaiting}</div>
                </div>
              </div>
            </section>

            {/* Filter & Primary Tabs Segment */}
            <section className="p-6 md:p-8 bg-slate-50/50 border-t border-slate-200/60">
              <div className="flex gap-1 overflow-x-auto border-b border-slate-100 mb-6">
                {[
                  { id: 'reconciliation', label: 'Сверка оплат', icon: FileText, count: reconciliationStats.awaiting },
                  { id: 'settings', label: 'Настройки кассы', icon: Sliders }
                ].map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      className={`flex items-center gap-2 px-4 py-3 text-sm font-bold whitespace-nowrap border-b-2 transition-all ${
                        isActive
                          ? 'border-indigo-600 text-indigo-600'
                          : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                      }`}
                      onClick={() => setActiveTab(tab.id)}
                    >
                      {Icon && <Icon className="w-4 h-4" />}
                      {tab.label}
                      {tab.count !== undefined && tab.count > 0 && (
                        <span className={`text-xs px-1.5 py-0.5 rounded-md ${isActive ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-500'}`}>
                          {tab.count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {activeTab === 'reconciliation' && (
                <div className="flex flex-col md:flex-row items-center gap-4">
                  <div className="relative flex-1 w-full">
                    <input
                      className="w-full pl-12 pr-6 py-3.5 bg-white border border-slate-200 rounded-xl text-slate-900 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm text-sm"
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Поиск по сумме, ID транзакции, комментарию..."
                    />
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300" />
                  </div>
                  {bots.length > 0 && (
                    <div className="w-full md:w-[280px] shrink-0">
                      <select
                        className="w-full px-4 py-3.5 bg-white border border-slate-200 rounded-xl text-slate-900 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm text-sm"
                        value={state.selectedBotId || ''}
                        onChange={(e) => setState((prev) => ({ ...prev, selectedBotId: e.target.value || null }))}
                      >
                        <option value="">Все боты</option>
                        {bots.map((bot) => (
                          <option key={bot.id} value={bot.id}>
                            @{bot.tg_username}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Bottom Content Segment */}
            <div className="border-t border-slate-200/60 bg-white">
              {activeTab === 'settings' ? (
                <div className="p-6 md:p-8 space-y-8">
                  <RequisitesSection
                    fieldErrors={fieldErrors}
                    patchSettings={patchSettings}
                    saveSettings={saveSettings}
                    saving={state.saving}
                    settings={state.settings}
                    validatePaymentFields={validatePaymentFields}
                    plain={true}
                  />
                  <div className="border-t border-slate-100 pt-8">
                    <BillingWebhookSection
                      accessToken={accessToken}
                      plain={true}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex flex-col">
                  {/* Sub-tabs list */}
                  <div className="flex gap-2 p-1.5 bg-slate-100 rounded-2xl overflow-x-auto mx-8 mt-6">
                    {[
                      ...(profileRole === 'admin' ? [{ id: 'shop', label: 'Робокасса', count: filteredAwaitingReceipts.length }] : []),
                      { id: 'bots', label: 'Счета ботов', count: awaitingBotEventsCount }
                    ].map((sub) => (
                      <button
                        key={sub.id}
                        type="button"
                        className={`shrink-0 px-4 py-2 text-xs font-black uppercase tracking-wider rounded-xl transition-all flex items-center gap-1.5 ${
                          activeSubtab === sub.id
                            ? 'bg-white text-indigo-600 shadow-sm'
                            : 'text-slate-500 hover:text-slate-700'
                        }`}
                        onClick={() => setActiveSubtab(sub.id)}
                      >
                        {sub.label}
                        {sub.count > 0 && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-md ${activeSubtab === sub.id ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-200 text-slate-500'}`}>
                            {sub.count}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>

                  {/* Sub-tab active views */}
                  {activeSubtab === 'shop' && profileRole === 'admin' && (
                    <div className="p-6 md:p-8 space-y-8">
                      <div>
                        <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
                          <h3 className="text-lg font-black text-slate-900">Очередь ручных чеков</h3>
                          <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">
                            {filteredAwaitingReceipts.length} оплат ждет
                          </span>
                        </div>

                        {!filteredAwaitingReceipts.length ? (
                          <div className="text-center py-12 text-slate-500 space-y-2">
                            <div className="text-4xl">🎉</div>
                            <p className="text-sm font-black text-slate-900">Транзакции P2P полностью разобраны!</p>
                            <p className="text-xs text-slate-400 font-semibold">Новых ручных или авто-чеков пока не поступало.</p>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            {filteredAwaitingReceipts.map((purchase) => {
                              const parsed = purchase.payload?.parsed_receipt_metadata;
                              return (
                                <div key={purchase.id} className="rounded-2xl border border-amber-200 bg-amber-50/10 p-5 hover:border-amber-300 transition-all shadow-xs">
                                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                                    <div>
                                      <div className="font-black text-slate-900 text-base leading-snug">{purchase.item?.title || 'Лот'}</div>
                                      <div className="mt-1.5 text-xs text-slate-600 flex flex-wrap items-center gap-2">
                                        <span className="font-semibold text-slate-400">Покупатель:</span>
                                        <span className="font-mono text-slate-800">owner {purchase.buyer_owner_id}</span>
                                        <span className="text-slate-300">•</span>
                                        <span className="font-black text-slate-900 bg-slate-100 px-2 py-0.5 rounded-md text-[11px]">{formatAmount(purchase)}</span>
                                        {purchase.purchase_ids?.length > 1 && (
                                          <span className="bg-indigo-50 text-indigo-700 border border-indigo-100 px-1.5 py-0.5 rounded text-[10px] font-bold">
                                            Пакет ({purchase.purchase_ids.length})
                                          </span>
                                        )}
                                      </div>
                                      <div className="mt-2 text-[11px] text-slate-400 font-bold">
                                        Отмечено покупателем: {formatWhen(purchase.payload?.receipt_marked_at || purchase.updated_at)}
                                      </div>
                                    </div>
                                    <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 shrink-0 self-start md:self-auto text-xs py-0.5 px-2.5">
                                      Ожидает сверки
                                    </Badge>
                                  </div>

                                  {/* PDF Auto-Parse Results */}
                                  {parsed ? (
                                    <div className="mt-4 bg-white border border-indigo-100 rounded-2xl p-4 space-y-3 shadow-xs">
                                      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                                        <div className="flex items-center gap-1.5 text-indigo-950 font-bold text-xs">
                                          <FileText className="w-4 h-4 text-indigo-500" />
                                          Распознан электронный PDF-чек
                                        </div>
                                        <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-100 text-[10px] font-bold py-0.5 px-2">
                                          {parsed.bankName === 'sberbank' ? 'Сбербанк' : parsed.bankName === 'tinkoff' ? 'Т-Банк / Тинькофф' : parsed.bankName || 'Банк'}
                                        </Badge>
                                      </div>

                                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                                        <div>
                                          <span className="text-slate-400 block font-normal">Сумма перевода:</span>
                                          <span className="font-black text-slate-800 text-sm">
                                            {parsed.amount ? `${new Intl.NumberFormat('ru-RU').format(parsed.amount)} ₽` : '—'}
                                          </span>
                                        </div>
                                        <div>
                                          <span className="text-slate-400 block font-normal">ID транзакции:</span>
                                          <span className="font-mono font-bold text-slate-700 text-xs break-all">{parsed.transactionId || '—'}</span>
                                        </div>
                                        <div>
                                          <span className="text-slate-400 block font-normal">Время по чеку:</span>
                                          <span className="font-medium text-slate-700">{parsed.timestamp ? formatWhen(parsed.timestamp) : '—'}</span>
                                        </div>
                                      </div>

                                      {/* Warnings or matches */}
                                      <div className="mt-2.5 flex items-start gap-2 p-2.5 bg-slate-50 border border-slate-100 text-slate-600 rounded-xl text-[11px] leading-relaxed">
                                        <Info className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                                        <div>
                                          Чек успешно распарсен. Если СМС от банка еще не пришло в ленту, ты можешь подтвердить операцию вручную. Как только поступит SMS с ID транзакции <span className="font-mono font-bold text-slate-800">{parsed.transactionId || '—'}</span>, система сверит ее автоматически.
                                        </div>
                                      </div>
                                    </div>
                                  ) : (
                                    purchase.payload?.receipt_note && (
                                      <div className="mt-3 bg-white border border-slate-100 rounded-xl p-3 text-xs text-slate-600 italic">
                                        Комментарий: {purchase.payload.receipt_note}
                                      </div>
                                    )
                                  )}

                                  {/* Image or File Upload Link */}
                                  {purchase.payload?.receipt_file_url && (
                                    <div className="mt-3 flex items-center gap-2">
                                      <FileText className="w-4 h-4 text-slate-400" />
                                      <a
                                        href={resolveBackendAssetUrl(purchase.payload.receipt_file_url)}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-xs font-bold text-blue-600 hover:text-blue-700 hover:underline inline-flex items-center gap-1"
                                      >
                                        Посмотреть прикрепленный чек
                                      </a>
                                    </div>
                                  )}

                                  <div className="flex gap-2.5 mt-4">
                                    <Button
                                      size="sm"
                                      className="h-9 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold inline-flex items-center gap-1.5 shadow-sm active:scale-95 transition-all"
                                      type="button"
                                      onClick={() => runAction(purchase, 'approve')}
                                    >
                                      <CheckCircle2 className="h-4 w-4" /> Подтвердить оплату
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-9 rounded-xl border border-rose-200 text-rose-600 hover:text-rose-700 hover:bg-rose-50 font-bold inline-flex items-center gap-1.5 active:scale-95 transition-all"
                                      type="button"
                                      onClick={() => runAction(purchase, 'reject')}
                                    >
                                      <XCircle className="h-4 w-4" /> Отклонить
                                    </Button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Verification History Table */}
                      <div className="border-t border-slate-100 pt-8">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
                          <h3 className="text-lg font-black text-slate-900">Последние сверки магазина</h3>
                          <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">История проверенных платежей</p>
                        </div>

                        {!filteredRecentReceipts.length ? (
                          <p className="text-xs text-slate-400 text-center py-6">Сверок пока не проводилось.</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                              <thead>
                                <tr className="bg-slate-50/80 border-b border-slate-100">
                                  <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px]">Лот</th>
                                  <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px]">Покупатель</th>
                                  <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px]">Сумма</th>
                                  <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px]">Статус</th>
                                  <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px] text-right">Чек</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-50">
                                {filteredRecentReceipts.slice(0, 15).map((purchase) => (
                                  <tr key={purchase.id} className="hover:bg-slate-50/50 transition-colors">
                                    <td className="px-6 py-4">
                                      <div className="font-black text-slate-900 text-sm truncate">{purchase.item?.title || 'Лот'}</div>
                                      <div className="text-[10px] text-slate-400 font-bold uppercase tracking-tight mt-0.5">
                                        {purchase.item?.item_type || 'shop item'}{purchase.purchase_ids?.length > 1 ? ` · x${purchase.purchase_ids.length}` : ''}
                                      </div>
                                    </td>
                                    <td className="px-6 py-4">
                                      <div className="text-slate-700 font-mono text-xs">owner {purchase.buyer_owner_id}</div>
                                      <div className="text-[10px] text-slate-400 font-bold mt-0.5">{formatWhen(purchase.created_at)}</div>
                                    </td>
                                    <td className="px-6 py-4 font-black text-slate-900">{formatAmount(purchase)}</td>
                                    <td className="px-6 py-4">{statusBadge(purchase.status)}</td>
                                    <td className="px-6 py-4 text-right">{renderReceiptLinks(purchase)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {activeSubtab === 'bots' && (
                    <div className="p-6 md:p-8 space-y-8">
                      <ReceiptVerificationSection
                        paymentEvents={filteredPaymentEvents}
                        invoiceMap={invoiceMap}
                        tariffs={state.tariffs}
                        members={state.members}
                        plain={true}
                        onConfirm={handleConfirmBotInvoice}
                        onReject={handleRejectBotInvoice}
                      />
                      <div className="border-t border-slate-100 pt-8">
                        <CryptoPurchasesSection
                          paymentEvents={filteredPaymentEvents}
                          invoiceMap={invoiceMap}
                          tariffs={state.tariffs}
                          plain={true}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>
        </section>
      ) : null}

      {isPlansMode ? (
        <>
          <TariffsSection
            addBundleItem={addBundleItem}
            bundleDrafts={bundleDrafts}
            bundleSupport={state.bundleSupport}
            channels={state.channels}
            createTariff={createTariff}
            creating={state.saving}
            deleteBundleItem={deleteBundleItem}
            deleteTariff={deleteTariff}
            ensureBundleDraft={ensureBundleDraft}
            getTariffBundleItems={getTariffBundleItems}
            newTariff={newTariff}
            officialBots={state.officialBots}
            setBundleDrafts={setBundleDrafts}
            setNewTariff={setNewTariff}
            tariffs={state.tariffs}
          />
        </>
      ) : null}

    </section>
  );
}
