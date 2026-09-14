import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, ChevronDown, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase.js';
import { useAuth } from '../../app/providers/AuthProvider.jsx';
import { CampaignReplies } from './CampaignReplies.jsx';
import { STATUS_LABELS, campaignStatusTone } from './PreparationRunner.jsx';
import {
  Card, Section, SectionTitle, EmptyNote, StatusBadge, StatTile,
  TableShell, Th, Td, Tr, btnGhost
} from './ui.jsx';

const AUDIENCE_LABELS = {
  client_base_members: 'База клиентов',
  channel_audience_members: 'База по каналам',
  manual_list: 'Ручная выборка'
};

const CAMPAIGN_ACTIVE_STATUSES = new Set(['queued', 'sending']);

const FAILURES_PAGE = 25;

function formatWhen(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function campaignCounts(campaign) {
  const meta = campaign?.meta || {};
  const senderStats = Array.isArray(meta.sender_stats) ? meta.sender_stats : [];
  const sum = senderStats.reduce((acc, row) => ({
    sent: acc.sent + Number(row.sent || 0),
    failed: acc.failed + Number(row.failed || 0)
  }), { sent: 0, failed: 0 });
  const sent = meta.sent ?? (senderStats.length > 0 ? sum.sent : null);
  const failed = meta.failed ?? (senderStats.length > 0 ? sum.failed : null);
  const total = meta.total ?? (sent != null || failed != null ? (sent || 0) + (failed || 0) : null);
  return { sent, failed, total };
}

export function CampaignDetail({ accessToken, userbots, campaign, onBack, onRefresh }) {
  const { user } = useAuth();
  const meta = campaign.meta || {};
  const counts = campaignCounts(campaign);
  const senderStats = Array.isArray(meta.sender_stats) ? meta.sender_stats : [];
  const senderNames = (meta.sender_usernames || []).map((name) => `@${name}`);
  const skippedUnreachable = Number(meta.skipped_unreachable || 0);
  const campaignActive = CAMPAIGN_ACTIVE_STATUSES.has(campaign.status);

  const [failures, setFailures] = useState({ open: false, loading: false, rows: [], total: null, page: 0 });
  // Защита от гонок: ответ по прошлой кампании/странице не перезапишет свежий (паттерн reqId из CustomersPage)
  const failuresReqIdRef = useRef(0);

  useEffect(() => {
    failuresReqIdRef.current += 1;
    setFailures({ open: false, loading: false, rows: [], total: null, page: 0 });
  }, [campaign.id]);

  async function loadFailures(page) {
    const reqId = ++failuresReqIdRef.current;
    setFailures((prev) => ({ ...prev, loading: true }));
    const from = page * FAILURES_PAGE;
    const { data, count, error } = await supabase
      .from('broadcast_deliveries')
      .select('tg_user_id, error_text, created_at', { count: 'exact' })
      .eq('campaign_id', campaign.id)
      .eq('owner_id', user?.id || '')
      .eq('delivery_status', 'failed')
      .order('created_at', { ascending: false })
      .range(from, from + FAILURES_PAGE - 1);
    if (reqId !== failuresReqIdRef.current) return;
    if (error) {
      setFailures((prev) => ({ ...prev, loading: false }));
      return;
    }
    setFailures((prev) => ({
      open: true,
      loading: false,
      rows: page === 0 ? (data || []) : [...prev.rows, ...(data || [])],
      total: count ?? (data || []).length,
      page
    }));
  }

  // Кампания выполняется в фоне — опрашиваем список, пока идёт отправка
  useEffect(() => {
    if (!campaignActive || typeof onRefresh !== 'function') return undefined;
    const timer = window.setInterval(() => onRefresh(), 15000);
    return () => window.clearInterval(timer);
  }, [campaignActive, onRefresh, campaign.id]);

  const progressDone = (counts.sent || 0) + (counts.failed || 0);
  const progressPct = counts.total > 0 ? Math.min(100, Math.round((progressDone / counts.total) * 100)) : null;

  const failuresKnown = counts.failed != null ? counts.failed : null;

  return (
    <div className="space-y-6">
      <div className="grid grid--flush grid-cols-1 sm:grid-cols-3 gap-3">
        <StatTile label="Доставлено" value={counts.sent ?? '—'} tone="ok" />
        <StatTile label="Недоставлено" value={counts.failed ?? '—'} tone={(counts.failed || 0) > 0 ? 'danger' : 'default'} />
        <StatTile label="Всего получателей" value={counts.total ?? '—'} />
      </div>

      {skippedUnreachable > 0 ? (
        <div className="text-sm font-bold text-amber-700">
          Пропущены (недостижимые): {skippedUnreachable}
        </div>
      ) : null}

      <Card>
        <Section>
          <button type="button" className={`${btnGhost} mb-4`} onClick={onBack}>
            <ArrowLeft className="w-4 h-4" /> Назад к списку
          </button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-black text-slate-900">{campaign.title}</h1>
            <StatusBadge tone={campaignStatusTone(campaign.status)}>
              {STATUS_LABELS[campaign.status] || campaign.status}
            </StatusBadge>
            {typeof onRefresh === 'function' ? (
              <button type="button" className={`${btnGhost} !px-3 !py-1.5`} onClick={onRefresh}>
                <RefreshCw className="w-4 h-4" /> Обновить
              </button>
            ) : null}
          </div>
          <div className="mt-1.5 text-xs text-slate-500 font-medium">
            {formatWhen(campaign.created_at)} · {AUDIENCE_LABELS[campaign.audience_type] || campaign.audience_type}
          </div>
          {campaignActive ? (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-slate-500">
                  Отправлено {counts.sent ?? 0}{(counts.failed || 0) > 0 ? ` · ошибок ${counts.failed}` : ''} из {counts.total ?? '—'}
                </span>
                {progressPct != null ? <span className="text-xs font-black text-indigo-600">{progressPct}%</span> : null}
              </div>
              <div className="h-2 rounded-full bg-slate-200/70 overflow-hidden">
                {progressPct != null ? (
                  <div className="h-full bg-indigo-600 rounded-full transition-all duration-500" style={{ width: `${progressPct}%` }} />
                ) : (
                  <div className="h-full w-full bg-indigo-400/70 animate-pulse rounded-full" />
                )}
              </div>
            </div>
          ) : null}
        </Section>
      </Card>

      <CampaignReplies accessToken={accessToken} userbots={userbots} campaign={campaign} />

      <Card>
        <Section>
          {senderStats.length > 0 ? (
            <div className="mt-5">
              <div className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2">Отправители</div>
              <div className="flex flex-wrap gap-2">
                {senderStats.map((row) => (
                  <span key={row.sender_key} className="px-3 py-1.5 rounded-full bg-white border border-slate-200 text-xs font-bold text-slate-700">
                    {row.sender_label} · {row.sent}{row.failed > 0 ? <span className="text-rose-600"> / {row.failed} упало</span> : null}
                  </span>
                ))}
              </div>
            </div>
          ) : senderNames.length > 0 ? (
            <div className="mt-5">
              <div className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2">Отправители</div>
              <div className="flex flex-wrap gap-2">
                {senderNames.map((name) => (
                  <span key={name} className="px-3 py-1.5 rounded-full bg-white border border-slate-200 text-xs font-bold text-slate-700">{name}</span>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-5 text-sm text-slate-500 font-medium">Отправитель: официальный бот</div>
          )}

          {campaign.message_text ? (
            <div className="mt-5">
              <div className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2">Текст рассылки</div>
              <div className="p-4 rounded-2xl bg-slate-50/60 border border-slate-100 whitespace-pre-wrap text-sm text-slate-600 font-medium">
                {campaign.message_text}
              </div>
            </div>
          ) : null}
        </Section>

        <Section>
          <SectionTitle
            icon={failures.open ? ChevronDown : ChevronRight}
            action={
              <button
                type="button"
                className={`${btnGhost} !px-3 !py-1.5`}
                disabled={failures.loading}
                onClick={() => (failures.open ? setFailures((prev) => ({ ...prev, open: false })) : loadFailures(0))}
              >
                {failures.loading ? 'Загружаем...' : failures.open ? 'Свернуть' : `Недоставленные${failuresKnown != null ? ` (${failuresKnown})` : ''}`}
              </button>
            }
          >
            Недоставленные
          </SectionTitle>
          {failures.open ? (
            failures.rows.length === 0 ? (
              <EmptyNote>Недоставленных нет — всё дошло.</EmptyNote>
            ) : (
              <div>
                <TableShell>
                  <thead>
                    <tr>
                      <Th>Дата</Th>
                      <Th>TG ID</Th>
                      <Th>Ошибка</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {failures.rows.map((row, index) => (
                      <Tr key={`${row.tg_user_id}-${index}`}>
                        <Td><div className="text-xs text-slate-500 font-medium whitespace-nowrap">{formatWhen(row.created_at)}</div></Td>
                        <Td><div className="text-xs text-slate-600 font-mono">{row.tg_user_id}</div></Td>
                        <Td><div className="text-xs text-rose-600 font-medium">{row.error_text || '—'}</div></Td>
                      </Tr>
                    ))}
                  </tbody>
                </TableShell>
                {failures.rows.length < (failures.total || 0) ? (
                  <div className="mt-3">
                    <button type="button" className={btnGhost} disabled={failures.loading} onClick={() => loadFailures(failures.page + 1)}>
                      Показать ещё
                    </button>
                  </div>
                ) : null}
              </div>
            )
          ) : (
            <div className="text-sm text-slate-500 font-medium">
              Кому не дошло и почему — по этой рассылке.
            </div>
          )}
        </Section>
      </Card>
    </div>
  );
}
