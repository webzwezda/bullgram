import { useEffect } from 'react';
import { apiRequest } from '../../../api/client.js';
import { supabase } from '../../../lib/supabase.js';
import { consumeManualSelection, loadDraft, baseValueFromPreparation } from '../utils/broadcastDraft.js';

export function useBroadcastBootstrap({
  accessToken,
  user,
  setState,
  setForm,
  setManual,
  setPoolIds,
  setPreparation,
  setBroadcastFlags
}) {
  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      if (!accessToken || !user?.id) return;
      try {
        const draft = loadDraft();
        if (draft) {
          setForm((prev) => ({ ...prev, ...draft, base: prev.base || draft.base }));
        }
        const manualSelection = consumeManualSelection();
        const urlParams = new URLSearchParams(window.location.search);
        const queryBaseId = urlParams.get('base_id');
        const queryAudienceType = urlParams.get('audience_type');
        const [{ data: rawUserbots }, reserved, clientBases, preparations] = await Promise.all([
          supabase
            .from('tg_accounts')
            .select('id, tg_username, tg_account_id, runtime_status, proxy_id, proxies(id, name, is_working, last_check_country, host, port)')
            .eq('owner_id', user.id)
            .eq('account_type', 'userbot')
            .order('created_at', { ascending: false }),
          apiRequest('/api/shop/seller/reserved-assets', { accessToken }),
          apiRequest('/api/client-bases', { accessToken }),
          apiRequest('/api/broadcast/preparations', { accessToken })
        ]);

        const reservedIds = new Set((reserved.userbot_ids || []).map(String));
        const userbots = (rawUserbots || []).filter((row) => !reservedIds.has(String(row.id)));

        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: '',
          clientBases: clientBases.bases || [],
          userbots
        }));
        setBroadcastFlags(preparations.flags || {});

        setPoolIds((prev) => (prev.length ? prev : (userbots[0] ? [userbots[0].id] : [])));

        const activePrep = preparations.active;
        const readyPrep = activePrep ? null : (preparations.preparations || []).find((row) => {
          if (row.status !== 'ready') return false;
          return Date.now() - new Date(row.updated_at || row.created_at).getTime() < 24 * 60 * 60 * 1000;
        });
        const restored = activePrep || readyPrep;
        if (restored?.id) {
          let full = restored;
          try {
            const data = await apiRequest(`/api/broadcast/preparations/${restored.id}`, { accessToken });
            full = data.preparation || restored;
          } catch {
            // список уже дал основное
          }
          if (cancelled) return;
          setPreparation(full);
          if ((full.userbot_ids || []).length) {
            const existing = new Set(userbots.map((row) => String(row.id)));
            setPoolIds(full.userbot_ids.filter((id) => existing.has(String(id))));
          }
          const value = baseValueFromPreparation(full);
          if (value) {
            setForm((prev) => ({ ...prev, base: prev.base || value }));
          }
          if (full.audience_type === 'manual_list' && (full.manual_tg_user_ids || []).length) {
            setManual({ tg_user_ids: full.manual_tg_user_ids, members: [] });
          }
        }

        if (manualSelection?.tg_user_ids?.length) {
          setManual({ tg_user_ids: manualSelection.tg_user_ids || [], members: manualSelection.members || [] });
          setForm((prev) => ({
            ...prev,
            base: 'manual',
            title: prev.title || manualSelection.suggested_title || '',
            message_text: prev.message_text || manualSelection.suggested_message || ''
          }));
        }

        if (queryBaseId && queryAudienceType === 'client_base_members') {
          setForm((prev) => {
            const next = { ...prev, base: `client:${queryBaseId}` };
            const suggested = (clientBases.bases || []).find((b) => b.id === queryBaseId);
            if (suggested && !prev.title) {
              next.title = `Рассылка по базе «${suggested.name}»`;
            }
            window.history.replaceState({}, '', window.location.pathname);
            return next;
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState((prev) => ({ ...prev, loading: false, error: error.message }));
        }
      }
    }

    loadAll();
    return () => {
      cancelled = true;
    };
  }, [accessToken, user?.id]);
}
