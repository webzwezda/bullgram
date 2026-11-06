// Секция «Подключение бота» AutopostManagePage (behavior-preserving
// разрезка 2026-11-07): карта подключения с токеном и селектором ботов,
// карточка «Что это за бот» и свёрнутый блок «Интеграции и API».
// JSX и помощники (maskBotToken, curl-пример) дословно перенесены из страницы;
// хендлеры приходят пропсами и остались в композиторе (замыкаются на его стейт).
import { Bot, ChevronDown, Code, ExternalLink, Eye, EyeOff, FileText, Key, Loader2, Pause, Play, Plus, Trash2, Zap } from 'lucide-react';
import { Button } from '../../../components/ui/button.jsx';
import { Card } from '../../../components/ui/card.jsx';
import { Input } from '../../../components/ui/input.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select.jsx';
import { CodeBlock } from '../../../ui/CodeBlock.jsx';

function maskBotToken(value) {
  const t = String(value || '');
  const idx = t.indexOf(':');
  if (idx === -1) return '••••••••';
  return `${t.slice(0, idx)}:${'•'.repeat(8)}${t.slice(-4)}`;
}

function maskInvite(value) {
  const t = String(value || '');
  const idx = t.indexOf('?start=');
  if (idx === -1) return t;
  return `${t.slice(0, idx + 7)}${'•'.repeat(8)}`;
}

const AUTOPOST_POST_CURL = `curl -X POST \\
https://bullgram.xyz/api/external/v1/autopost/bots/{bot_id}/posts \\
-H "Authorization: Bearer brapi_..." \\
-H "Content-Type: application/json" \\
-d '{"target_channel_ids":["-100111","-100222"],"caption":"Hello","publish_now":true}'`;

export default function BotConnect({
  selectedBotId,
  setSelectedBotId,
  botToken,
  setBotToken,
  tokenRevealed,
  setTokenRevealed,
  existingBots,
  togglePause,
  pausing,
  botPaused,
  handleConnect,
  initing,
  askDelete
}) {
  return (
    <>
      {/* Подключение бота */}
      <Card className="p-0 gap-0 border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
        <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex flex-row items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
                <Zap className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">Бот автопостинга</h2>
                {selectedBotId === 'new' ? (
                  <p className="text-sm font-medium text-slate-500 mt-0.5">
                    Подключи Telegram-бота для автоматического постинга и приёма предложений
                  </p>
                ) : null}
              </div>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            {selectedBotId !== 'new' ? (
              <Button
                variant="outline"
                size="sm"
                className="h-10 rounded-xl font-semibold"
                type="button"
                onClick={togglePause}
                disabled={pausing}
              >
                {botPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                {botPaused ? 'Возобновить' : 'Пауза'}
              </Button>
            ) : null}
            {existingBots.length > 0 ? (
              <Select value={selectedBotId} onValueChange={setSelectedBotId}>
                <SelectTrigger className="h-10 w-[240px] bg-white rounded-xl border-slate-200 shadow-sm text-sm font-semibold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="new" className="rounded-lg"><Plus className="h-4 w-4 inline mr-1 -mt-0.5" />Подключить нового</SelectItem>
                  {existingBots.map((b) => (
                    <SelectItem key={b.id} value={b.id} className="rounded-lg">
                      @{b.username || 'Telegram Bot'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            </div>
          </div>
        </div>
        <div className="p-5 sm:p-6 space-y-4">
          <div className="flex flex-col md:flex-row items-end gap-4">
            <div className="flex-1 w-full">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 block">Токен бота</label>
              <div className="relative">
                <Input
                  value={selectedBotId === 'new' ? botToken : (tokenRevealed ? botToken : maskBotToken(botToken))}
                  onChange={selectedBotId === 'new' ? (e) => setBotToken(e.target.value) : undefined}
                  readOnly={selectedBotId !== 'new'}
                  placeholder="123456:ABC-DEF..."
                  spellCheck="false"
                  className={`font-mono h-11 rounded-xl border-slate-200 shadow-sm focus-visible:ring-indigo-500 pr-20 ${selectedBotId !== 'new' ? 'bg-slate-50 text-slate-500' : 'bg-white'}`}
                />
                {selectedBotId !== 'new' && botToken ? (
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700 transition-colors"
                    onClick={() => setTokenRevealed((v) => !v)}
                    aria-label={tokenRevealed ? 'Скрыть токен' : 'Показать токен'}
                    title={tokenRevealed ? 'Скрыть токен' : 'Показать токен'}
                  >
                    {tokenRevealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                ) : null}
              </div>
            </div>
            <div className="flex gap-2 w-full md:w-auto">
              {selectedBotId === 'new' ? (
                <Button
                  onClick={handleConnect}
                  disabled={!botToken.trim() || initing}
                  className="h-11 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold disabled:shadow-none disabled:bg-slate-100 disabled:text-slate-400 w-full md:w-auto"
                >
                  {initing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Инициализация...</> : 'Подключить'}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  onClick={askDelete}
                  className="h-11 px-4 rounded-xl text-rose-600 hover:bg-rose-50 font-bold border border-rose-100 w-full md:w-auto"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Удалить бота
                </Button>
              )}
              <Button variant="outline" asChild className="h-11 rounded-xl text-slate-700 border-slate-200 shadow-sm font-semibold">
                <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="flex items-center gap-2">
                  @BotFather <ExternalLink className="w-4 h-4" />
                </a>
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* Что это за бот — показываем там же, где и API-блок, перед ним */}
      {selectedBotId === 'new' && (
        <Card className="p-0 gap-0 border-0 shadow-sm ring-1 ring-slate-200/60 bg-white overflow-hidden rounded-2xl">
          <div className="p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
                <Bot className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold text-slate-900">Что это за бот</h3>
                <p className="text-sm text-slate-600 mt-1 leading-relaxed max-w-[70ch]">
                  Telegram-бот, который ведёт твои каналы за тебя: сам публикует посты по расписанию,
                  принимает предложения от подписчиков и ставит реакции на новые посты.
                  Один бот может вести несколько каналов — всё управление здесь, на этом экране.
                </p>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {['Постинг по расписанию', 'Приём предложений', 'Автореакции и кнопки'].map(chip => (
                    <span key={chip} className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 text-xs font-semibold">
                      {chip}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Заметка про API — показываем, когда в селекторе выбрано «создать нового».
          Свёрнута по умолчанию: инженерный контент не должен стоять между админом и токеном */}
      {selectedBotId === 'new' && (
        <details className="group rounded-2xl shadow-sm ring-1 ring-slate-200/60 bg-white overflow-hidden">
          <summary className="p-5 sm:p-6 cursor-pointer select-none flex items-center gap-3 list-none [&::-webkit-details-marker]:hidden">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
              <Code className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-bold text-slate-900">Интеграции и API</h3>
              <p className="text-xs text-slate-500 mt-0.5 max-w-[70ch]">
                Публикация постов из n8n, Zapier или скриптов — для автоматизации. Разверните, если нужно.
              </p>
            </div>
            <ChevronDown className="w-4 h-4 text-slate-400 shrink-0 transition-transform group-open:rotate-180" />
          </summary>
          <div className="px-5 sm:px-6 pb-5 sm:pb-6 pt-4 space-y-3 border-t border-slate-100">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-bold text-slate-900">Публикация через API</h3>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed max-w-[70ch]">
                  Из n8n, Zapier или скриптов. Кнопки и автореакция наследуются из настроек канала.
                  Нужен токен <code className="font-mono text-[11px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">brapi_</code> со скоупом <code className="font-mono text-[11px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">api:autopost:write</code>.
                </p>
              </div>
            </div>

            <CodeBlock
              label="POST /autopost/bots/{bot_id}/posts"
              value={AUTOPOST_POST_CURL}
            />

            <p className="text-xs text-slate-500 leading-relaxed max-w-[70ch]">
              Чтобы узнать <code className="font-mono text-[11px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">bot_id</code> и <code className="font-mono text-[11px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">target_channel_ids</code>:{' '}
              <code className="font-mono text-[11px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">GET /autopost/bots</code>, затем{' '}
              <code className="font-mono text-[11px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">GET /autopost/bots/{'{bot_id}'}/channels</code>.
            </p>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button asChild variant="outline" size="sm" className="h-8 rounded-lg text-xs font-semibold border-slate-200 bg-white shadow-sm">
                <a href="/api/external/v1/docs" target="_blank" rel="noreferrer" className="flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" />
                  API-документация
                </a>
              </Button>
              <Button asChild variant="outline" size="sm" className="h-8 rounded-lg text-xs font-semibold border-slate-200 bg-white shadow-sm">
                <a href="/userbot/api" className="flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5" />
                  Выпустить токен
                </a>
              </Button>
            </div>
          </div>
        </details>
      )}
    </>
  );
}
