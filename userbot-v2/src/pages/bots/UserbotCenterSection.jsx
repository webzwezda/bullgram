import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { UserPlus, User } from 'lucide-react';
import { useAuth } from '../../app/providers/AuthProvider.jsx';
import { LoadingState } from '../../ui/LoadingState.jsx';
import { PlanBanner } from '../../ui/PlanBanner.jsx';
import { UpgradeCallout } from '../../ui/UpgradeCallout.jsx';
import { UserbotSaleComposer } from './UserbotSaleComposer.jsx';
import { UserbotConnectPanel } from './UserbotConnectPanel.jsx';
import { ProxyConnectPanel } from './ProxyConnectPanel.jsx';
import { loadDraft } from './centerStorage.js';
import { useProfileEditing } from './hooks/useProfileEditing.js';
import { useCenterData } from './hooks/useCenterData.js';
import { useThreadMessaging } from './hooks/useThreadMessaging.js';
import { ProfileTab } from './tabs/ProfileTab.jsx';
import { GroupsTab } from './tabs/GroupsTab.jsx';
import { CenterAccountCard } from './components/CenterAccountCard.jsx';

const USERBOT_CENTER_HANDOFF_KEY = 'bullgram_userbot_center_handoff';

function consumeUserbotCenterHandoff() {
  try {
    const raw = window.localStorage.getItem(USERBOT_CENTER_HANDOFF_KEY);
    if (!raw) return null;
    window.localStorage.removeItem(USERBOT_CENTER_HANDOFF_KEY);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function needsBotsRecovery(message = '') {
  const value = String(message || '').toLowerCase();
  return value.includes('сессия') ||
    value.includes('подключите юзербота') ||
    value.includes('неактивным') ||
    value.includes('прокси') ||
    value.includes('expired') ||
    value.includes('auth_key_unregistered');
}

export function UserbotCenterSection({
  selectedLiveUserbot,
  selectedLiveUserbotId,
  binding,
  recovery,
  accountCheckReport,
  accountBindingFeedback,
  accountRestoreFeedback,
  bindingAccountId,
  checkingAccountId,
  togglingSafeModeId,
  restoringAccountId,
  saveBinding,
  updateBinding,
  checkAccount,
  toggleSafeMode,
  restoreAccount,
  patchLiveUserbot,
  proxyLabel,
  availableOnboardingProxies,
  availableBindingProxiesForAccount,
  availableFailoverProxiesForAccount,
  canRestoreFromFiles,
  defaultCheckLines,
  formatWhen,
  liveUserbots,
  reloadAccounts,
  setSelectedLiveUserbotId,
  userbotCount,
  deleteAccount,
  deletingAccountId,
  restrictedMarker,
  recoveryStatusBadge,
  canSellUserbotAssets,
  saleComposer,
  setSaleComposer,
  saveUserbotSaleLot,
  toggleSalePaymentMethod,
  openSaleComposer
}) {
  const location = useLocation();
  const sectionRef = useRef(null);
  const [connectPanelOpen, setConnectPanelOpen] = useState(false);
  const [proxyPanelOpen, setProxyPanelOpen] = useState(false);
  const [preferredProxyId, setPreferredProxyId] = useState('');

  // Кнопки «Подключить аккаунт» открывают инлайн-панель онбординга над
  // карточкой аккаунта; повторный клик при открытом окне просто подводит
  // скролл к нему, закрытие — крестик в панели.
  function openConnectPanel() {
    setConnectPanelOpen(true);
    setTimeout(() => {
      document.getElementById('userbot-connect-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }

  // Прокси поднят: закрываем панель прокси, обновляем списки страницы и
  // запоминаем созданный — панель аккаунта подставит его в шаг 1.
  async function handleProxyCreated(proxyIds) {
    setProxyPanelOpen(false);
    try {
      await reloadAccounts();
    } finally {
      if (Array.isArray(proxyIds) && proxyIds.length) {
        setPreferredProxyId(String(proxyIds[0]));
      }
    }
  }


  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const hasDeep = params.get('userbot_id') || params.get('tg_user_id');
    if (hasDeep && sectionRef.current) {
      const timer = setTimeout(() => {
        sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [location.search]);
  const { accessToken, profilePlan } = useAuth();
  const [initialHandoff] = useState(() => consumeUserbotCenterHandoff());
  const initialParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const initialThreadUserId = String(initialParams.get('tg_user_id') || initialHandoff?.tg_user_id || '').trim();
  const initialCommonChatId = String(initialHandoff?.common_chat_id || '').trim();
  const initialDraftMessage = String(initialHandoff?.draft_message || '').trim();
  const [manualCommonChatId, setManualCommonChatId] = useState(initialCommonChatId || loadDraft('manual_chat'));
  // Прилетели с handoff «Написать» из CRM — открываем сразу вкладку групп/диалогов,
  // а не профиль: иначе переход с экрана клиентов выглядит как бесполезная страница.
  const [activeTab, setActiveTab] = useState(initialThreadUserId ? 'groups' : 'profile');
  const [telegramWebEnabled, setTelegramWebEnabled] = useState(true);
  const [openPanels, setOpenPanels] = useState({ connection: false, session: false });
  function togglePanel(key) {
    setOpenPanels((prev) => ({ ...prev, [key]: !prev[key] }));
  }
  useEffect(() => {
    let cancelled = false;
    fetch('/api/userbot-web/status', { method: 'GET' })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (cancelled || !data) return;
        setTelegramWebEnabled(Boolean(data.enabled));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const profile = useProfileEditing({ accessToken, selectedUserbot: selectedLiveUserbot, selectedLiveUserbotId, patchLiveUserbot, saveBinding, binding });
  const {
    profileSyncState,
    profileDraft,
    setProfileDraft,
    labelDraft,
    setLabelDraft,
    labelDirty,
    labelSaving,
    saveCustomLabel,
    syncSelectedUserbotProfile,
    saveAllChanges,
    selectedDraftFirstName,
    selectedDraftLastName,
    selectedDraftAbout,
    selectedProfileName,
    selectedProfileTitle,
    selectedProfileInitial,
    selectedProfileAttemptedAt,
    selectedProfilePhotoSrc,
    profileDirty,
    bindingDirty,
    hasUnsavedChanges,
  } = profile;

  const { state, setState, threadUserId, setThreadUserId, chatHistory, setChatHistory, reloadCenter } = useCenterData({ accessToken, selectedLiveUserbot, selectedLiveUserbotId, initialThreadUserId, initialHandoff, manualCommonChatId, setManualCommonChatId });
  const data = state.data || {};
  const userbots = data.userbots || [];
  const groups = data.groups || [];
  const conversations = data.conversations || [];
  const summary = data.summary || {};
  const signalConfig = data.signal_config || {};
  const selectedUserbot = selectedLiveUserbot;

  const messaging = useThreadMessaging({ accessToken, selectedLiveUserbotId, conversations, threadUserId, setThreadUserId, setChatHistory, setState, reloadCenter, manualCommonChatId, initialThreadUserId, initialDraftMessage });
  const {
    actionState,
    manualInviteLink,
    setManualInviteLink,
    manualTgUserId,
    setManualTgUserId,
    manualDirectMessage,
    setManualDirectMessage,
    joinInviteLink,
    sendDirectMessage,
  } = messaging;

  useEffect(() => {
    if (activeTab !== 'sale') return;
    if (!selectedLiveUserbot) return;
    if (saleComposer.accountId === String(selectedLiveUserbot.id)) return;
    openSaleComposer(selectedLiveUserbot);
  }, [activeTab, selectedLiveUserbot, saleComposer.accountId, openSaleComposer]);

  const sortedConversations = useMemo(
    () => [...conversations].sort((a, b) => {
      if ((b.unread_count || 0) !== (a.unread_count || 0)) return (b.unread_count || 0) - (a.unread_count || 0);
      return String(b.last_message_at || '').localeCompare(String(a.last_message_at || ''));
    }),
    [conversations]
  );

  const commonChatGroups = useMemo(
    () => groups.filter((item) => item.chat_id),
    [groups]
  );

  if (state.loading && !initialHandoff) {
    return <LoadingState text="Тянем живой Центр юзербота..." />;
  }

  if (state.error) {
    return (
      <section ref={sectionRef} id="userbot-center" className="scroll-mt-4">
        <div className="error-card">{state.error}</div>
        {needsBotsRecovery(state.error) ? (
          <div className="toolbar-card" style={{ marginTop: 16 }}>
            <div className="toolbar-card__title">Что делать дальше</div>
            <div className="list-stack">
              <div className="list-item">
                <div className="list-item__title">Подключи юзербота на странице «Подключение»</div>
                <div className="list-item__meta">
                  Там живой onboarding: QR, импорт `.session/.json`, выбор прокси.{' '}
                  {/* `!` обязателен: unlayered `a { color: inherit }` в index.css перебивает цветовые утилиты на анкорах */}
                  <Link to="/connect" className="font-semibold text-action-primary! hover:text-action-primary-hover!">Перейти к подключению</Link>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    );
  }

  function renderSaleTab() {
    if (!selectedLiveUserbot) return null;
    return (
      <div className="p-5 sm:p-6 animate-fade-in">
        <UserbotSaleComposer
          account={selectedLiveUserbot}
          saleComposer={saleComposer}
          setSaleComposer={setSaleComposer}
          toggleSalePaymentMethod={toggleSalePaymentMethod}
          saveUserbotSaleLot={saveUserbotSaleLot}
        />
      </div>
    );
  }

  return (
    <section ref={sectionRef} id="userbot-center" className="scroll-mt-4">
      {profilePlan === 'trial' ? (
        <>
          <PlanBanner
            tone="info"
            title="Userbot Center на Trial — это быстрый пробный контур"
            text="На Trial можно собрать первый живой triage по входящим. Но как только userbot становится рабочим closеr-инструментом, переводи кабинет на Pro."
          />
          <UpgradeCallout
            compact
            title="Userbot уже приносит входящие — не держи этот контур в trial."
            text="Если здесь уже есть лички, сигналы покупки и ручной дожим, это основной рабочий экран. Pro нужен, чтобы дальше жить без ознакомительных стопоров."
          />
        </>
      ) : null}

      {state.loading && initialHandoff ? (
        <div className="mb-4 p-3 rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-800 font-medium text-sm flex items-center gap-2">
          <span className="inline-block size-3 animate-spin rounded-full border-2 border-indigo-400 border-t-indigo-700" />
          Подтягиваем данные юзербота...
        </div>
      ) : null}

      {proxyPanelOpen ? (
        <ProxyConnectPanel
          onClose={() => setProxyPanelOpen(false)}
          onCreated={handleProxyCreated}
        />
      ) : null}

      {connectPanelOpen ? (
        <UserbotConnectPanel
          availableOnboardingProxies={availableOnboardingProxies}
          onConnectProxy={() => setProxyPanelOpen(true)}
          onClose={() => setConnectPanelOpen(false)}
          preferredProxyId={preferredProxyId}
          proxyLabel={proxyLabel}
          reloadAccounts={reloadAccounts}
          userbotCount={userbotCount}
        />
      ) : null}

      {selectedLiveUserbot ? (
        <CenterAccountCard
          selectedLiveUserbot={selectedLiveUserbot}
          deleteAccount={deleteAccount}
          deletingAccountId={deletingAccountId}
          liveUserbots={liveUserbots}
          setSelectedLiveUserbotId={setSelectedLiveUserbotId}
          openConnectPanel={openConnectPanel}
          restrictedMarker={restrictedMarker}
          recoveryStatusBadge={recoveryStatusBadge}
          recovery={recovery}
          checkingAccountId={checkingAccountId}
          togglingSafeModeId={togglingSafeModeId}
          toggleSafeMode={toggleSafeMode}
          canSellUserbotAssets={canSellUserbotAssets}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          profileTab={
            <ProfileTab
              selectedLiveUserbot={selectedLiveUserbot}
              selectedUserbot={selectedUserbot}
              selectedLiveUserbotId={selectedLiveUserbotId}
              checkAccount={checkAccount}
              recovery={recovery}
              profileSyncState={profileSyncState}
              telegramWebEnabled={telegramWebEnabled}
              labelDirty={labelDirty}
              labelDraft={labelDraft}
              labelSaving={labelSaving}
              setLabelDraft={setLabelDraft}
              saveCustomLabel={saveCustomLabel}
              selectedProfilePhotoSrc={selectedProfilePhotoSrc}
              selectedProfileInitial={selectedProfileInitial}
              selectedProfileName={selectedProfileName}
              syncSelectedUserbotProfile={syncSelectedUserbotProfile}
              selectedDraftFirstName={selectedDraftFirstName}
              selectedDraftLastName={selectedDraftLastName}
              selectedDraftAbout={selectedDraftAbout}
              setProfileDraft={setProfileDraft}
              selectedProfileAttemptedAt={selectedProfileAttemptedAt}
              profileDirty={profileDirty}
              openPanels={openPanels}
              togglePanel={togglePanel}
              binding={binding}
              updateBinding={updateBinding}
              availableBindingProxiesForAccount={availableBindingProxiesForAccount}
              proxyLabel={proxyLabel}
              availableFailoverProxiesForAccount={availableFailoverProxiesForAccount}
              toggleSafeMode={toggleSafeMode}
              checkingAccountId={checkingAccountId}
              togglingSafeModeId={togglingSafeModeId}
              accountCheckReport={accountCheckReport}
              defaultCheckLines={defaultCheckLines}
              accountRestoreFeedback={accountRestoreFeedback}
              restoreAccount={restoreAccount}
              restoringAccountId={restoringAccountId}
              canRestoreFromFiles={canRestoreFromFiles}
              formatWhen={formatWhen}
              accountBindingFeedback={accountBindingFeedback}
              hasUnsavedChanges={hasUnsavedChanges}
              saveAllChanges={saveAllChanges}
              bindingAccountId={bindingAccountId}
            />
          }
          groupsTab={
            <GroupsTab
              manualInviteLink={manualInviteLink}
              setManualInviteLink={setManualInviteLink}
              joinInviteLink={joinInviteLink}
              actionState={actionState}
              manualTgUserId={manualTgUserId}
              setManualTgUserId={setManualTgUserId}
              manualCommonChatId={manualCommonChatId}
              setManualCommonChatId={setManualCommonChatId}
              manualDirectMessage={manualDirectMessage}
              setManualDirectMessage={setManualDirectMessage}
              sendDirectMessage={sendDirectMessage}
            />
          }
          saleTab={renderSaleTab()}
        />
      ) : (
        <div className="bg-white border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 rounded-2xl overflow-hidden">
          <div className="p-12 text-center flex flex-col items-center justify-center">
            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4 ring-1 ring-slate-100">
              <User className="w-8 h-8 text-slate-300" />
            </div>
            <h3 className="text-base font-semibold text-slate-900">Боевых аккаунтов пока нет</h3>
            <p className="mt-1 text-sm text-slate-500 max-w-sm">
              Подключи аккаунт в разделе «Подключение» — и его профиль, прокси и проверка сессии появятся здесь.
            </p>
            <button
              type="button"
              onClick={openConnectPanel}
              className="mt-4 h-10 px-4 inline-flex items-center gap-2 rounded-xl bg-action-primary text-action-primary-text! text-sm font-bold hover:bg-action-primary-hover shadow-sm"
            >
              <UserPlus className="w-4 h-4" />
              Подключить аккаунт
            </button>
          </div>
        </div>
      )}

    </section>
  );
}
