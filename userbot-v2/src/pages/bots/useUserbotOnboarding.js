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
    qrPasswordRequired: false,
    qrPasswordValue: '',
    qrPasswordHint: '',
    qrPasswordError: '',
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
  const lastQrImageRef = useRef(null);
  const qrGeneratingNoticeRef = useRef(false);
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
    showUiMessage('Ждем скан и вход...');

    qrPollingIntervalRef.current = window.setInterval(async () => {
      try {
        const result = await apiRequest('/api/userbot/qr-status', { accessToken });
        if (result.status === 'success') {
          stopQrPolling();
          const profileLabel = result.fingerprint_profile_label || currentQrFingerprintProfile(onboarding.qrFingerprintProfileId).label;
          updateOnboarding({
            qrCodeUrl: '',
            qrPasswordRequired: false,
            qrPasswordError: ''
          });
          showUiMessage(`Аккаунт подключен в safe-mode. Профиль входа: ${profileLabel}.`, 'success');
          await reloadAccounts();
        }
        if (result.status === '2fa_required') {
          // Скан принят, но аккаунт под облачным паролем: Telegram требует
          // auth.checkPassword с нового клиента. Тост + форма пароля.
          stopQrPolling();
          updateOnboarding({
            qrPasswordRequired: true,
            qrPasswordValue: '',
            qrPasswordHint: result.password_hint || '',
            qrPasswordError: result.password_error || ''
          });
          showUiMessage('Скан принят. Аккаунт защищен облачным паролем — введи его, чтобы завершить вход.');
          return;
        }
        if (result.status === 'generating') {
          // Сессия еще поднимается через прокси, первого токена нет.
          if (!qrGeneratingNoticeRef.current) {
            qrGeneratingNoticeRef.current = true;
            showUiMessage('Поднимаю сессию через прокси — QR появится здесь. Обычно до 30 секунд.');
          }
          return;
        }
        if (result.status === 'pending' && result.qr_code && result.qr_code !== lastQrImageRef.current) {
          // Токен QR живёт ~30 секунд, сервер ротирует код: подменяем картинку,
          // пока владелец ещё не отсканил, иначе скан попадёт в протухший QR.
          const isFirstQr = !lastQrImageRef.current;
          lastQrImageRef.current = result.qr_code;
          updateOnboarding({ qrCodeUrl: result.qr_code });
          if (isFirstQr) {
            showUiMessage('QR готов. Сканируй его в Telegram — код сам обновится, если истечет.', 'success');
          } else {
            showUiMessage('Обновили QR — старый код истёк. Сканируй свежий.');
          }
        }
        if (result.status === 'failed') {
          stopQrPolling();
          updateOnboarding({
            qrPasswordRequired: false,
            qrPasswordError: ''
          });
          showUiMessage(result.error || 'QR-вход не прошел. Сгенерируй QR заново.', 'error');
        }
      } catch (error) {
        if (String(error.message).includes('404')) {
          stopQrPolling();
          updateOnboarding({
            qrPasswordRequired: false,
            qrPasswordError: ''
          });
          showUiMessage('QR больше не активен. Сгенерируй новый.', 'error');
          return;
        }
        stopQrPolling();
        showUiMessage(error.message || 'Не удалось проверить статус QR. Остановили ожидание, чтобы не долбить API бесконечно.', 'error');
      }
    }, 3000);

    qrPollingTimeoutRef.current = window.setTimeout(() => {
      stopQrPolling();
      showUiMessage('QR-ожидание истекло. Сгенерируй новый код, если вход так и не завершился.', 'error');
    }, 3 * 60 * 1000);
  }

  async function submitQrPassword() {
    const password = String(onboarding.qrPasswordValue || '').trim();
    if (!password) {
      updateOnboarding({ qrPasswordError: 'Введи облачный пароль.' });
      return;
    }
    try {
      await apiRequest('/api/userbot/qr-password', {
        accessToken,
        method: 'POST',
        body: { password }
      });
      updateOnboarding({
        qrPasswordError: '',
        qrPasswordValue: ''
      });
      // Пароль принят: дальше либо authorized (поллинг добьет success),
      // либо 2fa_required снова — с «Неверный пароль» от сервера.
      showUiMessage('Проверяем пароль в Telegram...');
      pollQrStatus();
    } catch (error) {
      updateOnboarding({ qrPasswordError: error.message || 'Не удалось передать пароль. Попробуй еще раз.' });
    }
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
      showUiMessage(`На ${planRules.label} даем только ${planRules.maxUserbots} юзербота. Для следующего аккаунта переводи кабинет на Pro.`, 'error');
      return;
    }
    const usingCustomFingerprint = onboarding.fingerprintMode === 'custom';
    const customFingerprint = usingCustomFingerprint ? buildCustomFingerprintPayload() : null;
    // Выбор прокси опционален (BACKLOG §32): выбрал — идем через свой прокси
    // (payload прежний), не выбрал — платформа сама выдаст managed-слот.
    const qrStartPayload = {
      fingerprint_profile_id: usingCustomFingerprint ? '' : onboarding.qrFingerprintProfileId,
      custom_fingerprint: customFingerprint
    };
    if (onboarding.proxyId) {
      qrStartPayload.proxy_id = onboarding.proxyId;
    } else {
      qrStartPayload.use_platform_proxy = true;
    }

    updateOnboarding({
      isGeneratingQr: true,
      qrCodeUrl: '',
      qrPasswordRequired: false,
      qrPasswordValue: '',
      qrPasswordHint: '',
      qrPasswordError: ''
    });
    lastQrImageRef.current = null;
    qrGeneratingNoticeRef.current = false;
    // Подтверждение перед живой авторизацией переехало из window.confirm в тост.
    showUiMessage('Генерирую QR, подожди ~30 сек — сессия поднимается через прокси...');

    try {
      // Генерация идет в фоне на сервере: qr-start отвечает сразу, картинка и
      // статус приходят поллингом (generating → pending с qr_code → success).
      const result = await apiRequest('/api/userbot/qr-start', {
        accessToken,
        method: 'POST',
        body: qrStartPayload
      });
      if (result.success) {
        // Генерация в фоне: картинку и статусы принесет поллинг.
        pollQrStatus();
      } else {
        showUiMessage('QR не запустился. Попробуй еще раз.', 'error');
      }
    } catch (error) {
      showUiMessage(normalizeOnboardingErrorMessage(error), 'error');
    } finally {
      updateOnboarding({ isGeneratingQr: false });
    }
  }

  async function importSession() {
    if (!planRules.canCreateMultipleUserbots && userbotCount >= planRules.maxUserbots) {
      showUiMessage(`На ${planRules.label} даем только ${planRules.maxUserbots} юзербота. Для следующего аккаунта переводи кабинет на Pro.`, 'error');
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
    if (!window.confirm('Импорт `.session + .json` даёт сервису полный доступ к аккаунту. `tdata`, `Password2FA.txt`, `Accounts.txt` и другие соседние файлы сюда грузить не надо. После импорта аккаунт встанет в safe-mode и не пойдёт в автоматику до ручной активации. Продолжить?')) {
      return;
    }

    updateOnboarding({
      isImporting: true
    });
    try {
      const formData = new FormData();
      formData.append('sessionFile', onboarding.sessionFile);
      formData.append('jsonFile', onboarding.jsonFile);
      // Выбор прокси опционален (BACKLOG §32): свой прокси идет как раньше,
      // пустой выбор — платформа выдаст managed-слот сама.
      if (onboarding.proxyId) {
        formData.append('proxy_id', onboarding.proxyId);
      } else {
        formData.append('use_platform_proxy', 'true');
      }

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
        jsonFileName: ''
      });
      showUiMessage('Аккаунт импортирован в safe-mode.', 'success');
      await reloadAccounts();
    } catch (error) {
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
    submitQrPassword,
    switchFingerprintMode,
    updateOnboarding
  };
}
