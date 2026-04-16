import { useMemo } from 'react';

export function usePaymentSettingsDerivedState({ mode, paymentEventFilter, state }) {
  const billingStats = useMemo(() => {
    return state.paymentEvents.reduce((stats, event) => {
      stats.total += 1;
      if (event.event_type === 'webhook_received' || event.event_type === 'webhook_test') stats.webhook += 1;
      if (event.event_type === 'invoice_completed') stats.completed += 1;
      if (event.event_type === 'rejected_secret' || event.status === 'rejected') stats.rejected += 1;
      return stats;
    }, { total: 0, webhook: 0, completed: 0, rejected: 0 });
  }, [state.paymentEvents]);

  const filteredPaymentEvents = useMemo(() => {
    return state.paymentEvents.filter((event) => {
      if (paymentEventFilter === 'webhook') {
        return event.event_type === 'webhook_received' || event.event_type === 'webhook_test';
      }
      if (paymentEventFilter === 'completed') {
        return event.event_type === 'invoice_completed';
      }
      if (paymentEventFilter === 'rejected') {
        return event.event_type === 'rejected_secret' || event.status === 'rejected';
      }
      return true;
    });
  }, [paymentEventFilter, state.paymentEvents]);

  const billingStatsCards = useMemo(() => ([
    { title: 'Webhook событий', value: billingStats.total, hint: `Дошли: ${billingStats.webhook}, закрылись: ${billingStats.completed}.` },
    { title: 'TON задан', value: state.settings.ton_wallet ? 'Да' : 'Нет', hint: 'Кошелек, на который приходят TON оплаты.', tone: state.settings.ton_wallet ? 'ok' : 'warning' },
    { title: 'Рефералка', value: state.settings.referral_enabled ? 'Вкл' : 'Выкл', hint: `Награда: ${state.settings.referral_reward_percent || 0}%`, tone: state.settings.referral_enabled ? 'ok' : 'default' },
    { title: 'Billing mode', value: state.settings.billing_mode || 'manual', hint: `Провайдер: ${state.settings.billing_provider || 'generic'}` }
  ]), [billingStats, state.settings]);

  const prioritySignals = useMemo(() => {
    const signals = [];
    if (!state.settings.ton_wallet) {
      signals.push({
        tone: 'danger',
        title: 'TON-кошелек не указан',
        text: 'Пока здесь пусто, P2P/TON деньги просто некуда принимать. Пропиши кошелек продавца и владельца.'
      });
    }
    if (state.billingHealth && state.billingHealth.success !== true) {
      signals.push({
        tone: 'warning',
        title: 'Billing health не в норме',
        text: 'Webhook или provider mode выглядят криво. Разбери health до того, как оплаты зависнут в серой зоне.'
      });
    }
    if (billingStats.rejected > 0) {
      signals.push({
        tone: 'danger',
        title: `Есть ошибки кассы: ${billingStats.rejected}`,
        text: 'В журнале уже лежат rejected-события. Разгреби их раньше, чем админы начнут руками искать потерянные деньги.'
      });
    }
    return signals;
  }, [state.settings, state.billingHealth, billingStats]);

  const showBillingStats = useMemo(() => {
    return (
      billingStats.total > 0 ||
      !!state.settings.ton_wallet ||
      !!state.settings.billing_shop_id ||
      !!state.settings.billing_api_key ||
      !!state.settings.billing_webhook_secret ||
      !!state.settings.referral_enabled
    );
  }, [billingStats.total, state.settings]);

  const isRequisitesMode = mode === 'requisites';
  const isPlansMode = mode === 'plans';
  const isBillingMode = mode === 'billing';
  const pageCopy = useMemo(() => {
    if (isBillingMode) {
      return {
        title: 'Касса / webhook',
        description: 'Тут живет касса: webhook, provider mode, ручная проверка и журнал событий. Реквизиты и тарифы вынесены отдельно.',
        refreshHint: 'Экран обновляется сам раз в минуту, чтобы не пропускать потерянные оплаты.'
      };
    }
    return {
      title: 'Реквизиты',
      description: 'Укажи TON-кошелек и базовые реквизиты для первого checkout.',
      refreshHint: ''
    };
  }, [isBillingMode]);

  return {
    filteredPaymentEvents,
    billingStatsCards,
    prioritySignals,
    showBillingStats,
    isRequisitesMode,
    isPlansMode,
    isBillingMode,
    pageCopy
  };
}
