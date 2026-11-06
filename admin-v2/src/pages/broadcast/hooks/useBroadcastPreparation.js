import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { apiRequest } from '../../../api/client.js';
import { fetchClientBaseMembers } from '../../../api/client-bases.js';
import { ACTIVE_PREPARATION_STATUSES, MEMBERS_PAGE_SIZE } from '../utils/broadcastDraft.js';

export function useBroadcastPreparation({
  accessToken,
  form,
  audienceType,
  apiBaseId,
  manual,
  selectedIds,
  clientSelectionActive,
  poolIds,
  baseSelected,
  setStep
}) {
  const [preparation, setPreparation] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const [members, setMembers] = useState({ rows: [], total: 0, loading: false, error: '' });
  const [membersPage, setMembersPage] = useState(0);
  const [membersReloadKey, setMembersReloadKey] = useState(0);
  const [groupsText, setGroupsText] = useState('');
  const [pendingGroups, setPendingGroups] = useState([]);
  const [addingGroups, setAddingGroups] = useState(false);
  const pollRef = useRef(null);
  const memberIndexRef = useRef(new Map());

  const manualPayload = clientSelectionActive
    ? {
        tg_user_ids: selectedIds,
        members: selectedIds.map((id) => {
          const row = memberIndexRef.current.get(String(id));
          return { tg_user_id: id, username: row?.username || '', display_name: row?.display_name || '' };
        })
      }
    : { tg_user_ids: manual.tg_user_ids || [], members: manual.members || [] };

  // Состав выбранной базы (постранично)
  useEffect(() => {
    if (!accessToken || !form.base.startsWith('client:')) {
      setMembers({ rows: [], total: 0, loading: false, error: '' });
      return;
    }
    let cancelled = false;
    async function loadMembers() {
      setMembers((prev) => ({ ...prev, loading: true, error: '' }));
      try {
        const data = await fetchClientBaseMembers(accessToken, form.base.slice('client:'.length), {
          limit: MEMBERS_PAGE_SIZE,
          offset: membersPage * MEMBERS_PAGE_SIZE
        });
        if (!cancelled) {
          const rows = data.members || [];
          for (const row of rows) {
            memberIndexRef.current.set(String(row.tg_user_id), row);
          }
          setMembers({ rows, total: data.summary?.total || 0, loading: false, error: '' });
        }
      } catch (error) {
        if (!cancelled) {
          setMembers({ rows: [], total: 0, loading: false, error: error.message });
        }
      }
    }
    loadMembers();
    return () => {
      cancelled = true;
    };
  }, [accessToken, form.base, membersPage, membersReloadKey]);

  // Поллинг активной подготовки
  useEffect(() => {
    if (!accessToken || !preparation?.id || !ACTIVE_PREPARATION_STATUSES.has(preparation.status)) {
      if (pollRef.current) {
        window.clearTimeout(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    const preparationId = preparation.id;
    async function poll() {
      try {
        const data = await apiRequest(`/api/broadcast/preparations/${preparationId}`, { accessToken });
        setPreparation(data.preparation || null);
      } catch {
        // следующая итерация попробует снова
      }
      pollRef.current = window.setTimeout(poll, 3000);
    }
    pollRef.current = window.setTimeout(poll, 3000);
    return () => {
      if (pollRef.current) {
        window.clearTimeout(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [accessToken, preparation?.id, preparation?.status]);

  async function startPreparation() {
    if (!baseSelected) {
      toast.error('Выбери базу.');
      return;
    }
    if (poolIds.length === 0) {
      toast.error('Выбери юзерботов.');
      return;
    }

    setPreparing(true);
    try {
      const data = await apiRequest('/api/broadcast/preparations', {
        accessToken,
        method: 'POST',
        body: {
          audience_type: audienceType,
          base_id: apiBaseId,
          manual_tg_user_ids: manualPayload.tg_user_ids,
          manual_members: manualPayload.members,
          userbot_ids: poolIds
        }
      });
      setPreparation({
        id: data.id,
        status: 'pending',
        phase_detail: {},
        audience_type: audienceType,
        base_id: apiBaseId,
        manual_tg_user_ids: manualPayload.tg_user_ids,
        userbot_ids: poolIds
      });
      setStep('prepare');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setPreparing(false);
    }
  }

  async function cancelPreparation() {
    if (!preparation?.id) return;
    try {
      await apiRequest(`/api/broadcast/preparations/${preparation.id}`, { accessToken, method: 'DELETE' });
      setPreparation(null);
      setStep('userbots');
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function recheckPreparation() {
    if (!preparation?.id) return;
    try {
      await apiRequest(`/api/broadcast/preparations/${preparation.id}/recheck`, { accessToken, method: 'POST' });
      setPreparation((prev) => (prev ? { ...prev, status: 'scanning' } : prev));
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function addJoinTargets(targets) {
    if (!preparation?.id) return;
    try {
      await apiRequest(`/api/broadcast/preparations/${preparation.id}/join-targets`, {
        accessToken,
        method: 'POST',
        body: { targets }
      });
      setPreparation((prev) => (prev ? { ...prev, status: 'joining' } : prev));
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function submitGroups() {
    const targets = groupsText.split('\n').map((line) => line.trim()).filter(Boolean);
    if (targets.length === 0 || !preparation?.id) return;
    if (ACTIVE_PREPARATION_STATUSES.has(preparation.status)) {
      setPendingGroups((prev) => [...prev, ...targets]);
      setGroupsText('');
      toast('Группы в очереди — юзерботы вступятся сразу после конца подготовки.');
      return;
    }
    setAddingGroups(true);
    try {
      await addJoinTargets(targets);
      setGroupsText('');
    } finally {
      setAddingGroups(false);
    }
  }

  // очередь групп из submitGroups вступается, как только подготовка закончится
  useEffect(() => {
    if (pendingGroups.length === 0 || !preparation?.id) return;
    if (preparation.status !== 'ready' && preparation.status !== 'failed') return;
    const targets = pendingGroups;
    setPendingGroups([]);
    addJoinTargets(targets);
  }, [preparation?.id, preparation?.status, pendingGroups]);

  return {
    preparation,
    setPreparation,
    preparing,
    members,
    membersPage,
    setMembersPage,
    membersReloadKey,
    setMembersReloadKey,
    manualPayload,
    groupsText,
    setGroupsText,
    pendingGroups,
    addingGroups,
    startPreparation,
    cancelPreparation,
    recheckPreparation,
    submitGroups
  };
}
