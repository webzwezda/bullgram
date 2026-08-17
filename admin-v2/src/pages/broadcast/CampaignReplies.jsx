import { useEffect, useState } from 'react';
import { MessageCircle, Loader2, ExternalLink, CheckCheck } from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { supabase } from '../../lib/supabase.js';
import { Card, Section, SectionTitle, EmptyNote, ErrorNote, TableShell, Th, Td, Tr, btnPrimary, btnGhost } from './ui.jsx';

function formatWhen(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function memberLabel(reply) {
  if (reply.username) return `@${reply.username}`;
  if (reply.display_name) return reply.display_name;
  return `TG ID ${reply.tg_user_id}`;
}

function minutesAgo(ts) {
  return Math.max(1, Math.round((Date.now() - ts) / 60000));
}

export function CampaignReplies({ accessToken, userbots, campaign }) {
  const [telegramWebEnabled, setTelegramWebEnabled] = useState(false);
  const [state, setState] = useState({ phase: 'idle', progress: '', replies: [], errors: [], lastScanAt: null, filter: 'unread' });

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

  // сменили рассылку — сбрасываем прошлый скан
  useEffect(() => {
    setState({ phase: 'idle', progress: '', replies: [], errors: [], lastScanAt: null, filter: 'unread' });
  }, [campaign?.id]);

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
    if (!campaign?.id) return;
    const eligible = (userbots || []).filter((row) =>
      row.runtime_status !== 'pending_activation' && !(row.proxy_id && row.proxies?.is_working === false));
    const senderIds = (campaign.meta?.sender_userbot_ids || []).map(String);
    const targets = senderIds
      .map((id) => eligible.find((row) => String(row.id) === id))
      .filter(Boolean);

    if (targets.length === 0) {
      setState((prev) => ({ ...prev, phase: 'idle', progress: '', errors: ['У этой рассылки нет живых юзерботов-отправителей — ответы проверять не у кого.'] }));
      return;
    }

    setState((prev) => ({ ...prev, phase: 'scanning', progress: 'Готовим скан...', errors: [] }));
    const replies = [];
    const errors = [];

    let recipientIds = new Set();
    try {
      recipientIds = await loadRecipientIds(campaign.id);
    } catch {
      // без списка получателей покажем все входящие диалоги
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

    setState((prev) => ({ ...prev, phase: 'done', progress: '', replies: uniqueReplies, errors, lastScanAt: Date.now() }));
  }

  async function markRead(reply) {
    try {
      await apiRequest('/api/userbot/ops-center/mark-read', {
        accessToken,
        method: 'POST',
        body: { tg_user_id: String(reply.tg_user_id), userbot_id: reply.userbot_id }
      });
      setState((prev) => ({
        ...prev,
        replies: prev.replies.map((row) =>
          row.userbot_id === reply.userbot_id && String(row.tg_user_id) === String(reply.tg_user_id)
            ? { ...row, unread_count: 0 }
            : row)
      }));
    } catch (error) {
      setState((prev) => ({ ...prev, errors: [...prev.errors, `Отметить прочитанным (${memberLabel(reply)}): ${error.message}`] }));
    }
  }

  const scanning = state.phase === 'scanning';
  const done = state.phase === 'done';
  const unreadReplies = state.replies.filter((reply) => (reply.unread_count || 0) > 0);
  const visibleReplies = state.filter === 'unread' ? unreadReplies : state.replies;
  const hasSenderIds = (campaign?.meta?.sender_userbot_ids || []).length > 0;

  return (
    <Card>
      <Section>
        <SectionTitle
          icon={MessageCircle}
          action={
            hasSenderIds ? (
              <button type="button" className={btnPrimary} disabled={scanning || !campaign?.id} onClick={checkReplies}>
                {scanning ? <><Loader2 className="w-4 h-4 animate-spin" /> {state.progress}</> : 'Проверить ответы'}
              </button>
            ) : null
          }
        >
          Ответы
        </SectionTitle>

        {!hasSenderIds ? (
          <EmptyNote>Рассылка шла от официального бота — ответы юзерботов тут не проверяем.</EmptyNote>
        ) : (
          <>
            <div className="text-sm text-slate-500 font-medium">
              Сканируем диалоги юзерботов, отправлявших эту рассылку. По умолчанию показываем только непрочитанные —
              прочитал в TG Web или пометил здесь, лид уходит из списка.
            </div>
            {state.lastScanAt ? (
              <div className="mt-2 text-xs text-slate-400 font-bold">Последняя проверка: {minutesAgo(state.lastScanAt)} мин назад</div>
            ) : null}

            {state.errors.length > 0 ? (
              <div className="mt-4 space-y-2">
                {state.errors.map((error) => <ErrorNote key={error}>{error}</ErrorNote>)}
              </div>
            ) : null}

            {done ? (
              <>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className={state.filter === 'unread' ? btnPrimary : btnGhost}
                    onClick={() => setState((prev) => ({ ...prev, filter: 'unread' }))}
                  >
                    Непрочитанные ({unreadReplies.length})
                  </button>
                  <button
                    type="button"
                    className={state.filter === 'all' ? btnPrimary : btnGhost}
                    onClick={() => setState((prev) => ({ ...prev, filter: 'all' }))}
                  >
                    Все ответы ({state.replies.length})
                  </button>
                </div>

                {visibleReplies.length === 0 ? (
                  <div className="mt-4">
                    <EmptyNote>
                      {state.filter === 'unread' ? 'Непрочитанных нет — все лиды обработаны.' : 'Ответов нет — по этой рассылке все молчат.'}
                    </EmptyNote>
                  </div>
                ) : (
                  <div className="mt-4">
                    <TableShell>
                      <thead>
                        <tr>
                          <Th>Кто</Th>
                          <Th>Сообщение</Th>
                          <Th>Юзербот</Th>
                          <Th>Действия</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleReplies.map((reply) => (
                          <Tr key={`${reply.userbot_id}:${reply.tg_user_id}`}>
                            <Td>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-slate-900">{memberLabel(reply)}</span>
                                {(reply.unread_count || 0) > 0 ? (
                                  <span className="px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-[10px] font-black">
                                    +{reply.unread_count}
                                  </span>
                                ) : null}
                              </div>
                              <div className="text-xs text-slate-500 font-mono">{reply.tg_user_id}</div>
                            </Td>
                            <Td>
                              <div className="text-xs text-slate-700 font-medium max-w-[280px] truncate">{reply.last_message_preview || '—'}</div>
                              <div className="text-xs text-slate-400 font-medium mt-1">{formatWhen(reply.last_message_at)}</div>
                            </Td>
                            <Td>
                              <div className="text-xs font-black text-slate-700">@{reply.userbot_name}</div>
                            </Td>
                            <Td>
                              <div className="flex flex-col items-start gap-1.5">
                                {telegramWebEnabled ? (
                                  <button
                                    type="button"
                                    className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-700 transition-colors"
                                    onClick={() => window.open(`/app/telegram-web/${reply.userbot_id}`, '_blank', 'noopener')}
                                  >
                                    <ExternalLink className="w-3 h-3" /> TG Web
                                  </button>
                                ) : null}
                                {(reply.unread_count || 0) > 0 ? (
                                  <button
                                    type="button"
                                    className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-700 transition-colors"
                                    onClick={() => markRead(reply)}
                                  >
                                    <CheckCheck className="w-3 h-3" /> Прочитано
                                  </button>
                                ) : null}
                              </div>
                            </Td>
                          </Tr>
                        ))}
                      </tbody>
                    </TableShell>
                    {!telegramWebEnabled ? (
                      <div className="mt-3 text-xs text-slate-400 font-medium">
                        Telegram Web выключен — включи веб-доступ на странице юзерботов, чтобы отвечать прямо отсюда.
                      </div>
                    ) : null}
                  </div>
                )}
              </>
            ) : null}
          </>
        )}
      </Section>
    </Card>
  );
}
