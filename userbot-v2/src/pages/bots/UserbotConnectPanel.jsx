import { useMemo, useRef } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../app/providers/AuthProvider.jsx';
import { getProductTierRules } from '../../app/productTier.js';
import { Button } from '@/components/ui/button';
import { UserbotOnboardingSection } from './UserbotOnboardingSection.jsx';
import { useUserbotOnboarding } from './useUserbotOnboarding.js';

// Инлайн-панель подключения на /userbot (2026-10-23): по кнопке «Подключить
// аккаунт» окно онбординга открывается над карточкой аккаунта, без перехода
// на /connect. Фронт переиспользован со страницы /connect без правок — там
// он остаётся отдельным путём. Состояние (QR, файлы, fingerprint) собственное
// и живёт, пока панель смонтирована: закрытие гасит QR-поллинг хука.

function showUiMessage(text, tone = 'default') {
  if (tone === 'success') return toast.success(text);
  if (tone === 'error') return toast.error(text);
  return toast(text);
}

// Шаги как на /connect (ConnectPage), чтобы окно выглядело идентично.
const ONBOARDING_STEPS = { proxy: 1, connect: 2, fingerprint: 3, authFiles: 3, authQr: 4 };

export function UserbotConnectPanel({
  availableOnboardingProxies,
  onClose,
  proxyLabel,
  reloadAccounts,
  userbotCount
}) {
  const { accessToken, profilePlan } = useAuth();
  const planRules = useMemo(() => getProductTierRules(profilePlan), [profilePlan]);
  const panelRef = useRef(null);

  // Хук вызывает reloadAccounts только при успехе (импорт .session или
  // QR-вход) — обёртка закрывает панель, когда список аккаунтов обновился.
  async function reloadAccountsAndClose() {
    try {
      await reloadAccounts();
    } finally {
      onClose();
    }
  }

  const {
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
  } = useUserbotOnboarding({
    accessToken,
    planRules,
    userbotCount,
    reloadAccounts: reloadAccountsAndClose,
    showUiMessage
  });

  return (
    <div ref={panelRef} id="userbot-connect-panel" className="relative scroll-mt-4">
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-3 right-3 sm:top-4 sm:right-4 z-10 shrink-0"
        onClick={onClose}
        title="Скрыть окно подключения"
      >
        <X className="w-4 h-4" />
      </Button>
      <UserbotOnboardingSection
        availableOnboardingProxies={availableOnboardingProxies}
        currentQrFingerprintProfile={currentQrFingerprintProfile}
        fingerprintProfiles={fingerprintProfiles}
        fingerprintProfilesState={fingerprintProfilesState}
        handleJsonFileChange={handleJsonFileChange}
        handleSessionFileChange={handleSessionFileChange}
        importSession={importSession}
        onboarding={onboarding}
        proxyLabel={proxyLabel}
        startQrLogin={startQrLogin}
        steps={ONBOARDING_STEPS}
        switchFingerprintMode={switchFingerprintMode}
        updateOnboarding={updateOnboarding}
      />
    </div>
  );
}
