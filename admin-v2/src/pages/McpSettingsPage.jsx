import { useEffect, useMemo, useState } from 'react';
import { Bot, Check, Copy, KeyRound, MessageSquare, RefreshCcw, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { APP_CONFIG } from '../config.js';
import { Badge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.jsx';
import { Input } from '../components/ui/input.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';

function formatWhen(value) {
  if (!value) return 'Еще не использовался';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Дата неизвестна';
  return date.toLocaleString('ru-RU');
}

function maskToken(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  if (token.length <= 18) return token;
  return `${token.slice(0, 16)}...${token.slice(-6)}`;
}

function CopyInput({ value, monospace }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    if (!value) return;
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }
  return (
    <div className="relative">
      <Input
        className={`h-9 bg-slate-50 pr-10 ${monospace ? 'font-mono text-xs' : 'text-sm font-medium text-slate-900'}`}
        value={value || '—'}
        readOnly
      />
      <button
        type="button"
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
        onClick={handleCopy}
        title="Копировать"
      >
        {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}

function CodeBlock({ value, label }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    if (!value) return;
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100">
        <span className="text-xs font-semibold text-slate-500">{label}</span>
        <button
          type="button"
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          onClick={handleCopy}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Скопировано' : 'Копировать'}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-xs font-mono leading-5 text-slate-700"><code>{value}</code></pre>
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

export function McpSettingsPage() {
  const { accessToken, profilePlan } = useAuth();
  const [loading, setLoading] = useState(true);
  const [tokens, setTokens] = useState([]);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState('');
  const [testing, setTesting] = useState(false);
  const [label, setLabel] = useState('OpenClaw');
  const [lastCreatedToken, setLastCreatedToken] = useState('');
  const [lastCreatedRecord, setLastCreatedRecord] = useState(null);
  const [testResult, setTestResult] = useState(null);

  async function loadTokens() {
    if (!accessToken) return;
    const data = await apiRequest('/api/mcp/tokens', { accessToken });
    setTokens(data.tokens || []);
  }

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      if (!accessToken) return;
      try {
        setLoading(true);
        setError('');
        const data = await apiRequest('/api/mcp/tokens', { accessToken });
        if (cancelled) return;
        setTokens(data.tokens || []);
      } catch (nextError) {
        if (!cancelled) setError(nextError.message || 'Не удалось загрузить MCP экран.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    bootstrap();
    return () => { cancelled = true; };
  }, [accessToken]);

  const activeTokens = useMemo(() => tokens.filter((item) => !item.revoked_at), [tokens]);
  const tokenForSetup = lastCreatedToken || '${BULLRUN_MCP_TOKEN}';

  const mcpServerSnippet = useMemo(() => `{
  "bullrun": {
    "command": "npx",
    "args": [
      "-y",
      "mcp-remote@latest",
      "--http",
      "${APP_CONFIG.backendUrl}/api/mcp",
      "--header",
      "Authorization: Bearer ${tokenForSetup}"
    ]
  }
}`, [tokenForSetup]);

  const openClawConfigSnippet = useMemo(() => `{
  "plugins": {
    "entries": {
      "acpx": {
        "enabled": true,
        "config": {
          "mcpServers": ${mcpServerSnippet}
        }
      }
    }
  }
}`, [mcpServerSnippet]);

  const agentSetupPrompt = useMemo(() => `Ты настраиваешь OpenClaw для подключения к BullRun MCP.

Сделай по шагам:
1. Убедись, что ACPX plugin включен. Если нет, выполни:
   openclaw plugins enable acpx
2. Открой файл ~/.openclaw/openclaw.json
3. Найди или создай секцию plugins.entries.acpx.config.mcpServers
4. Добавь туда сервер bullrun в точности в таком виде:

${mcpServerSnippet}

5. Сохрани файл
6. Перезапусти gateway командой:
   openclaw gateway
7. После этого используй BullRun MCP и скажи, какие tools доступны

BullRun MCP endpoint:
${APP_CONFIG.backendUrl}/api/mcp

MCP token:
${tokenForSetup}`, [mcpServerSnippet, tokenForSetup]);

  async function createToken() {
    try {
      setCreating(true);
      setError('');
      setTestResult(null);
      const data = await apiRequest('/api/mcp/tokens', {
        accessToken,
        method: 'POST',
        body: { label }
      });
      setLastCreatedToken(data.token || '');
      setLastCreatedRecord(data.record || null);
      await loadTokens();
      toast.success('MCP-токен создан.');
    } catch (nextError) {
      setError(nextError.message || 'Не удалось создать MCP токен.');
    } finally {
      setCreating(false);
    }
  }

  async function revokeToken(tokenId) {
    if (!window.confirm('После отзыва клешня больше не сможет обращаться к BullRun MCP.')) return;
    try {
      setRevokingId(String(tokenId));
      setError('');
      await apiRequest(`/api/mcp/tokens/${tokenId}/revoke`, {
        accessToken,
        method: 'POST',
        body: { reason: 'revoked_from_ui' }
      });
      await loadTokens();
      if (String(lastCreatedRecord?.id || '') === String(tokenId)) {
        setLastCreatedToken('');
        setLastCreatedRecord(null);
        setTestResult(null);
      }
      toast.success('Токен отозван.');
    } catch (nextError) {
      setError(nextError.message || 'Не удалось отозвать MCP токен.');
    } finally {
      setRevokingId('');
    }
  }

  async function testToken() {
    if (!lastCreatedToken) {
      setTestResult({ ok: false, text: 'Сначала создай новый токен.' });
      return;
    }
    try {
      setTesting(true);
      setError('');
      const data = await apiRequest('/api/mcp/tokens/test', {
        accessToken,
        method: 'POST',
        body: { token: lastCreatedToken }
      });
      setTestResult({
        ok: true,
        text: `MCP жив: ${data.proxy_total} proxy, ${data.userbot_total} userbot, tier ${data.product_tier}.`
      });
    } catch (nextError) {
      setTestResult({ ok: false, text: nextError.message || 'Проверка не прошла.' });
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return <LoadingState text="Грузим контур MCP..." />;
  }

  return (
    <section className="page">
      {error ? <div className="error-card" style={{ marginTop: 20 }}>{error}</div> : null}

      <div className="space-y-6">
        {/* Create token */}
        <Card className="border-slate-200/70 bg-white shadow-sm">
          <CardHeader className="px-6 pt-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20 shrink-0">
                  <KeyRound className="w-6 h-6" />
                </div>
                <div>
                  <CardTitle className="text-lg font-bold tracking-tight text-slate-900">MCP-токен</CardTitle>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
                    Выдай персональный токен, скопируй готовый config и проверь, что клешня видит BullRun tools.
                  </p>
                </div>
              </div>
              <Button asChild variant="outline" size="sm" className="h-9 rounded-xl">
                <a href="/app/integrations">Все API-ключи</a>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 px-6 pb-6">
            <div className="flex gap-3 items-end">
              <label className="flex flex-col gap-1.5 flex-1 max-w-xs">
                <span className="text-xs font-semibold text-slate-500">Название</span>
                <Input className="h-9 bg-slate-50" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="OpenClaw на ноутбуке" />
              </label>
              <Button className="h-9 rounded-xl" type="button" onClick={createToken} disabled={creating}>
                {creating ? 'Создаем...' : 'Создать токен'}
              </Button>
            </div>

            {lastCreatedToken ? (
              <div className="space-y-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-slate-500">Новый токен</span>
                  <CopyInput value={lastCreatedToken} monospace />
                </label>
                <p className="text-xs text-slate-400">Если потеряешь ключ, открой /app/integrations и скопируй повторно.</p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* Setup steps */}
        <Card className="border-slate-200/70 bg-white shadow-sm">
          <CardHeader className="px-6 pt-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center text-white shadow-lg shadow-emerald-500/20 shrink-0">
                <Bot className="w-6 h-6" />
              </div>
              <div>
                <CardTitle className="text-lg font-bold tracking-tight text-slate-900">Подключение клешни</CardTitle>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
                  Включи ACPX, открой конфиг, вставь BullRun MCP и проверь подключение.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6 px-6 pb-6">
            <div className="space-y-5">
              <div>
                <StepHeader number={1} title="Включи ACPX runtime" />
                <p className="text-sm text-slate-500 mb-2 ml-9">Если плагин ACPX еще не включен, выполни команду.</p>
                <div className="ml-9">
                  <CodeBlock label="Команда" value="openclaw plugins enable acpx" />
                </div>
              </div>

              <div>
                <StepHeader number={2} title="Открой конфиг OpenClaw" />
                <p className="text-sm text-slate-500 mb-2 ml-9">Нужный файл и точка вставки уже известны.</p>
                <div className="ml-9 grid gap-2">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 flex items-center gap-3">
                    <span className="text-xs font-semibold text-slate-400 w-14 shrink-0">Файл</span>
                    <code className="font-mono text-xs text-slate-700">~/.openclaw/openclaw.json</code>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 flex items-center gap-3">
                    <span className="text-xs font-semibold text-slate-400 w-14 shrink-0">Секция</span>
                    <code className="font-mono text-xs text-slate-700 break-all">plugins.entries.acpx.config.mcpServers</code>
                  </div>
                </div>
              </div>

              <div>
                <StepHeader number={3} title="Вставь BullRun MCP" />
                <p className="text-sm text-slate-500 mb-2 ml-9">Готовый фрагмент с токеном и endpoint.</p>
                <div className="ml-9">
                  <CodeBlock label="Готовый config" value={openClawConfigSnippet} />
                </div>
              </div>

              <div>
                <StepHeader number={4} title="Перезапусти и проверь" />
                <p className="text-sm text-slate-500 mb-2 ml-9">Запусти gateway заново и проверь токен.</p>
                <div className="ml-9">
                  <CodeBlock label="Команда запуска" value="openclaw gateway" />
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-4 space-y-3">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Быстрые значения</div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-slate-500">MCP endpoint</span>
                  <CopyInput value={`${APP_CONFIG.backendUrl}/api/mcp`} monospace />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-slate-500">Token</span>
                  <CopyInput value={tokenForSetup} monospace />
                </label>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button className="h-9 rounded-xl" type="button" onClick={testToken} disabled={testing || !lastCreatedToken}>
                {testing ? 'Проверяем...' : 'Проверить подключение'}
              </Button>
              {testResult ? (
                <Badge variant="outline" className={testResult.ok ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'}>
                  {testResult.text}
                </Badge>
              ) : null}
            </div>
          </CardContent>
        </Card>

        {/* Agent prompt */}
        <Card className="border-slate-200/70 bg-white shadow-sm">
          <CardHeader className="px-6 pt-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20 shrink-0">
                <MessageSquare className="w-6 h-6" />
              </div>
              <div>
                <CardTitle className="text-lg font-bold tracking-tight text-slate-900">Промпт для клешни</CardTitle>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
                  Скопируй один промпт и отправь в OpenClaw — он сам поправит свой конфиг.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            <CodeBlock label="Готовый промпт" value={agentSetupPrompt} />
          </CardContent>
        </Card>

        {/* Tokens table */}
        <Card className="border-slate-200/70 bg-white shadow-sm">
          <CardHeader className="px-6 pt-6">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg font-bold tracking-tight text-slate-900">Все MCP-токены</CardTitle>
                <p className="mt-1 text-sm text-slate-500">Потерял устройство — отзови токен и выдай новый.</p>
              </div>
              <Button variant="outline" size="sm" className="h-9 rounded-xl" type="button" onClick={() => loadTokens()} disabled={Boolean(revokingId)}>
                <RefreshCcw className="h-4 w-4" /> Обновить
              </Button>
            </div>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            <div className="overflow-x-auto -mx-6 px-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Название</th>
                    <th className="py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Hint</th>
                    <th className="py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Создан</th>
                    <th className="py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Последний вход</th>
                    <th className="py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Статус</th>
                    <th className="py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-400">Действие</th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.length ? tokens.map((token) => (
                    <tr key={token.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                      <td className="py-3 pr-4 font-medium text-slate-900">{token.label || 'OpenClaw'}</td>
                      <td className="py-3 pr-4 font-mono text-xs text-slate-700">{token.token_hint || maskToken(token.token_prefix)}</td>
                      <td className="py-3 pr-4 text-slate-500">{formatWhen(token.created_at)}</td>
                      <td className="py-3 pr-4">
                        <div className="text-slate-700">{formatWhen(token.last_used_at)}</div>
                        {token.last_used_ip ? <div className="font-mono text-xs text-slate-400">{token.last_used_ip}</div> : null}
                      </td>
                      <td className="py-3 pr-4">
                        <Badge variant="outline" className={token.revoked_at ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-emerald-100 text-emerald-800 border-emerald-200'}>
                          {token.revoked_at ? 'Отозван' : 'Активен'}
                        </Badge>
                      </td>
                      <td className="py-3 text-right">
                        {token.revoked_at ? (
                          <span className="text-xs text-slate-400">—</span>
                        ) : (
                          <Button variant="ghost" size="sm" className="h-8 px-2 text-rose-600 hover:text-rose-700 hover:bg-rose-50" type="button" onClick={() => revokeToken(token.id)} disabled={revokingId === String(token.id)} title="Отозвать">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan="6" className="py-12 text-center">
                        <div className="flex flex-col items-center justify-center">
                          <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mb-3">
                            <ShieldCheck className="w-6 h-6 text-slate-400" />
                          </div>
                          <p className="text-sm text-slate-500 font-semibold">Пока нет MCP-токенов</p>
                          <p className="mt-1 text-xs text-slate-400">Создай первый токен выше и проверь подключение.</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
