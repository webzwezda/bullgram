import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { APP_CONFIG } from '../config.js';
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
  const [copyState, setCopyState] = useState('');

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
    return () => {
      cancelled = true;
    };
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

  async function copyText(value, mode) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState(mode);
      window.setTimeout(() => setCopyState(''), 1600);
    } catch {
      setCopyState('');
    }
  }

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
    } catch (nextError) {
      setError(nextError.message || 'Не удалось создать MCP токен.');
    } finally {
      setCreating(false);
    }
  }

  async function revokeToken(tokenId) {
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
      setTestResult({
        ok: false,
        text: nextError.message || 'Проверка не прошла.'
      });
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return <LoadingState text="Грузим контур MCP..." />;
  }

  return (
    <section className="page">
      <div className="payment-overview proxy-surface-card mcp-overview">
        <div className="payment-overview__top">
          <div className="payment-overview__copy">
            <div className="proxy-page__eyebrow">Claw / MCP</div>
            <div className="page__header">
              <h1>Подключение клешни</h1>
            </div>
            <p className="proxy-page__intro">
              Тут выдаем персональный MCP-токен, копируем готовый config и проверяем, что клешня реально видит BullRun tools.
            </p>
          </div>
          <div className="payment-overview__rule">
            <div className="payment-overview__rule-label">Что даем агенту</div>
            <div className="payment-overview__rule-title">Только MCP</div>
            <div className="payment-overview__rule-text">
              Без парсинга верстки и без второго bridge-контура. Клешня ходит в один BullRun MCP и получает только разрешенные tools.
            </div>
          </div>
        </div>
        <div className="payment-summary-grid">
          <div className="proxy-summary-card proxy-summary-card--ok">
            <div className="proxy-summary-card__label">Активные токены</div>
            <div className="proxy-summary-card__value">{activeTokens.length}</div>
            <div className="proxy-summary-card__hint">Сейчас живых MCP-токенов у этого аккаунта.</div>
          </div>
          <div className="proxy-summary-card proxy-summary-card--warning">
            <div className="proxy-summary-card__label">Текущий tier</div>
            <div className="proxy-summary-card__value">{String(profilePlan || 'trial').toUpperCase()}</div>
            <div className="proxy-summary-card__hint">Клешня увидит те же лимиты и тот же контур, что и сам пользователь.</div>
          </div>
          <div className="proxy-summary-card proxy-summary-card--neutral">
            <div className="proxy-summary-card__label">MCP endpoint</div>
            <div className="proxy-summary-card__value table-mono">/api/mcp</div>
            <div className="proxy-summary-card__hint">Один endpoint для initialize, tools/list и tools/call.</div>
          </div>
        </div>
      </div>

      {error ? <div className="error-card" style={{ marginTop: 20 }}>{error}</div> : null}

      <div className="mcp-layout">
        <div className="toolbar-card proxy-surface-card">
          <div className="proxy-surface-card__head">
            <div>
              <div className="toolbar-card__title">Выдать новый MCP-токен</div>
              <div className="table-subtext">Токен показываем один раз. Потом на экране останется только hint и история использования.</div>
            </div>
          </div>
          <div className="toolbar-card__body mcp-create-grid">
            <label className="field-group">
              <span>Название</span>
              <input className="field" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="OpenClaw на ноутбуке" />
            </label>
            <button className="ghost-button ghost-button--primary" type="button" onClick={createToken} disabled={creating}>
              {creating ? 'Создаем...' : 'Создать токен'}
            </button>
          </div>

          {lastCreatedToken ? (
            <div className="mcp-secret-block">
              <div className="mcp-secret-block__head">
                <strong>Новый токен</strong>
                <button className="ghost-button" type="button" onClick={() => copyText(lastCreatedToken, 'token')}>
                  {copyState === 'token' ? 'Скопировано' : 'Скопировать токен'}
                </button>
              </div>
              <pre className="mcp-code-block"><code>{lastCreatedToken}</code></pre>
              <div className="table-subtext">Сохрани его сразу в клиенте. В списке ниже потом будет только сокращенный hint.</div>
            </div>
          ) : null}
        </div>

        <div className="toolbar-card proxy-surface-card">
          <div className="proxy-surface-card__head">
            <div>
              <div className="toolbar-card__title">Как подключить обычному человеку</div>
              <div className="table-subtext">Опираемся на card-step паттерн: сначала включить ACPX, потом открыть конфиг, вставить BullRun MCP и только после этого проверять.</div>
            </div>
          </div>

          <div className="mcp-steps">
            <article className="mcp-step-card">
              <div className="mcp-step-card__badge">Шаг 1</div>
              <div className="mcp-step-card__title">Включи ACPX runtime</div>
              <div className="mcp-step-card__text">Если плагин ACPX еще не включен, выполни одну команду в терминале.</div>
              <div className="mcp-secret-block">
                <div className="mcp-secret-block__head">
                  <strong>Команда</strong>
                  <button className="ghost-button" type="button" onClick={() => copyText('openclaw plugins enable acpx', 'enable')}>
                    {copyState === 'enable' ? 'Скопировано' : 'Скопировать'}
                  </button>
                </div>
                <pre className="mcp-code-block"><code>openclaw plugins enable acpx</code></pre>
              </div>
            </article>

            <article className="mcp-step-card">
              <div className="mcp-step-card__badge">Шаг 2</div>
              <div className="mcp-step-card__title">Открой конфиг OpenClaw</div>
              <div className="mcp-step-card__text">Нужный файл и точка вставки уже известны. Человеку не нужно гадать, куда именно класть BullRun MCP.</div>
              <div className="mcp-inline-values">
                <div className="mcp-inline-values__row">
                  <span>Файл</span>
                  <code>~/.openclaw/openclaw.json</code>
                </div>
                <div className="mcp-inline-values__row">
                  <span>Секция</span>
                  <code>plugins.entries.acpx.config.mcpServers</code>
                </div>
              </div>
            </article>

            <article className="mcp-step-card">
              <div className="mcp-step-card__badge">Шаг 3</div>
              <div className="mcp-step-card__title">Вставь BullRun MCP</div>
              <div className="mcp-step-card__text">Если не хочется думать про структуру конфига, ниже уже готовый фрагмент с токеном и endpoint.</div>
              <div className="mcp-secret-block">
                <div className="mcp-secret-block__head">
                  <strong>Готовый config</strong>
                  <button className="ghost-button" type="button" onClick={() => copyText(openClawConfigSnippet, 'snippet')}>
                    {copyState === 'snippet' ? 'Скопировано' : 'Скопировать config'}
                  </button>
                </div>
                <pre className="mcp-code-block"><code>{openClawConfigSnippet}</code></pre>
              </div>
            </article>

            <article className="mcp-step-card">
              <div className="mcp-step-card__badge">Шаг 4</div>
              <div className="mcp-step-card__title">Перезапусти и проверь</div>
              <div className="mcp-step-card__text">После правки конфига запусти gateway заново и проверь токен прямо тут, не уходя в догадки.</div>
              <div className="mcp-secret-block">
                <div className="mcp-secret-block__head">
                  <strong>Команда запуска</strong>
                  <button className="ghost-button" type="button" onClick={() => copyText('openclaw gateway', 'gateway')}>
                    {copyState === 'gateway' ? 'Скопировано' : 'Скопировать'}
                  </button>
                </div>
                <pre className="mcp-code-block"><code>openclaw gateway</code></pre>
              </div>
            </article>
          </div>

          <div className="mcp-secret-block" style={{ marginTop: 18 }}>
            <div className="mcp-secret-block__head">
              <strong>Быстрые значения</strong>
              <button className="ghost-button" type="button" onClick={() => copyText(tokenForSetup, 'token-inline')}>
                {copyState === 'token-inline' ? 'Скопировано' : 'Скопировать токен'}
              </button>
            </div>
            <div className="mcp-inline-values">
              <div className="mcp-inline-values__row">
                <span>MCP endpoint</span>
                <code>{APP_CONFIG.backendUrl}/api/mcp</code>
              </div>
              <div className="mcp-inline-values__row">
                <span>Token</span>
                <code>{tokenForSetup}</code>
              </div>
            </div>
          </div>

          <div className="toolbar-card__body" style={{ paddingTop: 0 }}>
            <button className="ghost-button ghost-button--primary" type="button" onClick={testToken} disabled={testing || !lastCreatedToken}>
              {testing ? 'Проверяем...' : 'Проверить подключение'}
            </button>
          </div>
          {testResult ? (
            <div className={`mcp-test-result${testResult.ok ? ' mcp-test-result--ok' : ' mcp-test-result--error'}`}>
              {testResult.text}
            </div>
          ) : null}
        </div>
      </div>

      <div className="toolbar-card proxy-surface-card" style={{ marginTop: 20 }}>
        <div className="proxy-surface-card__head">
          <div>
            <div className="toolbar-card__title">Если хочешь просто скинуть это самой клешне</div>
            <div className="table-subtext">Копируешь один промпт, отправляешь его в OpenClaw и он сам правит свой конфиг, если у него есть доступ к файлам.</div>
          </div>
        </div>
        <div className="mcp-secret-block">
          <div className="mcp-secret-block__head">
            <strong>Готовый промпт для клешни</strong>
            <button className="ghost-button" type="button" onClick={() => copyText(agentSetupPrompt, 'agent-prompt')}>
              {copyState === 'agent-prompt' ? 'Скопировано' : 'Скопировать промпт'}
            </button>
          </div>
          <pre className="mcp-code-block"><code>{agentSetupPrompt}</code></pre>
        </div>
      </div>

      <div className="table-card proxy-surface-card" style={{ marginTop: 20 }}>
        <div className="proxy-surface-card__head">
          <div>
            <div className="table-card__title">Выданные токены</div>
            <div className="table-subtext">Если устройство потеряли или хотим пересобрать контур, просто отзываем токен и выдаем новый.</div>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Название</th>
                <th>Hint</th>
                <th>Создан</th>
                <th>Последний вход</th>
                <th>Статус</th>
                <th>Действие</th>
              </tr>
            </thead>
            <tbody>
              {tokens.length ? tokens.map((token) => (
                <tr key={token.id}>
                  <td>
                    <div className="table-primary">{token.label || 'OpenClaw'}</div>
                  </td>
                  <td>
                    <div className="table-primary table-mono">{token.token_hint || maskToken(token.token_prefix)}</div>
                  </td>
                  <td>
                    <div className="table-primary">{formatWhen(token.created_at)}</div>
                  </td>
                  <td>
                    <div className="table-primary">{formatWhen(token.last_used_at)}</div>
                    {token.last_used_ip ? <div className="table-subtext table-mono">{token.last_used_ip}</div> : null}
                  </td>
                  <td>
                    <span className={`pill ${token.revoked_at ? 'pill--danger' : 'pill--ok'}`}>
                      {token.revoked_at ? 'Отозван' : 'Активен'}
                    </span>
                  </td>
                  <td>
                    {token.revoked_at ? (
                      <div className="table-subtext">Ничего не делаем</div>
                    ) : (
                      <button className="ghost-button" type="button" onClick={() => revokeToken(token.id)} disabled={revokingId === String(token.id)}>
                        {revokingId === String(token.id) ? 'Отзываем...' : 'Отозвать'}
                      </button>
                    )}
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan="6">
                    <div className="empty-state" style={{ minHeight: 120 }}>
                      <strong>Пока нет MCP-токенов</strong>
                      <span>Создай первый токен выше и сразу проверь, что клешня видит BullRun tools.</span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
