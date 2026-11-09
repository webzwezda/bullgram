import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiRequest } from '../../../api/client.js';

function formatDate(value) {
  if (!value) return 'Нет данных';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

export function useProfileEditing({ accessToken, selectedUserbot, selectedLiveUserbotId, patchLiveUserbot, saveBinding, binding }) {
  const [profileSyncState, setProfileSyncState] = useState({
    pulling: false,
    saving: false,
    tone: 'default',
    text: ''
  });
  const [profileDraft, setProfileDraft] = useState({
    accountId: '',
    firstName: '',
    lastName: '',
    about: ''
  });
  const [usernameDraft, setUsernameDraft] = useState('');
  const [usernameAccountId, setUsernameAccountId] = useState('');
  const [usernameSaving, setUsernameSaving] = useState(false);
  useEffect(() => {
    setProfileSyncState({ pulling: false, saving: false, tone: 'default', text: '' });
  }, [accessToken, selectedLiveUserbotId]);
  useEffect(() => {
    if (!selectedUserbot?.id) {
      setProfileDraft({ accountId: '', firstName: '', lastName: '', about: '' });
      return;
    }
    setProfileDraft({
      accountId: String(selectedUserbot.id),
      firstName: selectedUserbot.tg_first_name || '',
      lastName: selectedUserbot.tg_last_name || '',
      about: selectedUserbot.tg_about || ''
    });
  }, [
    selectedUserbot?.id,
    selectedUserbot?.tg_first_name,
    selectedUserbot?.tg_last_name,
    selectedUserbot?.tg_about
  ]);
  // Быстрое редактирование @username: черновик без ведущей @, сохранение —
  // живой Telegram-вызов POST /api/userbot/username/:id.
  useEffect(() => {
    if (!selectedUserbot?.id) {
      setUsernameDraft('');
      setUsernameAccountId('');
      return;
    }
    setUsernameDraft((selectedUserbot.tg_username || '').replace(/^@/, ''));
    setUsernameAccountId(String(selectedUserbot.id));
  }, [selectedUserbot?.id, selectedUserbot?.tg_username]);
  const usernameDirty = usernameAccountId === String(selectedUserbot?.id || '')
    && usernameDraft.trim().replace(/^@/, '') !== (selectedUserbot?.tg_username || '').replace(/^@/, '').trim();

  async function saveUsername() {
    if (!accessToken || !selectedUserbot?.id || !usernameDirty) return;
    const cleaned = usernameDraft.trim().replace(/^@/, '');
    if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(cleaned)) {
      toast.error('Username не подходит: 5–32 символа, латиница, цифры и _, начинается с буквы.');
      return;
    }
    setUsernameSaving(true);
    try {
      const result = await apiRequest(`/api/userbot/username/${selectedUserbot.id}`, {
        accessToken,
        method: 'POST',
        body: { username: cleaned },
        signal: AbortSignal.timeout(60000)
      });
      patchLiveUserbot(selectedUserbot.id, { tg_username: result.tg_username || cleaned });
      toast.success('Username сохранён в Telegram.');
    } catch (error) {
      toast.error(`Не удалось сменить username: ${error.message}`);
    } finally {
      setUsernameSaving(false);
    }
  }
  const selectedDraftFirstName = profileDraft.accountId === String(selectedUserbot?.id || '') ? profileDraft.firstName : '';
  const selectedDraftLastName = profileDraft.accountId === String(selectedUserbot?.id || '') ? profileDraft.lastName : '';
  const selectedDraftAbout = profileDraft.accountId === String(selectedUserbot?.id || '') ? profileDraft.about : '';
  const selectedProfileName = selectedUserbot
    ? [selectedDraftFirstName || selectedUserbot.tg_first_name, selectedDraftLastName || selectedUserbot.tg_last_name].filter(Boolean).join(' ').trim()
    : '';
  const selectedProfileTitle = selectedProfileName || (
    selectedUserbot?.tg_username ? `@${selectedUserbot.tg_username}` : 'Имя пока не подтянуто'
  );
  const selectedProfileInitial = (
    selectedProfileName ||
    selectedUserbot?.tg_username ||
    String(selectedUserbot?.tg_account_id || '?')
  ).slice(0, 1).toUpperCase();
  const selectedProfileAttemptedAt = selectedUserbot?.tg_profile_sync_attempted_at
    ? formatDate(selectedUserbot.tg_profile_sync_attempted_at)
    : '';
  const selectedProfilePhotoSrc = selectedUserbot?.tg_photo_url
    ? `${selectedUserbot.tg_photo_url}${selectedUserbot.tg_photo_synced_at ? `?v=${encodeURIComponent(selectedUserbot.tg_photo_synced_at)}` : ''}`
    : (selectedUserbot?.tg_photo_data_url || '');
  const profileDirty = !!selectedUserbot && (
    selectedDraftFirstName !== (selectedUserbot.tg_first_name || '') ||
    selectedDraftLastName !== (selectedUserbot.tg_last_name || '') ||
    selectedDraftAbout !== (selectedUserbot.tg_about || '')
  );
  const bindingDirty = !!selectedUserbot && !!binding && (
    String(binding.proxy_id || '') !== String(selectedUserbot.proxy_id || '') ||
    !!binding.allow_proxy_failover !== !!selectedUserbot.allow_proxy_failover ||
    (binding.failover_proxy_ids || []).slice().sort().join('|') !==
      (Array.isArray(selectedUserbot.failover_proxy_ids) ? selectedUserbot.failover_proxy_ids.map(String) : []).slice().sort().join('|')
  );
  const hasUnsavedChanges = profileDirty || bindingDirty;
  async function syncSelectedUserbotProfile() {
    if (!accessToken || !selectedLiveUserbotId) return;

    setProfileSyncState({ pulling: true, saving: false, tone: 'default', text: '' });
    try {
      const result = await apiRequest(`/api/userbot/profile/${selectedLiveUserbotId}/sync`, {
        accessToken,
        method: 'POST',
        signal: AbortSignal.timeout(60000)
      });

      if (result.account) {
        patchLiveUserbot(result.account.id, result.account);
      }

      const message = result.message || (result.cached ? 'Показываем сохраненный профиль.' : 'Профиль стянут из Telegram.');
      if (result.cached) {
        toast.warning(message);
      } else {
        toast.success(message);
      }
      setProfileSyncState({ pulling: false, saving: false, tone: 'default', text: '' });
    } catch (error) {
      toast.error(`Не получилось стянуть профиль: ${error.message}`);
      setProfileSyncState({ pulling: false, saving: false, tone: 'error', text: error.message });
    }
  }
  async function saveSelectedUserbotProfile() {
    if (!accessToken || !selectedLiveUserbotId) return;
    const firstName = String(profileDraft.firstName || '').trim();
    const lastName = String(profileDraft.lastName || '').trim();
    const about = String(profileDraft.about || '').trim();

    if (!firstName) {
      setProfileSyncState({
        pulling: false,
        saving: false,
        tone: 'error',
        text: 'Имя Telegram-аккаунта не может быть пустым.'
      });
      return;
    }

    setProfileSyncState({ pulling: false, saving: true, tone: 'default', text: '' });
    try {
      const result = await apiRequest(`/api/userbot/profile/${selectedLiveUserbotId}/update`, {
        accessToken,
        method: 'POST',
        signal: AbortSignal.timeout(60000),
        body: {
          first_name: firstName,
          last_name: lastName,
          about
        }
      });

      if (result.account) {
        patchLiveUserbot(result.account.id, result.account);
      }

      setProfileSyncState({
        pulling: false,
        saving: false,
        tone: 'success',
        text: result.message || 'Профиль сохранен в Telegram и Supabase.'
      });
      toast.success(result.message || 'Профиль сохранен в Telegram.');
    } catch (error) {
      setProfileSyncState({
        pulling: false,
        saving: false,
        tone: 'error',
        text: error.message
      });
      toast.error(`Не получилось сохранить: ${error.message}`);
    }
  }
  async function saveAllChanges() {
    if (!accessToken || !selectedLiveUserbotId || !selectedUserbot) return;
    if (!hasUnsavedChanges) return;

    if (profileDirty) {
      await saveSelectedUserbotProfile();
    }
    if (bindingDirty) {
      await saveBinding(selectedLiveUserbotId);
    }
  }
  return {
    profileSyncState,
    profileDraft,
    setProfileDraft,
    usernameDraft,
    setUsernameDraft,
    usernameDirty,
    usernameSaving,
    saveUsername,
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
  };
}
