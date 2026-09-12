import { useEffect, useMemo, useState } from 'react';
import { Bot, Check, Copy, KeyRound, MessageSquare } from 'lucide-react';
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
  const [promptOpen, setPromptOpen] = useState(false);

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
  const tokenForSetup = lastCreatedToken || '${BULLGRAM_MCP_TOKEN}';

  const mcpServerSnippet = useMemo(() => `{
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

  const agentSetupPrompt = useMemo(() => `Ты настраиваешь OpenClaw для подключения к Bullgram MCP.

Сделай по шагам:
1. Убедись, что ACPX plugin включен. Если нет, выполни:
   openclaw plugins enable acpx
2. Открой файл ~/.openclaw/openclaw.json
3. Найди или создай секцию plugins.entries.acpx.config.mcpServers
4. Добавь туда сервер bullgram в точности в таком виде:

${mcpServerSnippet}

5. Сохрани файл
6. Перезапусти gateway командой:
   openclaw gateway
7. После этого используй Bullgram MCP и скажи, какие tools доступны

Bullgram MCP endpoint:
${APP_CONFIG.backendUrl}/api/mcp

MCP token:
${tokenForSetup}`, [mcpServerSnippet, tokenForSetup]);

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
          <CardHeader className="px-6 pt-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20 shrink-0">
                  <KeyRound className="w-6 h-6" />
                </div>
                <div>
                  <CardTitle className="text-lg font-bold tracking-tight text-slate-900">MCP-токен</CardTitle>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
                    Выдай персональный токен, скопируй готовый config и проверь, что клешня видит Bullgram tools.
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
                {latestActive?.token_hint || (latestActive ? maskToken(latestActive.token_prefix) : 'Создай токен — полный доступ показывается один раз при создании')}
              </div>
            </label>
            <div className="flex flex-wrap gap-3 items-end">
              <Button className="h-9 rounded-xl" type="button" onClick={createToken} disabled={creating}>
                {creating ? 'Создаем...' : 'Создать токен'}
              </Button>
            </div>

            {lastCreatedToken ? (
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-slate-500">Новый токен</span>
                <CopyInput value={lastCreatedToken} monospace />
                <span className="text-xs text-slate-400">Скопируй сейчас — позже токен уже не показывается. Потерял: отзови в таблице ниже и выдай новый.</span>
              </label>
            ) : null}
          </CardContent>
        </Card>

        {/* Setup steps */}
        <Card className="border-slate-200/70 bg-white shadow-sm">
          <CardHeader className="px-6 pt-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center text-white shadow-lg shadow-emerald-500/20 shrink-0">
                <Bot className="w-6 h-6" />
              </div>
              <div>
                <CardTitle className="text-lg font-bold tracking-tight text-slate-900">Подключение клешни</CardTitle>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
                  Включи ACPX, открой конфиг, вставь Bullgram MCP и проверь подключение.
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
                <StepHeader number={3} title="Вставь Bullgram MCP" />
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
          <CardHeader className="px-6 pt-4">
            <div className="flex items-start justify-between gap-4">
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
              <Button variant="outline" size="sm" className="h-9 rounded-xl shrink-0" onClick={() => setPromptOpen((v) => !v)}>
                {promptOpen ? 'Скрыть' : 'Показать'}
              </Button>
            </div>
          </CardHeader>
          {promptOpen ? (
            <CardContent className="px-6 pb-6">
              <CodeBlock label="Готовый промпт" value={agentSetupPrompt} />
            </CardContent>
          ) : null}
        </Card>

        <RecentCallsTable source="mcp" />
      </div>
    </section>
  );
}
