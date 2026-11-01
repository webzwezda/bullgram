import { useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../../api/client.js';

// Скан «Найти аккаунты для продажи» (только платформенный админ): POST запускает
// живую проверку сессий по всем хранилищам на бэкенде, клиент опрашивает статус
// до терминального состояния. Последний скан персистентен — при монтировании
// тянем его и, если он ещё идёт, продолжаем поллинг автоматически.

const SCAN_ENDPOINT = '/api/shop/admin/account-lots/scan';
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 15 * 60 * 1000;
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

const POLL_CAP_MESSAGE = 'Скан ещё идёт на сервере — обнови страницу позже.';

// Вердикт скана → подпись и тон точки. error/no_proxy подписываются по reason —
// там единственная содержательная часть.
const VERDICT_META = {
  online: { label: 'Онлайн', dotClass: 'bg-feedback-success-text', textClass: 'text-ink-muted' },
  pending_activation: { label: 'Safe-mode', dotClass: 'bg-feedback-success-text', textClass: 'text-ink-muted' },
  restricted: { label: 'Ограничен', dotClass: 'bg-feedback-error-text', textClass: 'text-feedback-error-text' },
  frozen: { label: 'Заморожен Telegram', dotClass: 'bg-feedback-error-text', textClass: 'text-feedback-error-text' },
  expired: { label: 'Сессия недействительна', dotClass: 'bg-feedback-error-text', textClass: 'text-feedback-error-text' },
  dead_proxy: { label: 'Мёртвый прокси', dotClass: 'bg-feedback-error-text', textClass: 'text-feedback-error-text' },
  error: { label: 'Ошибка проверки', dotClass: 'bg-ink-faint', textClass: 'text-ink-muted' },
  no_proxy: { label: 'Нет прокси', dotClass: 'bg-ink-faint', textClass: 'text-ink-muted' }
};

export function scanVerdictMeta(item) {
  const verdict = String(item?.verdict || '').trim().toLowerCase();
  const meta = VERDICT_META[verdict];
  if (!meta) {
    return { label: 'Проверка не прошла', dotClass: 'bg-ink-faint', textClass: 'text-ink-muted' };
  }
  if ((verdict === 'error' || verdict === 'no_proxy') && item?.reason) {
    return { ...meta, label: item.reason };
  }
  return meta;
}

// Свежесть последнего завершённого скана: гейт публикации на бэкенде — 6ч,
// карточка предупреждает тем же окном. Берём свежайший checked_at айтемов,
// иначе updated_at скана.
export function isScanStale(scan) {
  if (!scan || scan.status !== 'completed') return false;
  const stamps = (Array.isArray(scan.items) ? scan.items : [])
    .map((item) => new Date(item?.checked_at || '').getTime())
    .filter((ts) => Number.isFinite(ts));
  const scanUpdated = new Date(scan.updated_at || '').getTime();
  if (Number.isFinite(scanUpdated)) stamps.push(scanUpdated);
  if (!stamps.length) return false;
  return Date.now() - Math.max(...stamps) > STALE_AFTER_MS;
}

export function useSaleScan({ accessToken, showUiMessage, scope = 'unlisted' }) {
  const [scan, setScan] = useState(null);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState('');
  const didLoadRef = useRef(false);
  const pollTimerRef = useRef(null);
  const pollTimeoutRef = useRef(null);

  const isScanning = scan?.status === 'processing';

  function stopPolling() {
    if (pollTimerRef.current) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (pollTimeoutRef.current) {
      window.clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }

  useEffect(() => () => {
    stopPolling();
  }, []);

  function startPolling() {
    stopPolling();
    let failedAttempts = 0;
    pollTimerRef.current = window.setInterval(async () => {
      try {
        const result = await apiRequest(`${SCAN_ENDPOINT}?scope=${scope}`, { accessToken });
        failedAttempts = 0;
        const next = result?.scan;
        if (!next) return;
        setScan(next);
        if (next.status === 'processing') return;
        stopPolling();
        if (next.status === 'failed') {
          showUiMessage(next.error || 'Скан не удался — попробуй ещё раз.', 'error');
        } else {
          showUiMessage(
            `Скан завершён: готово ${Number(next.processed || 0)} из ${Number(next.total || 0)}.`,
            'success'
          );
        }
      } catch {
        // Разовые сетевые сбои не должны убивать ожидание долгого скана —
        // роняем поллинг только после нескольких ошибок подряд.
        failedAttempts += 1;
        if (failedAttempts < 5) return;
        stopPolling();
        const message = 'Не удалось получить статус скана.';
        setError(message);
        setScan((prev) => (prev ? { ...prev, status: 'failed', error: message } : prev));
        showUiMessage(message, 'error');
      }
    }, POLL_INTERVAL_MS);

    pollTimeoutRef.current = window.setTimeout(() => {
      // Кап — не ошибка: скан здоров и живёт на сервере (строка остаётся
      // processing), при перезагрузке страницы поллинг подхватится снова.
      stopPolling();
      showUiMessage(POLL_CAP_MESSAGE);
    }, POLL_TIMEOUT_MS);
  }

  // Последний скан персистентен: при монтировании показываем его, а идущий —
  // подхватываем поллингом (строка скана переживает перезагрузку страницы).
  // refreshScan — тот же GET по требованию: после выставления лотов карточка
  // перечитывает флаги listed, чтобы живые уезжали в «Уже на витрине».
  async function refreshScan() {
    if (!accessToken) return;
    try {
      const result = await apiRequest(`${SCAN_ENDPOINT}?scope=${scope}`, { accessToken });
      const latest = result?.scan || null;
      setScan(latest);
      if (latest?.status === 'processing') startPolling();
    } catch {
      // Не дотянулись — карточка остаётся как была.
    }
  }

  useEffect(() => {
    if (didLoadRef.current || !accessToken) return;
    didLoadRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const result = await apiRequest(`${SCAN_ENDPOINT}?scope=${scope}`, { accessToken });
        if (cancelled) return;
        const latest = result?.scan || null;
        setScan(latest);
        if (latest?.status === 'processing') startPolling();
      } catch {
        // Последнего скана нет или не дотянулись — карточка остаётся в пустом состоянии.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  async function startScan() {
    if (!accessToken) {
      showUiMessage('Сессия устарела — перезайди в кабинет.', 'error');
      return;
    }

    setIsStarting(true);
    setError('');
    try {
      const result = await apiRequest(SCAN_ENDPOINT, {
        accessToken,
        method: 'POST',
        body: { scope }
      });
      setScan({
        id: result?.scan_id,
        status: 'processing',
        total: Number(result?.total || 0),
        processed: 0,
        failed: 0,
        orphans: 0,
        items: [],
        error: ''
      });
      startPolling();
    } catch (caught) {
      const message = caught.message || 'Не удалось запустить скан.';
      setError(message);
      showUiMessage(message, 'error');
    } finally {
      setIsStarting(false);
    }
  }

  const stale = useMemo(() => isScanStale(scan), [scan]);

  return {
    scan,
    isScanning,
    isStarting,
    stale,
    error,
    startScan,
    refreshScan
  };
}
