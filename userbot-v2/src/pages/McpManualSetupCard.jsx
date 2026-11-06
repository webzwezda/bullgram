import { useState } from 'react';
import { Bot, Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { APP_CONFIG } from '../config.js';
import { Badge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.jsx';
import { Input } from '../components/ui/input.jsx';
import { CodeBlock } from '../ui/CodeBlock.jsx';

export function CopyInput({ value, monospace, placeholder }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (err) {
      console.error('Clipboard write failed:', err);
      toast.error('Не удалось скопировать — выдели значение и скопируй вручную.');
    }
  }
  return (
    <div className="relative">
      <Input
        className={`h-9 bg-slate-50 pr-10 ${monospace ? 'font-mono text-xs' : 'text-sm font-medium text-slate-900'}`}
        value={value || ''}
        placeholder={placeholder || '—'}
        readOnly
      />
      <button
        type="button"
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
        onClick={handleCopy}
        title="Копировать"
      >
        {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}

function StepHeader({ number, title }) {
  return (
    <div className="flex items-center gap-2.5 mb-2">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-bold text-indigo-600 ring-1 ring-indigo-200">
        {number}
      </div>
      <h3 className="text-sm font-bold text-slate-900">{title}</h3>
    </div>
  );
}

export function McpManualSetupCard({ mcpServersSnippet, setupTokenValue, testToken, testing, testResult }) {
  const [manualOpen, setManualOpen] = useState(false);
  return (
    <Card className="border-slate-200/70 bg-white shadow-sm">
      <CardHeader className="px-6 pt-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center text-white shadow-lg shadow-emerald-500/20 shrink-0">
              <Bot className="w-6 h-6" />
            </div>
            <div>
              <CardTitle className="text-lg font-bold tracking-tight text-slate-900">Ручная настройка</CardTitle>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
                Универсальный MCP-конфиг: подходит любому ИИ-агенту с поддержкой mcpServers.
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="h-9 rounded-xl shrink-0" onClick={() => setManualOpen((v) => !v)}>
            {manualOpen ? 'Скрыть' : 'Показать'}
          </Button>
        </div>
      </CardHeader>
      {manualOpen ? (
        <CardContent className="space-y-6 px-6 pb-6">
          <div className="space-y-5">
            <div>
              <StepHeader number={1} title="Скопируй Bullgram MCP" />
              <p className="text-sm text-slate-500 mb-2 ml-9">Готовый фрагмент с токеном и endpoint.</p>
              <div className="ml-9">
                <CodeBlock label="Готовый config" value={mcpServersSnippet} />
              </div>
            </div>

            <div>
              <StepHeader number={2} title="Вставь в конфиг своего ИИ-агента" />
              <p className="text-sm text-slate-500 mb-2 ml-9">Нужна секция mcpServers в конфиге твоего клиента.</p>
              <div className="ml-9 grid gap-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 flex items-center gap-3">
                  <span className="text-xs font-semibold text-slate-500 w-14 shrink-0">Секция</span>
                  <code className="font-mono text-xs text-slate-700 break-all">mcpServers</code>
                </div>
              </div>
            </div>

            <div>
              <StepHeader number={3} title="Перезапусти и проверь" />
              <p className="text-sm text-slate-500 mb-2 ml-9">После перезапуска агенту станут доступны инструменты Bullgram.</p>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-4 space-y-3">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Быстрые значения</div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-slate-500">MCP endpoint</span>
                <CopyInput value={`${APP_CONFIG.backendUrl}/api/mcp`} monospace />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-slate-500">Token</span>
                <CopyInput value={setupTokenValue} monospace placeholder="•••• (нажми «Показать»)" />
              </label>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button className="h-9 rounded-xl" type="button" onClick={testToken} disabled={testing}>
              {testing ? 'Проверяем...' : 'Проверить подключение'}
            </Button>
            {testResult ? (
              <Badge variant="outline" className={testResult.ok ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'}>
                {testResult.text}
              </Badge>
            ) : null}
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}
