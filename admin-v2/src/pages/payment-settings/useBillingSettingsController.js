import { useState } from 'react';
import { toast } from 'sonner';
import { apiRequest } from '../../api/client.js';

export function useBillingSettingsController({ accessToken, patchSettings, settings, userbots }) {
  const [selectedUserbotId, setSelectedUserbotId] = useState('');

  async function sendWebhookTest() {
    try {
      await apiRequest('/api/payment/test-webhook', {
        accessToken,
        method: 'POST',
        body: { provider: settings.billing_provider || 'generic' }
      });
      toast.success('Тестовое webhook-событие записано. Обнови журнал ниже.');
    } catch (error) {
      toast.error(error.message);
    }
  }

  function fillAdminIdFromUserbot() {
    const userbot = userbots.find((item) => String(item.id) === String(selectedUserbotId)) || userbots[0];
    if (!userbot) {
      toast.error('Сначала подключи юзербота.');
      return;
    }
    patchSettings({ admin_tg_id: String(userbot.tg_account_id) });
  }

  return {
    fillAdminIdFromUserbot,
    selectedUserbotId,
    sendWebhookTest,
    setSelectedUserbotId
  };
}
