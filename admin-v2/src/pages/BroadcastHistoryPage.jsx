import { useEffect, useState } from 'react';
import { ListChecks, MessageCircle } from 'lucide-react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { supabase } from '../lib/supabase.js';
import { LoadingState } from '../ui/LoadingState.jsx';
import { CampaignDetail } from './broadcast/CampaignDetail.jsx';
import {
  Card, Section, SectionTitle, EmptyNote, ErrorNote, StatusBadge, StatTile,
  TableShell, Th, Td, Tr, btnGhost
} from './broadcast/ui.jsx';

const AUDIENCE_LABELS = {
  client_base_members: 'База клиентов',
  channel_audience_members: 'База по каналам',
  manual_list: 'Ручная выборка'
};

function formatWhen(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function deliveredLabel(campaign) {
  const meta = campaign.meta || {};
  if (meta.sent != null || meta.total != null) {
    return `${meta.sent ?? 0} из ${meta.total ?? meta.sent ?? 0}`;
  }
  const stats = Array.isArray(meta.sender_stats) ? meta.sender_stats : [];
  if (stats.length > 0) {
    const sent = stats.reduce((sum, row) => sum + Number(row.sent || 0), 0);
    const failed = stats.reduce((sum, row) => sum + Number(row.failed || 0), 0);
    return `${sent} из ${sent + failed}`;
  }
  return '—';
}

function sendersLabel(campaign) {
  if (campaign?.meta?.sender_usernames?.length) {
    return campaign.meta.sender_usernames.map((name) => `@${name}`).join(', ');
  }
  if (campaign?.meta?.sender_username) {
    return `@${campaign.meta.sender_username}`;
  }
  return 'Официальный бот';
}

export function BroadcastHistoryPage() {
  const { accessToken, user } = useAuth();
  const [state, setState] = useState({ loading: true, error: '', campaigns: [], summary: null, userbots: [] });
  const [activeCampaignId, setActiveCampaignId] = useState(
    () => new URLSearchParams(window.location.search).get('campaign')
  );

  useEffect(() => {
    if (!accessToken || !user?.id) return undefined;
    let cancelled = false;
    async function load() {
      try {
        const [campaigns, { data: rawUserbots }] = await Promise.all([
          apiRequest('/api/broadcast/campaigns', { accessToken }),
          supabase
            .from('tg_accounts')
            .select('id, tg_username, tg_account_id, runtime_status, proxy_id, proxies(id, name, is_working)')
            .eq('owner_id', user.id)
            .eq('account_type', 'userbot')
            .order('created_at', { ascending: false })
        ]);
        if (cancelled) return;
        setState({
          loading: false,
          error: '',
          campaigns: campaigns.campaigns || [],
          summary: campaigns.summary || null,
          userbots: rawUserbots || []
        });
      } catch (error) {
        if (!cancelled) {
          setState((prev) => ({ ...prev, loading: false, error: error.message }));
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [accessToken, user?.id]);

  function openCampaign(id) {
    setActiveCampaignId(id);
    window.history.replaceState(
      {},
      '',
      id ? `/app/broadcast/history?campaign=${encodeURIComponent(id)}` : '/app/broadcast/history'
    );
  }

  // битый deep-link (?campaign= нет в списке) — возвращаемся к списку
  useEffect(() => {
    if (!state.loading && activeCampaignId && !state.campaigns.some((row) => row.id === activeCampaignId)) {
      openCampaign(null);
    }
  }, [state.loading, state.campaigns, activeCampaignId]);

  if (state.loading) {
    return <LoadingState text="Загружаем историю рассылок..." />;
  }

  const activeCampaign = state.campaigns.find((row) => row.id === activeCampaignId) || null;

  if (activeCampaign) {
    return (
      <section className="page page--flush space-y-6">
        {state.error ? <ErrorNote>{state.error}</ErrorNote> : null}
        <CampaignDetail
          accessToken={accessToken}
          userbots={state.userbots}
          campaign={activeCampaign}
          onBack={() => openCampaign(null)}
        />
      </section>
    );
  }

  const summary = state.summary;

  return (
    <section className="page page--flush space-y-6">
      {state.error ? <ErrorNote>{state.error}</ErrorNote> : null}

      {summary ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatTile
            label="Рассылок"
            value={summary.totalCampaigns ?? '—'}
            hint={summary.partialCampaigns > 0 ? `с ошибками: ${summary.partialCampaigns}` : 'все чисто'}
          />
          <StatTile label="Отправлено" value={summary.totalSent ?? '—'} tone="ok" />
          <StatTile
            label="Недоставлено"
            value={summary.totalFailed ?? '—'}
            tone={(summary.totalFailed || 0) > 0 ? 'danger' : 'default'}
          />
        </div>
      ) : null}

      <Card>
        <Section>
          <SectionTitle icon={ListChecks}>Рассылки</SectionTitle>
          {state.campaigns.length === 0 ? (
            <EmptyNote>Рассылок еще не было.</EmptyNote>
          ) : (
            <TableShell>
              <thead>
                <tr>
                  <Th>Дата</Th>
                  <Th>Название</Th>
                  <Th>База</Th>
                  <Th>Отправители</Th>
                  <Th>Доставлено</Th>
                  <Th>Статус</Th>
                  <Th right />
                </tr>
              </thead>
              <tbody>
                {state.campaigns.map((campaign) => (
                  <Tr key={campaign.id}>
                    <Td><div className="text-xs text-slate-500 font-medium whitespace-nowrap">{formatWhen(campaign.created_at)}</div></Td>
                    <Td>
                      <button
                        type="button"
                        className="text-left text-sm font-bold text-slate-900 hover:text-indigo-700 transition-colors"
                        onClick={() => openCampaign(campaign.id)}
                      >
                        {campaign.title}
                      </button>
                    </Td>
                    <Td><div className="text-xs text-slate-600 font-medium">{AUDIENCE_LABELS[campaign.audience_type] || campaign.audience_type}</div></Td>
                    <Td><div className="text-xs text-slate-600 font-medium">{sendersLabel(campaign)}</div></Td>
                    <Td><div className="text-xs text-slate-600 font-bold whitespace-nowrap">{deliveredLabel(campaign)}</div></Td>
                    <Td>
                      <StatusBadge tone={campaign.status === 'sent' ? 'ok' : campaign.status === 'completed_with_errors' ? 'warning' : 'default'}>
                        {campaign.status}
                      </StatusBadge>
                    </Td>
                    <Td right>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-600 hover:border-indigo-400 hover:text-indigo-700 transition-colors"
                        onClick={() => openCampaign(campaign.id)}
                      >
                        <MessageCircle className="w-3.5 h-3.5" /> Ответы
                      </button>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableShell>
          )}
        </Section>
      </Card>
    </section>
  );
}
