import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../../api/client.js';
import { forgetInvoices, getRememberedInvoices } from '../../lib/my-invoices.js';

const VIEW_CHUNK_SIZE = 5;
const VIEW_CHUNK_DELAY_MS = 300;

export function useMyInvoices(user, accessToken) {
  const [myInvoices, setMyInvoices] = useState([]);
  const [myLoading, setMyLoading] = useState(false);
  const [myError, setMyError] = useState('');

  const fetchMine = useCallback(async () => {
    setMyLoading(true);
    setMyError('');
    try {
      const byId = new Map();

      if (user && accessToken) {
        try {
          const data = await apiRequest('/api/public-invoices/mine', { accessToken });
          for (const inv of data.items || []) {
            if (inv.status !== 'pending' && inv.status !== 'paid') continue;
            byId.set(inv.id, {
              id: inv.id,
              title: inv.title || null,
              amount_ton: inv.amount_ton,
              status: inv.status,
              created_at: inv.created_at,
            });
          }
        } catch {
          // не критично — локальные счёта покажем без серверных
        }
      }

      // Счета этого браузера (в т.ч. созданные без регистрации): статус через public-view,
      // чанками по 5 с паузой, чтобы не выжечь общий лимит запросов с одного IP
      const remembered = getRememberedInvoices();
      const staleIds = [];
      let someFailed = false;
      for (let i = 0; i < remembered.length; i += VIEW_CHUNK_SIZE) {
        const chunk = remembered.slice(i, i + VIEW_CHUNK_SIZE);
        const views = await Promise.allSettled(
          chunk.map((entry) =>
            apiRequest(`/api/public-invoices/public/${entry.id}/public-view`)
          )
        );
        views.forEach((result, index) => {
          const entry = chunk[index];
          if (result.status === 'fulfilled') {
            const view = result.value;
            if (view.status !== 'pending' && view.status !== 'paid') {
              staleIds.push(entry.id);
              return;
            }
            byId.set(view.id, {
              id: view.id,
              title: view.item_title || null,
              amount_ton: view.amount_ton,
              status: view.status,
              created_at: entry.created_at,
            });
          } else if (result.reason?.status === 404) {
            staleIds.push(entry.id);
          } else {
            someFailed = true;
            byId.set(entry.id, {
              id: entry.id,
              title: null,
              amount_ton: null,
              status: 'unknown',
              created_at: entry.created_at,
            });
          }
        });
        if (i + VIEW_CHUNK_SIZE < remembered.length) {
          await new Promise((resolve) => setTimeout(resolve, VIEW_CHUNK_DELAY_MS));
        }
      }
      if (staleIds.length) forgetInvoices(staleIds);

      const items = Array.from(byId.values())
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
        .slice(0, 20);
      setMyInvoices(items);
      if (someFailed) setMyError('Не удалось загрузить часть счетов');
    } catch (e) {
      setMyError(e.message || 'Не удалось загрузить счета');
    } finally {
      setMyLoading(false);
    }
  }, [user, accessToken]);

  useEffect(() => {
    fetchMine();
  }, [fetchMine]);

  return { myInvoices, myLoading, myError, fetchMine };
}
