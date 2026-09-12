import { useEffect, useMemo, useState } from 'react';
import { Braces, BookOpen, Check, Copy, KeyRound, RefreshCcw } from 'lucide-react';
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

function statusBadge(token) {
  if (!token) return <Badge variant="outline" className="bg-slate-100 text-slate-600 border-slate-200">Нет ключа</Badge>;
  if (token.revoked_at) return <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200">Отозван</Badge>;
  return <Badge variant="outline" className="bg-emerald-100 text-emerald-800 border-emerald-200">Активен</Badge>;
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
      {value ? (
        <button
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          onClick={handleCopy}
          title="Копировать"
        >
          {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
        </button>
      ) : null}
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
  onHideSecret
}) {
  const meta = PURPOSES[purpose];
  const Icon = meta.icon;
  const hasToken = Boolean(token);
  const canShow = hasToken && !token.revoked_at && token.can_reveal;
  const canReissue = hasToken && !token.revoked_at;

  useEffect(() => {
    if (!secret || !onHideSecret || !token?.id) return;
    const timer = setTimeout(() => onHideSecret(token.id), 60000);
    return () => clearTimeout(timer);
  }, [secret, token?.id, onHideSecret]);

  return (
    <Card className="border-slate-200/70 bg-white shadow-sm">
      <CardHeader className="px-6 pt-4">
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
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-slate-500">Ключ</span>
            <CopyInput value={secret || ''} monospace placeholder={secret === undefined ? 'Нажми «Показать», чтобы увидеть ключ' : '—'} />
          </label>
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
            <Button variant="outline" size="sm" className="h-9 rounded-xl text-amber-600 hover:text-amber-700 hover:bg-amber-50" type="button" onClick={() => onReissue(token)} disabled={busy}>
              <RefreshCcw className="h-4 w-4" /> Перевыпустить
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
  const [docsOpen, setDocsOpen] = useState(false);

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

  function hideSecret(tokenId) {
    setSecrets((prev) => {
      if (!(tokenId in prev)) return prev;
      const next = { ...prev };
      delete next[tokenId];
      return next;
    });
  }

  const activeApiToken = useMemo(() => {
    return state.tokens.find((t) => t.purpose === 'api' && !t.revoked_at) || null;
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
          label: meta?.label || purpose
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
    if (!window.confirm('Перевыпустить ключ? Старый ключ перестанет работать сразу: все скрипты и n8n на этом ключе сломаются, пока не вставишь новый. Отменить это нельзя.')) return;
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
          onHideSecret={hideSecret}
        />
      </div>

      <Card className="border-slate-200/70 bg-white shadow-sm mt-6">
        <CardHeader className="px-6 pt-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-sky-500 to-sky-600 flex items-center justify-center text-white shadow-lg shadow-sky-500/20 shrink-0">
                <BookOpen className="w-6 h-6" />
              </div>
              <div>
                <CardTitle className="text-lg font-bold tracking-tight text-slate-900">Справочник по API</CardTitle>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
                  Все эндпоинты, параметры и примеры запросов. Работает с Bearer-токеном из карточки выше.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" className="h-9 rounded-xl" type="button" onClick={() => setDocsOpen((v) => !v)}>
                {docsOpen ? 'Скрыть' : 'Показать'}
              </Button>
              <a
                href="https://bullgram.xyz/api/external/v1/docs"
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 transition hover:bg-slate-50"
              >
                Открыть в новой вкладке
              </a>
            </div>
          </div>
        </CardHeader>
        {docsOpen ? (
          <CardContent className="px-6 pb-6">
            <iframe
              src="/api/external/v1/docs"
              title="Справочник по API"
              className="h-[720px] w-full rounded-xl border border-slate-200"
            />
          </CardContent>
        ) : null}
      </Card>

      <div className="mt-6">
        <RecentCallsTable source="rest" />
      </div>
    </section>
  );
}
