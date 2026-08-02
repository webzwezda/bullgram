import { useEffect, useMemo, useState } from 'react';
import { Braces, Check, Copy, KeyRound, RefreshCcw, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { Badge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.jsx';
import { Input } from '../components/ui/input.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';
import { RecentCallsTable } from '../ui/RecentCallsTable.jsx';

const PURPOSES = {
  api: {
    title: 'API ключ',
    description: 'Общий Bearer token для внешних запросов к Bullgram API: автоматизации, скрипты, интеграции.',
    icon: Braces,
    gradient: 'from-amber-500 to-amber-600',
    shadow: 'shadow-amber-500/20',
    label: 'API ключ'
  }
};

const VISIBLE_PURPOSES = new Set(['api', 'custom']);

const SCOPE_GROUPS = [
  {
    domain: 'userbot',
    label: 'Userbot',
    scopes: [
      { name: 'mcp:userbot:read', desc: 'Список, health, диалоги, сообщения, поиск, участники' },
      { name: 'mcp:userbot:write', desc: 'Отправка сообщений от имени userbot' },
      { name: 'api:userbot:read', desc: 'Те же чтения через REST' },
      { name: 'api:userbot:write', desc: 'Те же записи через REST' }
    ]
  },
  {
    domain: 'proxy',
    label: 'Proxy',
    scopes: [
      { name: 'mcp:proxy:read', desc: 'Превью прокси перед импортом' },
      { name: 'mcp:proxy:write', desc: 'Импорт прокси' },
      { name: 'api:proxy:read', desc: 'Те же чтения через REST' },
      { name: 'api:proxy:write', desc: 'Те же записи через REST' }
    ]
  }
];

function formatWhen(value) {
  if (!value) return 'Еще не использовался';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Дата неизвестна';
  return date.toLocaleString('ru-RU');
}

function purposeTitle(value) {
  return PURPOSES[value]?.title || (value === 'custom' ? 'Кастомный' : 'API key');
}

function maskSecret(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  if (token.length <= 20) return token;
  return `${token.slice(0, 18)}...${token.slice(-8)}`;
}

function statusBadge(token) {
  if (!token) return <Badge variant="outline" className="bg-slate-100 text-slate-600 border-slate-200">Нет ключа</Badge>;
  if (token.revoked_at) return <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200">Отозван</Badge>;
  return <Badge variant="outline" className="bg-emerald-100 text-emerald-800 border-emerald-200">Активен</Badge>;
}

function scopesText(scopes = []) {
  return scopes.length ? scopes.join(', ') : 'без scopes';
}

function CopyInput({ value, monospace, placeholder }) {
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
        value={value || ''}
        placeholder={placeholder || '—'}
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

function IntegrationCard({
  purpose,
  token,
  secret,
  busy,
  onCreate,
  onReveal,
  onCopy,
  onReissue,
  onRevoke
}) {
  const meta = PURPOSES[purpose];
  const Icon = meta.icon;
  const hasToken = Boolean(token);
  const canShow = hasToken && !token.revoked_at && token.can_reveal;
  const canReissue = hasToken && !token.revoked_at;

  return (
    <Card className="border-slate-200/70 bg-white shadow-sm">
      <CardHeader className="px-6 pt-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${meta.gradient} flex items-center justify-center text-white shadow-lg ${meta.shadow} shrink-0`}>
              <Icon className="w-6 h-6" />
            </div>
            <div>
              <CardTitle className="text-lg font-bold tracking-tight text-slate-900">{meta.title}</CardTitle>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">{meta.description}</p>
            </div>
          </div>
          {statusBadge(token)}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 px-6 pb-6">
        {hasToken ? (
          <div className="space-y-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-slate-500">Ключ</span>
              <CopyInput value={secret || ''} monospace placeholder={secret === undefined ? 'Нажми «Показать», чтобы увидеть ключ' : '—'} />
            </label>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-400">Права</div>
                <div className="mt-1 text-sm font-medium text-slate-900">{scopesText(token.scopes)}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-400">Последний вход</div>
                <div className="mt-1 text-sm font-medium text-slate-900">{formatWhen(token.last_used_at)}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-400">Создан</div>
                <div className="mt-1 text-sm font-medium text-slate-900">{formatWhen(token.created_at)}</div>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Ключ еще не выпускался.</p>
        )}

        <div className="flex flex-wrap gap-2">
          {!hasToken ? (
            <Button size="sm" className="h-9 rounded-xl" type="button" onClick={() => onCreate(purpose)} disabled={busy}>
              <KeyRound className="h-4 w-4" /> Выпустить
            </Button>
          ) : null}
          {canShow ? (
            <Button variant="outline" size="sm" className="h-9 rounded-xl" type="button" onClick={() => onReveal(token)} disabled={busy}>
              <KeyRound className="h-4 w-4" /> Показать
            </Button>
          ) : null}
          {canShow ? (
            <Button variant="outline" size="sm" className="h-9 rounded-xl" type="button" onClick={() => onCopy(token)} disabled={busy}>
              <Copy className="h-4 w-4" /> Скопировать
            </Button>
          ) : null}
          {canReissue ? (
            <Button variant="outline" size="sm" className="h-9 rounded-xl" type="button" onClick={() => onReissue(token)} disabled={busy}>
              <RefreshCcw className="h-4 w-4" /> Перевыпустить
            </Button>
          ) : null}
          {canReissue ? (
            <Button variant="outline" size="sm" className="h-9 rounded-xl text-rose-600 hover:text-rose-700 hover:bg-rose-50" type="button" onClick={() => onRevoke(token)} disabled={busy}>
              <Trash2 className="h-4 w-4" /> Отозвать
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function ApiIntegrationsPage() {
  const { accessToken } = useAuth();
  const [state, setState] = useState({
    loading: true,
    error: '',
    tokens: []
  });
  const [secrets, setSecrets] = useState({});
  const [busyId, setBusyId] = useState('');

  const [customOpen, setCustomOpen] = useState(false);
  const [customLabel, setCustomLabel] = useState('');
  const [customScopes, setCustomScopes] = useState({ 'api:userbot:read': true, 'api:proxy:read': true });

  async function loadTokens({ silent = false } = {}) {
    if (!accessToken) return;
    if (!silent) setState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const data = await apiRequest('/api/integrations/tokens', { accessToken });
      setState({ loading: false, error: '', tokens: data.tokens || [] });
    } catch (error) {
      setState((prev) => ({ ...prev, loading: false, error: error.message || 'Не удалось загрузить ключи.' }));
    }
  }

  useEffect(() => {
    loadTokens();
  }, [accessToken]);

  function toggleScope(name) {
    setCustomScopes((prev) => ({ ...prev, [name]: !prev[name] }));
  }

  async function createCustomToken() {
    const scopes = Object.keys(customScopes).filter((k) => customScopes[k]);
    if (!scopes.length) {
      toast.error('Выбери хотя бы один scope.');
      return;
    }
    setBusyId('create:custom');
    try {
      const data = await apiRequest('/api/integrations/tokens', {
        accessToken,
        method: 'POST',
        body: {
          purpose: 'custom',
          label: customLabel.trim() || `Custom · ${scopes.length} scope${scopes.length === 1 ? '' : 's'}`,
          scopes
        }
      });
      if (data.record?.id && data.token) {
        setSecrets((prev) => ({ ...prev, [data.record.id]: data.token }));
      }
      toast.success(`Ключ выпущен с ${scopes.length} scope${scopes.length === 1 ? '' : 's'}.`);
      setCustomOpen(false);
      setCustomLabel('');
      await loadTokens({ silent: true });
    } catch (error) {
      toast.error(error.message || 'Не удалось выпустить ключ.');
    } finally {
      setBusyId('');
    }
  }

  const activeApiToken = useMemo(() => {
    return state.tokens.find((t) => t.purpose === 'api' && !t.revoked_at) || null;
  }, [state.tokens]);

  const visibleTokens = useMemo(() => {
    return state.tokens.filter((t) => VISIBLE_PURPOSES.has(t.purpose));
  }, [state.tokens]);

  async function revealToken(token) {
    if (!token?.id) return '';
    if (secrets[token.id]) return secrets[token.id];
    setBusyId(token.id);
    try {
      const data = await apiRequest(`/api/integrations/tokens/${encodeURIComponent(token.id)}/secret`, { accessToken });
      setSecrets((prev) => ({ ...prev, [token.id]: data.token || '' }));
      return data.token || '';
    } catch (error) {
      toast.error(error.message || 'Не удалось показать ключ.');
      return '';
    } finally {
      setBusyId('');
    }
  }

  async function copyToken(token) {
    const secret = await revealToken(token);
    if (!secret) return;
    await navigator.clipboard.writeText(secret);
    toast.success('Ключ скопирован.');
  }

  async function createToken(purpose) {
    const meta = PURPOSES[purpose];
    setBusyId(`create:${purpose}`);
    try {
      const data = await apiRequest('/api/integrations/tokens', {
        accessToken,
        method: 'POST',
        body: {
          purpose,
          label: meta?.label || purposeTitle(purpose)
        }
      });
      if (data.record?.id && data.token) {
        setSecrets((prev) => ({ ...prev, [data.record.id]: data.token }));
      }
      toast.success('Ключ выпущен.');
      await loadTokens({ silent: true });
    } catch (error) {
      toast.error(error.message || 'Не удалось выпустить ключ.');
    } finally {
      setBusyId('');
    }
  }

  async function reissueToken(token) {
    if (!window.confirm('Старый ключ сразу перестанет работать. Внешних скриптах нужно будет вставить новый.')) return;
    setBusyId(token.id);
    try {
      const data = await apiRequest(`/api/integrations/tokens/${encodeURIComponent(token.id)}/reissue`, {
        accessToken,
        method: 'POST',
        body: { reason: 'reissued_from_api_page' }
      });
      if (data.record?.id && data.token) {
        setSecrets((prev) => ({ ...prev, [data.record.id]: data.token }));
      }
      toast.success('Ключ перевыпущен.');
      await loadTokens({ silent: true });
    } catch (error) {
      toast.error(error.message || 'Не удалось перевыпустить ключ.');
    } finally {
      setBusyId('');
    }
  }

  async function revokeToken(token) {
    if (!window.confirm('После отзыва эта интеграция больше не сможет обращаться к Bullgram.')) return;
    setBusyId(token.id);
    try {
      await apiRequest(`/api/integrations/tokens/${encodeURIComponent(token.id)}/revoke`, {
        accessToken,
        method: 'POST',
        body: { reason: 'revoked_from_api_page' }
      });
      setSecrets((prev) => {
        const next = { ...prev };
        delete next[token.id];
        return next;
      });
      toast.success('Ключ отозван.');
      await loadTokens({ silent: true });
    } catch (error) {
      toast.error(error.message || 'Не удалось отозвать ключ.');
    } finally {
      setBusyId('');
    }
  }

  if (state.loading) return <LoadingState text="Грузим API ключи..." />;

  return (
    <section className="page">
      {state.error ? <div className="error-card" style={{ marginTop: 20 }}>{state.error}</div> : null}

      <div className="space-y-6">
        <IntegrationCard
          purpose="api"
          token={activeApiToken}
          secret={activeApiToken ? secrets[activeApiToken.id] : ''}
          busy={Boolean(busyId)}
          onCreate={createToken}
          onReveal={revealToken}
          onCopy={copyToken}
          onReissue={reissueToken}
          onRevoke={revokeToken}
        />
      </div>

      <Card className="border-slate-200/70 bg-white shadow-sm mt-6">
        <CardHeader className="px-6 pt-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-violet-600 flex items-center justify-center text-white shadow-lg shadow-violet-500/20 shrink-0">
                <Sparkles className="w-6 h-6" />
              </div>
              <div>
                <CardTitle className="text-lg font-bold tracking-tight text-slate-900">Кастомный токен</CardTitle>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
                  Токен с точным набором скоупов. Для узких интеграций: только чтение, только userbot, только прокси.
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" className="h-9 rounded-xl" onClick={() => setCustomOpen((v) => !v)}>
              {customOpen ? 'Скрыть' : 'Настроить'}
            </Button>
          </div>
        </CardHeader>
        {customOpen ? (
          <CardContent className="px-6 pb-6 space-y-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-slate-500">Название</span>
              <Input
                className="h-9"
                placeholder="Например: n8n-collector"
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
              />
            </label>
            <div>
              <div className="text-xs font-semibold text-slate-500 mb-2">Скоупы</div>
              <div className="grid gap-4 md:grid-cols-2">
                {SCOPE_GROUPS.map((group) => (
                  <div key={group.domain} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs font-bold uppercase tracking-wide text-slate-700 mb-2">{group.label}</div>
                    <div className="space-y-2">
                      {group.scopes.map((scope) => (
                        <label key={scope.name} className="flex items-start gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                            checked={Boolean(customScopes[scope.name])}
                            onChange={() => toggleScope(scope.name)}
                          />
                          <div>
                            <div className="font-mono text-xs text-slate-900">{scope.name}</div>
                            <div className="text-xs text-slate-500 leading-snug">{scope.desc}</div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" className="h-9 rounded-xl" onClick={createCustomToken} disabled={Boolean(busyId)}>
                <KeyRound className="h-4 w-4" /> Выпустить кастомный
              </Button>
              <span className="text-xs text-slate-500">
                Выбрано: {Object.values(customScopes).filter(Boolean).length}
              </span>
            </div>
          </CardContent>
        ) : null}
      </Card>

      <Card className="border-slate-200/70 bg-white shadow-sm mt-6">
        <CardHeader className="px-6 pt-6">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg font-bold tracking-tight text-slate-900">Все ключи</CardTitle>
              <p className="mt-1 text-sm text-slate-500">Показать, скопировать, перевыпустить или отозвать.</p>
            </div>
            <Button variant="outline" size="sm" className="h-9 rounded-xl" type="button" onClick={() => loadTokens()} disabled={Boolean(busyId)}>
              <RefreshCcw className="h-4 w-4" /> Обновить
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-6 pb-6">
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Интеграция</th>
                  <th className="py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Название</th>
                  <th className="py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Права</th>
                  <th className="py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Ключ</th>
                  <th className="py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Последний вход</th>
                  <th className="py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Статус</th>
                  <th className="py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-400">Действия</th>
                </tr>
              </thead>
              <tbody>
                {visibleTokens.length ? visibleTokens.map((token) => (
                  <tr key={token.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                    <td className="py-3 pr-4">
                      <div className="font-medium text-slate-900">{purposeTitle(token.purpose)}</div>
                      <div className="text-xs text-slate-400">{formatWhen(token.created_at)}</div>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="font-medium text-slate-900">{token.label || purposeTitle(token.purpose)}</div>
                    </td>
                    <td className="py-3 pr-4 text-slate-500">{scopesText(token.scopes)}</td>
                    <td className="py-3 pr-4">
                      <span className="font-mono text-xs text-slate-700">
                        {secrets[token.id] ? maskSecret(secrets[token.id]) : (token.token_hint || '—')}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="text-slate-700">{formatWhen(token.last_used_at)}</div>
                      {token.last_used_ip ? <div className="font-mono text-xs text-slate-400">{token.last_used_ip}</div> : null}
                    </td>
                    <td className="py-3 pr-4">{statusBadge(token)}</td>
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {token.can_reveal && !token.revoked_at ? (
                          <Button variant="ghost" size="sm" className="h-8 px-2" type="button" onClick={() => copyToken(token)} disabled={Boolean(busyId)} title="Копировать">
                            <Copy className="h-4 w-4" />
                          </Button>
                        ) : null}
                        {!token.revoked_at ? (
                          <Button variant="ghost" size="sm" className="h-8 px-2" type="button" onClick={() => reissueToken(token)} disabled={Boolean(busyId)} title="Перевыпустить">
                            <RefreshCcw className="h-4 w-4" />
                          </Button>
                        ) : null}
                        {!token.revoked_at ? (
                          <Button variant="ghost" size="sm" className="h-8 px-2 text-rose-600 hover:text-rose-700 hover:bg-rose-50" type="button" onClick={() => revokeToken(token)} disabled={Boolean(busyId)} title="Отозвать">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan="7" className="py-12 text-center">
                      <div className="flex flex-col items-center justify-center">
                        <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mb-3">
                          <ShieldCheck className="w-6 h-6 text-slate-400" />
                        </div>
                        <p className="text-sm text-slate-500 font-semibold">Пока нет ключей</p>
                        <p className="mt-1 text-xs text-slate-400">Выпусти API ключ выше.</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="mt-6">
        <RecentCallsTable source="rest" />
      </div>
    </section>
  );
}
