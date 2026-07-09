import { useEffect, useState } from 'react';
import { apiRequest } from '../../api/client.js';
import {
  buildCheckLines,
  checkLine,
  proxyLabel,
  saleTitleForAccount,
  summarizeCheckStatus
} from './bots-accounts.utils.js';

function emptyFeedback() {
  return { accountId: '', tone: 'default', text: '' };
}

function emptyCheckReport() {
  return { accountId: '', title: '', tone: 'default', lines: [], checkedAt: '' };
}

function initialSaleComposer() {
  return {
    accountId: '',
    title: '',
    sale_type: 'userbot',
    price_ton: '',
    payment_methods: ['ton'],
    saving: false,
    error: ''
  };
}

export function useLiveUserbotsController({
  accessToken,
  patchLiveUserbot,
  reloadAccounts,
  setState,
  state,
  usedUserbotProxyIds,
  userbots,
  showUiMessage
}) {
  const [bindings, setBindings] = useState({});
  const [accountCheckFeedback, setAccountCheckFeedback] = useState(emptyFeedback);
  const [accountCheckReport, setAccountCheckReport] = useState(emptyCheckReport);
  const [accountBindingFeedback, setAccountBindingFeedback] = useState(emptyFeedback);
  const [accountRestoreFeedback, setAccountRestoreFeedback] = useState(emptyFeedback);
  const [accountDeleteFeedback, setAccountDeleteFeedback] = useState(emptyFeedback);
  const [saleComposer, setSaleComposer] = useState(initialSaleComposer);

  useEffect(() => {
    setBindings((prev) => {
      const next = { ...prev };
      let changed = false;
      userbots.forEach((account) => {
        if (next[account.id]) return;
        const primaryProxyId = account.proxy_id ? String(account.proxy_id) : '';
        const safeFailoverIds = Array.isArray(account.failover_proxy_ids)
          ? account.failover_proxy_ids.map(String).filter((id) => id && id !== primaryProxyId)
          : [];
        next[account.id] = {
          proxy_id: primaryProxyId,
          allow_proxy_failover: !!account.allow_proxy_failover,
          failover_proxy_ids: safeFailoverIds
        };
        changed = true;
      });
      return changed ? next : prev;
    });
  }, [userbots]);

  function openSaleComposer(account) {
    setSaleComposer({
      accountId: String(account.id),
      title: saleTitleForAccount(account),
      sale_type: account.proxy_id ? 'bundle' : 'userbot',
      price_ton: '15',
      payment_methods: ['ton'],
      saving: false,
      error: ''
    });
  }

  function resetSaleComposer() {
    setSaleComposer(initialSaleComposer());
  }

  function toggleSalePaymentMethod(method, enabled) {
    setSaleComposer((prev) => {
      const nextMethods = enabled
        ? Array.from(new Set([...(prev.payment_methods || []), method]))
        : (prev.payment_methods || []).filter((item) => item !== method);
      return {
        ...prev,
        payment_methods: nextMethods
      };
    });
  }

  function availableBindingProxiesForAccount(account) {
    return state.proxies.filter((proxy) => {
      if (proxy.is_working === false) return false;
      if (state.proxySupport?.profile_role === 'admin' && proxy.inventory_group !== 'self_use') {
        return false;
      }

      const proxyId = String(proxy.id);
      const accountProxyId = String(account.proxy_id || '');
      return proxyId === accountProxyId || !usedUserbotProxyIds.has(proxyId);
    });
  }

  function availableFailoverProxiesForAccount(account) {
    const currentPrimaryProxyId = String(bindings[account.id]?.proxy_id || account.proxy_id || '');

    return state.proxies.filter((proxy) => {
      if (proxy.is_working === false) return false;
      if (state.proxySupport?.profile_role === 'admin' && proxy.inventory_group !== 'self_use') {
        return false;
      }

      const proxyId = String(proxy.id);
      if (proxyId === currentPrimaryProxyId) return false;
      return !usedUserbotProxyIds.has(proxyId);
    });
  }

  async function restoreAccount(account) {
    setAccountRestoreFeedback({ accountId: String(account.id), tone: 'default', text: '' });
    setState((prev) => ({ ...prev, restoringAccountId: String(account.id) }));
    try {
      const result = await apiRequest(`/api/userbot/restore/${account.id}`, {
        accessToken,
        method: 'POST'
      });
      await reloadAccounts();
      setAccountRestoreFeedback({
        accountId: String(account.id),
        tone: 'success',
        text: `Сессию восстановили: @${result.username || account.tg_username || 'без username'}`
      });
      showUiMessage(`Аккаунт @${result.username || account.tg_username || 'без username'} восстановлен.`, 'success');
    } catch (error) {
      setAccountRestoreFeedback({
        accountId: String(account.id),
        tone: 'error',
        text: error.message
      });
      showUiMessage(error.message, 'error');
    } finally {
      setState((prev) => ({ ...prev, restoringAccountId: '' }));
    }
  }

  async function deleteAccount(account) {
    if (!window.confirm(`Удалить ${account.account_type === 'userbot' ? 'юзербота' : 'бота'} и освободить его контур?`)) {
      return;
    }

    setAccountDeleteFeedback({ accountId: String(account.id), tone: 'default', text: '' });
    setState((prev) => ({ ...prev, deletingAccountId: String(account.id) }));
    try {
      await apiRequest(`/api/userbot/${account.id}`, {
        accessToken,
        method: 'DELETE'
      });
      await reloadAccounts();
      setAccountDeleteFeedback({
        accountId: String(account.id),
        tone: 'success',
        text: 'Аккаунт удален.'
      });
      showUiMessage('Аккаунт удален.', 'success');
    } catch (error) {
      setAccountDeleteFeedback({
        accountId: String(account.id),
        tone: 'error',
        text: error.message
      });
      showUiMessage(error.message, 'error');
    } finally {
      setState((prev) => ({ ...prev, deletingAccountId: '' }));
    }
  }

  async function checkAccount(account) {
    const isFresh = String(account?.runtime_status || '') === 'pending_activation';
    const actionLabel = isFresh ? 'Активировать аккаунт' : 'Проверить Telegram';
    if (!window.confirm(`${actionLabel}: это живая Telegram-проверка, а не просто чтение локальной сессии. Мы проверим, отвечает ли сессия, есть ли ограничения у аккаунта и что показывает пассивная проверка через SpamBot. ${isFresh ? 'Для свежего импорта это снимет safe-mode и переведёт аккаунт в рабочий статус, если Telegram не видит проблем. ' : ''}Продолжить?`)) {
      return;
    }
    const accountId = account?.id;
    setAccountCheckFeedback({ accountId: String(accountId), tone: 'default', text: '' });
    setAccountCheckReport(emptyCheckReport());
    setState((prev) => ({ ...prev, checkingAccountId: String(accountId) }));
    try {
      const result = await apiRequest(`/api/userbot/check/${accountId}?activate=true`, { accessToken });
      await reloadAccounts();
      const summary = summarizeCheckStatus(result, account);
      setAccountCheckFeedback({
        accountId: String(accountId),
        tone: summary.tone,
        text: result?.reason || summary.title
      });
      showUiMessage(summary.title, summary.tone === 'error' ? 'error' : summary.tone === 'warning' ? 'error' : 'success');
      setAccountCheckReport({
        accountId: String(accountId),
        title: summary.title,
        tone: summary.tone,
        lines: buildCheckLines(result, account),
        checkedAt: new Date().toISOString()
      });
    } catch (error) {
      setAccountCheckFeedback({
        accountId: String(accountId),
        tone: 'error',
        text: error.message
      });
      showUiMessage(error.message, 'error');
      setAccountCheckReport({
        accountId: String(accountId),
        title: 'Проверка упала',
        tone: 'error',
        lines: [
          checkLine('Сессия', '', 'error'),
          checkLine('Ограничения', '', 'default'),
          checkLine('SpamBot', '', 'default')
        ],
        checkedAt: new Date().toISOString()
      });
    } finally {
      setState((prev) => ({ ...prev, checkingAccountId: '' }));
    }
  }

  async function toggleSafeMode(account) {
    const accountId = String(account?.id || '');
    if (!accountId) return;

    const isSafeMode = String(account?.runtime_status || '') === 'pending_activation';

    if (isSafeMode) {
      await checkAccount(account);
      return;
    }

    if (!window.confirm('Вернуть аккаунт в safe-mode? Автоматика и живые Telegram-действия снова будут отключены до следующей ручной активации.')) {
      return;
    }

    setState((prev) => ({ ...prev, togglingSafeModeId: accountId }));
    try {
      await apiRequest(`/api/userbot/safe-mode/${accountId}`, {
        accessToken,
        method: 'POST',
        body: { enabled: true }
      });
      await reloadAccounts();
      setAccountCheckReport({
        accountId,
        title: 'Safe-mode включен',
        tone: 'warning',
        lines: [
          checkLine('Сессия', '', 'default'),
          checkLine('Ограничения', '', 'default'),
          checkLine('SpamBot', '', 'default')
        ],
        checkedAt: new Date().toISOString()
      });
      showUiMessage('Safe-mode включен.', 'success');
    } catch (error) {
      setAccountCheckReport({
        accountId,
        title: 'Safe-mode не переключился',
        tone: 'error',
        lines: [
          checkLine('Сессия', '', 'error'),
          checkLine('Ограничения', '', 'default'),
          checkLine('SpamBot', '', 'default')
        ],
        checkedAt: new Date().toISOString()
      });
      showUiMessage('Safe-mode не переключился: ' + error.message, 'error');
    } finally {
      setState((prev) => ({ ...prev, togglingSafeModeId: '' }));
    }
  }

  async function saveBinding(accountId) {
    const binding = bindings[accountId];
    setAccountBindingFeedback({ accountId: String(accountId), tone: 'default', text: '' });
    if (!binding?.proxy_id) {
      setAccountBindingFeedback({
        accountId: String(accountId),
        tone: 'error',
        text: 'Юзербот должен быть привязан к прокси. Пустое значение нельзя сохранить.'
      });
      showUiMessage('Юзербот должен быть привязан к прокси.', 'error');
      return;
    }

    setState((prev) => ({ ...prev, bindingAccountId: String(accountId) }));
    try {
      await apiRequest('/api/userbot/bind-proxy', {
        accessToken,
        method: 'POST',
        body: {
          account_id: accountId,
          proxy_id: binding.proxy_id,
          allow_proxy_failover: !!binding.allow_proxy_failover,
          failover_proxy_ids: (binding.failover_proxy_ids || []).filter((id) => id && id !== binding.proxy_id)
        }
      });
      await reloadAccounts();
      setAccountBindingFeedback({
        accountId: String(accountId),
        tone: 'success',
        text: 'Привязка прокси обновлена.'
      });
      showUiMessage('Привязка прокси обновлена.', 'success');
    } catch (error) {
      setAccountBindingFeedback({
        accountId: String(accountId),
        tone: 'error',
        text: error.message
      });
      showUiMessage(error.message, 'error');
    } finally {
      setState((prev) => ({ ...prev, bindingAccountId: '' }));
    }
  }

  async function saveUserbotSaleLot(account) {
    if (!saleComposer.title.trim()) {
      setSaleComposer((prev) => ({ ...prev, error: 'Укажи название лота.' }));
      return;
    }
    if ((saleComposer.payment_methods || []).length === 0) {
      setSaleComposer((prev) => ({ ...prev, error: 'Выбери хотя бы один способ оплаты.' }));
      return;
    }
    if ((saleComposer.payment_methods || []).includes('ton') && Number(saleComposer.price_ton || 0) <= 0) {
      setSaleComposer((prev) => ({ ...prev, error: 'Для TON нужна цена в TON.' }));
      return;
    }

    const wantsBundle = saleComposer.sale_type === 'bundle';
    if (wantsBundle && !account.proxy_id) {
      setSaleComposer((prev) => ({ ...prev, error: 'У этого юзербота нет привязанного прокси для bundle-продажи.' }));
      return;
    }
    const linkedProxy = wantsBundle
      ? state.proxies.find((proxy) => String(proxy.id) === String(account.proxy_id))
      : null;

    setSaleComposer((prev) => ({ ...prev, saving: true, error: '' }));
    try {
      await apiRequest('/api/shop/seller/items', {
        accessToken,
        method: 'POST',
        body: {
          title: saleComposer.title,
          description: wantsBundle
            ? (account.tg_username
                ? `Готовый seller userbot @${account.tg_username} вместе с его прокси.`
                : `Готовый seller userbot ${account.tg_account_id} вместе с его прокси.`)
            : (account.tg_username
                ? `Готовый seller userbot @${account.tg_username}.`
                : `Готовый seller userbot ${account.tg_account_id}.`),
          preview_text: wantsBundle
            ? 'Готовый Telegram-аккаунт Bullgram вместе с его прокси.'
            : 'Готовый Telegram-аккаунт Bullgram для seller-операционки.',
          payment_methods: saleComposer.payment_methods,
          post_purchase_message: null,
          offer_code: null,
          item_type: wantsBundle ? 'bundle' : 'userbot',
          sales_channel: 'admin_only',
          price_ton: Number(saleComposer.price_ton || 0),
          status: 'published',
          visibility: 'public',
          transfer_mode: 'ownership_transfer',
          assets: wantsBundle
            ? [
                {
                  asset_type: 'userbot',
                  asset_id: account.id,
                  label: account.tg_username ? `@${account.tg_username}` : `ID ${account.tg_account_id}`
                },
                {
                  asset_type: 'proxy',
                  asset_id: account.proxy_id,
                  label: linkedProxy ? proxyLabel(linkedProxy) : String(account.proxy_id)
                }
              ]
            : [{
                asset_type: 'userbot',
                asset_id: account.id,
                label: account.tg_username ? `@${account.tg_username}` : `ID ${account.tg_account_id}`
              }]
        }
      });

      resetSaleComposer();
      await reloadAccounts();
      showUiMessage('Лот выставлен в Shop.', 'success');
    } catch (error) {
      setSaleComposer((prev) => ({
        ...prev,
        saving: false,
        error: error.message
      }));
      showUiMessage(error.message, 'error');
    }
  }

  function updateBinding(accountId, patch) {
    setBindings((prev) => ({
      ...prev,
      [accountId]: (() => {
        const next = {
          proxy_id: '',
          allow_proxy_failover: false,
          failover_proxy_ids: [],
          ...(prev[accountId] || {}),
          ...patch
        };
        if (next.proxy_id) {
          next.failover_proxy_ids = (next.failover_proxy_ids || []).filter((id) => String(id) !== String(next.proxy_id));
        }
        return next;
      })()
    }));
  }

  return {
    accountBindingFeedback,
    accountCheckFeedback,
    accountCheckReport,
    accountDeleteFeedback,
    accountRestoreFeedback,
    availableBindingProxiesForAccount,
    availableFailoverProxiesForAccount,
    bindings,
    checkAccount,
    deleteAccount,
    openSaleComposer,
    patchLiveUserbot,
    resetSaleComposer,
    restoreAccount,
    saleComposer,
    saveBinding,
    saveUserbotSaleLot,
    setSaleComposer,
    toggleSafeMode,
    toggleSalePaymentMethod,
    updateBinding
  };
}
