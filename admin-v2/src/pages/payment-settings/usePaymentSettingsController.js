import { useState } from 'react';
import { toast } from 'sonner';
import { apiRequest } from '../../api/client.js';
import {
  isValidTonWallet,
  normalizeTonWallet
} from './payment-settings.utils.js';

export function usePaymentSettingsController({ accessToken, setState, settings }) {
  const [fieldErrors, setFieldErrors] = useState({});

  function patchSettings(nextPatch) {
    setState((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        ...nextPatch
      }
    }));
  }

  function validatePaymentFields(partialSettings = settings) {
    const nextErrors = {};
    const tonWallet = normalizeTonWallet(partialSettings.ton_wallet);

    if (tonWallet && !isValidTonWallet(tonWallet)) {
      nextErrors.ton_wallet = 'Укажи корректный TON-кошелек без пробелов.';
    }

    setFieldErrors(nextErrors);
    return nextErrors;
  }

  async function saveSettings(overrides = null) {
    const nextErrors = validatePaymentFields();
    if (Object.keys(nextErrors).length > 0) {
      setState((prev) => ({ ...prev, error: 'Проверь заполнение реквизитов.' }));
      return;
    }
    setState((prev) => ({ ...prev, saving: true, error: '' }));
    try {
      const payload = {
        ...settings,
        ...(overrides || {})
      };
      const response = await apiRequest('/api/payment-settings', {
        accessToken,
        method: 'POST',
        body: payload
      });
      const savedSettings = {
        ...payload,
        ...(response.settings || {})
      };
      const health = await apiRequest('/api/payment/health', { accessToken });
      setState((prev) => ({
        ...prev,
        saving: false,
        settings: {
          ...prev.settings,
          ...savedSettings
        },
        billingHealth: health,
        updatedAt: new Date().toISOString()
      }));
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('bullrun:payment-settings-updated', {
          detail: {
            paymentReadiness: {
              hasTon: !!savedSettings.ton_wallet,
              adminTgId: savedSettings.admin_tg_id ? String(savedSettings.admin_tg_id) : ''
            }
          }
        }));
      }
      toast.success('Настройки сохранены.');
    } catch (error) {
      setState((prev) => ({ ...prev, saving: false, error: error.message }));
    }
  }

  return {
    fieldErrors,
    patchSettings,
    saveSettings,
    validatePaymentFields
  };
}
