import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../api/client.js';

// Приёмка пачек аккаунтов (партия аккаунтов, только платформенный админ).
// Локального парсинга нет и не будет: backend — единственный разборщик паков.
// Клиент собирает File + относительные пути (папки и zip), отправляет одним
// POST и опрашивает статус разбора до терминального состояния.

const MAX_INTAKE_FILES = 400;
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

const CAP_MESSAGE = `За одну приёмку можно передать не больше ${MAX_INTAKE_FILES} файлов. Лишнее отброшено — грузи остаток следующей пачкой.`;

function buildInitialState() {
  return {
    files: [],
    paths: [],
    rejected: [],
    batch: null,
    isUploading: false,
    error: ''
  };
}

// Дропнутые items нужно прочитать синхронно, в обработчике события —
// после первого await DataTransfer уже пуст.
export function collectDataTransferEntries(dataTransfer) {
  const entries = [];
  const items = dataTransfer?.items;
  if (items?.length) {
    for (const item of Array.from(items)) {
      const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
      if (entry) entries.push(entry);
    }
  }
  return entries;
}

// readEntries отдаёт порциями (обычно до 100), дочитываем до пустого ответа.
function readAllDirectoryEntries(reader) {
  return new Promise((resolve, reject) => {
    const collected = [];
    function readChunk() {
      reader.readEntries((entries) => {
        if (!entries.length) {
          resolve(collected);
          return;
        }
        collected.push(...entries);
        readChunk();
      }, reject);
    }
    readChunk();
  });
}

async function collectEntryFiles(entry, prefix, collected) {
  if (!entry) return;
  if (entry.isFile) {
    try {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      collected.push({ file, path: `${prefix}${entry.name}` });
    } catch {
      // Недоступный файл (права/симлинк) пропускаем — backend увидит только то, что дошло.
    }
    return;
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    const children = await readAllDirectoryEntries(reader).catch(() => []);
    const nextPrefix = `${prefix}${entry.name}/`;
    for (const child of children) {
      await collectEntryFiles(child, nextPrefix, collected);
    }
  }
}

export function useAccountIntake({ accessToken, reloadAccounts, showUiMessage }) {
  const pollTimerRef = useRef(null);
  const pollTimeoutRef = useRef(null);
  const [intake, setIntake] = useState(buildInitialState);

  const isProcessing = intake.isUploading || intake.batch?.status === 'processing';

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

  function mergeFiles(incoming) {
    if (!incoming.length) return;
    setIntake((prev) => {
      const room = MAX_INTAKE_FILES - prev.files.length;
      if (room <= 0) {
        return { ...prev, error: CAP_MESSAGE };
      }
      const accepted = incoming.slice(0, room);
      return {
        ...prev,
        files: [...prev.files, ...accepted.map((row) => row.file)],
        paths: [...prev.paths, ...accepted.map((row) => row.path)],
        error: incoming.length > room ? CAP_MESSAGE : prev.error
      };
    });
  }

  // Скрытые инпуты: у папки путь живёт в webkitRelativePath, у одиночных файлов — name.
  function addFilesFromInput(fileList, useRelativePaths) {
    const incoming = Array.from(fileList || []).map((file) => ({
      file,
      path: useRelativePaths ? (file.webkitRelativePath || file.name) : file.name
    }));
    mergeFiles(incoming);
  }

  async function addDroppedEntries(entries) {
    const collected = [];
    for (const entry of entries || []) {
      await collectEntryFiles(entry, '', collected);
    }
    if (collected.length) {
      mergeFiles(collected);
      return;
    }
    // Пустой дроп, недоступные файлы или браузер без webkitGetAsEntry.
    showUiMessage('Дроп прочитать не удалось — перетащи zip-архивы или выбери папку кнопкой.', 'error');
  }

  function startPolling(batchId) {
    stopPolling();
    let failedAttempts = 0;
    pollTimerRef.current = window.setInterval(async () => {
      try {
        const result = await apiRequest(`/api/userbot/intake/batch/${batchId}`, { accessToken });
        failedAttempts = 0;
        const batch = result?.batch;
        if (!batch) return;
        setIntake((prev) => ({ ...prev, batch }));
        if (!batch.status || batch.status === 'processing') return;
        stopPolling();
        if (batch.status === 'failed') {
          showUiMessage(batch.error || 'Приёмка пачки не удалась.', 'error');
        } else {
          showUiMessage(`Пачка разобрана: готово ${Number(batch.processed || 0)} из ${Number(batch.total || 0)}.`, 'success');
        }
        reloadAccounts?.();
      } catch (error) {
        // Разовые сетевые сбои не должны убивать ожидание долгой пачки —
        // роняем поллинг только после нескольких ошибок подряд.
        failedAttempts += 1;
        if (failedAttempts < 5) return;
        stopPolling();
        const message = error.message || 'Не удалось получить статус приёмки пачки.';
        setIntake((prev) => ({
          ...prev,
          error: message,
          batch: prev.batch ? { ...prev.batch, status: 'failed', error: message } : prev.batch
        }));
        showUiMessage(message, 'error');
      }
    }, POLL_INTERVAL_MS);

    pollTimeoutRef.current = window.setTimeout(() => {
      stopPolling();
      const message = 'Приёмка пачки не завершилась за 10 минут. Обнови страницу — если пачка так и висит, зови поддержку.';
      setIntake((prev) => ({
        ...prev,
        error: message,
        batch: prev.batch ? { ...prev.batch, status: 'failed', error: message } : prev.batch
      }));
      showUiMessage('Приёмка пачки не завершилась за 10 минут.', 'error');
    }, POLL_TIMEOUT_MS);
  }

  async function startIntake() {
    if (!intake.files.length) {
      showUiMessage('Сначала выбери zip-архивы или папку с аккаунтами.', 'error');
      return;
    }
    if (!accessToken) {
      showUiMessage('Сессия устарела — перезайди в кабинет.', 'error');
      return;
    }

    setIntake((prev) => ({ ...prev, isUploading: true, error: '' }));
    try {
      const formData = new FormData();
      for (const file of intake.files) {
        formData.append('files', file);
      }
      formData.append('paths', JSON.stringify(intake.paths));

      const result = await apiRequest('/api/userbot/intake/batch', {
        accessToken,
        method: 'POST',
        body: formData
      });

      const batch = {
        id: result.batch_id,
        status: 'processing',
        total: Number(result.total ?? intake.files.length),
        processed: 0,
        failed: 0,
        items: [],
        error: ''
      };
      setIntake((prev) => ({
        ...prev,
        isUploading: false,
        rejected: Array.isArray(result.rejected) ? result.rejected : [],
        batch,
        files: [],
        paths: []
      }));
      showUiMessage(`Пачка принята в приёмку: ${batch.total} файл(ов). Разбираю...`);
      startPolling(result.batch_id);
    } catch (error) {
      setIntake((prev) => ({
        ...prev,
        isUploading: false,
        error: error.message || 'Не удалось отправить пачку в приёмку.'
      }));
      showUiMessage(error.message || 'Не удалось отправить пачку в приёмку.', 'error');
    }
  }

  function resetIntake() {
    stopPolling();
    setIntake(buildInitialState());
  }

  return {
    addDroppedEntries,
    addFilesFromInput,
    intake,
    isProcessing,
    resetIntake,
    startIntake
  };
}
