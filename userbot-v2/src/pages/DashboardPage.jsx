import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bot, CheckCircle2, Circle, Globe, KeyRound, Rocket, ShieldAlert
} from 'lucide-react';
import { apiRequest } from '../api/client.js';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';
import { RecentCallsTable } from '../ui/RecentCallsTable.jsx';

// Дашборд приложения «Юзербот» (план 2026-09-26-userbot-product-split, Фаза 3):
// сводка состояния юзерботов/прокси/агента без нового бэкенда.
// Источники: GET /api/dashboard (owner-скоуп, summary.userbotCount/proxyCount),
// GET /api/userbot/proxies, GET /api/mcp/tokens + tg_accounts через общий
// supabase-клиент (тот же RLS-owner-путь, что использует экран «Юзерботы») —
// нужен единственный недоступный из summary срез: юзерботы в safe-mode
// (runtime_status = pending_activation).
function StatCard({ icon: Icon, title, value, hint, to, cta, tone = 'default' }) {
  const valueClass = tone === 'warning'
    ? 'text-feedback-warning-text'
    : tone === 'danger'
      ? 'text-feedback-error-text'
      : 'text-ink-strong';
  return (
    <div className="card card--interactive">
      <div className="flex items-start justify-between gap-3">
        <div className="w-11 h-11 rounded-2xl bg-surface-subtle border border-border-default flex items-center justify-center shrink-0">
          <Icon className="w-5 h-5 text-ink-muted" />
        </div>
        {to ? (
          <Link to={to} className="link-action shrink-0">{cta || 'Открыть'} →</Link>
        ) : null}
      </div>
      <div className="card__title" style={{ marginTop: 12, fontSize: 13 }}>{title}</div>
      <div className={`stat-card__value${tone === 'default' ? '' : ' ' + valueClass}`} style={{ marginTop: 4 }}>
        {value}
      </div>
      {hint ? <p className="card__body" style={{ marginTop: 6 }}>{hint}</p> : null}
    </div>
  );
}

function CheckRow({ done, title, text, to }) {
  const body = (
    <>
      {done ? (
        <CheckCircle2 className="w-5 h-5 text-feedback-success-text shrink-0" />
      ) : (
        <Circle className="w-5 h-5 text-ink-faint shrink-0" />
      )}
      <div className="min-w-0">
        <div className="text-sm font-bold text-ink-strong">{title}</div>
        <div className="text-xs text-ink-muted mt-0.5">{text}</div>
      </div>
    </>
  );
  const className = 'flex items-start gap-3 p-3 rounded-2xl border transition-colors ' +
    (done ? 'border-feedback-success-bg bg-feedback-success-bg/40' : 'border-border-default bg-surface-card hover:bg-surface-subtle');
  if (done || !to) {
    return <div className={className}>{body}</div>;
  }
  return <Link to={to} className={className}>{body}</Link>;
}

export default function DashboardPage() {
  const { accessToken, user } = useAuth();
  const [state, setState] = useState({ loading: true, error: '' });
  const [summary, setSummary] = useState(null);
  const [proxies, setProxies] = useState([]);
  const [tokens, setTokens] = useState([]);
  const [apiTokens, setApiTokens] = useState([]);
  const [userbotRows, setUserbotRows] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      if (!accessToken || !user?.id) return;
      try {
        setState((prev) => ({ ...prev, loading: true, error: '' }));
        // Каждый источник падает самостоятельно: дашборд должен собраться
        // из того, что доступно, а не лечь целиком из-за одного эндпоинта.
        const [dashboardResult, proxiesResult, tokensResult, apiTokensResult, accountsResult] = await Promise.all([
          apiRequest('/api/dashboard', { accessToken })
            .then((data) => ({ ok: true, data }))
            .catch((error) => ({ ok: false, error })),
          apiRequest('/api/userbot/proxies', { accessToken })
            .then((data) => ({ ok: true, data }))
            .catch((error) => ({ ok: false, error })),
          apiRequest('/api/mcp/tokens', { accessToken })
            .then((data) => ({ ok: true, data }))
            .catch((error) => ({ ok: false, error })),
          apiRequest('/api/integrations/tokens', { accessToken })
            .then((data) => ({ ok: true, data }))
            .catch((error) => ({ ok: false, error })),
          supabase
            .from('tg_accounts')
            .select('id, account_type, runtime_status')
            .eq('owner_id', user.id)
            .then(({ data, error }) => (error ? { ok: false, error } : { ok: true, data }))
        ]);

        if (cancelled) return;

        const failed = [dashboardResult, proxiesResult, tokensResult, apiTokensResult, accountsResult]
          .filter((item) => !item.ok)
          .map((item) => item.error?.message || 'источник недоступен');
        if (failed.length === 5) {
          setState({ loading: false, error: failed[0] || 'Не удалось загрузить дашборд.' });
          return;
        }

        setSummary(dashboardResult.ok ? (dashboardResult.data?.summary || null) : null);
        setProxies(proxiesResult.ok ? (proxiesResult.data?.proxies || []) : []);
        setTokens(tokensResult.ok ? (tokensResult.data?.tokens || []) : []);
        setApiTokens(apiTokensResult.ok ? (apiTokensResult.data?.tokens || []) : []);
        setUserbotRows(accountsResult.ok ? (accountsResult.data || []) : []);
        setState({ loading: false, error: '' });
      } catch (error) {
        if (!cancelled) {
          setState({ loading: false, error: error.message || 'Не удалось загрузить дашборд.' });
        }
      }
    }

    loadDashboard();
    return () => { cancelled = true; };
  }, [accessToken, user?.id]);

  const userbots = useMemo(
    () => userbotRows.filter((row) => row.account_type === 'userbot'),
    [userbotRows]
  );
  const userbotTotal = summary?.userbotCount ?? userbots.length;
  const safeModeUserbots = useMemo(
    () => userbots.filter((row) => row.runtime_status === 'pending_activation'),
    [userbots]
  );
  const restrictedUserbots = useMemo(
    () => userbots.filter((row) => row.runtime_status === 'restricted'),
    [userbots]
  );
  const workingProxies = proxies.filter((proxy) => proxy.is_working === true).length;
  const proxyTotal = summary?.proxyCount ?? proxies.length;
  const activeMcpTokens = tokens.filter((token) => !token.revoked_at);
  const agentConnected = activeMcpTokens.length > 0;
  const activeApiTokens = apiTokens.filter((token) => !token.revoked_at);
  const hasApiKey = activeApiTokens.length > 0;

  if (state.loading) {
    return <LoadingState text="Собираем состояние юзерботов, прокси и агента..." />;
  }

  if (state.error) {
    return (
      <section className="page page--flush">
        <div className="page__header">
          <h1>Дашборд</h1>
          <p>Загрузка вернула ошибку.</p>
        </div>
        <div className="error-card">{state.error}</div>
      </section>
    );
  }

  const userbotTone = safeModeUserbots.length > 0
    ? 'warning'
    : restrictedUserbots.length > 0
      ? 'danger'
      : 'default';
  const userbotHint = safeModeUserbots.length > 0
    ? `${safeModeUserbots.length} в safe-mode — новые аккаунты ждут ручной активации. Открой «Юзерботы» и активируй их.`
    : restrictedUserbots.length > 0
      ? `${restrictedUserbots.length} аккаунтов ограничены Telegram — разбери их в центре управления.`
      : userbotTotal > 0
        ? 'Все аккаунты активны и работают через свои прокси.'
        : 'Аккаунтов пока нет. Начни с онбординга на экране «Юзерботы».';

  return (
    <section className="page page--flush">
      <div className="page__header">
        <h1>Дашборд</h1>
        <p>
          Состояние твоих Telegram-аккаунтов, прокси и подключенного ИИ-агента.
          Управление юзерботами живет здесь, платный доступ — в кабинете /app.
        </p>
      </div>

      <div className="section">
        <div className="grid grid--double">
          <StatCard
            icon={Rocket}
            title="Юзерботы"
            value={String(userbotTotal)}
            hint={userbotHint}
            to="/accounts"
            cta={safeModeUserbots.length > 0 ? 'Активировать' : 'Управлять'}
            tone={userbotTone}
          />
          <StatCard
            icon={Globe}
            title="Прокси"
            value={`${workingProxies} / ${proxyTotal}`}
            hint={
              proxyTotal === 0
                ? 'Прокси еще нет. Каждый юзербот ходит в Telegram только через свой прокси.'
                : 'Рабочих из всех добавленных. Один прокси — один юзербот.'
            }
            to="/proxies"
            cta="Открыть"
            tone={proxyTotal > 0 && workingProxies === 0 ? 'danger' : 'default'}
          />
          <StatCard
            icon={agentConnected ? Bot : KeyRound}
            title="Агент (MCP)"
            value={agentConnected ? 'Подключен' : 'Не подключен'}
            hint={
              agentConnected
                ? `Активных токенов: ${activeMcpTokens.length}. Последние вызовы — ниже.`
                : 'Выпусти MCP-токен и дай его своему ИИ-агенту — он получит инструменты Bullgram.'
            }
            to="/mcp"
            cta={agentConnected ? 'Настроить' : 'Подключить'}
            tone={agentConnected ? 'default' : 'warning'}
          />
          <StatCard
            icon={KeyRound}
            title="API-ключ (REST)"
            value={hasApiKey ? 'Выдан' : 'Нет ключа'}
            hint={
              hasApiKey
                ? `Ключей: ${activeApiTokens.length}. REST — для прямых HTTP-вызовов Bullgram.`
                : 'Нужен, если твоему флоу удобнее HTTP, чем MCP: n8n, кроны, свои скрипты.'
            }
            to="/api"
            cta={hasApiKey ? 'Открыть' : 'Создать'}
          />
        </div>
      </div>

      <div className="section">
        <div className="card">
          <div className="card__title">Онбординг</div>
          <p className="card__body">
            Четыре шага до рабочего аккаунта для агента. Порядок фиксированный: без прокси аккаунт не завести, без активации safe-mode не снимется.
          </p>
          <div className="grid grid--double" style={{ marginTop: 12 }}>
            <CheckRow
              done={proxyTotal > 0}
              title="1. Добавь прокси"
              text={proxyTotal > 0 ? `Прокси есть: ${proxyTotal}.` : 'Каждый юзербот ходит в Telegram через отдельный прокси.'}
              to={proxyTotal > 0 ? null : '/proxies'}
            />
            <CheckRow
              done={userbotTotal > 0}
              title="2. Подключи аккаунт"
              text={userbotTotal > 0 ? `Аккаунтов: ${userbotTotal}.` : 'Отсканируй QR или загрузи .session на экране «Юзерботы».'}
              to={userbotTotal > 0 ? null : '/accounts'}
            />
            <CheckRow
              done={userbotTotal > 0 && safeModeUserbots.length === 0}
              title="3. Активируй аккаунт"
              text={safeModeUserbots.length > 0
                ? `${safeModeUserbots.length} в safe-mode — активируй вручную, фоновые задания их не трогают.`
                : 'Новые аккаунты стартуют в safe-mode и ждут ручной активации.'}
              to={safeModeUserbots.length > 0 ? '/accounts' : null}
            />
            <CheckRow
              done={agentConnected}
              title="4. Подключи агента"
              text={agentConnected
                ? 'MCP-токен активен, агент может вызывать Bullgram.'
                : 'Выпусти MCP-токен и вставь его в конфиг агента (mcpServers).'}
              to={agentConnected ? null : '/mcp'}
            />
          </div>
          {restrictedUserbots.length > 0 ? (
            <div className="pill pill--danger" style={{ marginTop: 12, gap: 6 }}>
              <ShieldAlert className="w-3.5 h-3.5" />
              {restrictedUserbots.length} аккаунт(ов) ограничены Telegram
            </div>
          ) : null}
        </div>
      </div>

      <RecentCallsTable source="mcp" />
    </section>
  );
}
