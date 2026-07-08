import { useEffect, useMemo, useState } from 'react';
import { Sliders, Sparkles } from 'lucide-react';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { apiRequest } from '../api/client.js';
import { supabase } from '../lib/supabase.js';
import { LoadingState } from '../ui/LoadingState.jsx';
import { DEFAULT_SETTINGS } from './payment-settings/payment-settings.constants.js';
import { PrioritySignalsGrid } from './payment-settings/PrioritySignalsGrid.jsx';
import { RequisitesSection } from './payment-settings/RequisitesSection.jsx';
import { CryptoPurchasesSection } from './payment-settings/CryptoPurchasesSection.jsx';
import { PlatformTierUpgradeCard } from '../features/billing/PlatformTierUpgradeCard.jsx';
import { usePaymentSettingsController } from './payment-settings/usePaymentSettingsController.js';
import { usePaymentSettingsDerivedState } from './payment-settings/usePaymentSettingsDerivedState.js';


export function PaymentSettingsPage({ mode = 'requisites' }) {
  const { user, accessToken } = useAuth();
  const [billingTab, setBillingTab] = useState('subscription');
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
    validatePaymentFields
  } = usePaymentSettingsController({
    accessToken,
    setState,
    settings: state.settings
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
            updatedAt: new Date().toISOString()
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
          validatePaymentFields={validatePaymentFields}
        />
      ) : null}

      {isBillingMode ? (
        <section className="page page--flush space-y-6">
          <div className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden transition-all hover:border-slate-300/60">
            {/* Tabs Segment */}
            <section className="p-6 md:p-8 bg-slate-50/50">
              <div className="flex gap-1 overflow-x-auto border-b border-slate-100 mb-6">
                {[
                  { id: 'subscription', label: 'Подписка', icon: Sparkles },
                  { id: 'purchases', label: 'Покупки', icon: Sliders },
                  { id: 'settings', label: 'Настройки кассы', icon: Sliders }
                ].map((tab) => {
                  const Icon = tab.icon;
                  const isActive = billingTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      className={`flex items-center gap-2 px-4 py-3 text-sm font-bold whitespace-nowrap border-b-2 transition-all ${
                        isActive
                          ? 'border-indigo-600 text-indigo-600'
                          : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                      }`}
                      onClick={() => setBillingTab(tab.id)}
                    >
                      {Icon && <Icon className="w-4 h-4" />}
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {billingTab === 'purchases' && bots.length > 0 && (
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
              {billingTab === 'settings' ? (
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
              ) : billingTab === 'purchases' ? (
                <div className="p-6 md:p-8">
                  <CryptoPurchasesSection
                    paymentEvents={filteredPaymentEvents}
                    invoiceMap={invoiceMap}
                    tariffs={state.tariffs}
                    plain={true}
                  />
                </div>
              ) : (
                <div className="p-6 md:p-8">
                  <PlatformTierUpgradeCard />
                </div>
              )}
            </div>

          </div>
        </section>
      ) : null}

    </section>
  );
}
