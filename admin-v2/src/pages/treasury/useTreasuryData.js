import { useCallback, useState } from 'react';
import { apiRequest } from '../../api/client.js';

export function useTreasuryData({ accessToken }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError('');
    try {
      const payload = await apiRequest('/api/project-admin/treasury', { accessToken });
      setData(payload);
    } catch (err) {
      setError(err.message || 'Не удалось загрузить казну проекта.');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  return { data, setData, loading, error, reload };
}
