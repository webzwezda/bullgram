import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bot, CheckCircle2, Circle, Globe, KeyRound, Rocket, ShieldAlert
} from 'lucide-react';
import { apiRequest } from '../api/client.js';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';

// Дашборд приложения «Юзербот» (план 2026-09-26-userbot-product-split, Фаза 3):
// сводка состояния юзерботов/прокси/агента без нового бэкенда.
// Источники: GET /api/dashboard (owner-скоуп, summary.userbotCount/proxyCount),
// GET /api/userbot/proxies, GET /api/mcp/tokens + tg_accounts через общий
// supabase-клиент (тот же RLS-owner-путь, что использует экран «Юзерботы») —
// нужен единственный недоступный из summary срез: юзерботы в safe-mode
// (runtime_status = pending_activation).
// Стат-карточка в диалекте treasury (admin-v2 TreasuryTab.TreasuryStatCard):
// белая карточка rounded-2xl + ring, чип-иконка, uppercase-лейбл в шапке рядом
// с иконкой, крупное значение, подсказка под значением; CTA-ссылка — справа в шапке.
// Цвета выражены semantic-токенами с тем же рендером, что у treasury-классов
// (ink.strong=slate-900, ink.muted=slate-500, surface.card=white,
// border.default=slate-200, feedback.warning.text=amber-700): сырые шаги палитры
// растят hardcodes-ratchet, поэтому в новый код не пишем.
function StatCard({ icon: Icon, iconClasses, title, value, hint, to, cta, tone = 'default' }) {
  const hintTone = tone === 'warning'
    ? 'text-feedback-warning-text font-medium'
    : tone === 'danger'
      ? 'text-feedback-error-text font-medium'
      : 'text-ink-muted';
  // У treasury тон живёт на подсказке; когда подсказки нет (карточка «Прокси»
  // в danger — «0 / N» рабочих), сигнал переносим на значение, чтобы состояние
  // не потерялось.
  const valueClass = tone !== 'default' && !hint
    ? (tone === 'warning' ? 'text-feedback-warning-text' : 'text-feedback-error-text')
    : 'text-ink-strong';
  return (
    <div className="bg-surface-card rounded-2xl ring-1 ring-border-default/50 shadow-sm p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${iconClasses}`}>
          <Icon className="w-5 h-5" />
        </div>
        <span className="text-xs font-semibold text-ink-muted uppercase tracking-wide">{title}</span>
        {to ? (
          <Link to={to} className="link-action shrink-0 ml-auto">{cta || 'Открыть'} →</Link>
        ) : null}
      </div>
      <div className={`text-2xl font-bold ${valueClass}`}>{value}</div>
      {hint ? <div className={`text-xs mt-1 ${hintTone}`}>{hint}</div> : null}
    </div>
  );
}

function CheckRow({ done, title, text, to }) {
  const body = (
    <>
      {done ? (
        <CheckCircle2 className="w-5 h-5 text-feedback-success-text shrink-0" />
      ) : (
        <Circle className="w-5 h-5 text-ink-muted shrink-0" />
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
    ? `${safeModeUserbots.length} в safe-mode — активируй в «Юзерботах»`
    : restrictedUserbots.length > 0
      ? `${restrictedUserbots.length} аккаунтов ограничены Telegram — разбери их в центре управления.`
      : userbotTotal > 0
        ? undefined
        : 'Аккаунтов пока нет. Начни с онбординга на экране «Юзерботы».';

  // Онбординг-карточка живёт только пока есть незакрытые шаги: выполненные
  // строки скрываем целиком (дублируют стат-карточки выше и рельс).
  const onboardingRows = [
    { title: 'Добавь прокси', done: proxyTotal > 0, text: 'Каждому юзерботу — свой прокси', to: '/proxies' },
    { title: 'Подключи аккаунт', done: userbotTotal > 0, text: 'QR или .session-файл', to: '/accounts' },
    { title: 'Активируй аккаунт', done: userbotTotal > 0 && safeModeUserbots.length === 0, text: 'Ждет ручной активации (safe-mode)', to: '/accounts' },
    { title: 'Подключи агента', done: agentConnected, text: 'Выпусти MCP-токен — вставь его в конфиг агента (mcpServers).', to: '/mcp' },
  ];
  const pendingOnboarding = onboardingRows.filter((row) => !row.done);

  return (
    <section className="page page--flush">
      <h1 className="sr-only">Дашборд</h1>
      <div className="section">
        <div className="grid grid--flush grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCard
            icon={Rocket}
            iconClasses="bg-action-primary/10 text-action-primary"
            title="Юзерботы"
            value={String(userbotTotal)}
            hint={userbotHint}
            to="/accounts"
            cta={safeModeUserbots.length > 0 ? 'Активировать' : 'Управлять'}
            tone={userbotTone}
          />
          <StatCard
            icon={Globe}
            iconClasses="bg-feedback-success-bg text-feedback-success-text"
            title="Прокси"
            value={`${workingProxies} / ${proxyTotal}`}
            hint={proxyTotal === 0 ? 'Каждому юзерботу — свой прокси' : undefined}
            to="/proxies"
            cta="Открыть"
            tone={proxyTotal > 0 && workingProxies === 0 ? 'danger' : 'default'}
          />
          <StatCard
            icon={agentConnected ? Bot : KeyRound}
            iconClasses="bg-feedback-info-bg text-feedback-info-text"
            title="Агент (MCP)"
            value={agentConnected ? 'Подключен' : 'Не подключен'}
            hint={agentConnected ? undefined : 'Выпусти MCP-токен для своего агента'}
            to="/mcp"
            cta={agentConnected ? 'Настроить' : 'Подключить'}
            tone={agentConnected ? 'default' : 'warning'}
          />
          <StatCard
            icon={KeyRound}
            iconClasses="bg-surface-subtle-strong text-ink-muted"
            title="API-ключ (REST)"
            value={hasApiKey ? 'Выдан' : 'Нет ключа'}
            hint={hasApiKey ? undefined : 'Для n8n, кронов и скриптов'}
            to="/api"
            cta={hasApiKey ? 'Открыть' : 'Создать'}
          />
        </div>
      </div>

      {pendingOnboarding.length > 0 || restrictedUserbots.length > 0 ? (
        <div className="section">
          <div className="card">
            <div className="card__title">Онбординг</div>
            {pendingOnboarding.length > 0 ? (
              <div className="grid grid--double gap-3" style={{ marginTop: 12 }}>
                {pendingOnboarding.map((row, index) => (
                  <CheckRow
                    key={row.title}
                    done={false}
                    title={`${index + 1}. ${row.title}`}
                    text={row.text}
                    to={row.to}
                  />
                ))}
              </div>
            ) : null}
            {restrictedUserbots.length > 0 ? (
              <div className="pill pill--danger" style={{ marginTop: 12, gap: 6 }}>
                <ShieldAlert className="w-3.5 h-3.5" />
                {restrictedUserbots.length} аккаунт(ов) ограничены Telegram
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
