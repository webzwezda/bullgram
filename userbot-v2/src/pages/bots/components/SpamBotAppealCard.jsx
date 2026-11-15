import { useState } from 'react';
import { ExternalLink, Loader2, RefreshCw, Scale } from 'lucide-react';
import { apiRequest } from '../../../api/client.js';

// Полуавтоматическая апелляция лимита @SpamBot (план
// docs/plans/2026-11-15-spambot-verdicts-appeals.md, решение владельца):
// платформа прокликивает «Подать жалобу» → «Это ошибка», останавливается на
// шаге подтверждения «человек», финал человек завершает в Telegram Web этой
// сессии — кнопка открывает чат @SpamBot сразу (deep-link #?tgaddr, правок
// форка не нужно). Для frozen автоклика нет: сессия read-only, только гид.
export function SpamBotAppealCard({ accountId, status, accessToken, onRecheck, checking = false }) {
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const accountStatus = String(status || '').trim().toLowerCase();
  const isLimited = accountStatus === 'limited';
  const isFrozen = accountStatus === 'frozen';
  if (!accountId || (!isLimited && !isFrozen)) return null;

  const telegramWebUrl = `/userbot/telegram-web/${accountId}#?tgaddr=${encodeURIComponent('https://t.me/SpamBot')}`;

  const openTelegramWeb = () => {
    window.open(telegramWebUrl, '_blank', 'noopener');
  };

  const submitAppeal = async () => {
    if (!accessToken || running) return;
    setRunning(true);
    setOutcome(null);
    try {
      const data = await apiRequest(`/api/userbot/appeal/${accountId}`, {
        method: 'POST',
        accessToken
      });
      setOutcome(data || { result: 'needs_human', instruction: 'Пустой ответ сервера — проверь чат @SpamBot вручную.' });
    } catch (error) {
      setOutcome({ result: 'failed', instruction: String(error?.message || 'Апелляция не прошла. Подай её вручную через Telegram Web.') });
    } finally {
      setRunning(false);
    }
  };

  const resultTone = outcome?.result === 'submitted'
    ? 'bg-feedback-success-bg text-feedback-success-text'
    : 'bg-feedback-warning-bg text-feedback-warning-text';

  return (
    <div className="mt-3 space-y-2.5">
      <div className="flex flex-wrap gap-2">
        {isLimited ? (
          <button
            type="button"
            onClick={submitAppeal}
            disabled={running || checking || !accessToken}
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-action-primary px-4 text-sm font-bold text-action-primary-text! transition-colors hover:bg-action-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scale className="w-4 h-4" />}
            {running ? 'Кликаю апелляцию…' : 'Подать апелляцию'}
          </button>
        ) : null}
        <button
          type="button"
          onClick={openTelegramWeb}
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-border-default bg-surface-card px-4 text-sm font-bold text-ink-default transition-colors hover:bg-surface-subtle"
        >
          <ExternalLink className="w-4 h-4" />
          Открыть @SpamBot в Telegram Web
        </button>
        {onRecheck ? (
          <button
            type="button"
            onClick={onRecheck}
            disabled={checking || running}
            className="inline-flex h-9 items-center gap-2 rounded-xl border border-border-default bg-surface-card px-4 text-sm font-bold text-ink-default transition-colors hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50"
          >
            {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Перепроверить
          </button>
        ) : null}
      </div>

      {isFrozen ? (
        <ol className="m-0 list-none space-y-1.5 pl-0 text-sm text-ink-muted">
          {[
            'Открой чат @SpamBot — кнопка приведёт прямо в него.',
            'Напиши /start и дождись ответа.',
            'Нажми «Подать жалобу» → «Это ошибка».',
            'Дождись ответа модераторов в этом же чате.'
          ].map((step, index) => (
            <li key={step} className="flex items-start gap-2">
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-xs font-bold text-ink-muted">
                {index + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      ) : null}

      {outcome ? (
        <div className={`rounded-xl p-3 text-sm font-medium ${resultTone}`}>
          <p className="m-0">{outcome.instruction}</p>
          {outcome.last_reply ? (
            <p className="mb-0 mt-1.5 whitespace-pre-line border-l-2 border-current/30 pl-2 text-xs opacity-80">
              {outcome.last_reply}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
