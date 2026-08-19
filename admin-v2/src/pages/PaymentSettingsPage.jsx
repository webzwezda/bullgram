import { useEffect, useMemo, useState } from 'react';
import { Coins, ShoppingBag, Sparkles, Wallet } from 'lucide-react';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { apiRequest } from '../api/client.js';
import { supabase } from '../lib/supabase.js';
import { LoadingState } from '../ui/LoadingState.jsx';
import { PrioritySignalsGrid } from './payment-settings/PrioritySignalsGrid.jsx';
import { CryptoPurchasesSection } from './payment-settings/CryptoPurchasesSection.jsx';
import { PlatformTierUpgradeCard } from '../features/billing/PlatformTierUpgradeCard.jsx';
import { BillingContactsCard } from '../features/billing/BillingContactsCard.jsx';
import { MyPurchasesCard } from '../features/billing/MyPurchasesCard.jsx';
import { usePaymentSettingsDerivedState } from './payment-settings/usePaymentSettingsDerivedState.js';

const BILLING_TABS = [
  { id: 'subscription', label: 'Подписка Bullgram', icon: Sparkles },
  { id: 'purchases', label: 'Оплаты от подписчиков', icon: Coins },
  { id: 'my-purchases', label: 'Мои покупки', icon: ShoppingBag }
];

export function PaymentSettingsPage() {
  const { user, accessToken } = useAuth();
  const [billingTab, setBillingTab] = useState('subscription');
  const [state, setState] = useState({
    loading: true,
    error: '',
    officialBots: [],
    tariffs: [],
    billingHealth: null,
    paymentEvents: [],
    invoices: [],
    selectedBotId: null,
    updatedAt: null
  });

  // Deep link /app/billing?tab=purchases
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (BILLING_TABS.some((entry) => entry.id === tab)) {
      setBillingTab(tab);
    }
    window.history.replaceState({}, '', '/app/billing');
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadPage({ silent = false } = {}) {
      if (!user?.id || !accessToken) return;

      if (!silent) {
        setState((prev) => ({
          ...prev,
          loading: !prev.updatedAt,
          error: ''
        }));
      }

      try {
        const [
          { data: officialBots, error: officialBotsError },
          health,
          { data: paymentEvents, error: paymentEventsError }
        ] = await Promise.all([
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

        if (officialBotsError) throw officialBotsError;
        if (paymentEventsError && !(paymentEventsError.message || '').includes('payment_events')) {
          throw paymentEventsError;
        }

        const tariffsResult = await supabase
          .from('tariffs')
          .select('*, channels(title)')
          .eq('owner_id', user.id)
          .eq('is_active', true)
          .order('created_at', { ascending: false });

        if (tariffsResult.error) throw tariffsResult.error;
        const tariffs = tariffsResult.data || [];
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

        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            loading: false,
            error: '',
            officialBots: officialBots || [],
            tariffs,
            billingHealth: health || null,
            paymentEvents: paymentEvents || [],
            invoices: invoicesData,
            updatedAt: new Date().toISOString()
          }));
        }
      } catch (error) {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            loading: false,
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

  const { prioritySignals } = usePaymentSettingsDerivedState({ state });

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
    return <LoadingState text="Тянем кассу и сверки..." />;
  }

  return (
    <section className="page">
      {prioritySignals.length > 0 ? (
        <PrioritySignalsGrid signals={prioritySignals} />
      ) : null}

      {state.error ? <div className="error-card" style={{ marginTop: 20 }}>{state.error}</div> : null}

      <section className="page page--flush space-y-6">
        <div className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden transition-all hover:border-slate-300/60">
          <div className="p-6 md:p-8 bg-slate-50/50 border-b border-slate-100">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20 shrink-0">
                <Wallet className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">Касса</h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  Ваша подписка Bullgram, приём оплат от подписчиков и покупки в магазине.
                </p>
              </div>
            </div>
          </div>

          {/* Tabs Segment */}
          <section className="p-6 md:p-8 bg-slate-50/50">
            <div className="flex gap-1 overflow-x-auto border-b border-slate-100 mb-6">
              {BILLING_TABS.map((tab) => {
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
                    <Icon className="w-4 h-4" />
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
            {billingTab === 'purchases' ? (
              <div className="p-6 md:p-8 space-y-6">
                <BillingContactsCard />
                <CryptoPurchasesSection
                  paymentEvents={filteredPaymentEvents}
                  invoiceMap={invoiceMap}
                  tariffs={state.tariffs}
                  plain={true}
                />
              </div>
            ) : billingTab === 'my-purchases' ? (
              <div className="p-6 md:p-8">
                <MyPurchasesCard />
              </div>
            ) : (
              <div className="p-6 md:p-8">
                <PlatformTierUpgradeCard />
              </div>
            )}
          </div>

        </div>
      </section>
    </section>
  );
}
