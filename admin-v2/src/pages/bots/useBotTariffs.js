import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';

export function useBotTariffs({ ownerId, botId }) {
  const [state, setState] = useState({
    loading: true,
    tariffs: [],
    bundleItems: [],
    bundleSupport: true,
    error: ''
  });

  const reload = useCallback(async () => {
    if (!ownerId || !botId) return;

    setState((prev) => ({ ...prev, loading: true, error: '' }));

    try {
      const [tariffsResult, bundleResult] = await Promise.all([
        supabase
          .from('tariffs')
          .select('*, channels(title)')
          .eq('owner_id', ownerId)
          .eq('bot_id', botId)
          .eq('is_active', true)
          .order('created_at', { ascending: false }),
        supabase
          .from('tariff_bundle_items')
          .select('*, channels(id, title)')
          .eq('owner_id', ownerId)
          .eq('is_active', true)
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true })
      ]);

      if (tariffsResult.error) throw tariffsResult.error;

      let bundleItems = [];
      let bundleSupport = true;
      if (bundleResult.error) {
        if ((bundleResult.error.message || '').includes('tariff_bundle_items')) {
          bundleSupport = false;
        } else {
          throw bundleResult.error;
        }
      } else {
        bundleItems = bundleResult.data || [];
      }

      setState({
        loading: false,
        tariffs: tariffsResult.data || [],
        bundleItems,
        bundleSupport,
        error: ''
      });
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error.message
      }));
    }
  }, [ownerId, botId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return {
    tariffs: state.tariffs,
    bundleItems: state.bundleItems,
    bundleSupport: state.bundleSupport,
    loading: state.loading,
    error: state.error,
    reload
  };
}
