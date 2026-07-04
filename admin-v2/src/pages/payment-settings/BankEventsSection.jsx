import { useEffect, useMemo, useState } from 'react';
import { Bell, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { apiRequest } from '../../api/client.js';
import { Badge } from '../../components/ui/badge.jsx';
import { Button } from '../../components/ui/button.jsx';

function formatWhen(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function bankEventBadge(status) {
  if (status === 'confirmed') return <Badge variant="outline" className="bg-emerald-100 text-emerald-800 border-emerald-200">Подтверждено</Badge>;
  if (status === 'ignored') return <Badge variant="outline" className="bg-slate-100 text-slate-600 border-slate-200">Скрыто</Badge>;
  return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">{status}</Badge>;
}

export function BankEventsSection({ accessToken, plain = false }) {
  const [state, setState] = useState({
    loading: true,
    error: '',
    bankEvents: []
  });

  const unresolvedCount = useMemo(
    () => state.bankEvents.filter((e) => ['matched', 'ambiguous', 'unmatched', 'auto_confirm_failed'].includes(e.status)).length,
    [state.bankEvents]
  );

  useEffect(() => {
    let cancelled = false;

    async function load({ silent = false } = {}) {
      if (!accessToken) return;
      if (!silent) setState((prev) => ({ ...prev, loading: !prev.bankEvents.length, error: '' }));
      try {
        const data = await apiRequest('/api/p2p-bank-events', { accessToken });
        if (cancelled) return;
        setState((prev) => ({ ...prev, loading: false, error: '', bankEvents: data.events || [] }));
      } catch (error) {
        if (cancelled) return;
        setState((prev) => ({ ...prev, loading: false, error: error.message }));
      }
    }

    load();
    const id = window.setInterval(() => load({ silent: true }), 30000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [accessToken]);

  async function runBankEventAction(event, action) {
    try {
      if (action === 'ignore') {
        await apiRequest(`/api/p2p-bank-events/${event.id}/ignore`, {
          accessToken,
          method: 'POST'
        });
      }
      if (action === 'confirm') {
        await apiRequest(`/api/p2p-bank-events/${event.id}/confirm`, {
          accessToken,
          method: 'POST',
          body: {
            purchase_ids: event.candidate_purchase_ids || event.matched_purchase_ids || [],
            batch_token: event.candidate_batch_tokens?.[0] || event.matched_batch_token || null
          }
        });
      }
      const data = await apiRequest('/api/p2p-bank-events', { accessToken });
      setState((prev) => ({ ...prev, error: '', bankEvents: data.events || [] }));
      toast.success(action === 'confirm' ? 'Банковское уведомление подтверждено.' : 'Банковское уведомление скрыто.');
    } catch (error) {
      setState((prev) => ({ ...prev, error: error.message }));
      toast.error(error.message);
    }
  }

  return (
    <div className={plain ? "space-y-5" : "bg-white border border-slate-200/60 rounded-3xl p-6 md:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] space-y-5"}>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20 shrink-0">
          <Bell className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-bold text-slate-900">Уведомления банка</h3>
          <p className="text-sm text-slate-500 mt-0.5">
            SMS/Push Forward от банка. Bullgram мэтчит автоматически, спорные — на тебе.
          </p>
        </div>
        {unresolvedCount > 0 ? (
          <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 shrink-0">
            {unresolvedCount} спорных
          </Badge>
        ) : null}
      </div>

      {state.error ? (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
          {state.error}
        </div>
      ) : null}

      {state.loading ? (
        <p className="text-sm text-slate-400 py-4 text-center">Загружаем уведомления...</p>
      ) : (
        <>
          {!state.bankEvents.length ? (
            <p className="text-sm text-slate-500 py-2">Пока банк не присылал уведомления через SMS/Push Forward.</p>
          ) : (
            <div className="space-y-2">
              {state.bankEvents.slice(0, 15).map((event) => {
                const candidateCount = (event.candidate_purchase_ids || event.matched_purchase_ids || []).length;
                const canConfirm = ['matched', 'auto_confirm_failed'].includes(event.status) && candidateCount > 0;
                return (
                  <div key={event.id} className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-slate-900">
                            {event.amount_rub ? `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(event.amount_rub)} ₽` : '—'}
                          </span>
                          {bankEventBadge(event.status)}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {formatWhen(event.received_at)}
                          {candidateCount ? ` · ${candidateCount} кандидат(ов)` : ''}
                        </div>
                        {event.redacted_text || event.raw_text ? (
                          <div className="mt-1 text-xs text-slate-400 truncate">{event.redacted_text || event.raw_text}</div>
                        ) : null}
                        {event.match_reason ? (
                          <div className="mt-0.5 text-xs text-slate-400">{event.match_reason}</div>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {canConfirm ? (
                          <Button variant="ghost" size="sm" className="h-8 px-2 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50" type="button" onClick={() => runBankEventAction(event, 'confirm')} title="Подтвердить">
                            <CheckCircle2 className="h-4 w-4" />
                          </Button>
                        ) : null}
                        {!['ignored', 'confirmed'].includes(event.status) ? (
                          <Button variant="ghost" size="sm" className="h-8 px-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100" type="button" onClick={() => runBankEventAction(event, 'ignore')} title="Скрыть">
                            <XCircle className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
