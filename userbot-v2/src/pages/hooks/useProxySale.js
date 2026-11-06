import { useState } from 'react';
import { toast } from 'sonner';
import { apiRequest } from '../../api/client.js';
import { proxyHasLiveUserbot } from '../sections/proxyShared.js';

export function useProxySale({ accessToken, saleProxies, loadSellerItems }) {
  const [saleSelection, setSaleSelection] = useState(() => new Set());
  const [salePriceTon, setSalePriceTon] = useState('');
  const [listingSale, setListingSale] = useState(false);
  const [proxyPage, setProxyPage] = useState(1);
  const [saleStatusFilter, setSaleStatusFilter] = useState('all');
  function toggleSaleSelection(proxyId) {
    setSaleSelection((prev) => {
      const next = new Set(prev);
      const key = String(proxyId);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function toggleAllSaleSelection() {
    setSaleSelection((prev) => {
      // Прокси с живым юзерботом не выбираем: сервер всё равно отклонит листинг.
      const listable = saleProxies.filter((proxy) => !proxyHasLiveUserbot(proxy));
      const allSelected = listable.length > 0 && listable.every((proxy) => prev.has(String(proxy.id)));
      if (allSelected) return new Set();
      return new Set(listable.map((proxy) => String(proxy.id)));
    });
  }

  async function listSelectedForSale() {
    const price = Number(salePriceTon);
    const selected = saleProxies.filter((proxy) => saleSelection.has(String(proxy.id)));
    const blocked = selected.filter(proxyHasLiveUserbot);
    const ids = selected
      .filter((proxy) => !proxyHasLiveUserbot(proxy))
      .map((proxy) => proxy.id);

    if (!ids.length) {
      toast.error(blocked.length
        ? 'Все выбранные прокси заняты юзерботами — выставить их на витрину нельзя'
        : 'Сначала выбери прокси');
      return;
    }
    if (!(price > 0)) {
      toast.error('Укажи цену лота в TON');
      return;
    }

    for (const proxy of blocked) {
      toast.error(`${proxy.name || `${proxy.host}:${proxy.port}`}: на нём висит юзербот — листинг будет отклонён`);
    }

    setListingSale(true);
    try {
      const data = await apiRequest('/api/shop/seller/items/batch-proxy', {
        accessToken,
        method: 'POST',
        body: { proxy_ids: ids, price_ton: price }
      });
      if (Number(data?.created || 0) > 0) {
        toast.success(`Выставлено лотов: ${data.created}`);
      }
      const nameById = new Map(saleProxies.map((proxy) => [String(proxy.id), proxy.name || `${proxy.host}:${proxy.port}`]));
      for (const failure of data?.errors || []) {
        toast.error(`${nameById.get(String(failure.proxy_id)) || 'Прокси'}: ${failure.error}`);
      }
      setSaleSelection(new Set());
      await loadSellerItems();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setListingSale(false);
    }
  }
  return {
    saleSelection,
    setSaleSelection,
    salePriceTon,
    setSalePriceTon,
    listingSale,
    proxyPage,
    setProxyPage,
    saleStatusFilter,
    setSaleStatusFilter,
    saleProxies,
    toggleSaleSelection,
    toggleAllSaleSelection,
    listSelectedForSale,
  };
}
