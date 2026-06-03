import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { supabase } from '../lib/supabase.js';
import { LoadingState } from '../ui/LoadingState.jsx';
import { DEFAULT_SETTINGS } from './payment-settings/payment-settings.constants.js';
import { BillingHeader } from './payment-settings/BillingHeader.jsx';
import { BillingWebhookSection } from './payment-settings/BillingWebhookSection.jsx';
import { PrioritySignalsGrid } from './payment-settings/PrioritySignalsGrid.jsx';
import { RequisitesSection } from './payment-settings/RequisitesSection.jsx';
import { ReceiptVerificationSection } from './payment-settings/ReceiptVerificationSection.jsx';
import { BankEventsSection } from './payment-settings/BankEventsSection.jsx';
import { CryptoPurchasesSection } from './payment-settings/CryptoPurchasesSection.jsx';
import { TariffsSection } from './payment-settings/TariffsSection.jsx';
import { usePaymentSettingsController } from './payment-settings/usePaymentSettingsController.js';
import { usePaymentSettingsDerivedState } from './payment-settings/usePaymentSettingsDerivedState.js';
import { useTariffsController } from './payment-settings/useTariffsController.js';

export function PaymentSettingsPage({ mode = 'requisites' }) {
  const { user, accessToken } = useAuth();
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
    selectedBotId: null,
    updatedAt: null
  });
  const {
    fieldErrors,
    patchSettings,
    saveSettings,
    toggleSbpBank,
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
            .select('id, title, tg_chat_id, chat_type, bot_id')
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

        const invoicesResult = await supabase
          .from('invoices')
          .select('*')
          .eq('owner_id', user.id)
          .order('created_at', { ascending: false })
          .limit(200);

        if (tariffsResult.error) throw tariffsResult.error;
        if (invoicesResult.error && !(invoicesResult.error.message || '').includes('invoices')) {
          throw invoicesResult.error;
        }
        tariffs = tariffsResult.data || [];

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
            invoices: invoicesResult.data || [],
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
          toggleSbpBank={toggleSbpBank}
          validatePaymentFields={validatePaymentFields}
        />
      ) : null}

      {isBillingMode ? (
        <div className="space-y-6">
          <RequisitesSection
            fieldErrors={fieldErrors}
            patchSettings={patchSettings}
            saveSettings={saveSettings}
            saving={state.saving}
            settings={state.settings}
            toggleSbpBank={toggleSbpBank}
            validatePaymentFields={validatePaymentFields}
          />
          <BillingWebhookSection
            accessToken={accessToken}
          />
          <div className="bg-white border border-slate-200/60 rounded-3xl p-6 md:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] space-y-6">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-bold text-slate-700">Оплаты:</span>
              <button
                type="button"
                className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${!state.selectedBotId ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
                onClick={() => setState((prev) => ({ ...prev, selectedBotId: null }))}
              >
                Все боты
              </button>
              {bots.map((bot) => (
                <button
                  key={bot.id}
                  type="button"
                  className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${state.selectedBotId === bot.id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
                  onClick={() => setState((prev) => ({ ...prev, selectedBotId: bot.id }))}
                >
                  @{bot.tg_username}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <ReceiptVerificationSection paymentEvents={filteredPaymentEvents} invoiceMap={invoiceMap} tariffs={state.tariffs} />
              <BankEventsSection accessToken={accessToken} />
            </div>
            <CryptoPurchasesSection paymentEvents={filteredPaymentEvents} invoiceMap={invoiceMap} tariffs={state.tariffs} />
          </div>
        </div>
      ) : null}

      {isPlansMode ? (
        <>
          <TariffsSection
            addBundleItem={addBundleItem}
            bundleDrafts={bundleDrafts}
            bundleSupport={state.bundleSupport}
            channels={state.channels}
            createTariff={createTariff}
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
