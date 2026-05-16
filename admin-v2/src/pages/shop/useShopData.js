import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../../api/client.js';

export function useShopData({ accessToken }) {
  const [state, setState] = useState({
    loading: true,
    refreshing: false,
    saving: false,
    error: '',
    items: [],
    purchases: [],
    assets: null,
    updatedAt: null
  });

  const loadShop = useCallback(async ({ silent = false } = {}) => {
    if (!accessToken) return;

    if (!silent) {
      setState((prev) => ({
        ...prev,
        loading: !prev.items.length && !prev.assets,
        refreshing: !!prev.items.length || !!prev.assets,
        error: ''
      }));
    }

    try {
      const [itemsData, purchasesData, assetsData] = await Promise.all([
        apiRequest('/api/shop/seller/items', { accessToken }),
        apiRequest('/api/shop/seller/purchases', { accessToken }),
        apiRequest('/api/shop/seller/assets', { accessToken })
      ]);

      setState((prev) => ({
        ...prev,
        loading: false,
        refreshing: false,
        error: '',
        items: itemsData.items || [],
        purchases: purchasesData.purchases || [],
        assets: assetsData,
        updatedAt: new Date().toISOString()
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        refreshing: false,
        error: error.message,
        items: [],
        purchases: [],
        assets: null,
        updatedAt: null
      }));
    }
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return undefined;
    loadShop();
    const id = window.setInterval(() => loadShop({ silent: true }), 60_000);
    return () => window.clearInterval(id);
  }, [accessToken, loadShop]);

  return { state, setState, loadShop };
}
