import { useEffect, useState } from 'react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { supabase } from '../lib/supabase.js';
import { LoadingState } from '../ui/LoadingState.jsx';
import { DEFAULT_SETTINGS } from './payment-settings/payment-settings.constants.js';
import { BillingAdminIdSection } from './payment-settings/BillingAdminIdSection.jsx';
import { BillingHeader } from './payment-settings/BillingHeader.jsx';
import { BillingStatsGrid } from './payment-settings/BillingStatsGrid.jsx';
import { BillingWebhookSection } from './payment-settings/BillingWebhookSection.jsx';
import { FinalSettingsActions } from './payment-settings/FinalSettingsActions.jsx';
import { PaymentEventsSection } from './payment-settings/PaymentEventsSection.jsx';
import { PrioritySignalsGrid } from './payment-settings/PrioritySignalsGrid.jsx';
import { ReferralSettingsSection } from './payment-settings/ReferralSettingsSection.jsx';
import { RequisitesSection } from './payment-settings/RequisitesSection.jsx';
import { TariffsSection } from './payment-settings/TariffsSection.jsx';
import { useBillingSettingsController } from './payment-settings/useBillingSettingsController.js';
import { usePaymentSettingsController } from './payment-settings/usePaymentSettingsController.js';
import { usePaymentSettingsDerivedState } from './payment-settings/usePaymentSettingsDerivedState.js';
import { useTariffsController } from './payment-settings/useTariffsController.js';

export function PaymentSettingsPage({ mode = 'requisites' }) {
  const { user, accessToken } = useAuth();
  const [paymentEventFilter, setPaymentEventFilter] = useState('all');
  const [state, setState] = useState({
    loading: true,
    refreshing: false,
    saving: false,
    error: '',
    settings: DEFAULT_SETTINGS,
    userbots: [],
    channels: [],
    tariffs: [],
    bundleItems: [],
    bundleSupport: true,
    billingHealth: null,
    paymentEvents: [],
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
    fillAdminIdFromUserbot,
    selectedUserbotId,
    sendWebhookTest,
    setSelectedUserbotId
  } = useBillingSettingsController({
    accessToken,
    patchSettings,
    settings: state.settings,
    userbots: state.userbots
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
            .select('id, title, tg_chat_id, chat_type')
            .eq('owner_id', user.id)
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
            tariffs: nextTariffs,
            bundleItems,
            bundleSupport,
            billingHealth: health || null,
            paymentEvents: paymentEvents || [],
            updatedAt: new Date().toISOString()
          });

          if (!selectedUserbotId && nextUserbots.length > 0) {
            setSelectedUserbotId(String(nextUserbots[0].id));
          }

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
  }, [user?.id, accessToken, selectedUserbotId]);

  const {
    filteredPaymentEvents,
    billingStatsCards,
    prioritySignals,
    showBillingStats,
    isRequisitesMode,
    isPlansMode,
    isBillingMode,
    pageCopy
  } = usePaymentSettingsDerivedState({ mode, paymentEventFilter, state });

  if (state.loading) {
    return <LoadingState text="Тянем реквизиты и billing..." />;
  }

  return (
    <section className={`page${isRequisitesMode ? ' payment-page' : ''}`}>
      {isBillingMode ? (
        <BillingHeader pageCopy={pageCopy} refreshing={state.refreshing} updatedAt={state.updatedAt} />
      ) : null}

      {!isRequisitesMode && prioritySignals.length > 0 ? (
        <PrioritySignalsGrid signals={prioritySignals} />
      ) : null}

      {state.error ? <div className="error-card" style={{ marginTop: 20 }}>{state.error}</div> : null}

      {isBillingMode && showBillingStats ? (
        <BillingStatsGrid cards={billingStatsCards} />
      ) : null}

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
        <BillingAdminIdSection
          fillAdminIdFromUserbot={fillAdminIdFromUserbot}
          patchSettings={patchSettings}
          selectedUserbotId={selectedUserbotId}
          setSelectedUserbotId={setSelectedUserbotId}
          settings={state.settings}
          userbots={state.userbots}
        />
      ) : null}

      {isBillingMode ? (
        <BillingWebhookSection
          billingHealth={state.billingHealth}
          patchSettings={patchSettings}
          sendWebhookTest={sendWebhookTest}
          settings={state.settings}
        />
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
            setBundleDrafts={setBundleDrafts}
            setNewTariff={setNewTariff}
            tariffs={state.tariffs}
          />
          <ReferralSettingsSection patchSettings={patchSettings} settings={state.settings} />
        </>
      ) : null}

      {!isRequisitesMode ? (
      <FinalSettingsActions isPlansMode={isPlansMode} onSave={saveSettings} saving={state.saving} />
      ) : null}

      {isBillingMode ? (
      <PaymentEventsSection
        filteredPaymentEvents={filteredPaymentEvents}
        paymentEventFilter={paymentEventFilter}
        setPaymentEventFilter={setPaymentEventFilter}
      />
      ) : null}
    </section>
  );
}
