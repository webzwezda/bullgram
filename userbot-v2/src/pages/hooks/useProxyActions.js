import { toast } from 'sonner';
import { apiRequest } from '../../api/client.js';
import { ADMIN_PROXY_GROUPS } from '../sections/proxyShared.js';

export function useProxyActions({
  accessToken,
  state,
  setState,
  proxiesReqIdRef,
  checkingIds,
  setCheckingIds,
  armedDeleteId,
  setArmedDeleteId,
  formState,
  setFormState,
  bulkCount,
  setBulkCount,
  externalProxyMode,
  setExternalProxyMode,
  raisePriceTon,
  setRaisePriceTon,
  serverBatchCount,
  isAdminCreate,
  canEditProxy,
  loadSellerItems,
}) {
  async function checkProxy(proxyId) {
    const rowKey = String(proxyId);
    if (checkingIds.has(rowKey)) return;

    setCheckingIds((prev) => new Set(prev).add(rowKey));
    setState((prev) => ({
      ...prev,
      proxies: prev.proxies.map((proxy) => (
        proxy.id === proxyId ? { ...proxy, status: 'checking' } : proxy
      ))
    }));

    try {
      await apiRequest(`/api/userbot/proxies/check/${proxyId}`, { accessToken });
    } catch (error) {
      toast.error(error.message);
    }

    // Обновляем список независимо от результата проверки, чтобы строка не
    // зависла в «Проверяется». Инвалидируем поллинг: наш рефреш свежее.
    proxiesReqIdRef.current += 1;
    try {
      const data = await apiRequest('/api/userbot/proxies', { accessToken });
      setState((prev) => ({
        ...prev,
        proxies: data.proxies || [],
        support: data.support || prev.support,
        updatedAt: new Date().toISOString()
      }));
    } catch (error) {
      // Список обновить не удалось — снимаем локальный checking-статус строки,
      // чтобы кнопка и бейдж не залипли.
      toast.error(error.message);
      setState((prev) => ({
        ...prev,
        proxies: prev.proxies.map((proxy) => (
          proxy.id === proxyId && proxy.status === 'checking' ? { ...proxy, status: '' } : proxy
        ))
      }));
    } finally {
      setCheckingIds((prev) => {
        const next = new Set(prev);
        next.delete(rowKey);
        return next;
      });
    }
  }

  async function saveProxy() {
    setState((prev) => ({ ...prev, saving: true, error: '' }));
    try {
      const isAdminCreate = state.support?.profile_role === 'admin';
      const isServerBatch = isAdminCreate && !externalProxyMode;
      const forSale = formState.inventory_group === 'shop_sale';
      const salePrice = Number(raisePriceTon);
      const normalizedName = formState.name.trim();
      const normalizedHost = formState.host.trim();
      const normalizedPort = Number.parseInt(formState.port, 10);

      if (!normalizedName) {
        throw new Error('Сначала задай имя прокси.');
      }
      if (!isAdminCreate && !normalizedHost) {
        throw new Error('Сначала укажи host или IP прокси.');
      }
      if (isAdminCreate && externalProxyMode && !normalizedHost) {
        throw new Error('Укажи host внешнего прокси или вернись к серверному.');
      }
      if (isServerBatch && forSale && !(salePrice > 0)) {
        throw new Error('Укажи цену прокси в TON или выключи «На продажу в shop».');
      }
      if (!isAdminCreate && (!Number.isInteger(normalizedPort) || normalizedPort <= 0 || normalizedPort > 65535)) {
        throw new Error('Укажи корректный порт прокси.');
      }

      const result = await apiRequest('/api/userbot/proxies', {
        accessToken,
        method: 'POST',
        body: {
          name: normalizedName,
          host: normalizedHost || undefined,
          port: Number.isInteger(normalizedPort) ? normalizedPort : undefined,
          username: formState.username.trim() || null,
          password: formState.password.trim() || null,
          inventory_group: formState.inventory_group,
          count: isServerBatch ? serverBatchCount : undefined
        }
      });
      proxiesReqIdRef.current += 1;
      const data = await apiRequest('/api/userbot/proxies', { accessToken });

      let listedCount = 0;
      if (isServerBatch && forSale && Array.isArray(result?.proxy_ids) && result.proxy_ids.length && salePrice > 0) {
        try {
          const listing = await apiRequest('/api/shop/seller/items/batch-proxy', {
            accessToken,
            method: 'POST',
            body: { proxy_ids: result.proxy_ids, price_ton: salePrice }
          });
          listedCount = Number(listing?.created || 0);
          for (const failure of listing?.errors || []) {
            toast.error(`Не выставлен на продажу: ${failure.error}`);
          }
          await loadSellerItems();
        } catch (listingError) {
          toast.error(`Прокси подняты, но на продажу не встали: ${listingError.message}`);
        }
      }

      setBulkCount('1');
      setExternalProxyMode(false);
      setRaisePriceTon('');
      setFormState({
        name: '',
        host: '',
        port: '',
        username: '',
        password: '',
        inventory_group: 'self_use'
      });
      setState((prev) => ({
        ...prev,
        saving: false,
        proxies: data.proxies || [],
        support: data.support || prev.support,
        updatedAt: new Date().toISOString()
      }));
      if (listedCount > 0) {
        toast.success(`Поднято ${result?.created || result.proxy_ids.length} прокси, на витрину встало ${listedCount}.`);
      } else {
        toast.success(result?.message || 'Прокси сохранен.');
      }
    } catch (error) {
      setState((prev) => ({ ...prev, saving: false, error: error.message }));
      toast.error(error.message);
    }
  }

  // Инлайн-подтверждение вместо window.confirm: деструктивное действие
  // говорит голосом приложения (первый клик — «Точно удалить?», второй — удаление)
  async function deleteProxy(proxy) {
    const userbotCount = Number(proxy.userbot_count || 0);
    if (userbotCount > 0) {
      toast.error('На этом прокси висит юзербот — сначала перепривяжи аккаунт.');
      return;
    }

    try {
      await apiRequest(`/api/userbot/proxies/${proxy.id}`, {
        accessToken,
        method: 'DELETE'
      });
      proxiesReqIdRef.current += 1;
      const data = await apiRequest('/api/userbot/proxies', { accessToken });
      setState((prev) => ({
        ...prev,
        proxies: data.proxies || [],
        support: data.support || prev.support,
        updatedAt: new Date().toISOString()
      }));
      toast.success(`Прокси "${proxy.name}" удален.`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setArmedDeleteId('');
    }
  }

  async function moveProxyToGroup(proxy, targetGroup) {
    if (!canEditProxy) return;
    if (!ADMIN_PROXY_GROUPS.includes(targetGroup)) return;
    if ((proxy.inventory_group || 'shop_sale') === targetGroup) return;

    setState((prev) => ({ ...prev, movingProxyId: String(proxy.id), error: '' }));
    try {
      // Креды из GET приходят замаскированными — в апдейт не отправляем,
      // бэкенд держит «пустые = оставить как есть»
      await apiRequest('/api/userbot/proxies', {
        accessToken,
        method: 'POST',
        body: {
          id: proxy.id,
          name: proxy.name,
          host: proxy.host,
          port: proxy.port,
          username: '',
          password: '',
          inventory_group: targetGroup
        }
      });
      proxiesReqIdRef.current += 1;
      const data = await apiRequest('/api/userbot/proxies', { accessToken });
      setState((prev) => ({
        ...prev,
        movingProxyId: '',
        proxies: data.proxies || [],
        support: data.support || prev.support,
        updatedAt: new Date().toISOString()
      }));
      toast.success(`Прокси "${proxy.name}" перенесен в новую группу.`);
    } catch (error) {
      setState((prev) => ({
        ...prev,
        movingProxyId: '',
        error: error.message
      }));
      toast.error(error.message);
    }
  }
  return { checkProxy, saveProxy, deleteProxy, moveProxyToGroup };
}
