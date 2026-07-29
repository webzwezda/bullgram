import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Loader2, RefreshCcw, ShieldAlert, XCircle } from 'lucide-react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { Badge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.jsx';

const STATUS_META = {
  success: { label: 'Успех', icon: CheckCircle2, color: 'text-emerald-600', badge: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  error: { label: 'Ошибка', icon: XCircle, color: 'text-rose-600', badge: 'bg-rose-50 text-rose-700 border-rose-200' },
  rate_limited: { label: 'Rate limit', icon: Clock, color: 'text-amber-600', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  insufficient_scope: { label: 'Нет скоупа', icon: ShieldAlert, color: 'text-amber-600', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  forbidden_account: { label: 'Не в allowlist', icon: ShieldAlert, color: 'text-amber-600', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  safe_mode_blocked: { label: 'Safe-mode', icon: ShieldAlert, color: 'text-orange-600', badge: 'bg-orange-50 text-orange-700 border-orange-200' },
  account_restricted: { label: 'Ограничен', icon: ShieldAlert, color: 'text-orange-600', badge: 'bg-orange-50 text-orange-700 border-orange-200' },
  integration_token_required: { label: 'Нет токена', icon: ShieldAlert, color: 'text-amber-600', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  telegram_error: { label: 'Telegram error', icon: AlertTriangle, color: 'text-rose-600', badge: 'bg-rose-50 text-rose-700 border-rose-200' },
  started: { label: 'В процессе', icon: Loader2, color: 'text-slate-500', badge: 'bg-slate-100 text-slate-700 border-slate-200' }
};

function formatTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', { hour12: false });
}

function formatLatency(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.error;
  const Icon = meta.icon;
  return (
    <Badge variant="outline" className={`${meta.badge} gap-1`}>
      <Icon className={`h-3 w-3 ${meta.color}`} />
      {meta.label}
    </Badge>
  );
}

export function RecentCallsTable({ source }) {
  const { accessToken } = useAuth();
  const [state, setState] = useState({ loading: true, error: '', entries: [] });

  async function load() {
    if (!accessToken) return;
    setState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const params = new URLSearchParams({ limit: '20' });
      if (source) params.set('source', source);
      const data = await apiRequest(`/api/integrations/audit-log?${params}`, { accessToken });
      setState({ loading: false, error: '', entries: data.entries || [] });
    } catch (error) {
      setState((prev) => ({ ...prev, loading: false, error: error.message || 'Не удалось загрузить вызовы.' }));
    }
  }

  useEffect(() => {
    load();
  }, [accessToken, source]);

  const title = source === 'mcp' ? 'Последние MCP-вызовы' : source === 'rest' ? 'Последние API-вызовы' : 'Последние вызовы';
  const subtitle = source === 'mcp'
    ? 'Журнал вызовов через MCP-шлюз — что клешня дёргала в последнее время.'
    : source === 'rest'
      ? 'Журнал вызовов через REST API — внешние скрипты, интеграции, автоматизация.'
      : 'Журнал вызовов ключами этого токена.';

  return (
    <Card className="border-slate-200/70 bg-white shadow-sm">
      <CardHeader className="px-6 pt-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-lg font-bold tracking-tight text-slate-900">{title}</CardTitle>
            <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
          </div>
          <Button variant="outline" size="sm" className="h-9 rounded-xl" type="button" onClick={load} disabled={state.loading}>
            <RefreshCcw className={`h-4 w-4 ${state.loading ? 'animate-spin' : ''}`} /> Обновить
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-6 pb-6">
        {state.error ? (
          <div className="error-card">{state.error}</div>
        ) : (
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Время</th>
                  <th className="py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Операция</th>
                  <th className="py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Статус</th>
                  <th className="py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Latency</th>
                  <th className="py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Userbot</th>
                  <th className="py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">IP</th>
                  <th className="py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Ошибка</th>
                </tr>
              </thead>
              <tbody>
                {state.entries.length ? state.entries.map((row) => (
                  <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                    <td className="py-3 pr-4 whitespace-nowrap text-xs text-slate-700">{formatTime(row.started_at)}</td>
                    <td className="py-3 pr-4 font-mono text-xs text-slate-900">{row.operation_name}</td>
                    <td className="py-3 pr-4"><StatusBadge status={row.status} /></td>
                    <td className="py-3 pr-4 font-mono text-xs text-slate-700">{formatLatency(row.latency_ms)}</td>
                    <td className="py-3 pr-4 font-mono text-xs text-slate-500">{row.userbot_id ? String(row.userbot_id).slice(0, 8) + '…' : '—'}</td>
                    <td className="py-3 pr-4 font-mono text-xs text-slate-500">{row.request_ip || '—'}</td>
                    <td className="py-3 text-xs text-slate-500 max-w-md truncate" title={row.error_message || ''}>
                      {row.error_message || '—'}
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan="7" className="py-12 text-center text-sm text-slate-500">
                      Нет вызовов по этому источнику
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
