import { useEffect, useMemo, useState } from 'react';
import { Bot, Check, Copy, KeyRound, MessageSquare, RefreshCcw } from 'lucide-react';
import { toast } from 'sonner';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { APP_CONFIG } from '../config.js';
import { Badge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.jsx';
import { Input } from '../components/ui/input.jsx';
import { CodeBlock } from '../ui/CodeBlock.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';
import { RecentCallsTable } from '../ui/RecentCallsTable.jsx';

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
  const [testing, setTesting] = useState(false);
  const [lastCreatedToken, setLastCreatedToken] = useState('');
  const [lastCreatedRecord, setLastCreatedRecord] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [promptOpen, setPromptOpen] = useState(true);
  const [manualOpen, setManualOpen] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState('');
  const [revealing, setRevealing] = useState(false);

  useEffect(() => {
    if (!revealedSecret) return;
    const timer = setTimeout(() => setRevealedSecret(''), 60000);
    return () => clearTimeout(timer);
  }, [revealedSecret]);

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
  const latestActive = useMemo(() => {
    return [...activeTokens].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] || null;
  }, [activeTokens]);

  async function revealActiveSecret() {
    if (revealedSecret) return revealedSecret;
    if (!latestActive?.id) return '';
    setRevealing(true);
    try {
      const data = await apiRequest(`/api/integrations/tokens/${encodeURIComponent(latestActive.id)}/secret`, { accessToken });
      const secret = data.token || '';
      if (secret) setRevealedSecret(secret);
      return secret;
    } catch (e) {
      toast.error(e.message || 'Не удалось показать токен.');
      return '';
    } finally {
      setRevealing(false);
    }
  }
  const tokenForSetup = lastCreatedToken || '${BULLGRAM_MCP_TOKEN}';

  const mcpServersSnippet = useMemo(() => `{
  "mcpServers": {
    "bullgram": {
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
  }
}`, [tokenForSetup]);

  const agentSetupPrompt = useMemo(() => `Подключи Bullgram MCP к моему конфигу mcpServers.

Сделай по шагам:
1. Открой мой конфиг ИИ-агента, секцию mcpServers
2. Добавь туда сервер bullgram в точности в таком виде:

${mcpServersSnippet}

3. Перезапусти меня (агента)
4. Проверь, что инструменты Bullgram доступны, и скажи, какие tools появились

Bullgram MCP endpoint:
${APP_CONFIG.backendUrl}/api/mcp

MCP token:
${tokenForSetup}`, [mcpServersSnippet, tokenForSetup]);

  async function createToken() {
    try {
      setCreating(true);
      setError('');
      setTestResult(null);
      const previousIds = activeTokens.map((t) => String(t.id));
      const data = await apiRequest('/api/mcp/tokens', {
        accessToken,
        method: 'POST',
        body: { label: 'MCP-токен' }
      });
      for (const id of previousIds) {
        await apiRequest(`/api/mcp/tokens/${id}/revoke`, {
          accessToken,
          method: 'POST',
          body: { reason: 'replaced_by_new_token' }
        }).catch(() => {});
      }
      setLastCreatedToken(data.token || '');
      setLastCreatedRecord(data.record || null);
      await loadTokens();
      toast.success('MCP-токен создан. Старые токены отозваны.');
    } catch (nextError) {
      setError(nextError.message || 'Не удалось создать MCP токен.');
    } finally {
      setCreating(false);
    }
  }

  async function testToken() {
    if (!latestActive) {
      setTestResult({ ok: false, text: 'Сначала выпусти токен.' });
      return;
    }
    setTesting(true);
    setError('');
    try {
      const token = revealedSecret || (await revealActiveSecret());
      const data = await apiRequest('/api/mcp/tokens/test', {
        accessToken,
        method: 'POST',
        body: { token }
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
          <CardHeader className="px-6 pt-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20 shrink-0">
                  <KeyRound className="w-6 h-6" />
                </div>
                <div>
                  <CardTitle className="text-lg font-bold tracking-tight text-slate-900">MCP-токен</CardTitle>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
                    Выдай персональный токен — он связывает твоего ИИ-агента с Bullgram API и MCP.
                  </p>
                </div>
              </div>
              {latestActive ? (
                <Badge variant="outline" className="bg-emerald-100 text-emerald-800 border-emerald-200">Активен</Badge>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-4 px-6 pb-6">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-slate-500">Токен</span>
              <div className="h-9 rounded-lg border border-input bg-slate-50 px-2.5 flex items-center font-mono text-xs text-slate-700">
                {revealedSecret || (latestActive ? (latestActive.token_hint || maskToken(latestActive.token_prefix)) : '') || 'Выпусти токен — он покажется один раз'}
              </div>
            </label>
            <div className="flex flex-wrap gap-2">
              {latestActive ? (
                <>
                  <Button variant="outline" size="sm" className="h-9 rounded-xl" type="button" onClick={async () => setRevealedSecret(await revealActiveSecret())} disabled={revealing || testing}>
                    <KeyRound className="h-4 w-4" /> {revealedSecret ? 'Скрыть' : 'Показать'}
                  </Button>
                  <Button variant="outline" size="sm" className="h-9 rounded-xl" type="button" onClick={async () => { const s = await revealActiveSecret(); if (s) { await navigator.clipboard.writeText(s); toast.success('Токен скопирован.'); } }} disabled={revealing || testing}>
                    <Copy className="h-4 w-4" /> Скопировать
                  </Button>
                  <Button variant="outline" size="sm" className="h-9 rounded-xl text-amber-600 hover:text-amber-700 hover:bg-amber-50" type="button" onClick={createToken} disabled={creating || testing}>
                    <RefreshCcw className="h-4 w-4" /> Перевыпустить
                  </Button>
                </>
              ) : (
                <Button size="sm" className="h-9 rounded-xl" type="button" onClick={createToken} disabled={creating}>
                  <KeyRound className="h-4 w-4" /> Выпустить токен
                </Button>
              )}
            </div>

            {lastCreatedToken ? (
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-slate-500">Новый токен</span>
                <CopyInput value={lastCreatedToken} monospace />
                <span className="text-xs text-slate-400">Скопируй сейчас — позже токен уже не показывается. Нужен новый: «Перевыпустить» отзовёт старый сам.</span>
              </label>
            ) : null}
          </CardContent>
        </Card>

        {/* Prompt for AI agent */}
        <Card className="border-slate-200/70 bg-white shadow-sm">
          <CardHeader className="px-6 pt-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20 shrink-0">
                <MessageSquare className="w-6 h-6" />
              </div>
              <div>
                <CardTitle className="text-lg font-bold tracking-tight text-slate-900">Промпт для ИИ-агента</CardTitle>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
                  Отправь промпт своему ИИ-агенту — он сам подключит Bullgram MCP.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            <CodeBlock label="Готовый промпт" value={agentSetupPrompt} />
          </CardContent>
        </Card>

        {/* Manual setup */}
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
                      <span className="text-xs font-semibold text-slate-400 w-14 shrink-0">Секция</span>
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

        <RecentCallsTable source="mcp" />
      </div>
    </section>
  );
}
