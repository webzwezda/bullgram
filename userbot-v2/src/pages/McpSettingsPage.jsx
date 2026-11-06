import { useEffect, useMemo, useState } from 'react';
import { Copy, KeyRound, MessageSquare, RefreshCcw } from 'lucide-react';
import { toast } from 'sonner';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { APP_CONFIG } from '../config.js';
import { Badge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.jsx';
import { CodeBlock } from '../ui/CodeBlock.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';
import { RecentCallsTable } from '../ui/RecentCallsTable.jsx';
import { CopyInput, McpManualSetupCard } from './McpManualSetupCard.jsx';

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
  const [activeSecret, setActiveSecret] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [revealing, setRevealing] = useState(false);
  // Инлайн-подтверждение перевыпуска: первый клик вооружает, второй — выполняет
  const [armedReissue, setArmedReissue] = useState(false);

  // Авто-хайд затрагивает и revealed, и только что созданный токен:
  // полный секрет не должен жить в DOM дольше 60 секунд ни в одном месте
  useEffect(() => {
    if (!revealed && !lastCreatedToken) return;
    const timer = setTimeout(() => {
      setRevealed(false);
      setLastCreatedToken('');
    }, 60000);
    return () => clearTimeout(timer);
  }, [revealed, lastCreatedToken]);

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

  // Смена активного токена (ревокация извне, перевыпуск) инвалидирует показанный секрет
  useEffect(() => {
    setActiveSecret('');
    setRevealed(false);
    setLastCreatedToken('');
  }, [latestActive?.id]);

  // Секрет тянется с бэкенда только по явному действию юзера («Показать» /
  // «Скопировать» / «Проверить») — никаких авто-фетчей при монтировании.
  async function revealActiveSecret() {
    if (!latestActive?.id) return '';
    setRevealing(true);
    try {
      const data = await apiRequest(`/api/integrations/tokens/${encodeURIComponent(latestActive.id)}/secret`, { accessToken });
      const secret = data.token || '';
      if (secret) setActiveSecret(secret);
      return secret;
    } catch (e) {
      toast.error(e.message || 'Не удалось показать токен.');
      return '';
    } finally {
      setRevealing(false);
    }
  }

  async function handleRevealClick() {
    const secret = await revealActiveSecret();
    if (secret) setRevealed(true);
  }

  // Секрет попадает в подсказки/копирование только если юзер его прямо
  // открыл («Показать») или только что выпустил. Иначе — плейсхолдер.
  const setupTokenValue = lastCreatedToken || (revealed ? activeSecret : '');
  const tokenForSetup = setupTokenValue || '${BULLGRAM_MCP_TOKEN}';

  const mcpServersSnippet = useMemo(() => `{
  "mcpServers": {
    "bullgram": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote@latest",
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
    // Подтверждение — двухшаговой кнопкой перевыпуска (armed-паттерн),
    // не window.confirm
    const previousIds = activeTokens.map((t) => String(t.id));
    try {
      setCreating(true);
      setError('');
      setTestResult(null);
      const data = await apiRequest('/api/mcp/tokens', {
        accessToken,
        method: 'POST',
        body: { label: 'MCP-токен' }
      });
      let revokeFailures = 0;
      for (const id of previousIds) {
        try {
          await apiRequest(`/api/mcp/tokens/${id}/revoke`, {
            accessToken,
            method: 'POST',
            body: { reason: 'replaced_by_new_token' }
          });
        } catch {
          revokeFailures += 1;
        }
      }
      setLastCreatedToken(data.token || '');
      setLastCreatedRecord(data.record || null);
      // Старый секрет отозван — сбрасываем кэш и «Показать»,
      // чтобы следующий показ выдал уже новый токен.
      setActiveSecret('');
      setRevealed(false);
      await loadTokens();
      if (revokeFailures > 0) {
        toast.warning(`MCP-токен создан, но ${revokeFailures} старых отозвать не удалось — отзови вручную на этой странице.`);
      } else {
        toast.success('MCP-токен создан. Старые токены отозваны.');
      }
    } catch (nextError) {
      setError(nextError.message || 'Не удалось создать MCP токен.');
    } finally {
      setCreating(false);
    }
  }

  async function testToken() {
    if (!latestActive && !lastCreatedToken) {
      setTestResult({ ok: false, text: 'Сначала выпусти токен.' });
      return;
    }
    setTesting(true);
    setError('');
    try {
      const token = lastCreatedToken || (await revealActiveSecret());
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
                {(revealed && activeSecret) ? activeSecret : (latestActive ? '•••• (нажми «Показать»)' : 'Выпусти токен — он появится здесь после выпуска')}
              </div>
            </label>
            <div className="flex flex-wrap gap-2">
              {latestActive ? (
                <>
                  <Button variant="outline" size="sm" className="h-9 rounded-xl" type="button" onClick={handleRevealClick} disabled={revealing || testing}>
                    <KeyRound className="h-4 w-4" /> Показать
                  </Button>
                  <Button variant="outline" size="sm" className="h-9 rounded-xl" type="button" onClick={async () => {
                    const s = await revealActiveSecret();
                    if (!s) return;
                    try {
                      await navigator.clipboard.writeText(s);
                      toast.success('Токен скопирован.');
                    } catch (err) {
                      console.error('Clipboard write failed:', err);
                      toast.error('Не удалось скопировать — нажми «Показать» и скопируй вручную.');
                    }
                  }} disabled={revealing || testing}>
                    <Copy className="h-4 w-4" /> Скопировать
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className={`h-9 rounded-xl text-xs font-bold transition-all ${
                      armedReissue
                        ? 'bg-red-600 text-white border border-red-600 hover:bg-red-700'
                        : 'text-amber-700 hover:text-amber-700 hover:bg-amber-50 border border-amber-200'
                    }`}
                    type="button"
                    disabled={creating || testing}
                    onClick={() => {
                      if (armedReissue) {
                        setArmedReissue(false);
                        createToken();
                      } else {
                        setArmedReissue(true);
                        setTimeout(() => setArmedReissue(false), 5000);
                      }
                    }}
                  >
                    <RefreshCcw className="h-4 w-4" /> {armedReissue ? 'Точно перевыпустить?' : 'Перевыпустить'}
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
                <span className="text-xs text-slate-500">Скопируй токен — он показывается только по нажатию «Показать». Нужен новый: «Перевыпустить» отзовёт старый сам.</span>
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
        <McpManualSetupCard mcpServersSnippet setupTokenValue testToken testing testResult />

        <RecentCallsTable source="mcp" />
      </div>
    </section>
  );
}
