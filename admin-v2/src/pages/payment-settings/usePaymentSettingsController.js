import { useState } from 'react';
import { toast } from 'sonner';
import { apiRequest } from '../../api/client.js';
import {
  isValidSbpPhone,
  isValidTonWallet,
  normalizeTonWallet,
  parseSbpBanks,
  serializeSbpBanks
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

  function toggleSbpBank(bank) {
    const selectedBanks = parseSbpBanks(settings.sbp_bank);
    const isEnabled = selectedBanks.includes(bank);

    if (isEnabled && selectedBanks.length === 1) {
      return;
    }

    const nextBanks = isEnabled
      ? selectedBanks.filter((item) => item !== bank)
      : [...selectedBanks, bank];

    patchSettings({ sbp_bank: serializeSbpBanks(nextBanks) });
  }

  function validatePaymentFields(partialSettings = settings) {
    const nextErrors = {};
    const tonWallet = normalizeTonWallet(partialSettings.ton_wallet);
    const sbpPhone = String(partialSettings.sbp_phone || '').trim();

    if (tonWallet && !isValidTonWallet(tonWallet)) {
      nextErrors.ton_wallet = 'Укажи корректный TON-кошелек без пробелов.';
    }

    if (sbpPhone && !isValidSbpPhone(sbpPhone)) {
      nextErrors.sbp_phone = 'Укажи телефон в формате +7 999 123-45-67.';
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
              hasSbp: !!savedSettings.sbp_phone,
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
    toggleSbpBank,
    validatePaymentFields
  };
}
