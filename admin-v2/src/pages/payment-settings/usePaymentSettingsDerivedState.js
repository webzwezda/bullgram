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
    { title: 'Банковских событий', value: billingStats.total, hint: `Дошли: ${billingStats.webhook}, закрылись: ${billingStats.completed}.` },
    { title: 'СБП реквизиты', value: state.settings.sbp_phone ? 'Да' : 'Нет', hint: 'Телефон, банк и получатель для рублевых переводов.', tone: state.settings.sbp_phone ? 'ok' : 'warning' },
    { title: 'TON кошелек', value: state.settings.ton_wallet ? 'Да' : 'Нет', hint: 'Нужен только для TON оплат.', tone: state.settings.ton_wallet ? 'ok' : 'default' }
  ]), [billingStats, state.settings]);

  const prioritySignals = useMemo(() => {
    const signals = [];
    if (state.billingHealth && state.billingHealth.success !== true) {
      signals.push({
        tone: 'warning',
        title: 'Касса требует проверки',
        text: 'Один из платежных контуров отвечает нештатно. Проверь настройки до запуска трафика.'
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
    return false;
  }, []);

  const isRequisitesMode = mode === 'requisites';
  const isPlansMode = mode === 'plans';
  const isBillingMode = mode === 'billing';
  const pageCopy = useMemo(() => {
    if (isBillingMode) {
      return {
        title: 'Касса',
        description: 'Реквизиты, банковские уведомления и автосверка P2P оплат в одном рабочем контуре.',
        refreshHint: 'Спорные оплаты и ручные решения смотри в “Сверке оплат”.'
      };
    }
    return {
      title: 'Реквизиты',
      description: 'Эти реквизиты показываются покупателям в магазине, прокси, юзерботах и других P2P checkout.',
      refreshHint: 'Автосверка подключается в “Кассе”.'
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
