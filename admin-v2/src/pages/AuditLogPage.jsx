import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Filter, Loader2, RefreshCcw, Search, ShieldAlert, XCircle } from 'lucide-react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { Badge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.jsx';
import { Input } from '../components/ui/input.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';

const STATUS_META = {
  success: { label: 'Успех', icon: CheckCircle2, color: 'text-emerald-600', badge: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  error: { label: 'Ошибка', icon: XCircle, color: 'text-rose-600', badge: 'bg-rose-50 text-rose-700 border-rose-200' },
  rate_limited: { label: 'Rate limit', icon: Clock, color: 'text-amber-600', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  insufficient_scope: { label: 'Нет скоупа', icon: ShieldAlert, color: 'text-amber-600', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  forbidden_account: { label: 'Аккаунт не в allowlist', icon: ShieldAlert, color: 'text-amber-600', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  safe_mode_blocked: { label: 'Safe-mode', icon: ShieldAlert, color: 'text-orange-600', badge: 'bg-orange-50 text-orange-700 border-orange-200' },
  account_restricted: { label: 'Аккаунт ограничен', icon: ShieldAlert, color: 'text-orange-600', badge: 'bg-orange-50 text-orange-700 border-orange-200' },
  integration_token_required: { label: 'Нет токена', icon: ShieldAlert, color: 'text-amber-600', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  telegram_error: { label: 'Telegram error', icon: AlertTriangle, color: 'text-rose-600', badge: 'bg-rose-50 text-rose-700 border-rose-200' },
  started: { label: 'В процессе', icon: Loader2, color: 'text-slate-500', badge: 'bg-slate-100 text-slate-700 border-slate-200' }
};

const SOURCE_LABEL = { mcp: 'MCP', rest: 'REST' };

const OPERATIONS = [
  'bullrun_infra_summary',
  'bullrun_proxy_preview',
  'bullrun_proxy_import',
  'bullrun_userbot_list',
  'bullrun_userbot_health',
  'bullrun_userbot_dialogs',
  'bullrun_userbot_messages',
  'bullrun_userbot_messages_search',
  'bullrun_userbot_participants',
  'bullrun_userbot_message_send'
];

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

function StatCard({ label, value, tone }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${tone || 'text-slate-900'}`}>{value}</div>
    </div>
  );
}

export function AuditLogPage() {
  const { accessToken } = useAuth();
  const [state, setState] = useState({ loading: true, error: '', entries: [], aggregates: {} });
  const [filters, setFilters] = useState({ operation: '', status: '', source: '', since: '', until: '' });
  const [appliedFilters, setAppliedFilters] = useState({});

  async function loadEntries() {
    if (!accessToken) return;
    setState((prev) => ({ ...prev, loading: true, error: '' }));
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(appliedFilters)) {
      if (v) params.set(k, v);
    }
    try {
      const data = await apiRequest(`/api/integrations/audit-log${params.size ? '?' + params : ''}`, { accessToken });
      setState({ loading: false, error: '', entries: data.entries || [], aggregates: data.aggregates || {} });
    } catch (error) {
      setState((prev) => ({ ...prev, loading: false, error: error.message || 'Не удалось загрузить audit log.' }));
    }
  }

  useEffect(() => {
    loadEntries();
  }, [accessToken, appliedFilters]);

  const total = useMemo(() => state.entries.length, [state.entries]);
  const successCount = state.aggregates.success || 0;
  const errorCount = (state.aggregates.error || 0) + (state.aggregates.telegram_error || 0);
  const blockedCount = (state.aggregates.rate_limited || 0) + (state.aggregates.insufficient_scope || 0) + (state.aggregates.forbidden_account || 0) + (state.aggregates.safe_mode_blocked || 0) + (state.aggregates.account_restricted || 0) + (state.aggregates.integration_token_required || 0);

  function applyFilters() {
    setAppliedFilters({ ...filters });
  }
  function resetFilters() {
    setFilters({ operation: '', status: '', source: '', since: '', until: '' });
    setAppliedFilters({});
  }

  return (
    <section className="page">
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Audit log</h1>
          <p className="mt-1 text-sm text-slate-500">
            Каждый вызов MCP и REST пишется сюда. Фильтруй по операции, статусу или периоду.
          </p>
        </div>
        <Button variant="outline" size="sm" className="h-9 rounded-xl" onClick={loadEntries} disabled={state.loading}>
          <RefreshCcw className={`h-4 w-4 ${state.loading ? 'animate-spin' : ''}`} /> Обновить
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Записей" value={total} />
        <StatCard label="Успешных" value={successCount} tone="text-emerald-600" />
        <StatCard label="Ошибок" value={errorCount} tone="text-rose-600" />
        <StatCard label="Заблокировано" value={blockedCount} tone="text-amber-600" />
      </div>

      <Card className="border-slate-200/70 bg-white shadow-sm mb-6">
        <CardHeader className="px-6 pt-6 pb-4">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-slate-400" />
            <CardTitle className="text-sm font-semibold text-slate-700">Фильтры</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="px-6 pb-6 space-y-3">
          <div className="grid gap-3 md:grid-cols-5">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-slate-500">Операция</span>
              <select
                className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
                value={filters.operation}
                onChange={(e) => setFilters((f) => ({ ...f, operation: e.target.value }))}
              >
                <option value="">Все</option>
                {OPERATIONS.map((op) => (
                  <option key={op} value={op}>{op}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-slate-500">Статус</span>
              <select
                className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
                value={filters.status}
                onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
              >
                <option value="">Любой</option>
                {Object.entries(STATUS_META).map(([k, m]) => (
                  <option key={k} value={k}>{m.label}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-slate-500">Источник</span>
              <select
                className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
                value={filters.source}
                onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))}
              >
                <option value="">Любой</option>
                <option value="mcp">MCP</option>
                <option value="rest">REST</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-slate-500">С</span>
              <Input
                type="datetime-local"
                className="h-9"
                value={filters.since}
                onChange={(e) => setFilters((f) => ({ ...f, since: e.target.value }))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-slate-500">До</span>
              <Input
                type="datetime-local"
                className="h-9"
                value={filters.until}
                onChange={(e) => setFilters((f) => ({ ...f, until: e.target.value }))}
              />
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" className="h-9 rounded-xl" onClick={applyFilters}>
              <Search className="h-4 w-4" /> Применить
            </Button>
            <Button variant="outline" size="sm" className="h-9 rounded-xl" onClick={resetFilters}>
              Сбросить
            </Button>
          </div>
        </CardContent>
      </Card>

      {state.error ? (
        <div className="error-card">{state.error}</div>
      ) : state.loading ? (
        <LoadingState text="Грузим audit log..." />
      ) : (
        <Card className="border-slate-200/70 bg-white shadow-sm">
          <CardContent className="px-6 pb-6">
            <div className="overflow-x-auto -mx-6 px-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Время</th>
                    <th className="py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Операция</th>
                    <th className="py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Источник</th>
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
                      <td className="py-3 pr-4">
                        <Badge variant="outline" className="bg-slate-100 text-slate-700 border-slate-200 text-xs">
                          {SOURCE_LABEL[row.source] || row.source}
                        </Badge>
                      </td>
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
                      <td colSpan="8" className="py-12 text-center text-sm text-slate-500">
                        Нет записей по этим фильтрам
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
