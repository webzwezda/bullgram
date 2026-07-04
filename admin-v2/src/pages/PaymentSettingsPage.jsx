import { useEffect, useMemo, useState } from 'react';
import { FileText, Sliders } from 'lucide-react';
import { toast } from 'sonner';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { supabase } from '../lib/supabase.js';
import { LoadingState } from '../ui/LoadingState.jsx';
import { DEFAULT_SETTINGS } from './payment-settings/payment-settings.constants.js';
import { PrioritySignalsGrid } from './payment-settings/PrioritySignalsGrid.jsx';
import { RequisitesSection } from './payment-settings/RequisitesSection.jsx';
import { ReceiptVerificationSection } from './payment-settings/ReceiptVerificationSection.jsx';
import { CryptoPurchasesSection } from './payment-settings/CryptoPurchasesSection.jsx';
import { TariffsSection } from './payment-settings/TariffsSection.jsx';
import { usePaymentSettingsController } from './payment-settings/usePaymentSettingsController.js';
import { usePaymentSettingsDerivedState } from './payment-settings/usePaymentSettingsDerivedState.js';
import { useTariffsController } from './payment-settings/useTariffsController.js';


export function PaymentSettingsPage({ mode = 'requisites' }) {
  const { user, accessToken } = useAuth();
  const [activeTab, setActiveTab] = useState('reconciliation');
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
    updatedAt: null
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
          { data: paymentEvents, error: paymentEventsError }
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
            .limit(30)
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
            updatedAt: new Date().toISOString()
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
    return { awaiting: awaitingBotEventsCount };
  }, [awaitingBotEventsCount]);

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

              {activeTab === 'reconciliation' && bots.length > 0 && (
                <div className="flex flex-col md:flex-row items-center gap-4">
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
                </div>
              ) : (
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
