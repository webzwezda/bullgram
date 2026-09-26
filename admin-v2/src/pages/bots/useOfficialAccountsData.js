import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../../api/client.js';
import { supabase } from '../../lib/supabase.js';

// Срез данных страницы «Бот продаж» (/app/sales-bot).
//
// Контурная ротация юзерботов — paywall-фича, поэтому этот хук НЕСЁТ
// юзерботные данные: варианты ротации считаются из `accounts`
// (tg_accounts: боты И юзерботы), `proxies` (GET /api/userbot/proxies,
// включая proxySupport) и `reservedUserbotIds`
// (GET /api/shop/seller/reserved-assets) — проверено 2026-09-26,
// план docs/plans/2026-09-26-userbot-product-split.md, «Разрезается».
//
// Относительно общего useBotsAccountsData выкинуты только юзербот-витринные
// запросы: GET /api/shop/seller/items и GET /api/userbot/recovery-status.

const INITIAL_STATE = {
  loading: true,
  refreshing: false,
  savingBot: false,
  savingContourBotId: '',
  replacingTokenId: '',
  webhookRuntimeActionId: '',
  deletingBotId: '',
  error: '',
  accounts: [],
  proxies: [],
  proxySupport: null,
  reservedUserbotIds: [],
  channels: [],
  officialBotContoursPayload: null,
  officialBotContoursError: '',
  paymentAdminTgId: '',
  updatedAt: null
};

async function fetchOfficialAccountsPayload({ accessToken, ownerId }) {
  const [accountsResp, proxiesResp, reservedResp, paymentResp, channelsResp, contoursResp] = await Promise.all([
    supabase
      .from('tg_accounts')
      .select('*')
      .eq('owner_id', ownerId)
      .order('created_at', { ascending: false }),
    apiRequest('/api/userbot/proxies', { accessToken }),
    apiRequest('/api/shop/seller/reserved-assets', { accessToken }),
    supabase
      .from('payment_settings')
      .select('admin_tg_id')
      .eq('owner_id', ownerId)
      .maybeSingle(),
    supabase
      .from('channels')
      .select('id, title, tg_chat_id, bot_id, chat_type, username, visibility, last_visibility_check_at')
      .eq('owner_id', ownerId),
    apiRequest('/api/official-bot/contours', { accessToken })
      .then((payload) => ({ payload, error: '' }))
      .catch((error) => ({ payload: null, error: error.message }))
  ]);

  if (accountsResp.error) throw accountsResp.error;
  if (paymentResp.error) throw paymentResp.error;
  if (channelsResp.error) throw channelsResp.error;

  return {
    accounts: accountsResp.data || [],
    proxies: proxiesResp.proxies || [],
    proxySupport: proxiesResp.support || null,
    reservedUserbotIds: (reservedResp.userbot_ids || []).map(String),
    channels: channelsResp.data || [],
    officialBotContoursPayload: contoursResp.payload,
    officialBotContoursError: contoursResp.error || '',
    paymentAdminTgId: paymentResp.data?.admin_tg_id || '',
    updatedAt: new Date().toISOString()
  };
}

export function useOfficialAccountsData({ accessToken, ownerId }) {
  const [state, setState] = useState(INITIAL_STATE);

  const reloadAccounts = useCallback(async () => {
    const payload = await fetchOfficialAccountsPayload({ accessToken, ownerId });
    setState((prev) => ({
      ...prev,
      ...payload
    }));
    return payload;
  }, [accessToken, ownerId]);

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
        const payload = await fetchOfficialAccountsPayload({ accessToken, ownerId });
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
          channels: [],
          officialBotContoursPayload: null,
          officialBotContoursError: '',
          paymentAdminTgId: '',
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
    setState,
    state
  };
}
