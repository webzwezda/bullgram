import { useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../../api/client.js';
import { saleTitleForAccount } from './bots-accounts.utils.js';

// Партия аккаунтов → продажа: выбор живых аккаунтов из результатов скана
// (useSaleScan отдаёт только sellable-строки) и публикация пачкой публичных
// лотов магазина. Финальный гейт всё равно делает бэкенд при выставлении —
// нездоровым/устаревшим аккаунтам он вернёт status='failed'.


// Строка скана → кандидат в лоты (та же форма, что раньше приходила из
// state.accounts): id = account_id уходит в batch как asset_id.
function scanItemToCandidate(item) {
  return {
    id: item.account_id,
    custom_label: item.label,
    runtime_status: item.verdict,
    last_checked_at: item.checked_at,
    health_summary: { status: 'online' }
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

function accountLotLabel(account) {
  return account?.custom_label || saleTitleForAccount(account);
}

export function useAccountLots({ accessToken, items, showUiMessage }) {
  const candidates = useMemo(
    () => (Array.isArray(items) ? items : [])
      .filter((item) => item?.account_id)
      .map(scanItemToCandidate),
    [items]
  );

  const [selectedIds, setSelectedIds] = useState(() => new Set());
  // Идентификаторы, которые мы уже когда-то предвыбрали: авто-выбор ставится
  // только на новые sellable-кандидаты, чтобы обновление данных не возвращало
  // снятые вручную галочки. Новый скан меняет список целиком — старый выбор
  // обрезается до живых строк, свежие результаты предвыбираются заново.
  const seenCandidateIdsRef = useRef(new Set());

  useEffect(() => {
    const candidateIds = candidates.map((account) => String(account.id));
    const candidateSet = new Set(candidateIds);
    const seen = seenCandidateIdsRef.current;
    const freshIds = candidateIds.filter((id) => !seen.has(id));
    if (freshIds.length) {
      freshIds.forEach((id) => seen.add(id));
    }
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => candidateSet.has(id)));
      freshIds.forEach((id) => next.add(id));
      return next;
    });
  }, [candidates]);

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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [results, setResults] = useState([]);
  const [submitError, setSubmitError] = useState('');

  const selectedCount = useMemo(
    () => candidates.filter((account) => selectedIds.has(String(account.id))).length,
    [candidates, selectedIds]
  );

  async function submitBatch() {
    const price = Number(String(priceTon).trim().replace(',', '.'));
    if (!Number.isFinite(price) || price <= 0) {
      showUiMessage('Укажи цену лота в TON — одно число больше нуля.', 'error');
      return;
    }
    const assetIds = candidates
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
      // Название генерирует сервер (страна по телефону + срок отлёжки);
      // режим выдачи не выбираем — что получит покупатель, решается тем,
      // купил он анонимно или под логином (гибрид).
      const payload = {
        asset_ids: assetIds,
        price_ton: price
      };

      const data = await apiRequest('/api/shop/admin/account-lots/batch', {
        accessToken,
        method: 'POST',
        body: payload
      });

      const labelById = new Map(candidates.map((account) => [String(account.id), accountLotLabel(account)]));
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
    } catch (error) {
      const message = error.message || 'Не удалось выставить лоты.';
      setSubmitError(message);
      showUiMessage(message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  }

  return {
    candidates,
    selectedIds,
    selectedCount,
    toggleSelected,
    clearSelection,
    priceTon,
    setPriceTon,
    isSubmitting,
    results,
    submitError,
    submitBatch
  };
}
