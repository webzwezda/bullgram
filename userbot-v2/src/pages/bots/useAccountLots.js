import { useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../../api/client.js';
import { saleTitleForAccount, summarizeCheckStatus } from './bots-accounts.utils.js';

// Партия аккаунтов → продажа (Wave 2 приёмки): выбор проверенных аккаунтов из
// intake-запаса и публикация пачкой публичных лотов магазина. Фильтр «похоже,
// готово к продаже» здесь только преднастройка UI: гейт по-настоящему делает
// бэкенд (нездоровым/устаревшим аккаунтам он вернёт status='failed').

const FRESH_CHECK_WINDOW_MS = 6 * 60 * 60 * 1000;
const SELLABLE_RUNTIME_STATUSES = new Set(['pending_activation', 'online']);
const DEFAULT_LOT_TITLE = 'Telegram-аккаунт';

function checkedAtAgeMs(account) {
  const ts = new Date(account?.last_checked_at || '').getTime();
  return Number.isFinite(ts) ? Date.now() - ts : Number.POSITIVE_INFINITY;
}

// «Похоже, готов к продаже»: safe-mode или рабочий статус + живая проверка
// здоровья + проверка свежее окна отлёжки. Остальное — в приглушённую группу.
export function isSellableForSale(account) {
  const runtimeStatus = String(account?.runtime_status || '').trim().toLowerCase();
  return SELLABLE_RUNTIME_STATUSES.has(runtimeStatus)
    && account?.health_summary?.status === 'online'
    && checkedAtAgeMs(account) <= FRESH_CHECK_WINDOW_MS;
}

// Причина «не готов к продаже» + тон точки и текста рядом с ней.
export function notReadyMeta(account) {
  const age = checkedAtAgeMs(account);
  if (age === Number.POSITIVE_INFINITY) {
    return {
      reason: 'Проверка ещё не запускалась',
      dotClass: 'bg-ink-faint',
      textClass: 'text-ink-muted'
    };
  }
  if (age > FRESH_CHECK_WINDOW_MS) {
    return {
      reason: 'Проверка устарела',
      dotClass: 'bg-feedback-warning-text',
      textClass: 'text-feedback-warning-text'
    };
  }
  const health = String(account?.health_summary?.status || '').trim().toLowerCase();
  if (health !== 'online') {
    return {
      reason: health ? `Проверка здоровья: ${health}` : 'Проверка здоровья ещё не готова',
      dotClass: 'bg-feedback-error-text',
      textClass: 'text-ink-muted'
    };
  }
  return {
    reason: summarizeCheckStatus(account).title,
    dotClass: 'bg-ink-faint',
    textClass: 'text-ink-muted'
  };
}

// «Проверен N мин назад» — относительное время по-русски.
export function formatCheckedAgo(value) {
  const ts = new Date(value || '').getTime();
  if (!Number.isFinite(ts)) return '';
  const minutes = Math.max(1, Math.round((Date.now() - ts) / 60000));
  const formatter = new Intl.RelativeTimeFormat('ru-RU', { numeric: 'auto' });
  if (minutes < 60) return formatter.format(-minutes, 'minute');
  return formatter.format(-Math.round(minutes / 60), 'hour');
}

export function accountLotLabel(account) {
  return account?.custom_label || saleTitleForAccount(account);
}

export function useAccountLots({ accessToken, accounts, reloadAccounts, showUiMessage }) {
  const sellableAccounts = useMemo(() => accounts.filter(isSellableForSale), [accounts]);
  const notReadyAccounts = useMemo(
    () => accounts.filter((account) => !isSellableForSale(account)),
    [accounts]
  );

  const [selectedIds, setSelectedIds] = useState(() => new Set());
  // Идентификаторы, которые мы уже когда-то предвыбрали: авто-выбор ставится
  // только на новые sellable-аккаунты, чтобы фоновое обновление (каждую минуту)
  // не возвращало снятые вручную галочки.
  const seenSellableIdsRef = useRef(new Set());

  useEffect(() => {
    const sellableIds = sellableAccounts.map((account) => String(account.id));
    const sellableSet = new Set(sellableIds);
    const seen = seenSellableIdsRef.current;
    const freshIds = sellableIds.filter((id) => !seen.has(id));
    if (freshIds.length) {
      freshIds.forEach((id) => seen.add(id));
    }
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => sellableSet.has(id)));
      freshIds.forEach((id) => next.add(id));
      return next;
    });
  }, [sellableAccounts]);

  function toggleSelected(id) {
    const key = String(id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  const [priceTon, setPriceTon] = useState('');
  const [title, setTitle] = useState(DEFAULT_LOT_TITLE);
  const [description, setDescription] = useState('');
  const [deliveryMode, setDeliveryMode] = useState('hybrid');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [results, setResults] = useState([]);
  const [submitError, setSubmitError] = useState('');

  const selectedCount = useMemo(
    () => sellableAccounts.filter((account) => selectedIds.has(String(account.id))).length,
    [sellableAccounts, selectedIds]
  );

  async function submitBatch() {
    const price = Number(String(priceTon).trim().replace(',', '.'));
    if (!Number.isFinite(price) || price <= 0) {
      showUiMessage('Укажи цену лота в TON — одно число больше нуля.', 'error');
      return;
    }
    const assetIds = sellableAccounts
      .filter((account) => selectedIds.has(String(account.id)))
      .map((account) => String(account.id));
    if (!assetIds.length) {
      showUiMessage('Отметь хотя бы один аккаунт.', 'error');
      return;
    }
    if (!accessToken) {
      showUiMessage('Сессия устарела — перезайди в кабинет.', 'error');
      return;
    }

    setIsSubmitting(true);
    setSubmitError('');
    setResults([]);
    try {
      const payload = {
        asset_ids: assetIds,
        price_ton: price,
        title: title.trim() || DEFAULT_LOT_TITLE,
        delivery_mode: deliveryMode
      };
      const trimmedDescription = description.trim();
      if (trimmedDescription) payload.description = trimmedDescription;

      const data = await apiRequest('/api/shop/admin/account-lots/batch', {
        accessToken,
        method: 'POST',
        body: payload
      });

      const labelById = new Map(accounts.map((account) => [String(account.id), accountLotLabel(account)]));
      const rows = (Array.isArray(data?.results) ? data.results : []).map((row) => ({
        ...row,
        label: labelById.get(String(row.asset_id)) || String(row.asset_id)
      }));
      setResults(rows);

      const created = Number(data?.created ?? rows.filter((row) => row.status === 'ok').length);
      const failed = rows.filter((row) => row.status !== 'ok').length;
      if (rows.length && created === 0) {
        showUiMessage('Ни один лот не выставился — смотри ошибки в списке ниже.', 'error');
      } else {
        showUiMessage(
          `Выставлено ${created} из ${rows.length}. Лоты видны на bullgram.xyz/shop.`,
          failed ? 'default' : 'success'
        );
      }
      await reloadAccounts?.();
    } catch (error) {
      const message = error.message || 'Не удалось выставить лоты.';
      setSubmitError(message);
      showUiMessage(message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  }

  return {
    sellableAccounts,
    notReadyAccounts,
    selectedIds,
    selectedCount,
    toggleSelected,
    clearSelection,
    priceTon,
    setPriceTon,
    title,
    setTitle,
    description,
    setDescription,
    deliveryMode,
    setDeliveryMode,
    isSubmitting,
    results,
    submitError,
    submitBatch
  };
}
