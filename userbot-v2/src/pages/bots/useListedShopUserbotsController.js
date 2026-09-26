import { apiRequest } from '../../api/client.js';

export function useListedShopUserbotsController({
  accessToken,
  reloadAccounts,
  setState,
  showUiMessage
}) {
  async function deleteShopItem(itemId) {
    if (!itemId) return;
    if (!window.confirm('Удалить лот? Это сработает только если по нему нет живой или оплаченной покупки.')) {
      return;
    }

    setState((prev) => ({ ...prev, deletingShopItemId: String(itemId) }));
    try {
      await apiRequest(`/api/shop/seller/items/${itemId}`, {
        accessToken,
        method: 'DELETE'
      });
      await reloadAccounts();
      showUiMessage('Лот удален из Shop.', 'success');
    } catch (error) {
      showUiMessage(error.message, 'error');
    } finally {
      setState((prev) => ({ ...prev, deletingShopItemId: '' }));
    }
  }

  return {
    deleteShopItem
  };
}
