import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../../api/client.js';
import { supabase } from '../../lib/supabase.js';

// Юзербот-режим хука из admin-v2 (план 2026-09-26-userbot-product-split, «Разрезается»):
// official-часть (контуры /api/official-bot/contours и payment_settings) сюда не едет —
// её потребители (OfficialBotsSection, useSalesContourController) остаются в paywall-кабине.
// Проверено по потребителям: юзерботным секциям/контроллерам нужны tg_accounts, channels
// (channelsByBotId в derived state), proxies (+proxySupport.profile_role), reserved-assets,
// seller/items, recovery-status.
const INITIAL_STATE = {
  loading: true,
  refreshing: false,
  checkingAccountId: '',
  togglingSafeModeId: '',
  bindingAccountId: '',
  deletingAccountId: '',
  deletingShopItemId: '',
  restoringAccountId: '',
  error: '',
  accounts: [],
  proxies: [],
  proxySupport: null,
  reservedUserbotIds: [],
  reservedItemsByAsset: {},
  sellerItemsById: {},
  channels: [],
  recoveryMap: {},
  recoverySupported: true,
  updatedAt: null
};

async function fetchBotsAccountsPayload({ accessToken, ownerId }) {
  const [accountsResp, proxiesResp, reservedResp, sellerItemsResp, recoveryResp, channelsResp] = await Promise.all([
    supabase
      .from('tg_accounts')
      .select('*')
      .eq('owner_id', ownerId)
      .order('created_at', { ascending: false }),
    apiRequest('/api/userbot/proxies', { accessToken }),
    apiRequest('/api/shop/seller/reserved-assets', { accessToken }),
    apiRequest('/api/shop/seller/items', { accessToken }).catch(() => ({ items: [] })),
    apiRequest('/api/userbot/recovery-status', { accessToken }).catch(() => ({
      support: { recovery: false },
      rows: []
    })),
    supabase
      .from('channels')
      .select('id, title, tg_chat_id, bot_id, chat_type, username, visibility, last_visibility_check_at')
      .eq('owner_id', ownerId)
  ]);

  if (accountsResp.error) throw accountsResp.error;
  if (channelsResp.error) throw channelsResp.error;

  return {
    accounts: accountsResp.data || [],
    proxies: proxiesResp.proxies || [],
    proxySupport: proxiesResp.support || null,
    reservedUserbotIds: (reservedResp.userbot_ids || []).map(String),
    reservedItemsByAsset: Object.fromEntries((reservedResp.entries || []).map((entry) => [entry.key, entry])),
    sellerItemsById: Object.fromEntries((sellerItemsResp.items || []).map((item) => [String(item.id), item])),
    channels: channelsResp.data || [],
    recoveryMap: Object.fromEntries((recoveryResp.rows || []).map((row) => [String(row.account_id), row])),
    recoverySupported: recoveryResp.support?.recovery !== false,
    updatedAt: new Date().toISOString()
  };
}

export function useBotsAccountsData({ accessToken, ownerId }) {
  const [state, setState] = useState(INITIAL_STATE);

  const reloadAccounts = useCallback(async () => {
    const payload = await fetchBotsAccountsPayload({ accessToken, ownerId });
    setState((prev) => ({
      ...prev,
      ...payload
    }));
    return payload;
  }, [accessToken, ownerId]);

  const patchLiveUserbot = useCallback((accountId, patch) => {
    if (!accountId || !patch) return;
    setState((prev) => ({
      ...prev,
      accounts: prev.accounts.map((account) =>
        String(account.id) === String(accountId) ? { ...account, ...patch } : account
      )
    }));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadData({ silent = false } = {}) {
      if (!silent) {
        setState((prev) => ({
          ...prev,
          loading: !prev.accounts.length,
          refreshing: !!prev.accounts.length,
          error: ''
        }));
      }

      try {
        const payload = await fetchBotsAccountsPayload({ accessToken, ownerId });
        if (cancelled) return;

        setState((prev) => ({
          ...prev,
          loading: false,
          refreshing: false,
          error: '',
          ...payload
        }));
      } catch (error) {
        if (cancelled) return;

        setState((prev) => ({
          ...prev,
          loading: false,
          refreshing: false,
          error: error.message,
          accounts: [],
          proxies: [],
          proxySupport: null,
          reservedUserbotIds: [],
          reservedItemsByAsset: {},
          sellerItemsById: {},
          channels: [],
          recoveryMap: {},
          recoverySupported: true,
          updatedAt: null
        }));
      }
    }

    if (accessToken && ownerId) {
      loadData();
    }

    const intervalId = accessToken && ownerId
      ? window.setInterval(() => {
          loadData({ silent: true });
        }, 60_000)
      : null;

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [accessToken, ownerId]);

  return {
    reloadAccounts,
    patchLiveUserbot,
    setState,
    state
  };
}
