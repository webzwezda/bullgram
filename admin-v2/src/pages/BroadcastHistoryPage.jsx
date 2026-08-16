import { useEffect, useState } from 'react';
import { ListChecks, MessageCircle } from 'lucide-react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { supabase } from '../lib/supabase.js';
import { LoadingState } from '../ui/LoadingState.jsx';
import { RepliesChecker } from './broadcast/RepliesChecker.jsx';
import {
  Card, Section, SectionTitle, EmptyNote, ErrorNote, StatusBadge,
  TableShell, Th, Td, Tr
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

function senderLabel(campaign) {
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
  const [state, setState] = useState({ loading: true, error: '', campaigns: [], failures: [], userbots: [] });
  const [activeCampaignId, setActiveCampaignId] = useState(null);
  const activeCampaign = state.campaigns.find((campaign) => campaign.id === activeCampaignId) || null;

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
          failures: campaigns.failures || [],
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

  if (state.loading) {
    return <LoadingState text="Загружаем историю рассылок..." />;
  }

  return (
    <section className="page page--flush space-y-6">
      {state.error ? <ErrorNote>{state.error}</ErrorNote> : null}

      {activeCampaign ? (
        <RepliesChecker accessToken={accessToken} userbots={state.userbots} campaign={activeCampaign} />
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
                  <Th>Статус</Th>
                  <Th>Ответы</Th>
                </tr>
              </thead>
              <tbody>
                {state.campaigns.slice(0, 50).map((campaign) => (
                  <Tr key={campaign.id}>
                    <Td><div className="text-xs text-slate-500 font-medium whitespace-nowrap">{formatWhen(campaign.created_at)}</div></Td>
                    <Td><div className="text-sm font-bold text-slate-900">{campaign.title}</div></Td>
                    <Td><div className="text-xs text-slate-600 font-medium">{AUDIENCE_LABELS[campaign.audience_type] || campaign.audience_type}</div></Td>
                    <Td><div className="text-xs text-slate-600 font-medium">{senderLabel(campaign)}</div></Td>
                    <Td>
                      <StatusBadge tone={campaign.status === 'sent' ? 'ok' : campaign.status === 'completed_with_errors' ? 'warning' : 'default'}>
                        {campaign.status}
                      </StatusBadge>
                    </Td>
                    <Td>
                      <button
                        type="button"
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-colors ${
                          activeCampaignId === campaign.id
                            ? 'bg-indigo-600 border-indigo-600 !text-white'
                            : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-400 hover:text-indigo-700'
                        }`}
                        onClick={() => setActiveCampaignId((prev) => (prev === campaign.id ? null : campaign.id))}
                      >
                        <MessageCircle className="w-3.5 h-3.5" /> Проверить ответы
                      </button>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableShell>
          )}
          {state.failures.length > 0 ? (
            <div className="mt-6">
              <div className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-3">Не доставлено</div>
              <TableShell>
                <thead>
                  <tr>
                    <Th>Дата</Th>
                    <Th>TG ID</Th>
                    <Th>Ошибка</Th>
                  </tr>
                </thead>
                <tbody>
                  {state.failures.slice(0, 50).map((row) => (
                    <Tr key={row.id}>
                      <Td><div className="text-xs text-slate-500 font-medium whitespace-nowrap">{formatWhen(row.created_at)}</div></Td>
                      <Td><div className="text-xs text-slate-600 font-mono">{row.tg_user_id}</div></Td>
                      <Td><div className="text-xs text-rose-600 font-medium">{row.error_text || '—'}</div></Td>
                    </Tr>
                  ))}
                </tbody>
              </TableShell>
            </div>
          ) : null}
        </Section>
      </Card>
    </section>
  );
}
