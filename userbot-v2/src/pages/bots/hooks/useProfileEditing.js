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
  const [labelDraft, setLabelDraft] = useState('');
  const [labelAccountId, setLabelAccountId] = useState('');
  const [labelSaving, setLabelSaving] = useState(false);
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
  useEffect(() => {
    if (!selectedUserbot?.id) {
      setLabelDraft('');
      setLabelAccountId('');
      return;
    }
    setLabelDraft(selectedUserbot.custom_label || '');
    setLabelAccountId(String(selectedUserbot.id));
  }, [selectedUserbot?.id, selectedUserbot?.custom_label]);
  const labelDirty = labelAccountId === String(selectedUserbot?.id || '') && labelDraft.trim() !== (selectedUserbot?.custom_label || '').trim();

  async function saveCustomLabel() {
    if (!accessToken || !selectedUserbot?.id || !labelDirty) return;
    const trimmed = labelDraft.trim().slice(0, 100);
    setLabelSaving(true);
    try {
      const result = await apiRequest(`/api/userbot/custom-label/${selectedUserbot.id}`, {
        accessToken,
        method: 'PATCH',
        body: { custom_label: trimmed }
      });
      patchLiveUserbot(selectedUserbot.id, { custom_label: result.custom_label || '' });
    } catch (error) {
      toast.error(`Не удалось сохранить метку: ${error.message}`);
    } finally {
      setLabelSaving(false);
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
        method: 'POST'
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

    const parts = [];
    if (profileDirty) parts.push('профиль');
    if (bindingDirty) parts.push('настройки прокси');

    if (!window.confirm(`Сохранить ${parts.join(' и ')} в Telegram?`)) return;

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
  };
}
