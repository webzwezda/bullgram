import { useCallback, useRef, useState } from 'react';
import { apiRequest } from '../../api/client.js';

export function useTreasuryData({ accessToken }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Защита от гонки: устаревший ответ (или его ошибка) не должен перезаписывать
  // свежий стейт — тот же reqId-паттерн, что в loadCustomers (CustomersPage.jsx).
  const reqIdRef = useRef(0);

  const reload = useCallback(async () => {
    if (!accessToken) return;
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError('');
    try {
      const payload = await apiRequest('/api/project-admin/treasury', { accessToken });
      if (reqId !== reqIdRef.current) return;
      setData(payload);
    } catch (err) {
      if (reqId !== reqIdRef.current) return;
      setError(err.message || 'Не удалось загрузить казну проекта.');
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [accessToken]);

  return { data, setData, loading, error, reload };
}
