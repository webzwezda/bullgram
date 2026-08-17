import { useMemo } from 'react';

export function usePaymentSettingsDerivedState({ state }) {
  const billingStats = useMemo(() => {
    return state.paymentEvents.reduce((stats, event) => {
      stats.total += 1;
      if (event.event_type === 'webhook_received' || event.event_type === 'webhook_test') stats.webhook += 1;
      if (event.event_type === 'invoice_completed') stats.completed += 1;
      if (event.event_type === 'rejected_secret' || event.event_type === 'webhook_rejected') stats.rejected += 1;
      return stats;
    }, { total: 0, webhook: 0, completed: 0, rejected: 0 });
  }, [state.paymentEvents]);

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
  }, [state.billingHealth, billingStats]);

  return { prioritySignals };
}
