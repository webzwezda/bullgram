import { useCallback, useEffect, useRef } from 'react';
import { apiRequest } from '../../../api/client.js';
import { toast } from 'sonner';
import { plural } from '../utils/customersRows.js';

export function useCustomersData({
  accessToken,
  selectedBotId,
  setSearchParams,
  moneyPeriod,
  setMoneyPeriod,
  state,
  setState,
  botAnalytics,
  setBotAnalytics,
  audienceState,
  setAudienceState
}) {
  // Защита от гонки: ответ поллинга, пришедший позже свежей загрузки (например,
  // после действия над строкой), не должен перезаписывать свежий стейт —
  // тот же паттерн, что в loadBotAnalytics и loadAudience
  const customersReqIdRef = useRef(0);
  const loadCustomers = useCallback(async ({ silent = false, shouldCancel = () => false } = {}) => {
    if (!accessToken) return;
    const reqId = ++customersReqIdRef.current;

    if (!silent) {
      setState((prev) => ({
        ...prev,
        loading: !prev.updatedAt,
        error: ''
      }));
    }

    try {
      const params = new URLSearchParams();
      if (selectedBotId) params.set('bot_id', selectedBotId);
      const data = await apiRequest(`/api/customers/workbench${params.toString() ? `?${params.toString()}` : ''}`, { accessToken });
      const segments = data.segments || {};

      if (shouldCancel()) return;
      if (reqId !== customersReqIdRef.current) return;

      const botOptions = data.bots || [];
      const activeBotOptions = botOptions.filter((item) => item.status !== 'deleted');
      if (!selectedBotId && activeBotOptions.length > 0) {
        const next = new URLSearchParams(window.location.search);
        next.set('bot_id', String(activeBotOptions[0].id));
        setSearchParams(next);
        return;
      }

      setState({
        loading: false,
        error: '',
        updatedAt: data.updatedAt || new Date().toISOString(),
        bots: botOptions,
        channels: data.channels || [],
        started: segments.startedContacts || [],
        crm: [
          ...(segments.activeCustomers || []),
          ...(segments.expiredCustomers || [])
        ],
        viewed: segments.viewedTariffs || [],
        invoiceCreated: segments.invoiceCreated || [],
        caps: data.caps || null
      });
    } catch (error) {
      if (shouldCancel() || reqId !== customersReqIdRef.current) return;
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error.message
      }));
    }
  }, [accessToken, selectedBotId, setSearchParams]);

  const analyticsReqIdRef = useRef(0);
  const audienceReqIdRef = useRef(0);
  const loadBotAnalytics = useCallback(async () => {
    if (!selectedBotId || !accessToken) {
      setBotAnalytics({ loading: false, error: '', data: null });
      return;
    }
    const reqId = ++analyticsReqIdRef.current;
    // Функциональная форма: не читаем стейт из замыкания (он может быть протухшим)
    setBotAnalytics((prev) => (prev.data ? prev : { ...prev, loading: true, error: '' }));
    try {
      const data = await apiRequest(`/api/analytics?bot_id=${encodeURIComponent(selectedBotId)}&period=${encodeURIComponent(moneyPeriod)}`, { accessToken });
      if (reqId !== analyticsReqIdRef.current) return;
      setBotAnalytics({ loading: false, error: '', data });
    } catch (error) {
      if (reqId !== analyticsReqIdRef.current) return;
      setBotAnalytics((prev) => ({ loading: false, error: error.message || 'Ошибка аналитики', data: prev.data }));
    }
  }, [accessToken, selectedBotId, moneyPeriod]);

  useEffect(() => {
    let cancelled = false;

    loadCustomers({ shouldCancel: () => cancelled });
    loadBotAnalytics();
    const intervalId = accessToken
      ? window.setInterval(() => {
          loadCustomers({ silent: true, shouldCancel: () => cancelled });
          loadBotAnalytics();
        }, 60_000)
      : null;

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [accessToken, loadCustomers, loadBotAnalytics]);

  // Audience loading
  const loadAudience = useCallback(async () => {
    if (!accessToken) return;
    // Защита от гонки: устаревший ответ не перезаписывает свежий (тот же паттерн, что в loadBotAnalytics)
    const reqId = ++audienceReqIdRef.current;
    try {
      setAudienceState((prev) => ({ ...prev, loading: true, error: '' }));
      const params = new URLSearchParams();
      if (selectedBotId) params.set('contourId', selectedBotId);
      const data = await apiRequest(`/api/audience${params.toString() ? `?${params.toString()}` : ''}`, { accessToken });
      if (reqId !== audienceReqIdRef.current) return;
      setAudienceState((prev) => ({
        ...prev,
        loading: false,
        contourId: data.contourId || null,
        targets: data.targets || [],
        error: ''
      }));
    } catch (err) {
      if (reqId !== audienceReqIdRef.current) return;
      setAudienceState((prev) => ({ ...prev, loading: false, error: err.message }));
    }
  }, [accessToken, selectedBotId]);

  useEffect(() => { loadAudience(); }, [loadAudience]);

  const syncAudience = useCallback(async (targetType) => {
    const cid = audienceState.contourId;
    if (!cid) return;
    try {
      setAudienceState((prev) => ({ ...prev, syncingType: targetType }));
      const result = await apiRequest('/api/audience/sync', {
        accessToken,
        method: 'POST',
        body: { contourId: cid, targetType }
      });
      // Бэкенд /api/audience/sync возвращает synced_count (+ truncated при урезании лимитом)
      const countText = `Загружено ${result.synced_count} ${plural(result.synced_count, 'участника', 'участников', 'участников')}`;
      if (result.truncated) {
        toast.warning(`${countText} — в группе всего ${result.total_in_group}, выгрузка остановлена лимитом`);
      } else {
        toast.success(countText);
      }
      await loadAudience();
    } catch (err) {
      toast.error(err.message || 'Ошибка обновления');
    } finally {
      setAudienceState((prev) => ({ ...prev, syncingType: null }));
    }
  }, [accessToken, loadAudience, audienceState.contourId]);

  return { loadCustomers, syncAudience };
}
