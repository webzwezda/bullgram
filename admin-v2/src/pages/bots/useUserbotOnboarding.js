import { useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../../api/client.js';
import {
  normalizeOnboardingErrorMessage,
  QR_FINGERPRINT_PROFILES,
  qrFingerprintProfileById
} from './bots-accounts.utils.js';

function buildInitialOnboardingState() {
  return {
    proxyId: '',
    qrFingerprintProfileId: QR_FINGERPRINT_PROFILES[0].id,
    fingerprintMode: 'preset',
    connectMethod: 'qr',
    qrCodeUrl: '',
    qrStatus: '',
    qrStatusTone: 'default',
    isGeneratingQr: false,
    isImporting: false,
    customFingerprintLabel: 'Мой профиль',
    customFingerprintNote: '',
    customApiId: String(QR_FINGERPRINT_PROFILES[0].fingerprint.api_id),
    customApiHash: QR_FINGERPRINT_PROFILES[0].fingerprint.api_hash,
    customDeviceModel: QR_FINGERPRINT_PROFILES[0].fingerprint.device_model,
    customSystemVersion: QR_FINGERPRINT_PROFILES[0].fingerprint.system_version,
    customAppVersion: QR_FINGERPRINT_PROFILES[0].fingerprint.app_version,
    customSystemLangCode: QR_FINGERPRINT_PROFILES[0].fingerprint.system_lang_code,
    customLangCode: QR_FINGERPRINT_PROFILES[0].fingerprint.lang_code,
    sessionFile: null,
    sessionFileName: '',
    jsonFile: null,
    jsonFileName: ''
  };
}

export function useUserbotOnboarding({
  accessToken,
  planRules,
  userbotCount,
  reloadAccounts,
  showUiMessage
}) {
  const qrPollingIntervalRef = useRef(null);
  const qrPollingTimeoutRef = useRef(null);
  const [onboarding, setOnboarding] = useState(buildInitialOnboardingState);
  const [fingerprintProfilesState, setFingerprintProfilesState] = useState({
    loading: false,
    error: '',
    profiles: QR_FINGERPRINT_PROFILES
  });

  const fingerprintProfiles = useMemo(() => (
    Array.isArray(fingerprintProfilesState.profiles) && fingerprintProfilesState.profiles.length
      ? fingerprintProfilesState.profiles
      : QR_FINGERPRINT_PROFILES
  ), [fingerprintProfilesState.profiles]);

  function updateOnboarding(patch) {
    setOnboarding((prev) => ({ ...prev, ...patch }));
  }

  function currentQrFingerprintProfile(profileId = onboarding.qrFingerprintProfileId) {
    return qrFingerprintProfileById(profileId, fingerprintProfiles);
  }

  function primeCustomFingerprintFromProfile(profileId = onboarding.qrFingerprintProfileId) {
    const profile = currentQrFingerprintProfile(profileId);
    if (!profile) return;
    updateOnboarding({
      customFingerprintLabel: profile.label || 'Мой профиль',
      customFingerprintNote: profile.note || '',
      customApiId: String(profile.fingerprint?.api_id || ''),
      customApiHash: profile.fingerprint?.api_hash || '',
      customDeviceModel: profile.fingerprint?.device_model || profile.fingerprint?.deviceModel || '',
      customSystemVersion: profile.fingerprint?.system_version || profile.fingerprint?.systemVersion || '',
      customAppVersion: profile.fingerprint?.app_version || profile.fingerprint?.appVersion || '',
      customSystemLangCode: profile.fingerprint?.system_lang_code || profile.fingerprint?.systemLangCode || '',
      customLangCode: profile.fingerprint?.lang_code || profile.fingerprint?.langCode || ''
    });
  }

  function switchFingerprintMode(nextMode) {
    if (nextMode === 'custom') {
      primeCustomFingerprintFromProfile();
    }
    updateOnboarding({ fingerprintMode: nextMode });
  }

  function buildCustomFingerprintPayload() {
    return {
      label: onboarding.customFingerprintLabel.trim() || 'Мой профиль',
      note: onboarding.customFingerprintNote.trim(),
      api_id: Number(onboarding.customApiId || 0),
      api_hash: onboarding.customApiHash.trim(),
      device_model: onboarding.customDeviceModel.trim(),
      system_version: onboarding.customSystemVersion.trim(),
      app_version: onboarding.customAppVersion.trim(),
      system_lang_code: onboarding.customSystemLangCode.trim(),
      lang_code: onboarding.customLangCode.trim()
    };
  }

  function handleSessionFileChange(event) {
    updateOnboarding({
      sessionFile: event.target.files?.[0] || null,
      sessionFileName: event.target.files?.[0]?.name || ''
    });
  }

  function handleJsonFileChange(event) {
    updateOnboarding({
      jsonFile: event.target.files?.[0] || null,
      jsonFileName: event.target.files?.[0]?.name || ''
    });
  }

  function stopQrPolling() {
    if (qrPollingIntervalRef.current) {
      window.clearInterval(qrPollingIntervalRef.current);
      qrPollingIntervalRef.current = null;
    }
    if (qrPollingTimeoutRef.current) {
      window.clearTimeout(qrPollingTimeoutRef.current);
      qrPollingTimeoutRef.current = null;
    }
  }

  async function pollQrStatus() {
    stopQrPolling();
    updateOnboarding({ qrStatus: '', qrStatusTone: 'default' });
    showUiMessage('Ждем скан и вход...');

    qrPollingIntervalRef.current = window.setInterval(async () => {
      try {
        const result = await apiRequest('/api/userbot/qr-status', { accessToken });
        if (result.status === 'success') {
          stopQrPolling();
          const profileLabel = result.fingerprint_profile_label || currentQrFingerprintProfile(onboarding.qrFingerprintProfileId).label;
          updateOnboarding({
            qrStatus: `Аккаунт подключен в safe-mode. Профиль входа: ${profileLabel}. Сейчас подтянем его в список, а в работу его введешь отдельной живой активацией.`,
            qrCodeUrl: '',
            qrStatusTone: 'success'
          });
          showUiMessage('Аккаунт подключен через QR.', 'success');
          await reloadAccounts();
        }
      } catch (error) {
        if (String(error.message).includes('404')) {
          stopQrPolling();
          updateOnboarding({ qrStatus: 'QR больше не активен. Сгенерируй новый.', qrStatusTone: 'error' });
          showUiMessage('QR больше не активен. Сгенерируй новый.', 'error');
          return;
        }
        stopQrPolling();
        updateOnboarding({
          qrStatus: error.message || 'Не удалось проверить статус QR. Остановили ожидание, чтобы не долбить API бесконечно.',
          qrStatusTone: 'error'
        });
        showUiMessage(error.message || 'Не удалось проверить статус QR.', 'error');
      }
    }, 3000);

    qrPollingTimeoutRef.current = window.setTimeout(() => {
      stopQrPolling();
      updateOnboarding({
        qrStatus: 'QR-ожидание истекло. Сгенерируй новый код, если вход так и не завершился.',
        qrStatusTone: 'error'
      });
      showUiMessage('QR-ожидание истекло.', 'error');
    }, 3 * 60 * 1000);
  }

  useEffect(() => () => {
    stopQrPolling();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadFingerprintProfiles() {
      if (!accessToken) return;
      setFingerprintProfilesState((prev) => ({ ...prev, loading: true, error: '' }));
      try {
        const result = await apiRequest('/api/userbot/fingerprint-profiles', { accessToken });
        if (cancelled) return;
        const profiles = Array.isArray(result.profiles) && result.profiles.length
          ? result.profiles
          : QR_FINGERPRINT_PROFILES;
        setFingerprintProfilesState({
          loading: false,
          error: '',
          profiles
        });
      } catch (error) {
        if (cancelled) return;
        setFingerprintProfilesState({
          loading: false,
          error: error.message || 'Не удалось загрузить fingerprint-пресеты.',
          profiles: QR_FINGERPRINT_PROFILES
        });
      }
    }

    loadFingerprintProfiles();

    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  useEffect(() => {
    if (!fingerprintProfiles.length) return;
    if (fingerprintProfiles.some((profile) => profile.id === onboarding.qrFingerprintProfileId)) return;
    const firstProfile = fingerprintProfiles[0];
    if (!firstProfile) return;
    setOnboarding((prev) => ({
      ...prev,
      qrFingerprintProfileId: firstProfile.id
    }));
  }, [fingerprintProfiles, onboarding.qrFingerprintProfileId]);

  async function startQrLogin() {
    if (!planRules.canCreateMultipleUserbots && userbotCount >= planRules.maxUserbots) {
      showUiMessage(`На ${planRules.label} даем только ${planRules.maxUserbots} юзербота. Для следующего аккаунта переводи кабинет на Normal.`, 'error');
      return;
    }
    if (!onboarding.proxyId) {
      showUiMessage('Сначала выбери живой прокси. Юзерботы теперь подключаются только через прокси.', 'error');
      return;
    }
    const selectedQrFingerprint = currentQrFingerprintProfile(onboarding.qrFingerprintProfileId);
    const usingCustomFingerprint = onboarding.fingerprintMode === 'custom';
    const customFingerprint = usingCustomFingerprint ? buildCustomFingerprintPayload() : null;
    const fingerprintLabel = usingCustomFingerprint
      ? (customFingerprint.label || 'Свой профиль')
      : selectedQrFingerprint.label;

    if (!window.confirm(`Сгенерировать QR через выбранный прокси и профиль "${fingerprintLabel}"? Это живая Telegram-авторизация. После входа аккаунт сохранится в safe-mode, без автозапуска рабочих действий, а fingerprint закрепится за этой сессией.`)) {
      return;
    }

    updateOnboarding({
      isGeneratingQr: true,
      qrCodeUrl: '',
      qrStatus: '',
      qrStatusTone: 'default'
    });

    try {
      const result = await apiRequest('/api/userbot/qr-start', {
        accessToken,
        method: 'POST',
        body: {
          proxy_id: onboarding.proxyId,
          fingerprint_profile_id: usingCustomFingerprint ? '' : onboarding.qrFingerprintProfileId,
          custom_fingerprint: customFingerprint
        }
      });
      const profileLabel = result.fingerprint_profile_label || fingerprintLabel;
      updateOnboarding({
        qrCodeUrl: result.qrCode || '',
        qrStatus: result.qrCode ? `QR готов. Сканируй его в Telegram. Профиль входа: ${profileLabel}.` : 'QR не пришел.',
        qrStatusTone: result.qrCode ? 'success' : 'error'
      });
      if (!result.qrCode) {
        showUiMessage('QR не пришел от Telegram.', 'error');
      }
      if (result.qrCode) {
        pollQrStatus();
      }
    } catch (error) {
      updateOnboarding({
        qrStatus: normalizeOnboardingErrorMessage(error),
        qrStatusTone: 'error'
      });
      showUiMessage(normalizeOnboardingErrorMessage(error), 'error');
    } finally {
      updateOnboarding({ isGeneratingQr: false });
    }
  }

  async function importSession() {
    if (!planRules.canCreateMultipleUserbots && userbotCount >= planRules.maxUserbots) {
      showUiMessage(`На ${planRules.label} даем только ${planRules.maxUserbots} юзербота. Для следующего аккаунта переводи кабинет на Normal.`, 'error');
      return;
    }
    if (!onboarding.sessionFile) {
      showUiMessage('Сначала выбери .session файл.', 'error');
      return;
    }
    if (!onboarding.jsonFile) {
      showUiMessage('Для безопасного импорта обязателен и .json с fingerprint. Без него импорт не даем.', 'error');
      return;
    }
    if (!onboarding.proxyId) {
      showUiMessage('Сначала выбери живой прокси.', 'error');
      return;
    }
    if (!window.confirm('Импорт `.session + .json` даёт сервису полный доступ к аккаунту. `tdata`, `Password2FA.txt`, `Accounts.txt` и другие соседние файлы сюда грузить не надо. После импорта аккаунт встанет в safe-mode и не пойдёт в автоматику до ручной активации. Продолжить?')) {
      return;
    }

    updateOnboarding({
      isImporting: true,
      qrStatus: '',
      qrStatusTone: 'default'
    });
    try {
      const formData = new FormData();
      formData.append('sessionFile', onboarding.sessionFile);
      formData.append('jsonFile', onboarding.jsonFile);
      formData.append('proxy_id', onboarding.proxyId);

      const response = await fetch('/api/userbot/import-session-file'.startsWith('http') ? '/api/userbot/import-session-file' : `${window.location.origin.replace(/\/$/, '')}/api/userbot/import-session-file`, {
        method: 'POST',
        headers: {
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
        },
        body: formData
      });

      let data = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (!response.ok || data?.error) {
        throw new Error(data?.error || `HTTP ${response.status}`);
      }

      updateOnboarding({
        sessionFile: null,
        sessionFileName: '',
        jsonFile: null,
        jsonFileName: '',
        qrStatus: '',
        qrStatusTone: 'default'
      });
      showUiMessage('Аккаунт импортирован в safe-mode.', 'success');
      await reloadAccounts();
    } catch (error) {
      updateOnboarding({
        qrStatus: normalizeOnboardingErrorMessage(error),
        qrStatusTone: 'error'
      });
      showUiMessage(normalizeOnboardingErrorMessage(error), 'error');
    } finally {
      updateOnboarding({ isImporting: false });
    }
  }

  return {
    currentQrFingerprintProfile,
    fingerprintProfiles,
    fingerprintProfilesState,
    handleJsonFileChange,
    handleSessionFileChange,
    importSession,
    onboarding,
    startQrLogin,
    switchFingerprintMode,
    updateOnboarding
  };
}
