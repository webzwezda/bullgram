import { useRef, useState } from 'react';
import {
  AlertCircle, CheckCircle2, FileUp, FolderOpen, FolderUp, Layers, Loader2, UploadCloud
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { collectDataTransferEntries, useAccountIntake } from './useAccountIntake.js';

// Пары фонов+текста из одного набора (DESIGN.md «Feedback»): у бейджа — только bg+text,
// каноничный баннер — видимый бордер + подложка пары + двухтоновый текст.
const BADGE_TONES = {
  queued: 'bg-surface-subtle text-ink-muted',
  ok: 'bg-feedback-success-bg text-feedback-success-text',
  failed: 'bg-feedback-error-bg text-feedback-error-text'
};

const BADGE_LABELS = {
  queued: 'В очереди',
  ok: 'Готово',
  failed: 'Ошибка'
};

function badgeToneFor(status) {
  return {
    className: BADGE_TONES[status] || BADGE_TONES.queued,
    label: BADGE_LABELS[status] || BADGE_LABELS.queued
  };
}

// Каноничный баннер состояния: конструкция как у qr-баннера онбординга —
// скруглённый блок с бордером, подложкой feedback-пары и иконкой тона.
function StatusBanner({ tone, icon, children }) {
  return (
    <div className="p-4 flex gap-3 items-start rounded-2xl border border-border-default bg-surface-card shadow-sm">
      <span className={`shrink-0 mt-0.5 ${tone}`}>{icon}</span>
      <div className="pt-0.5 text-sm font-medium text-ink-body">{children}</div>
    </div>
  );
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
    <Card className="border-0 shadow-lg ring-1 ring-border-default mb-6 bg-surface-card overflow-hidden rounded-2xl">
      <div className="bg-surface-subtle/50 border-b border-border-default p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-action-primary flex items-center justify-center text-surface-card shrink-0">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold text-ink-strong">
              Партия аккаунтов
              {isProcessing ? <Loader2 className="w-5 h-5 animate-spin text-ink-muted" /> : null}
            </h2>
            <p className="text-sm text-ink-muted mt-0.5">
              Скинь сразу много паков — zip-архивы или папки. Пачка разберётся на отдельные аккаунты автоматически.
            </p>
          </div>
        </div>
      </div>

      <div className="p-5 sm:p-6 space-y-4">
        {intake.error ? (
          <StatusBanner tone="text-feedback-error-text" icon={<AlertCircle className="w-5 h-5" />}>
            {intake.error}
          </StatusBanner>
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
              ? 'border-action-primary bg-surface-subtle'
              : 'border-border-default bg-surface-subtle/50'
          }`}
        >
          <div className="w-14 h-14 rounded-full bg-surface-card border border-border-default flex items-center justify-center mb-3">
            <FolderUp className="w-7 h-7 text-ink-faint" />
          </div>
          <p className="text-sm font-semibold text-ink-body">Перетащи сюда zip-архивы или папки с аккаунтами</p>
          <p className="mt-1 max-w-md text-sm text-ink-muted">
            Можно бросить сразу несколько паков, в том числе папку целиком — до 400 файлов за раз.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => filesInputRef.current?.click()} disabled={isProcessing}>
            <FileUp className="w-4 h-4 mr-2" />
            Выбрать файлы
          </Button>
          <Button variant="outline" onClick={() => folderInputRef.current?.click()} disabled={isProcessing}>
            <FolderOpen className="w-4 h-4 mr-2" />
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
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border-default bg-surface-subtle/50 px-4 py-3">
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
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Отправляю...
                  </>
                ) : (
                  <>
                    <UploadCloud className="w-4 h-4 mr-2" />
                    Отправить в приёмку
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : null}

        {intake.rejected.length ? (
          <div className="p-4 flex gap-3 items-start rounded-2xl border border-border-default bg-feedback-warning-bg">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-feedback-warning-text" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink-body">
                Пропущено при приёмке: {intake.rejected.length}
              </p>
              <ul className="mt-2 space-y-1">
                {intake.rejected.map((row, index) => (
                  <li key={`${row.name}-${index}`} className="text-sm text-ink-muted">
                    <span className="font-mono tabular-nums">{row.name}</span> — {row.reason}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        {batch ? (
          <div className="space-y-4">
            {batch.status === 'completed' ? (
              <StatusBanner tone="text-feedback-success-text" icon={<CheckCircle2 className="w-5 h-5" />}>
                Аккаунты добавлены в safe-mode. Отлёжка запустится автоматически; состояние — в разделе «Гигиена аккаунтов».
              </StatusBanner>
            ) : null}
            {isBatchFailed && batch.error ? (
              <StatusBanner tone="text-feedback-error-text" icon={<AlertCircle className="w-5 h-5" />}>
                {batch.error}
              </StatusBanner>
            ) : null}

            {batchItems.length ? (
              <div className="rounded-2xl border border-border-default bg-surface-subtle/50 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="text-xs uppercase tracking-widest font-semibold text-ink-muted">
                    Разбор пачки
                  </span>
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-ink-body tabular-nums">
                    {batch.status === 'processing' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Готово {batchDone} из {batchTotal}
                  </span>
                </div>
                <ul className="max-h-80 space-y-1.5 overflow-y-auto">
                  {batchItems.map((item) => {
                    const tone = badgeToneFor(item.status);
                    return (
                      <li key={item.key} className="rounded-lg border border-border-default bg-surface-card px-3 py-2">
                        <div className="flex items-center gap-3">
                          <span className="min-w-0 flex-1 truncate font-mono text-xs tabular-nums text-ink-body">
                            {item.label}
                          </span>
                          <Badge variant="secondary" className={`text-[10px] uppercase font-bold py-0.5 px-2 ${tone.className}`}>
                            {tone.label}
                          </Badge>
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
                  <UploadCloud className="w-4 h-4 mr-2" />
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
