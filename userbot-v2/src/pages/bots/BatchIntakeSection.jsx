import { useRef, useState } from 'react';
import {
  AlertCircle, CheckCircle2, FileUp, FolderOpen, FolderUp, Layers, Loader2, UploadCloud
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { collectDataTransferEntries, useAccountIntake } from './useAccountIntake.js';

// Градиентная иконка секции — паттерн DESIGN.md §4: он сознательно не токенизирован
// (два шага одной рампы + тень того же шага), поэтому raw-классы здесь разрешены.
const SECTION_ICON_CLASS = 'from-indigo-500 to-indigo-600 shadow-indigo-500/20'; // ds-allow-hardcode

// Feedback-пары статусов (фон+текст из одного набора, см. design/tokens/color.semantic.json).
const ITEM_TONES = {
  queued: { badge: 'bg-surface-subtle text-ink-muted border-border-default', label: 'В очереди' },
  ok: { badge: 'bg-feedback-success-bg text-feedback-success-text border-feedback-success-bg', label: 'Готово' },
  failed: { badge: 'bg-feedback-error-bg text-feedback-error-text border-feedback-error-bg', label: 'Ошибка' }
};

function itemToneFor(status) {
  return ITEM_TONES[status] || ITEM_TONES.queued;
}

function pluralizeRu(count, one, few, many) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function countArchives(files) {
  return files.filter((file) => /\.zip$/i.test(file.name || '')).length;
}

// Партия аккаунтов: приёмка пачек (zip-архивы и папки) только для платформенного
// админа. Бэкенд — единственный разборщик паков, локальных превью содержимого нет.
export function BatchIntakeSection({
  accessToken,
  reloadAccounts,
  showUiMessage
}) {
  const filesInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const {
    addDroppedEntries,
    addFilesFromInput,
    intake,
    isProcessing,
    resetIntake,
    startIntake
  } = useAccountIntake({ accessToken, reloadAccounts, showUiMessage });

  const batch = intake.batch;
  const selectedFiles = intake.files;
  const archiveCount = countArchives(selectedFiles);
  const batchItems = batch?.items || [];
  const batchTotal = Number(batch?.total || 0);
  const batchDone = Number(batch?.processed || 0);
  const isBatchFailed = batch?.status === 'failed';

  function handleDrop(event) {
    event.preventDefault();
    setIsDragging(false);
    if (isProcessing) return;
    const entries = collectDataTransferEntries(event.dataTransfer);
    if (entries.length) {
      addDroppedEntries(entries);
      return;
    }
    if (event.dataTransfer?.files?.length) {
      addFilesFromInput(event.dataTransfer.files, false);
    }
  }

  function handleInputReset(event) {
    // Сброс value, чтобы повторный выбор той же папки/файлов снова стрельнул onChange.
    event.target.value = '';
  }

  return (
    <Card className="mb-6 rounded-2xl">
      <div className="bg-surface-subtle border-b border-border-default p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <div className={`flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg ${SECTION_ICON_CLASS}`}>
            <Layers className="size-6" />
          </div>
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold text-ink-strong">
              Партия аккаунтов
              {isProcessing ? <Loader2 className="size-5 animate-spin text-ink-muted" /> : null}
            </h2>
            <p className="mt-0.5 text-sm text-ink-muted">
              Скинь сразу много паков — zip-архивы или папки. Пачка разберётся на отдельные аккаунты автоматически.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-6">
        {intake.error ? (
          <div className="flex items-start gap-3 rounded-2xl border border-feedback-error-bg bg-feedback-error-bg p-4 text-sm font-medium text-feedback-error-text">
            <AlertCircle className="mt-0.5 size-5 shrink-0" />
            <div className="pt-0.5">{intake.error}</div>
          </div>
        ) : null}

        <div
          onDragOver={(event) => {
            event.preventDefault();
            if (!isProcessing) setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
            isDragging
              ? 'border-action-primary bg-feedback-info-bg'
              : 'border-border-default bg-surface-subtle'
          }`}
        >
          <div className="mb-3 flex size-14 items-center justify-center rounded-full border border-border-default bg-surface-card shadow-sm">
            <FolderUp className="size-7 text-ink-faint" />
          </div>
          <p className="text-sm font-semibold text-ink-body">Перетащи сюда zip-архивы или папки с аккаунтами</p>
          <p className="mt-1 max-w-md text-sm text-ink-muted">
            Можно бросить сразу несколько паков, в том числе папку целиком — до 400 файлов за раз.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => filesInputRef.current?.click()}
            disabled={isProcessing}
          >
            <FileUp data-icon="inline-start" />
            Выбрать файлы
          </Button>
          <Button
            variant="outline"
            onClick={() => folderInputRef.current?.click()}
            disabled={isProcessing}
          >
            <FolderOpen data-icon="inline-start" />
            Выбрать папку
          </Button>
        </div>

        {/* Скрытые инпуты невидимы и не требуют стилизации — kit-правило их не касается. */}
        <input
          ref={filesInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            addFilesFromInput(event.target.files, false);
            handleInputReset(event);
          }}
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          webkitdirectory="true"
          className="hidden"
          onChange={(event) => {
            addFilesFromInput(event.target.files, true);
            handleInputReset(event);
          }}
        />

        {selectedFiles.length ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border-default bg-surface-card px-4 py-3">
            <span className="text-sm font-semibold text-ink-body">
              {selectedFiles.length} {pluralizeRu(selectedFiles.length, 'файл', 'файла', 'файлов')} ·{' '}
              {archiveCount} {pluralizeRu(archiveCount, 'архив', 'архива', 'архивов')}
            </span>
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" onClick={resetIntake} disabled={isProcessing}>
                Очистить
              </Button>
              <Button onClick={startIntake} disabled={isProcessing}>
                {isProcessing ? (
                  <>
                    <Loader2 className="animate-spin" data-icon="inline-start" />
                    Отправляю...
                  </>
                ) : (
                  <>
                    <UploadCloud data-icon="inline-start" />
                    Отправить в приёмку
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : null}

        {intake.rejected.length ? (
          <div className="rounded-2xl border border-feedback-warning-bg bg-feedback-warning-bg p-4">
            <p className="text-sm font-semibold text-feedback-warning-text">
              Пропущено при приёмке: {intake.rejected.length}
            </p>
            <ul className="mt-2 space-y-1">
              {intake.rejected.map((row, index) => (
                <li key={`${row.name}-${index}`} className="text-sm text-feedback-warning-text">
                  <span className="font-mono tabular-nums">{row.name}</span> — {row.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {batch ? (
          <div className="space-y-3">
            {batch.status === 'completed' ? (
              <div className="flex items-start gap-3 rounded-2xl border border-feedback-info-bg bg-feedback-info-bg p-4 text-sm font-medium text-feedback-info-text">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0" />
                <div className="pt-0.5">
                  Аккаунты добавлены в safe-mode. Отлёжка запустится автоматически; состояние — в разделе «Гигиена аккаунтов».
                </div>
              </div>
            ) : null}
            {isBatchFailed && batch.error ? (
              <div className="flex items-start gap-3 rounded-2xl border border-feedback-error-bg bg-feedback-error-bg p-4 text-sm font-medium text-feedback-error-text">
                <AlertCircle className="mt-0.5 size-5 shrink-0" />
                <div className="pt-0.5">{batch.error}</div>
              </div>
            ) : null}

            {batchItems.length ? (
              <div className="rounded-2xl border border-border-default bg-surface-subtle p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold uppercase tracking-widest text-ink-muted">Разбор пачки</span>
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-ink-body">
                    {batch.status === 'processing' ? <Loader2 className="size-4 animate-spin" /> : null}
                    Готово {batchDone} из {batchTotal}
                  </span>
                </div>
                <ul className="max-h-80 space-y-1.5 overflow-y-auto">
                  {batchItems.map((item) => {
                    const tone = itemToneFor(item.status);
                    return (
                      <li key={item.key} className="rounded-lg border border-border-default bg-surface-card px-3 py-2">
                        <div className="flex items-center gap-3">
                          <span className="min-w-0 flex-1 truncate font-mono text-xs tabular-nums text-ink-body">
                            {item.label}
                          </span>
                          <Badge variant="outline" className={tone.badge}>{tone.label}</Badge>
                        </div>
                        {item.error ? (
                          <div className="mt-1 text-xs text-ink-muted">{item.error}</div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            {!isProcessing ? (
              <div>
                <Button variant="outline" onClick={resetIntake}>
                  <UploadCloud data-icon="inline-start" />
                  Загрузить ещё
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
