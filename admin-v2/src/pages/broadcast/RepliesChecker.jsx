import { useEffect, useState } from 'react';
import { MessageCircle, Loader2, ExternalLink } from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { supabase } from '../../lib/supabase.js';
import { Card, Section, SectionTitle, EmptyNote, ErrorNote, TableShell, Th, Td, Tr, btnPrimary } from './ui.jsx';

function formatWhen(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function memberLabel(reply) {
  if (reply.username) return `@${reply.username}`;
  if (reply.display_name) return reply.display_name;
  return `TG ID ${reply.tg_user_id}`;
}

export function RepliesChecker({ accessToken, userbots, campaigns, poolIds }) {
  const [telegramWebEnabled, setTelegramWebEnabled] = useState(false);
  const [state, setState] = useState({ phase: 'idle', progress: '', replies: [], errors: [] });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/userbot-web/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setTelegramWebEnabled(Boolean(data.enabled));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function loadRecipientIds(campaignId) {
    const ids = new Set();
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('broadcast_deliveries')
        .select('tg_user_id')
        .eq('campaign_id', campaignId)
        .eq('delivery_status', 'sent')
        .range(from, from + 999);
      if (error || !data || data.length === 0) break;
      for (const row of data) ids.add(String(row.tg_user_id));
      if (data.length < 1000) break;
      from += 1000;
    }
    return ids;
  }

  async function checkReplies() {
    const eligible = (userbots || []).filter((row) =>
      row.runtime_status !== 'pending_activation' && !(row.proxy_id && row.proxies?.is_working === false));
    const lastCampaign = (campaigns || [])[0];
    const senderIds = (lastCampaign?.meta?.sender_userbot_ids || []).map(String);
    const wanted = senderIds.length > 0 ? senderIds : (poolIds || []).map(String);
    const targets = wanted
      .map((id) => eligible.find((row) => String(row.id) === id))
      .filter(Boolean);

    if (targets.length === 0) {
      setState({ phase: 'idle', progress: '', replies: [], errors: ['Нет живых юзерботов для проверки ответов.'] });
      return;
    }

    setState((prev) => ({ ...prev, phase: 'scanning', progress: 'Готовим скан...', errors: [] }));
    const replies = [];
    const errors = [];

    let recipientIds = new Set();
    if (lastCampaign?.id) {
      try {
        recipientIds = await loadRecipientIds(lastCampaign.id);
      } catch {
        // без списка получателей покажем все входящие диалоги
      }
    }

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      setState((prev) => ({ ...prev, progress: `Сканируем @${target.tg_username || 'юзербот'} (${i + 1}/${targets.length})...` }));
      try {
        const data = await apiRequest(`/api/userbot/ops-center?userbot_id=${target.id}&scan=true`, { accessToken });
        // ops-center при падении выбранного юзербота может отсканить другого — верит только его ответ
        const userbotId = String(data.selected_userbot_id || target.id);
        const userbotName = data.selected_userbot_username || target.tg_username || 'юзербот';
        for (const conv of data.conversations || []) {
          if (conv.last_outgoing) continue;
          if (recipientIds.size > 0 && !recipientIds.has(String(conv.tg_user_id))) continue;
          replies.push({ ...conv, userbot_id: userbotId, userbot_name: userbotName });
        }
      } catch (error) {
        errors.push(`@${target.tg_username || target.id}: ${error.message}`);
      }
    }

    const seen = new Set();
    const uniqueReplies = replies.filter((reply) => {
      const key = `${reply.userbot_id}:${reply.tg_user_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    uniqueReplies.sort((a, b) => String(b.last_message_at || '').localeCompare(String(a.last_message_at || '')));

    setState({ phase: 'done', progress: '', replies: uniqueReplies, errors });
  }

  const scanning = state.phase === 'scanning';

  return (
    <Card>
      <Section>
        <SectionTitle icon={MessageCircle}>Ответы</SectionTitle>
        <div className="text-sm text-slate-500 font-medium">
          Сканируем диалоги юзерботов из последней рассылки: показываем людей, чьё сообщение стало последним в переписке.
        </div>
        <div className="mt-4">
          <button type="button" className={btnPrimary} disabled={scanning} onClick={checkReplies}>
            {scanning ? <><Loader2 className="w-4 h-4 animate-spin" /> {state.progress}</> : 'Проверить ответы'}
          </button>
        </div>
        {state.errors.length > 0 ? (
          <div className="mt-4 space-y-2">
            {state.errors.map((error) => <ErrorNote key={error}>{error}</ErrorNote>)}
          </div>
        ) : null}
        {state.phase === 'done' ? (
          state.replies.length === 0 ? (
            <div className="mt-4"><EmptyNote>Ответов нет — по последней рассылке все молчат.</EmptyNote></div>
          ) : (
            <div className="mt-4">
              <TableShell>
                <thead>
                  <tr>
                    <Th>Кто</Th>
                    <Th>Сообщение</Th>
                    <Th>Юзербот</Th>
                  </tr>
                </thead>
                <tbody>
                  {state.replies.map((reply) => (
                    <Tr key={`${reply.userbot_id}:${reply.tg_user_id}`}>
                      <Td>
                        <div className="text-sm font-bold text-slate-900">{memberLabel(reply)}</div>
                        <div className="text-xs text-slate-500 font-mono">{reply.tg_user_id}</div>
                      </Td>
                      <Td>
                        <div className="text-xs text-slate-700 font-medium max-w-[280px] truncate">{reply.last_message_preview || '—'}</div>
                        <div className="text-xs text-slate-400 font-medium mt-1">{formatWhen(reply.last_message_at)}</div>
                      </Td>
                      <Td>
                        <div className="text-xs font-black text-slate-700">@{reply.userbot_name}</div>
                        {telegramWebEnabled ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-700 mt-1 transition-colors"
                            onClick={() => window.open(`/app/telegram-web/${reply.userbot_id}`, '_blank', 'noopener')}
                          >
                            <ExternalLink className="w-3 h-3" /> Telegram Web
                          </button>
                        ) : null}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </TableShell>
              {!telegramWebEnabled ? (
                <div className="mt-3 text-xs text-slate-400 font-medium">
                  Telegram Web выключен — ответить можно из приложения или включить веб-доступ на странице юзерботов.
                </div>
              ) : null}
            </div>
          )
        ) : null}
      </Section>
    </Card>
  );
}
