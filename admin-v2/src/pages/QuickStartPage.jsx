import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Eye, EyeOff, Loader2, Pause, Play, RefreshCcw, Save, Trash2, Zap, Copy, Plus, Lock, Globe, Shield, UserPlus, Clock, AlertTriangle, Settings, RefreshCw, Unlink, Bot, Code, FileText, Key, Layout, Inbox, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { Button } from '../components/ui/button.jsx';
import { Card } from '../components/ui/card.jsx';
import { Input } from '../components/ui/input.jsx';
import { Textarea } from '../components/ui/textarea.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select.jsx';
import { supabase } from '../lib/supabase.js';
import { CodeBlock } from '../ui/CodeBlock.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';
import {
    fetchChannels,
    patchBot,
    regenerateInvite,
    fetchAdmins,
    initBot,
    patchChannel,
    unlinkChannel,
    refreshChannel,
    addAdmin,
    removeAdmin,
    deleteBot,
    fetchChecklists,
    createChecklist,
    getChecklistState,
    cancelChecklist
} from './autopost/api.js';

function maskBotToken(value) {
  const t = String(value || '');
  const idx = t.indexOf(':');
  if (idx === -1) return '••••••••';
  return `${t.slice(0, idx)}:${'•'.repeat(8)}${t.slice(-4)}`;
}

function maskInvite(value) {
  const t = String(value || '');
  const idx = t.indexOf('?start=');
  if (idx === -1) return t;
  return `${t.slice(0, idx + 7)}${'•'.repeat(8)}`;
}

const AUTOPOST_POST_CURL = `curl -X POST \\
https://bullgram.xyz/api/external/v1/autopost/bots/{bot_id}/posts \\
-H "Authorization: Bearer brapi_..." \\
-H "Content-Type: application/json" \\
-d '{"target_channel_ids":["-100111","-100222"],"caption":"Hello","publish_now":true}'`;

function parseReactionEmojis(value) {
  // VS16 (U+FE0F) вырезаем: в БД/Telegram хранится каноничное '❤', без селектора.
  return String(value || '').split(',').map(s => s.trim().replace(/\uFE0F/g, '')).filter(Boolean);
}

// Статус чек-листа — вычисляемая строка с бэка (active/expired/cancelled),
// здесь только человекочитаемая метка + цвет из feedback-пары токенов.
const CHECKLIST_STATUS_META = {
  active: { label: 'Активен', className: 'bg-feedback-success-bg text-feedback-success-text' },
  expired: { label: 'Истёк', className: 'bg-feedback-warning-bg text-feedback-warning-text' },
  cancelled: { label: 'Закрыт', className: 'bg-feedback-info-bg text-feedback-info-text' }
};

function splitChecklistLines(value) {
  return String(value || '').split('\n').map((s) => s.trim()).filter(Boolean);
}

function formatChecklistTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function QuickStartPage() {
  const { user, accessToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [selectedBotId, setSelectedBotId] = useState('new');
  const [botToken, setBotToken] = useState('');
  
  // Bot settings states
  const [existingBots, setExistingBots] = useState([]);
  // Зеркало existingBots для эффекта выбора бота: эффект должен срабатывать
  // только при смене выбранного бота, а не на каждое обновление списка.
  const existingBotsRef = useRef([]);
  // Защита от гонки (прецедент CustomersPage): ответ loadChannels/loadAdmins,
  // пришедший после переключения на другого бота, не должен перезаписать стейт
  // чужими каналами/админами.
  const loadChannelsReqIdRef = useRef(0);
  const loadAdminsReqIdRef = useRef(0);
  const confirmCancelRef = useRef(null);
  const [createdBot, setCreatedBot] = useState(null);
  const [channels, setChannels] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [inviteLink, setInviteLink] = useState('');
  const [tokenRevealed, setTokenRevealed] = useState(false);
  const [inviteRevealed, setInviteRevealed] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  
  // Modals & Action loading states
  const [initing, setIniting] = useState(false);
  const [savingChannel, setSavingChannel] = useState({});
  const [unlinkingChannel, setUnlinkingChannel] = useState({});
  const [refreshingChannel, setRefreshingChannel] = useState({});
  const [addingAdmin, setAddingAdmin] = useState(false);
  const [newAdminTgId, setNewAdminTgId] = useState('');

  // Active channel UUID for config panel (null when no channels connected).
  // Таб больше не 'public'/'private' — каналов может быть N любого visibility.
  const [activeChannelId, setActiveChannelId] = useState(null);

  // Раскрытая инструкция под slot-карточкой «Подключить ещё канал».
  const [showAddChannelHint, setShowAddChannelHint] = useState(false);

  // Configs for channels — keyed by channel UUID (supports N channels per bot,
  // включая несколько public или несколько private).
  const [channelConfigs, setChannelConfigs] = useState({});

  // Чек-листы: список активных + состояние (items/summary) по каждому —
  // прогрес «X из M» и отметки живут в state-ручке, поэтому тянем её по каждому списку.
  const [checklists, setChecklists] = useState([]);
  const [checklistStates, setChecklistStates] = useState({});
  const [checklistsLoading, setChecklistsLoading] = useState(false);
  const [checklistsError, setChecklistsError] = useState(null);
  const [expandedChecklistId, setExpandedChecklistId] = useState(null);
  const [refreshingChecklist, setRefreshingChecklist] = useState({});
  const [cancellingChecklist, setCancellingChecklist] = useState({});
  const [showChecklistForm, setShowChecklistForm] = useState(false);
  const [checklistTitle, setChecklistTitle] = useState('');
  const [checklistItemsText, setChecklistItemsText] = useState('');
  const [checklistChannelIds, setChecklistChannelIds] = useState([]);
  const [checklistExpiresAt, setChecklistExpiresAt] = useState('');
  const [checklistDedupKey, setChecklistDedupKey] = useState('');
  const [creatingChecklist, setCreatingChecklist] = useState(false);
  const checklistReqIdRef = useRef(0);
  const checklistRefreshTimerRef = useRef(null);

  // Загрузка существующих ботов
  const loadBots = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { data } = await supabase
        .from('autopost_bots')
        .select('*')
        .eq('owner_id', user.id)
        .order('created_at', { ascending: false });
      existingBotsRef.current = data || [];
      setExistingBots(data || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadBots();
  }, [loadBots]);

  // При выборе существующего бота — загрузить его настройки.
  // Эффект зависим только от selectedBotId: список ботов читаем через ref,
  // чтобы loadBots() посреди сессии (например, после паузы) не сбрасывал
  // раскрытие токена/ссылки и не перезагружал каналы и админов.
  useEffect(() => {
    if (selectedBotId === 'new') {
      setTokenRevealed(false);
      setInviteRevealed(false);
      setBotToken('');
      setChannels([]);
      setAdmins([]);
      setInviteLink('');
      setCreatedBot(null);
      setActiveChannelId(null);
      setChannelConfigs({});
      setChecklists([]);
      setChecklistStates({});
      setChecklistsError(null);
      setExpandedChecklistId(null);
      setShowChecklistForm(false);
      setChecklistChannelIds([]);
      return;
    }

    const bot = existingBotsRef.current.find((b) => b.id === selectedBotId);
    if (!bot) return;

    setTokenRevealed(false);
    setInviteRevealed(false);
    setBotToken(bot.bot_token || '');
    setCreatedBot({ id: bot.id, bot_username: bot.username });
    setChecklistChannelIds([]);

    loadChannels(bot.id);
    loadAdmins(bot.id);
  }, [selectedBotId, accessToken]);

  async function loadChannels(botId, { merge = false } = {}) {
    const reqId = ++loadChannelsReqIdRef.current;
    try {
      const data = await fetchChannels(botId, accessToken);
      if (reqId !== loadChannelsReqIdRef.current) return;
      if (!data.channels) return;
      setChannels(data.channels);
      if (merge) {
        mergeChannelsIntoConfig(data.channels);
      } else {
        applyChannelsToConfig(data.channels);
      }
    } catch (e) {
      if (reqId !== loadChannelsReqIdRef.current) return;
      console.error(e);
    }
  }

  function mapChannelRow(row) {
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow';
    return {
      id: row?.id || null,
      tgChatId: row?.tg_chat_id || null,
      title: row?.title || '',
      username: row?.username || null,
      visibility: row?.visibility || null,
      postsPerDay: String(row?.posts_per_day || 1),
      postingTimes: row?.posting_times || ['10:00'],
      autoAccept: row?.auto_accept_suggestions || false,
      buttons: row?.buttons_config || [],
      timezone: row?.timezone || browserTz,
      suggestionPostingTimes: row?.suggestion_posting_times || ['12:00'],
      suggestButtonEnabled: row?.suggest_button_enabled || false,
      maxSuggestionsPerDay: row?.max_suggestions_per_day !== undefined ? row.max_suggestions_per_day : 5,
      seedReactionEmoji: row?.seed_reaction_emoji || null,
      seedReactionPremium: row?.seed_reaction_premium === true,
      discussionForwardEnabled: row?.discussion_forward_enabled === true,
      linkedChatId: row?.linked_chat_id ?? null
    };
  }

  function applyChannelsToConfig(channelsList) {
    const next = {};
    for (const ch of channelsList) next[ch.id] = mapChannelRow(ch);
    setChannelConfigs(next);
    setActiveChannelId(prev => {
      if (prev && next[prev]) return prev;
      return channelsList[0]?.id || null;
    });
  }

  // Realtime-merge: сохраняем отредактированные пользователем поля (поля,
  // которые ещё не сохранены в БД). Добавляем новые каналы, убираем отвязанные.
  function mergeChannelsIntoConfig(channelsList) {
    setChannelConfigs(prev => {
      const next = {};
      for (const ch of channelsList) {
        next[ch.id] = prev[ch.id]?.id ? prev[ch.id] : mapChannelRow(ch);
      }
      return next;
    });
    setActiveChannelId(prev => {
      const stillThere = prev && channelsList.some(c => c.id === prev);
      return stillThere ? prev : (channelsList[0]?.id || null);
    });
  }

  async function loadAdmins(botId) {
    const reqId = ++loadAdminsReqIdRef.current;
    try {
      const data = await fetchAdmins(botId, accessToken);
      if (reqId !== loadAdminsReqIdRef.current) return;
      if (data.admin_tg_ids) {
        setAdmins(data.admin_tg_ids);
        setInviteLink(data.invite_link || '');
      }
    } catch (e) {
      if (reqId !== loadAdminsReqIdRef.current) return;
      console.error(e);
    }
  }

  // --- Чек-листы ---

  // Грузим активные списки и по каждому — состояние (пункты/прогресс/summary).
  // Списки короткие (семейный масштаб), поэтому N параллельных state-запросов
  // дешевле отдельного агрегата на бэке.
  async function loadChecklists(botId) {
    if (!botId) return;
    const reqId = ++checklistReqIdRef.current;
    setChecklistsLoading(true);
    setChecklistsError(null);
    try {
      const data = await fetchChecklists(botId, { status: 'active' }, accessToken);
      if (reqId !== checklistReqIdRef.current) return;
      const rows = data.items || [];
      setChecklists(rows);
      const states = await Promise.all(
        rows.map((row) => getChecklistState(botId, row.id, accessToken).catch(() => null))
      );
      if (reqId !== checklistReqIdRef.current) return;
      const next = {};
      rows.forEach((row, i) => { if (states[i]) next[row.id] = states[i]; });
      setChecklistStates(next);
    } catch (e) {
      if (reqId !== checklistReqIdRef.current) return;
      setChecklistsError(e.message);
    } finally {
      if (reqId === checklistReqIdRef.current) setChecklistsLoading(false);
    }
  }

  // Загрузка при выборе бота. Очищаем прошлые данные сразу, чтобы после
  // переключения бота не мигнули чужие списки.
  useEffect(() => {
    const botId = createdBot?.id;
    if (selectedBotId === 'new' || !botId) return;
    setChecklists([]);
    setChecklistStates({});
    setChecklistsError(null);
    setExpandedChecklistId(null);
    loadChecklists(botId);
  }, [selectedBotId, createdBot?.id]);

  function toggleChecklistChannel(tgChatId) {
    setChecklistChannelIds((prev) =>
      prev.includes(tgChatId) ? prev.filter((id) => id !== tgChatId) : [...prev, tgChatId]
    );
  }

  // Создание: клиентская проверка зеркалит капы бэка (1–25 пунктов, 1–100
  // символов, заголовок ≤200, dedup_key ≤128), чтобы не гонять заведомо невалидный
  // запрос и показать ошибку сразу.
  async function handleCreateChecklist() {
    if (!createdBot?.id || creatingChecklist) return;
    const title = checklistTitle.trim();
    const items = splitChecklistLines(checklistItemsText);
    if (title.length > 200) {
      toast.error('Заголовок длиннее 200 символов');
      return;
    }
    if (items.length < 1) {
      toast.error('Нужен хотя бы один пункт — по одному в строке');
      return;
    }
    if (items.length > 25) {
      toast.error(`Максимум 25 пунктов (сейчас ${items.length})`);
      return;
    }
    const tooLong = items.find((t) => t.length > 100);
    if (tooLong) {
      toast.error(`Пункт «${tooLong.slice(0, 30)}…» длиннее 100 символов`);
      return;
    }
    if (checklistChannelIds.length === 0) {
      toast.error('Выберите хотя бы один канал');
      return;
    }
    const dedupKey = checklistDedupKey.trim();
    if (dedupKey.length > 128) {
      toast.error('dedup_key длиннее 128 символов');
      return;
    }
    setCreatingChecklist(true);
    try {
      await createChecklist(createdBot.id, {
        title,
        items,
        channelIds: checklistChannelIds,
        expiresAt: checklistExpiresAt ? new Date(checklistExpiresAt).toISOString() : undefined,
        dedupKey: dedupKey || undefined
      }, accessToken);
      toast.success('Список создан — уйдёт в выбранные каналы по ближайшему слоту');
      setChecklistTitle('');
      setChecklistItemsText('');
      setChecklistChannelIds([]);
      setChecklistExpiresAt('');
      setChecklistDedupKey('');
      setShowChecklistForm(false);
      loadChecklists(createdBot.id);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCreatingChecklist(false);
    }
  }

  // «Обновить» — перечитать состояние одного списка: прогресс, отметки, summary.
  async function handleRefreshChecklist(checklistId) {
    if (!createdBot?.id || refreshingChecklist[checklistId]) return;
    setRefreshingChecklist((prev) => ({ ...prev, [checklistId]: true }));
    try {
      const state = await getChecklistState(createdBot.id, checklistId, accessToken);
      setChecklistStates((prev) => ({ ...prev, [checklistId]: state }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRefreshingChecklist((prev) => ({ ...prev, [checklistId]: false }));
    }
  }

  function toggleChecklistExpand(row) {
    setExpandedChecklistId((prev) => (prev === row.id ? null : row.id));
    // Состояние не доехало при загрузке списка — дотягиваем при раскрытии.
    if (!checklistStates[row.id] && createdBot?.id) {
      handleRefreshChecklist(row.id);
    }
  }

  function askCloseChecklist(row) {
    if (!createdBot?.id) return;
    askConfirm({
      title: 'Закрыть чек-лист',
      description: `«${row.title || 'Без названия'}»: кнопки в Telegram снимутся, неопубликованные строки уйдут из очереди. Отметки останутся в истории.`,
      actionLabel: 'Закрыть',
      danger: true,
      onConfirm: () => doCloseChecklist(row.id)
    });
  }

  async function doCloseChecklist(checklistId) {
    if (!createdBot?.id) return;
    setCancellingChecklist((prev) => ({ ...prev, [checklistId]: true }));
    try {
      await cancelChecklist(createdBot.id, checklistId, accessToken);
      toast.success('Чек-лист закрыт');
      if (expandedChecklistId === checklistId) setExpandedChecklistId(null);
      loadChecklists(createdBot.id);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCancellingChecklist((prev) => ({ ...prev, [checklistId]: false }));
    }
  }

  // Realtime-подписка: канал подключён/отключён, либо обновился список админов.
  // Заменяет setInterval-поллинг. Инициальная загрузка — в useEffect выбора бота.
  useEffect(() => {
    const botId = createdBot?.id;
    if (selectedBotId === 'new' || !botId) return;

    const channel = supabase
      .channel(`autopost-bot-${botId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'channels', filter: `autopost_bot_id=eq.${botId}` },
        () => { loadChannels(botId, { merge: true }); }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'autopost_bots', filter: `id=eq.${botId}` },
        () => { loadAdmins(botId); }
      )
      // События autopost_items пока не требуют действий на странице,
      // подписка оставлена на будущее.
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'autopost_items', filter: `bot_id=eq.${botId}` },
        () => {}
      )
      // Тапы семьи по пунктам в Telegram: лёгкий refetch списка с дебаунсом,
      // чтобы серия кликов не превратилась в серию запросов.
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'autopost_checklist_items', filter: `bot_id=eq.${botId}` },
        () => {
          if (checklistRefreshTimerRef.current) clearTimeout(checklistRefreshTimerRef.current);
          checklistRefreshTimerRef.current = setTimeout(() => {
            checklistRefreshTimerRef.current = null;
            loadChecklists(botId);
          }, 800);
        }
      )
      .subscribe();

    return () => {
      if (checklistRefreshTimerRef.current) {
        clearTimeout(checklistRefreshTimerRef.current);
        checklistRefreshTimerRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [createdBot?.id, selectedBotId, accessToken]);

  // Подключение бота (валидация токена + создание)
  async function handleConnect() {
    if (!botToken.trim() || initing) return;
    setIniting(true);
    try {
      const data = await initBot({ botToken: botToken.trim() }, accessToken);

      setCreatedBot({ id: data.bot.id, bot_username: data.bot.username });
      existingBotsRef.current = [...existingBotsRef.current, data.bot];
      setExistingBots((prev) => [...prev, data.bot]);
      setSelectedBotId(data.bot.id);
      toast.success('Бот успешно инициализирован! Теперь активируйте его в Telegram.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setIniting(false);
    }
  }

  // Сохранить настройки конкретного канала
  async function handleSaveChannelConfig(channelId) {
    const config = channelConfigs[channelId];
    if (!config.id || !createdBot?.id) return;

    setSavingChannel(prev => ({ ...prev, [channelId]: true }));
    try {
      const sortedPostingTimes = [...new Set(config.postingTimes || ['10:00'])].sort();
      const sortedSuggestionTimes = [...new Set(config.suggestionPostingTimes || ['12:00'])].sort();

      const data = await patchChannel(createdBot.id, config.id, {
        auto_accept_suggestions: config.autoAccept,
        buttons_config: config.buttons,
        posts_per_day: sortedPostingTimes.length,
        posting_times: sortedPostingTimes,
        timezone: config.timezone,
        suggestion_posts_per_day: sortedSuggestionTimes.length,
        suggestion_posting_times: sortedSuggestionTimes,
        suggest_button_enabled: config.suggestButtonEnabled,
        max_suggestions_per_day: Number(config.maxSuggestionsPerDay !== '' ? config.maxSuggestionsPerDay : 5),
        seed_reaction_emoji: config.seedReactionEmoji || null,
        seed_reaction_premium: config.seedReactionPremium === true,
        // Форвард постов в привязанную группу обсуждений. На этом PATCH бэкенд
        // перепроверяет linked_chat: если группы нет или бота в ней нет —
        // отвечает 400, сообщение показывается в toast как есть.
        discussion_forward_enabled: config.discussionForwardEnabled === true
      }, accessToken);

      setChannelConfigs(prev => ({
        ...prev,
        [channelId]: {
          ...prev[channelId],
          postingTimes: sortedPostingTimes,
          suggestionPostingTimes: sortedSuggestionTimes,
          suggestButtonEnabled: config.suggestButtonEnabled,
          maxSuggestionsPerDay: config.maxSuggestionsPerDay !== '' ? config.maxSuggestionsPerDay : 5,
          seedReactionEmoji: config.seedReactionEmoji || null,
          seedReactionPremium: config.seedReactionPremium === true,
          discussionForwardEnabled: config.discussionForwardEnabled === true,
          // linked_chat может разрешиться на бэкенде во время этого же PATCH —
          // берём свежий из ответа, иначе оставляем прошлое значение.
          linkedChatId: data?.channel && data.channel.linked_chat_id !== undefined
            ? (data.channel.linked_chat_id ?? null)
            : prev[channelId].linkedChatId
        }
      }));

      toast.success(`Настройки канала "${config.title}" успешно сохранены`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingChannel(prev => ({ ...prev, [channelId]: false }));
    }
  }

  // Диалог подтверждения: askConfirm показывает модалку и возвращает Promise<boolean>.
  // Кнопки модалки разрешают промис: подтверждение — true, отмена — false.
  function askConfirm(state) {
    return new Promise((resolve) => {
      setConfirmState({ ...state, resolve });
    });
  }

  function closeConfirm(result) {
    if (!confirmState) return;
    confirmState.resolve(result);
    setConfirmState(null);
  }

  // Esc закрывает диалог как отмену; заодно авто-фокус на «Отмена» при открытии
  useEffect(() => {
    if (!confirmState) return;
    confirmCancelRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') closeConfirm(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmState]);

  // Отвязать канал от автопостера (только в Bullgram, бот остаётся админом в Telegram)
  function askUnlinkChannel(channelId) {
    const cfg = channelConfigs[channelId];
    if (!cfg.id || !createdBot?.id) return;
    askConfirm({
      title: 'Отвязать канал',
      description: `Канал «${cfg.title}» будет отвязан от автопостера. Бот останется админом в Telegram — канал можно привязать заново без повторного добавления.`,
      actionLabel: 'Отвязать',
      onConfirm: () => doUnlinkChannel(channelId)
    });
  }

  async function doUnlinkChannel(channelId) {
    const cfg = channelConfigs[channelId];
    if (!cfg.id || !createdBot?.id) return;
    setUnlinkingChannel(prev => ({ ...prev, [channelId]: true }));
    try {
      await unlinkChannel(createdBot.id, cfg.id, accessToken);
      toast.success(`Канал "${cfg.title}" отвязан`);
      // UI обновится через realtime
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUnlinkingChannel(prev => ({ ...prev, [channelId]: false }));
    }
  }

  // Обновить метаданные канала из Telegram (title, username, visibility).
  // Если бот больше не админ — бэкенд авто-отвяжет канал.
  async function handleRefreshChannel(channelId) {
    const cfg = channelConfigs[channelId];
    if (!cfg.id || !createdBot?.id) return;

    setRefreshingChannel(prev => ({ ...prev, [channelId]: true }));
    try {
      const data = await refreshChannel(createdBot.id, cfg.id, accessToken);
      if (data.unbound) {
        toast.error(`Канал отвязан: ${data.reason}`);
      } else {
        toast.success(`Данные канала обновлены`);
      }
      // UI обновится через realtime
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRefreshingChannel(prev => ({ ...prev, [channelId]: false }));
    }
  }

  // Добавить администратора вручную
  async function handleAddAdmin() {
    if (!newAdminTgId.trim() || addingAdmin || !createdBot?.id) return;
    setAddingAdmin(true);
    try {
      const data = await addAdmin(createdBot.id, newAdminTgId.trim(), accessToken);

      setAdmins(data.admin_tg_ids || []);
      setNewAdminTgId('');
      toast.success('Администратор добавлен');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAddingAdmin(false);
    }
  }

  // Удалить администратора
  function askRemoveAdmin(tgId) {
    askConfirm({
      title: 'Удалить администратора',
      description: `Администратор ${tgId} потеряет доступ к постам и модерации.`,
      actionLabel: 'Удалить',
      danger: true,
      onConfirm: () => doRemoveAdmin(tgId)
    });
  }

  async function doRemoveAdmin(tgId) {
    try {
      const data = await removeAdmin(createdBot.id, tgId, accessToken);

      setAdmins(data.admin_tg_ids || []);
      toast.success('Администратор удален из списка');
    } catch (err) {
      toast.error(err.message);
    }
  }

  // Удалить бота
  function askDelete() {
    askConfirm({
      title: 'Удалить бота',
      description: 'Бот и все связанные каналы и посты будут удалены навсегда. Отменить это нельзя.',
      actionLabel: 'Удалить навсегда',
      danger: true,
      onConfirm: () => doDelete()
    });
  }

  async function doDelete() {
    try {
      await deleteBot(createdBot.id, accessToken);

      existingBotsRef.current = existingBotsRef.current.filter((b) => b.id !== createdBot.id);
      setExistingBots((prev) => prev.filter((b) => b.id !== createdBot.id));
      setSelectedBotId('new');
      toast.success('Бот удалён');
    } catch (err) {
      toast.error(err.message);
    }
  }

  // Копирование инвайт-ссылки в буфер обмена
  function handleCopyInvite() {
    if (!inviteLink) return;
    navigator.clipboard.writeText(inviteLink)
      .then(() => toast.success('Ссылка скопирована в буфер обмена'))
      .catch(() => toast.error('Не удалось скопировать ссылку.'));
  }

  // Изменение кнопок
  const handleAddButton = (channelId) => {
    setChannelConfigs(prev => {
      const ch = prev[channelId];
      return {
        ...prev,
        [channelId]: {
          ...ch,
          buttons: [...ch.buttons, { text: '', url: '' }]
        }
      };
    });
  };

  const handleRemoveButton = (channelId, index) => {
    setChannelConfigs(prev => {
      const ch = prev[channelId];
      return {
        ...prev,
        [channelId]: {
          ...ch,
          buttons: ch.buttons.filter((_, i) => i !== index)
        }
      };
    });
  };

  const handleButtonChange = (channelId, index, field, val) => {
    setChannelConfigs(prev => {
      const ch = prev[channelId];
      const newButtons = [...ch.buttons];
      newButtons[index] = { ...newButtons[index], [field]: val };
      return {
        ...prev,
        [channelId]: {
          ...ch,
          buttons: newButtons
        }
      };
    });
  };

  // Изменение времени публикаций
  const handleAddPostingTime = (channelId) => {
    setChannelConfigs(prev => {
      const ch = prev[channelId];
      const currentTimes = ch.postingTimes || ['10:00'];
      const freeSlot = ['12:00', '15:00', '18:00', '09:00', '21:00', '06:00'].find(t => !currentTimes.includes(t)) || '00:00';
      return {
        ...prev,
        [channelId]: {
          ...ch,
          postingTimes: [...currentTimes, freeSlot]
        }
      };
    });
  };

  const handleRemovePostingTime = (channelId, index) => {
    setChannelConfigs(prev => {
      const ch = prev[channelId];
      const currentTimes = ch.postingTimes || ['10:00'];
      if (currentTimes.length <= 1) {
        toast.error('Должно быть выбрано хотя бы одно время публикации');
        return prev;
      }
      return {
        ...prev,
        [channelId]: {
          ...ch,
          postingTimes: currentTimes.filter((_, i) => i !== index)
        }
      };
    });
  };

  const handlePostingTimeChange = (channelId, index, val) => {
    setChannelConfigs(prev => {
      const ch = prev[channelId];
      const newTimes = [...(ch.postingTimes || ['10:00'])];
      newTimes[index] = val;
      return {
        ...prev,
        [channelId]: {
          ...ch,
          postingTimes: newTimes
        }
      };
    });
  };

  // Изменение времени публикаций для предложений
  const handleAddSuggestionTime = (channelId) => {
    setChannelConfigs(prev => {
      const ch = prev[channelId];
      const currentTimes = ch.suggestionPostingTimes || ['12:00'];
      const freeSlot = ['15:00', '18:00', '21:00', '09:00'].find(t => !currentTimes.includes(t)) || '00:00';
      return {
        ...prev,
        [channelId]: {
          ...ch,
          suggestionPostingTimes: [...currentTimes, freeSlot]
        }
      };
    });
  };

  const handleRemoveSuggestionTime = (channelId, index) => {
    setChannelConfigs(prev => {
      const ch = prev[channelId];
      const currentTimes = ch.suggestionPostingTimes || ['12:00'];
      if (currentTimes.length <= 1) {
        toast.error('Должно быть выбрано хотя бы одно время публикации предложений');
        return prev;
      }
      return {
        ...prev,
        [channelId]: {
          ...ch,
          suggestionPostingTimes: currentTimes.filter((_, i) => i !== index)
        }
      };
    });
  };

  const handleSuggestionTimeChange = (channelId, index, val) => {
    setChannelConfigs(prev => {
      const ch = prev[channelId];
      const newTimes = [...(ch.suggestionPostingTimes || ['12:00'])];
      newTimes[index] = val;
      return {
        ...prev,
        [channelId]: {
          ...ch,
          suggestionPostingTimes: newTimes
        }
      };
    });
  };

  async function togglePause() {
    if (!createdBot?.id) return;
    setPausing(true);
    try {
      await patchBot(createdBot.id, { is_active: !botPaused }, accessToken);
      await loadBots();
      toast.success(botPaused ? 'Бот возобновлён.' : 'Бот поставлен на паузу.');
    } catch (err) {
      toast.error(err.message || 'Не удалось изменить состояние бота.');
    } finally {
      setPausing(false);
    }
  }

  if (loading) return <LoadingState text="Загружаем автопостер..." />;

  // Определяем шаги онбординга
  const hasAdmin = admins.length > 0;
  const hasChannels = channels.length > 0;
  const selectedBot = existingBots.find((b) => String(b.id) === String(selectedBotId)) || null;
  const botPaused = selectedBot ? selectedBot.is_active === false : false;
  const TIMEZONES = ['Europe/Moscow', 'Europe/Kaliningrad', 'Europe/Samara', 'Asia/Yekaterinburg', 'Asia/Omsk', 'Asia/Krasnoyarsk', 'Asia/Irkutsk', 'Asia/Yakutsk', 'Asia/Vladivostok', 'Asia/Magadan', 'Asia/Kamchatka', 'UTC'];

  return (
    <section className="page page--flush space-y-6">
      {/* Подключение бота */}
      <Card className="p-0 gap-0 border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
        <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex flex-row items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
                <Zap className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">Бот автопостинга</h2>
                {selectedBotId === 'new' ? (
                  <p className="text-sm font-medium text-slate-500 mt-0.5">
                    Подключите Telegram-бота для автоматического постинга и приёма предложений
                  </p>
                ) : null}
              </div>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            {selectedBotId !== 'new' ? (
              <Button
                variant="outline"
                size="sm"
                className="h-10 rounded-xl font-semibold"
                type="button"
                onClick={togglePause}
                disabled={pausing}
              >
                {botPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                {botPaused ? 'Возобновить' : 'Пауза'}
              </Button>
            ) : null}
            {existingBots.length > 0 ? (
              <Select value={selectedBotId} onValueChange={setSelectedBotId}>
                <SelectTrigger className="h-10 w-[240px] bg-white rounded-xl border-slate-200 shadow-sm text-sm font-semibold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="new" className="rounded-lg"><Plus className="h-4 w-4 inline mr-1 -mt-0.5" />Подключить нового</SelectItem>
                  {existingBots.map((b) => (
                    <SelectItem key={b.id} value={b.id} className="rounded-lg">
                      @{b.username || 'Telegram Bot'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            </div>
          </div>
        </div>
        <div className="p-5 sm:p-6 space-y-4">
          <div className="flex flex-col md:flex-row items-end gap-4">
            <div className="flex-1 w-full">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 block">Токен бота</label>
              <div className="relative">
                <Input
                  value={selectedBotId === 'new' ? botToken : (tokenRevealed ? botToken : maskBotToken(botToken))}
                  onChange={selectedBotId === 'new' ? (e) => setBotToken(e.target.value) : undefined}
                  readOnly={selectedBotId !== 'new'}
                  placeholder="123456:ABC-DEF..."
                  spellCheck="false"
                  className={`font-mono h-11 rounded-xl border-slate-200 shadow-sm focus-visible:ring-indigo-500 pr-20 ${selectedBotId !== 'new' ? 'bg-slate-50 text-slate-500' : 'bg-white'}`}
                />
                {selectedBotId !== 'new' && botToken ? (
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700 transition-colors"
                    onClick={() => setTokenRevealed((v) => !v)}
                    aria-label={tokenRevealed ? 'Скрыть токен' : 'Показать токен'}
                    title={tokenRevealed ? 'Скрыть токен' : 'Показать токен'}
                  >
                    {tokenRevealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                ) : null}
              </div>
            </div>
            <div className="flex gap-2 w-full md:w-auto">
              {selectedBotId === 'new' ? (
                <Button
                  onClick={handleConnect}
                  disabled={!botToken.trim() || initing}
                  className="h-11 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold disabled:shadow-none disabled:bg-slate-100 disabled:text-slate-400 w-full md:w-auto"
                >
                  {initing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Инициализация...</> : 'Подключить'}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  onClick={askDelete}
                  className="h-11 px-4 rounded-xl text-rose-600 hover:bg-rose-50 font-bold border border-rose-100 w-full md:w-auto"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Удалить бота
                </Button>
              )}
              <Button variant="outline" asChild className="h-11 rounded-xl text-slate-700 border-slate-200 shadow-sm font-semibold">
                <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="flex items-center gap-2">
                  @BotFather <ExternalLink className="w-4 h-4" />
                </a>
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* Что это за бот — показываем там же, где и API-блок, перед ним */}
      {selectedBotId === 'new' && (
        <Card className="p-0 gap-0 border-0 shadow-sm ring-1 ring-slate-200/60 bg-white overflow-hidden rounded-2xl">
          <div className="p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
                <Bot className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold text-slate-900">Что это за бот</h3>
                <p className="text-sm text-slate-600 mt-1 leading-relaxed max-w-[70ch]">
                  Telegram-бот, который ведёт ваши каналы за вас: сам публикует посты по расписанию,
                  принимает предложения от подписчиков и ставит реакции на новые посты.
                  Один бот может вести несколько каналов — всё управление здесь, на этом экране.
                </p>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {['Постинг по расписанию', 'Приём предложений', 'Автореакции и кнопки'].map(chip => (
                    <span key={chip} className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 text-xs font-semibold">
                      {chip}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Заметка про API — показываем, когда в селекторе выбрано «создать нового».
          Свёрнута по умолчанию: инженерный контент не должен стоять между админом и токеном */}
      {selectedBotId === 'new' && (
        <details className="group rounded-2xl shadow-sm ring-1 ring-slate-200/60 bg-white overflow-hidden">
          <summary className="p-5 sm:p-6 cursor-pointer select-none flex items-center gap-3 list-none [&::-webkit-details-marker]:hidden">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
              <Code className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-bold text-slate-900">Интеграции и API</h3>
              <p className="text-xs text-slate-500 mt-0.5 max-w-[70ch]">
                Публикация постов из n8n, Zapier или скриптов — для автоматизации. Разверните, если нужно.
              </p>
            </div>
            <ChevronDown className="w-4 h-4 text-slate-400 shrink-0 transition-transform group-open:rotate-180" />
          </summary>
          <div className="px-5 sm:px-6 pb-5 sm:pb-6 pt-4 space-y-3 border-t border-slate-100">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-bold text-slate-900">Публикация через API</h3>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed max-w-[70ch]">
                  Из n8n, Zapier или скриптов. Кнопки и автореакция наследуются из настроек канала.
                  Нужен токен <code className="font-mono text-[11px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">brapi_</code> со скоупом <code className="font-mono text-[11px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">api:autopost:write</code>.
                </p>
              </div>
            </div>

            <CodeBlock
              label="POST /autopost/bots/{bot_id}/posts"
              value={AUTOPOST_POST_CURL}
            />

            <p className="text-xs text-slate-500 leading-relaxed max-w-[70ch]">
              Чтобы узнать <code className="font-mono text-[11px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">bot_id</code> и <code className="font-mono text-[11px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">target_channel_ids</code>:{' '}
              <code className="font-mono text-[11px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">GET /autopost/bots</code>, затем{' '}
              <code className="font-mono text-[11px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">GET /autopost/bots/{'{bot_id}'}/channels</code>.
            </p>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button asChild variant="outline" size="sm" className="h-8 rounded-lg text-xs font-semibold border-slate-200 bg-white shadow-sm">
                <a href="/api/external/v1/docs" target="_blank" rel="noreferrer" className="flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" />
                  API-документация
                </a>
              </Button>
              <Button asChild variant="outline" size="sm" className="h-8 rounded-lg text-xs font-semibold border-slate-200 bg-white shadow-sm">
                <a href="/app/integrations" className="flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5" />
                  Выпустить токен
                </a>
              </Button>
            </div>
          </div>
        </details>
      )}

      {/* Onboarding State: Ожидание администратора */}
      {createdBot && !hasAdmin && (
        <Card className="border-0 shadow-lg shadow-indigo-100 ring-2 ring-indigo-500 bg-white overflow-hidden rounded-2xl p-6 sm:p-8 space-y-6">
          <div className="flex items-center gap-4 text-indigo-600">
            <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">Шаг 1 — активируйте бота</h3>
              <p className="text-sm text-slate-500 mt-0.5">Откройте бота в Telegram и привяжите свой аккаунт как администратор.</p>
            </div>
          </div>
          <div className="bg-slate-50 rounded-xl p-5 border border-slate-100 space-y-3">
            <p className="text-sm font-semibold text-slate-700">Пошаговая инструкция:</p>
            <ol className="list-decimal list-inside text-sm text-slate-600 space-y-2">
              <li>Нажмите кнопку <span className="font-bold text-slate-800">«Открыть @{createdBot.bot_username}»</span> ниже — откроется чат с ботом.</li>
              <li>В чате нажмите <span className="font-bold text-slate-800">«Запустить»</span> (или отправьте <code className="font-mono text-[12px] bg-white px-1.5 py-0.5 rounded border border-slate-200">/start</code>).</li>
              <li>Бот ответит сообщением с кнопкой <span className="font-bold text-slate-800">«✅ Я администратор»</span> — нажмите её.</li>
              <li>Эта страница автоматически обновится и покажет настройку каналов.</li>
            </ol>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 pt-1">
            <Button asChild size="lg" className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-8 py-6 text-base shadow-lg shadow-indigo-200 w-full sm:w-auto">
              <a href={`https://t.me/${createdBot.bot_username}`} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2">
                Открыть @{createdBot.bot_username} <ExternalLink className="w-5 h-5" />
              </a>
            </Button>
            <div className="flex items-center gap-2 text-xs text-slate-500 font-semibold">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
              Ожидание активации...
            </div>
          </div>
        </Card>
      )}

      {/* Onboarding State: Ожидание подключения каналов */}
      {createdBot && hasAdmin && !hasChannels && (
        <Card className="border-0 shadow-lg shadow-amber-100 ring-2 ring-amber-500 bg-white overflow-hidden rounded-2xl p-6 sm:p-8 space-y-6">
          <div className="flex items-center gap-4 text-amber-600">
            <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">Подключение каналов</h3>
              <p className="text-sm text-slate-500">Администратор успешно привязан. Теперь подключите ваши каналы к автопостеру.</p>
            </div>
          </div>
          <div className="bg-slate-50 rounded-xl p-5 border border-slate-100 space-y-3">
            <p className="text-sm font-semibold text-slate-700">Инструкция по подключению:</p>
            <ol className="list-decimal list-inside text-sm text-slate-600 space-y-2">
              <li>Добавьте бота <span className="font-bold text-slate-800">@{createdBot.bot_username}</span> в любой канал (публичный или приватный) в качестве администратора с правами на публикацию сообщений.</li>
              <li>Можно подключить сколько угодно каналов: например, два публичных для разных тем. Каждый получит свои кнопки, реакции и расписание.</li>
              <li>Бот автоматически поймает добавление и покажет канал на этой странице.</li>
            </ol>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500 font-semibold">
            <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
            Ожидание добавления в каналы...
          </div>
        </Card>
      )}

      {/* Конфигурация настроек каналов (доступна, когда подключен хотя бы один канал) */}
      {createdBot && hasAdmin && hasChannels && (
        <div className="space-y-6 animate-fade-in">
          {/* Объединенное окно конфигурации каналов */}
          <Card className="p-0 gap-0 border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
            {/* Список каналов — динамический, N любого visibility */}
            <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.values(channelConfigs).map(ch => {
                  const isActive = activeChannelId === ch.id;
                  const isPublic = ch.visibility === 'public';
                  const Icon = isPublic ? Globe : Lock;
                  const visibilityLabel = isPublic ? 'Публичный' : 'Приватный';
                  return (
                    <button
                      key={ch.id}
                      onClick={() => setActiveChannelId(ch.id)}
                      className={`p-5 rounded-2xl border text-left transition-all duration-200 hover:scale-[1.01] active:scale-[0.99] cursor-pointer flex flex-col justify-between h-32 ${
                        isActive
                          ? 'border-indigo-600 bg-white ring-1 ring-indigo-600 shadow-md shadow-indigo-100/55'
                          : 'border-slate-200 bg-white/60 hover:border-slate-300 hover:bg-white/80 shadow-sm'
                      }`}
                    >
                      <div className="flex items-start justify-between w-full">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${
                          isActive ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-500'
                        }`}>
                          <Icon className="w-5 h-5" />
                        </div>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                          {visibilityLabel}
                        </span>
                      </div>
                      <div>
                        <h4 className="font-bold text-sm text-slate-900 truncate">{ch.title || 'Новый канал'}</h4>
                        <p className="text-xs text-slate-500 font-semibold mt-1 truncate">
                          {ch.username ? `@${ch.username}` : (isPublic ? 'Открытая лента' : 'Платный доступ')}
                        </p>
                      </div>
                    </button>
                  );
                })}

                {/* Slot-карточка «Подключить ещё канал» — не просто decoration,
                    показывает куда нажать/что сделать чтобы добавить N+1 канал.
                    Клик → раскрывает инструкция. */}
                <button
                  onClick={() => setShowAddChannelHint(prev => !prev)}
                  className={`p-5 rounded-2xl border-2 border-dashed text-left transition-all duration-200 hover:scale-[1.01] active:scale-[0.99] cursor-pointer flex flex-col justify-between h-32 ${
                    showAddChannelHint
                      ? 'border-indigo-500 bg-indigo-50/40 ring-1 ring-indigo-200'
                      : 'border-slate-300 bg-slate-50/40 hover:border-indigo-400 hover:bg-indigo-50/30'
                  }`}
                >
                  <div className="flex items-start justify-between w-full">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-white text-indigo-500 shadow-sm">
                      <Plus className="w-5 h-5" />
                    </div>
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-indigo-700">Подключить ещё канал</h4>
                    <p className="text-xs text-slate-500 font-semibold mt-1">
                      Публичный или приватный — без ограничений
                    </p>
                  </div>
                </button>
              </div>

              {/* Развернутая инструкция под слотом «Подключить ещё канал» */}
              {showAddChannelHint && createdBot?.bot_username && (
                <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4 animate-fade-in">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0 mt-0.5">
                      <Plus className="w-4 h-4 text-indigo-700" />
                    </div>
                    <div className="space-y-1.5 text-sm text-slate-700 min-w-0">
                      <p className="font-bold text-slate-900">Как подключить новый канал</p>
                      <ol className="list-decimal list-inside space-y-1 text-xs text-slate-600">
                        <li>В Telegram откройте нужный канал → <b>Управление каналом</b> → <b>Администраторы</b>.</li>
                        <li>Добавьте бота <span className="font-bold text-slate-800">@{createdBot.bot_username}</span> с правом <b>«Публиковать посты»</b>.</li>
                        <li>Канал появится здесь автоматически — настраивайте кнопки, реакции и расписание.</li>
                      </ol>
                      <p className="text-[11px] text-slate-500 pt-1">Можно подключить сколько угодно каналов. Каждый публикует со своими кнопками и реакциями.</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Контент activeChannelId */}
            {Object.values(channelConfigs).map((ch) => {
              if (activeChannelId !== ch.id) return null;
              const tab = ch.id;
              const config = channelConfigs[tab];

              return (
                <div key={tab} className="animate-fade-in divide-y divide-slate-100">
                  <div className="bg-slate-50/30 p-5 sm:p-6">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
                        <Settings className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-lg font-bold text-slate-900 truncate">{config.title}</h3>
                        <p className="text-xs font-semibold text-slate-500">Настройки публикации и предложки для этого канала</p>
                      </div>
                      <div className="ml-auto flex gap-2 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRefreshChannel(tab)}
                          disabled={refreshingChannel[tab] || unlinkingChannel[tab] || savingChannel[tab]}
                          className="text-xs h-8"
                        >
                          {refreshingChannel[tab]
                            ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                            : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
                          Обновить
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => askUnlinkChannel(tab)}
                          disabled={refreshingChannel[tab] || unlinkingChannel[tab] || savingChannel[tab]}
                          className="text-xs h-8 text-rose-600 hover:text-rose-700 hover:bg-rose-50 hover:border-rose-200"
                        >
                          {unlinkingChannel[tab]
                            ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                            : <Unlink className="w-3.5 h-3.5 mr-1.5" />}
                          Отвязать
                        </Button>
                      </div>
                    </div>
                    {(config.tgChatId || config.username) && (
                      <div className="flex items-center gap-1.5 flex-wrap mt-3 ml-[52px]">
                        {config.tgChatId && (
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(String(config.tgChatId));
                              toast.success('ID канала скопирован');
                            }}
                            title="Скопировать ID канала"
                            className="font-mono text-[11px] text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200 transition-colors cursor-pointer"
                          >
                            {config.tgChatId}
                          </button>
                        )}
                        {config.username && (
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(`@${config.username}`);
                              toast.success('Username скопирован');
                            }}
                            title="Скопировать @username"
                            className="text-[11px] font-medium text-indigo-700 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded-md border border-indigo-200 transition-colors cursor-pointer"
                          >
                            @{config.username}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  
                  <div className="p-5 sm:p-6 space-y-6">
                    {/* Время публикаций (основная очередь) */}
                    <div className="space-y-4">
                      <div className="space-y-1">
                        <label className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-indigo-500" /> Время публикаций (основная очередь)
                        </label>
                        <span className="text-xs text-slate-500 font-semibold leading-relaxed block">
                          Посты публикуются автоматически — расписание с точностью до ±5 минут.
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5">
                        {(config.postingTimes || ['10:00']).map((time, idx) => (
                          <div key={idx} className="flex items-center gap-2 bg-slate-50 hover:bg-slate-100/70 p-2.5 rounded-xl border border-slate-200 transition-all focus-within:ring-1 focus-within:ring-indigo-500 focus-within:border-indigo-500">
                            <span className="text-[10px] font-bold text-slate-500 font-mono w-5 text-center">#{idx + 1}</span>
                            <input
                              type="time"
                              value={time}
                              onChange={(e) => handlePostingTimeChange(tab, idx, e.target.value)}
                              className="bg-transparent text-xs font-bold text-slate-800 outline-none w-full border-0 p-0 focus:ring-0 cursor-pointer"
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleRemovePostingTime(tab, idx)}
                              className="h-7 w-7 text-rose-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg shrink-0"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        ))}

                        <Button
                          variant="outline"
                          onClick={() => handleAddPostingTime(tab)}
                          className="h-10 rounded-xl border-dashed text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-indigo-600 hover:border-indigo-200 font-semibold text-xs transition-all flex items-center justify-center gap-1.5"
                        >
                          <Plus className="w-3.5 h-3.5 text-indigo-500" /> Добавить время
                        </Button>
                      </div>
                    </div>

                    {/* Часовой пояс канала */}
                    <div className="space-y-2 max-w-md">
                      <label className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                        <Globe className="w-3.5 h-3.5 text-indigo-500" /> Часовой пояс для публикаций
                      </label>
                      <Select
                        value={config.timezone}
                        onValueChange={(val) => setChannelConfigs(prev => ({
                          ...prev,
                          [tab]: { ...prev[tab], timezone: val }
                        }))}
                      >
                        <SelectTrigger className="h-11 w-full bg-white rounded-xl border-slate-200 shadow-sm focus:ring-indigo-500 font-medium">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl">
                          {!TIMEZONES.includes(config.timezone) && config.timezone ? (
                            <SelectItem value={config.timezone}>{config.timezone}</SelectItem>
                          ) : null}
                          <SelectItem value="Europe/Moscow" className="rounded-lg">Europe/Moscow (МСК, UTC+3)</SelectItem>
                          <SelectItem value="Europe/Kaliningrad" className="rounded-lg">Europe/Kaliningrad (MSK-1, UTC+2)</SelectItem>
                          <SelectItem value="Europe/Samara" className="rounded-lg">Europe/Samara (MSK+1, UTC+4)</SelectItem>
                          <SelectItem value="Asia/Yekaterinburg" className="rounded-lg">Asia/Yekaterinburg (MSK+2, UTC+5)</SelectItem>
                          <SelectItem value="Asia/Omsk" className="rounded-lg">Asia/Omsk (MSK+3, UTC+6)</SelectItem>
                          <SelectItem value="Asia/Krasnoyarsk" className="rounded-lg">Asia/Krasnoyarsk (MSK+4, UTC+7)</SelectItem>
                          <SelectItem value="Asia/Irkutsk" className="rounded-lg">Asia/Irkutsk (MSK+5, UTC+8)</SelectItem>
                          <SelectItem value="Asia/Yakutsk" className="rounded-lg">Asia/Yakutsk (MSK+6, UTC+9)</SelectItem>
                          <SelectItem value="Asia/Vladivostok" className="rounded-lg">Asia/Vladivostok (MSK+7, UTC+10)</SelectItem>
                          <SelectItem value="Asia/Magadan" className="rounded-lg">Asia/Magadan (MSK+8, UTC+11)</SelectItem>
                          <SelectItem value="Asia/Kamchatka" className="rounded-lg">Asia/Kamchatka (MSK+9, UTC+12)</SelectItem>
                          <SelectItem value="UTC" className="rounded-lg">UTC (Всемирное время)</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-slate-500 font-semibold leading-relaxed">
                        По умолчанию используется часовой пояс вашего браузера.
                      </p>
                    </div>

                    <hr className="border-slate-100" />

                    {/* Предложки от подписчиков — группируем все настройки предложки в одном блоке */}
                    <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4 sm:p-5 space-y-3">
                      <div className="space-y-1">
                        <label className="text-xs font-bold uppercase tracking-wider text-indigo-600 flex items-center gap-1.5">
                          <Inbox className="w-3.5 h-3.5" /> Предложки от подписчиков
                        </label>
                        <span className="text-xs text-slate-500 font-semibold leading-relaxed block">
                          Кнопка под постами, лимит, автопринятие и расписание — всё в одном месте.
                        </span>
                      </div>

                      {/* Кнопка предложки под постами */}
                      <div className="bg-white hover:bg-slate-50 rounded-2xl p-4 border border-slate-100 flex items-start justify-between gap-4 transition-all">
                        <div className="space-y-1">
                          <label htmlFor={`suggest-btn-toggle-${tab}`} className="text-sm font-bold text-slate-800 block">Кнопка «Предложить новость» под постами</label>
                          <span className="text-xs text-slate-500 font-semibold leading-relaxed block">
                            Добавляет под каждым публикуемым постом кнопку со ссылкой на бота для сбора предложений.
                          </span>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1 select-none">
                          <input
                            type="checkbox"
                            id={`suggest-btn-toggle-${tab}`}
                            className="sr-only peer"
                            checked={config.suggestButtonEnabled || false}
                            onChange={(e) => setChannelConfigs(prev => ({
                              ...prev,
                              [tab]: { ...prev[tab], suggestButtonEnabled: e.target.checked }
                            }))}
                          />
                          <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                        </label>
                      </div>

                      {/* Суточный лимит предложений */}
                      <div className="bg-white hover:bg-slate-50 rounded-2xl p-4 border border-slate-100 flex flex-col gap-3.5 transition-all">
                        <div className="space-y-1">
                          <label className="text-sm font-bold text-slate-800 block">Лимит предложений в сутки</label>
                          <span className="text-xs text-slate-500 font-semibold leading-relaxed block">
                            Максимальное количество предложений от одного пользователя за последние 24 часа. Укажите «0» для отключения ограничений.
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <input
                            type="number"
                            min="0"
                            max="1000"
                            className="w-24 px-3 py-1.5 text-sm font-bold text-center border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500 bg-white"
                            value={config.maxSuggestionsPerDay !== undefined ? config.maxSuggestionsPerDay : 5}
                            onChange={(e) => {
                              const val = e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value) || 0);
                              setChannelConfigs(prev => ({
                                ...prev,
                                [tab]: { ...prev[tab], maxSuggestionsPerDay: val }
                              }));
                            }}
                          />
                          <span className="text-xs text-slate-500 font-semibold">предложений / 24 часа</span>
                        </div>
                      </div>

                      {/* Автопринятие предложений */}
                      <div className="bg-white hover:bg-slate-50 rounded-2xl p-4 border border-slate-100 flex items-start justify-between gap-4 transition-all">
                        <div className="space-y-1">
                          <label htmlFor={`auto-accept-toggle-${tab}`} className="text-sm font-bold text-slate-800 block">Автопринятие предложений</label>
                          <span className="text-xs text-slate-500 font-semibold leading-relaxed block">
                            Если включено, контент от пользователей в предложке будет автоматически публиковаться без ручной модерации.
                          </span>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1 select-none">
                          <input
                            type="checkbox"
                            id={`auto-accept-toggle-${tab}`}
                            className="sr-only peer"
                            checked={config.autoAccept}
                            onChange={(e) => setChannelConfigs(prev => ({
                              ...prev,
                              [tab]: { ...prev[tab], autoAccept: e.target.checked }
                            }))}
                          />
                          <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                        </label>
                      </div>

                      {/* Планировщик предложений (Показываем только если включен тумблер автопринятия) */}
                      {config.autoAccept && (
                        <div className="space-y-4 pt-3 border-t border-indigo-100 animate-fade-in">
                          <div className="space-y-1">
                            <label className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                              <Clock className="w-3.5 h-3.5 text-indigo-500" /> Время публикаций предложенных постов
                            </label>
                            <span className="text-xs text-slate-500 font-semibold leading-relaxed block">
                              Отдельное расписание для автопринятых предложений от подписчиков.
                            </span>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5">
                            {(config.suggestionPostingTimes || ['12:00']).map((time, idx) => (
                              <div key={idx} className="flex items-center gap-2 bg-slate-50 hover:bg-slate-100/70 p-2.5 rounded-xl border border-slate-200 transition-all focus-within:ring-1 focus-within:ring-indigo-500 focus-within:border-indigo-500">
                                <span className="text-[10px] font-bold text-slate-500 font-mono w-5 text-center">#{idx + 1}</span>
                                <input
                                  type="time"
                                  value={time}
                                  onChange={(e) => handleSuggestionTimeChange(tab, idx, e.target.value)}
                                  className="bg-transparent text-xs font-bold text-slate-800 outline-none w-full border-0 p-0 focus:ring-0 cursor-pointer"
                                />
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleRemoveSuggestionTime(tab, idx)}
                                  className="h-7 w-7 text-rose-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg shrink-0"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            ))}

                            <Button
                              variant="outline"
                              onClick={() => handleAddSuggestionTime(tab)}
                              className="h-10 rounded-xl border-dashed text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-indigo-600 hover:border-indigo-200 font-semibold text-xs transition-all flex items-center justify-center gap-1.5"
                            >
                              <Plus className="w-3.5 h-3.5 text-indigo-500" /> Добавить время
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Автореакция на посты */}
                    <div className="bg-slate-50/50 hover:bg-slate-50/80 rounded-2xl p-4 border border-slate-100 flex flex-col gap-3 transition-all">
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <label htmlFor={`seed-reaction-toggle-${tab}`} className="text-sm font-bold text-slate-800 block">Автореакция на посты</label>
                          <span className="text-xs text-ink-muted font-semibold leading-relaxed block">
                            Бот ставит эту эмоцию на каждый пост. Эмодзи должен быть разрешён в настройках реакций самого канала.
                          </span>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1 select-none">
                          <input
                            type="checkbox"
                            id={`seed-reaction-toggle-${tab}`}
                            className="sr-only peer"
                            checked={Boolean(config.seedReactionEmoji)}
                            onChange={(e) => setChannelConfigs(prev => ({
                              ...prev,
                              [tab]: { ...prev[tab], seedReactionEmoji: e.target.checked ? (prev[tab].seedReactionEmoji || '👍') : null }
                            }))}
                          />
                          <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                        </label>
                      </div>
                      {Boolean(config.seedReactionEmoji) && (
                        <div className="flex flex-col gap-3 pt-1 animate-fade-in">
                          {/* Премиум-режим: доверяем заявке владельца; если бот
                              не премиум, рантайм сам деградирует до 1 реакции. */}
                          <div className="flex items-start justify-between gap-4">
                            <div className="space-y-0.5">
                              <label htmlFor={`seed-premium-toggle-${tab}`} className="text-xs font-bold text-ink-body block">Премиум бот</label>
                              <span className="text-xs text-ink-muted font-semibold leading-relaxed block">
                                Премиум-боты ставят до 3 реакций на пост. Без премиума Telegram примет только первую — остальные отработают как запасные.
                              </span>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer shrink-0 select-none">
                              <input
                                type="checkbox"
                                id={`seed-premium-toggle-${tab}`}
                                className="sr-only peer"
                                checked={Boolean(config.seedReactionPremium)}
                                onChange={(e) => setChannelConfigs(prev => {
                                  const premiumOn = e.target.checked;
                                  const emojis = parseReactionEmojis(prev[tab].seedReactionEmoji);
                                  // Выключение премиума схлопывает выбор до первой эмоции:
                                  // не-премиум бот физически ставит только одну, оставлять
                                  // «выбрано три» = снова вводить админа в заблуждение.
                                  if (!premiumOn && emojis.length > 1) {
                                    toast.info(`Премиум выключен — осталась первая эмоция ${emojis[0]}`);
                                    return { ...prev, [tab]: { ...prev[tab], seedReactionPremium: false, seedReactionEmoji: emojis[0] } };
                                  }
                                  return { ...prev, [tab]: { ...prev[tab], seedReactionPremium: premiumOn } };
                                })}
                              />
                              <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-4 peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border-border-strong after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-action-primary"></div>
                            </label>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            {[
                              { emoji: '👍', label: 'Лайк' },
                              { emoji: '👎', label: 'Дизлайк' },
                              { emoji: '❤️', value: '❤', label: 'Сердце' },
                              { emoji: '🔥', label: 'Огонь' },
                              { emoji: '🥰', label: 'Восхищение' },
                              { emoji: '🎉', label: 'Праздник' }
                            ].map(opt => {
                              // value — то, что уходит в БД ('❤' без VS16); emoji — что рисуем.
                              const val = opt.value || opt.emoji;
                              const activeReactions = parseReactionEmojis(config.seedReactionEmoji);
                              const active = activeReactions.includes(val);
                              return (
                                <button
                                  key={val}
                                  type="button"
                                  onClick={() => setChannelConfigs(prev => {
                                    const premium = Boolean(prev[tab].seedReactionPremium);
                                    const cur = parseReactionEmojis(prev[tab].seedReactionEmoji);
                                    // Клик по активному снимает его; последний эмодзи выключает автореакцию.
                                    if (cur.includes(val)) {
                                      const next = cur.filter((x) => x !== val);
                                      return { ...prev, [tab]: { ...prev[tab], seedReactionEmoji: next.length ? next.join(',') : null } };
                                    }
                                    if (premium) {
                                      if (cur.length >= 3) {
                                        toast.info('Максимум 3 реакции на пост');
                                        return prev;
                                      }
                                      return { ...prev, [tab]: { ...prev[tab], seedReactionEmoji: [...cur, val].join(',') } };
                                    }
                                    // Одиночный выбор: лимит не-премиум бота — 1 реакция на пост.
                                    if (cur.length > 0) {
                                      toast.info('Две эмоции — только с Telegram Premium');
                                      return prev;
                                    }
                                    return { ...prev, [tab]: { ...prev[tab], seedReactionEmoji: val } };
                                  })}
                                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                                    active
                                      ? 'bg-indigo-600 text-white border-indigo-600'
                                      : 'bg-white text-slate-700 border-slate-200 hover:border-indigo-300'
                                  }`}
                                >
                                  {opt.emoji} {opt.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Обсуждение — форвард постов в привязанную группу обсуждений.
                        Бот-API не создаёт тред обсуждения сам, поэтому бот пересылает
                        пост в linked-группу — Telegram показывает нативную кнопку. */}
                    <div className="bg-surface-subtle/50 hover:bg-surface-subtle/80 rounded-2xl p-4 border border-border-default flex flex-col gap-3 transition-all">
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <label htmlFor={`discussion-toggle-${tab}`} className="text-sm font-bold text-ink-body block">Пересылать посты в группу обсуждений</label>
                          <span className="text-xs text-ink-muted font-semibold leading-relaxed block">
                            Бот пересылает каждый опубликованный пост в привязанную к каналу группу обсуждений — подписчики обсуждают прямо в Telegram.
                          </span>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1 select-none">
                          <input
                            type="checkbox"
                            id={`discussion-toggle-${tab}`}
                            className="sr-only peer"
                            checked={Boolean(config.discussionForwardEnabled)}
                            onChange={(e) => setChannelConfigs(prev => ({
                              ...prev,
                              [tab]: { ...prev[tab], discussionForwardEnabled: e.target.checked }
                            }))}
                          />
                          <div className="w-11 h-6 bg-border-default peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border-border-strong after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-action-primary"></div>
                        </label>
                      </div>
                      {config.linkedChatId ? (
                        <span className="text-xs text-ink-muted font-semibold leading-relaxed block">
                          Привязанная группа найдена — под постами появится кнопка «Перейти к обсуждению». Бот должен быть админом в этой группе.
                        </span>
                      ) : (
                        <span className="text-xs text-feedback-warning-text font-semibold leading-relaxed block">
                          Привязанная группа обсуждений не найдена. Привяжи группу к каналу в настройках Telegram, затем обнови канал (или включи тумблер и сохрани — бэкенд перепроверит и подскажет).
                        </span>
                      )}
                    </div>

                    <hr className="border-slate-100" />

                    {/* Конструктор кнопок */}
                    <div className="space-y-4">
                      <div className="space-y-1">
                        <label className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                          <Layout className="w-3.5 h-3.5 text-indigo-500" /> Кнопки под каждым постом
                        </label>
                        <span className="text-xs text-slate-500 font-semibold leading-relaxed block">
                          Бот будет автоматически прикреплять эти кнопки под сообщениями в канале.
                        </span>
                      </div>

                      <div className="space-y-3">
                        {config.buttons.map((btn, idx) => (
                          <div key={idx} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 bg-slate-50/50 hover:bg-slate-100 p-4 rounded-2xl border border-slate-100 transition-all animate-fade-in">
                            <div className="flex-1">
                              <Input
                                value={btn.text}
                                onChange={(e) => handleButtonChange(tab, idx, 'text', e.target.value)}
                                placeholder="Текст кнопки"
                                className="bg-white h-11 rounded-xl border-slate-200 shadow-sm font-semibold text-xs"
                              />
                            </div>
                            <div className="flex-[2]">
                              <Input
                                value={btn.url}
                                onChange={(e) => handleButtonChange(tab, idx, 'url', e.target.value)}
                                placeholder="Ссылка (https://...)"
                                className="bg-white h-11 rounded-xl border-slate-200 shadow-sm font-semibold text-xs"
                              />
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleRemoveButton(tab, idx)}
                              className="h-11 w-11 text-rose-500 hover:text-rose-600 hover:bg-rose-50 rounded-xl shrink-0 flex items-center justify-center border border-transparent hover:border-rose-100"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        ))}

                        <Button
                          variant="outline"
                          onClick={() => handleAddButton(tab)}
                          className="h-11 px-4 rounded-xl border-dashed text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-indigo-600 hover:border-indigo-200 font-semibold text-xs transition-all flex items-center justify-center gap-1.5"
                        >
                          <Plus className="w-4 h-4 text-indigo-500" /> Добавить кнопку
                        </Button>
                      </div>
                    </div>

                    <hr className="border-slate-100 my-6" />

                    {/* Кнопка сохранения настроек канала */}
                    <div className="flex justify-start">
                      <Button
                        onClick={() => handleSaveChannelConfig(tab)}
                        disabled={savingChannel[tab]}
                        className="h-11 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-md shadow-indigo-200 disabled:opacity-50 transition-all"
                      >
                        {savingChannel[tab] ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                        Сохранить настройки канала
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
        </Card>

          {/* Чек-листы: список с кнопками в группе, отмечать могут все участники
              чата, состояние общее. Контент автопостера — команд-центр и заказы
              не трогаем (осознанное решение в плане фичи). */}
          <div className="rounded-2xl border border-border-default bg-surface-subtle/50 p-4 sm:p-5 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1 min-w-0">
                <h3 className="text-base font-bold text-ink-strong">☑️ Чек-листы</h3>
                <p className="text-xs text-ink-muted font-semibold leading-relaxed max-w-[70ch]">
                  Список с кнопками в группе: семья отмечает пункты, состояние видят все. Создаётся здесь или агентом через Bullgram MCP.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => setShowChecklistForm((v) => !v)}
                className="h-9 rounded-xl font-semibold shrink-0"
              >
                {showChecklistForm ? 'Свернуть' : '＋ Новый список'}
              </Button>
            </div>

            {/* Форма создания — свёрнута по умолчанию, чтобы не стоять между
                админом и уже живыми списками */}
            {showChecklistForm && (
              <div className="rounded-2xl border border-border-default bg-surface-card p-4 sm:p-5 space-y-4 animate-fade-in">
                <div className="space-y-1.5">
                  <label htmlFor="checklist-title" className="text-xs font-bold uppercase tracking-wider text-ink-muted block">Заголовок</label>
                  <Input
                    id="checklist-title"
                    value={checklistTitle}
                    onChange={(e) => setChecklistTitle(e.target.value)}
                    placeholder="Покупки на завтра"
                    maxLength={200}
                    className="h-11 rounded-xl bg-surface-card"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="checklist-items" className="text-xs font-bold uppercase tracking-wider text-ink-muted block">Пункты</label>
                  <Textarea
                    id="checklist-items"
                    value={checklistItemsText}
                    onChange={(e) => setChecklistItemsText(e.target.value)}
                    placeholder={'Купить картошку\nКупить капусту'}
                    rows={4}
                    className="rounded-xl bg-surface-card min-h-24"
                  />
                  <p className="text-xs text-ink-muted font-semibold">
                    По одному пункту в строке — от 1 до 25 пунктов, до 100 символов каждый.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-ink-muted block">Каналы публикации</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {channels.map((ch) => {
                      const tgId = String(ch.tg_chat_id);
                      const checked = checklistChannelIds.includes(tgId);
                      return (
                        <label
                          key={ch.id}
                          className={`flex items-center gap-2.5 rounded-xl border p-3 cursor-pointer transition-all ${
                            checked
                              ? 'border-action-primary bg-action-primary/5'
                              : 'border-border-default bg-surface-subtle/50 hover:border-border-strong'
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="accent-action-primary shrink-0"
                            checked={checked}
                            onChange={() => toggleChecklistChannel(tgId)}
                          />
                          <span className="min-w-0">
                            <span className="block text-sm font-bold text-ink-body truncate">{ch.title || 'Канал'}</span>
                            <span className="block text-xs text-ink-muted font-semibold truncate">
                              {ch.username ? `@${ch.username}` : (ch.visibility === 'public' ? 'Публичный' : 'Приватный')}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label htmlFor="checklist-expires" className="text-xs font-bold uppercase tracking-wider text-ink-muted block">Закрыть после (необязательно)</label>
                    <Input
                      id="checklist-expires"
                      type="datetime-local"
                      value={checklistExpiresAt}
                      onChange={(e) => setChecklistExpiresAt(e.target.value)}
                      className="h-11 rounded-xl bg-surface-card"
                    />
                    <p className="text-xs text-ink-muted font-semibold">После этой даты список пометится как истёкший.</p>
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="checklist-dedup" className="text-xs font-bold uppercase tracking-wider text-ink-muted block">dedup_key (необязательно)</label>
                    <Input
                      id="checklist-dedup"
                      value={checklistDedupKey}
                      onChange={(e) => setChecklistDedupKey(e.target.value)}
                      placeholder="daily-shopping"
                      className="h-11 rounded-xl bg-surface-card font-mono"
                    />
                    <p className="text-xs text-ink-muted font-semibold">Для повторяющихся задач — защита от дублей.</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    onClick={handleCreateChecklist}
                    disabled={creatingChecklist}
                    className="h-11 px-6 rounded-xl font-bold"
                  >
                    {creatingChecklist ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                    Создать список
                  </Button>
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => setShowChecklistForm(false)}
                    className="rounded-xl font-semibold"
                  >
                    Отмена
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <label className="text-xs font-bold uppercase tracking-wider text-ink-muted block">Активные списки ({checklists.length})</label>
              {checklistsLoading && checklists.length === 0 ? (
                <div className="flex items-center gap-2 p-4 text-sm text-ink-muted font-semibold">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Загружаем чек-листы...
                </div>
              ) : checklistsError ? (
                <div className="rounded-2xl border border-border-default bg-feedback-error-bg p-4 flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-feedback-error-text">{checklistsError}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={() => loadChecklists(createdBot.id)}
                    className="rounded-lg font-semibold shrink-0"
                  >
                    Повторить
                  </Button>
                </div>
              ) : checklists.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border-strong bg-surface-card/50 p-5 text-sm text-ink-muted font-semibold">
                  Пока нет активных чек-листов
                  <span className="block text-xs mt-1 font-semibold">
                    Создайте список кнопкой «＋ Новый список» — или пусть агент ведёт его через Bullgram MCP.
                  </span>
                </div>
              ) : (
                checklists.map((row) => {
                  const st = checklistStates[row.id];
                  const stateItems = (st?.items || []).slice().sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0));
                  const doneCount = stateItems.filter((it) => it.is_checked === true).length;
                  const statusMeta = CHECKLIST_STATUS_META[row.status] || CHECKLIST_STATUS_META.active;
                  const isExpanded = expandedChecklistId === row.id;
                  return (
                    <div key={row.id} className="rounded-2xl border border-border-default bg-surface-card overflow-hidden">
                      <div className="p-4 flex items-start justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => toggleChecklistExpand(row)}
                          className="flex-1 min-w-0 text-left cursor-pointer space-y-1"
                        >
                          <span className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-ink-strong">{row.title || 'Без названия'}</span>
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${statusMeta.className}`}>
                              {statusMeta.label}
                            </span>
                          </span>
                          <span className="block text-xs text-ink-muted font-semibold">
                            {st ? `${doneCount} из ${stateItems.length}` : 'Состояние не загрузилось'}
                            {row.expires_at ? ` · закроется после ${formatChecklistTime(row.expires_at)}` : ''}
                          </span>
                        </button>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            variant="outline"
                            size="sm"
                            type="button"
                            onClick={() => handleRefreshChecklist(row.id)}
                            disabled={refreshingChecklist[row.id]}
                            className="rounded-lg font-semibold"
                          >
                            {refreshingChecklist[row.id]
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : <RefreshCw className="w-3.5 h-3.5" />}
                            Обновить
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            type="button"
                            onClick={() => askCloseChecklist(row)}
                            disabled={cancellingChecklist[row.id]}
                            className="rounded-lg font-semibold"
                          >
                            {cancellingChecklist[row.id] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                            Закрыть
                          </Button>
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="border-t border-border-default bg-surface-subtle/50 p-4 space-y-2 animate-fade-in">
                          {st?.summary && (
                            <p className="text-xs text-ink-body font-semibold leading-relaxed">{st.summary}</p>
                          )}
                          {stateItems.map((item) => (
                            <div key={item.id} className="flex items-start gap-2 text-sm">
                              <span className="shrink-0" aria-hidden="true">{item.is_checked ? '✅' : '⬜'}</span>
                              <span className={`min-w-0 font-semibold ${item.is_checked ? 'text-ink-muted' : 'text-ink-body'}`}>
                                {item.text}
                                {item.is_checked && (item.checked_by_name || item.checked_at) ? (
                                  <span className="text-xs text-ink-muted">
                                    {' '}— {[item.checked_by_name, formatChecklistTime(item.checked_at)].filter(Boolean).join(', ')}
                                  </span>
                                ) : null}
                              </span>
                            </div>
                          ))}
                          {stateItems.length === 0 && (
                            <p className="text-xs text-ink-muted font-semibold">В списке нет пунктов.</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Список Администраторов (В самом низу) */}
          <Card className="p-0 gap-0 border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
            <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Администраторы бота</h3>
                  <p className="text-xs font-semibold text-slate-500">Управляйте правами доступа и генерируйте приглашения</p>
                </div>
              </div>
            </div>
            
            <div className="p-5 sm:p-6 space-y-6">
              {/* Ссылка-приглашение */}
              {inviteLink && (
                <div className="space-y-2 max-w-xl">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-500 block">Пригласить администратора</label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        readOnly
                        value={inviteRevealed ? inviteLink : maskInvite(inviteLink)}
                          className="font-mono bg-slate-50 h-11 rounded-xl border-slate-200 shadow-sm pr-20"
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700 transition-colors"
                        onClick={() => setInviteRevealed((v) => !v)}
                        aria-label={inviteRevealed ? 'Скрыть ссылку' : 'Показать ссылку'}
                        title={inviteRevealed ? 'Скрыть ссылку' : 'Показать ссылку'}
                      >
                        {inviteRevealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <Button
                      type="button"
                      onClick={handleCopyInvite}
                      aria-label="Скопировать инвайт-ссылку"
                      className="h-11 px-4 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-600 border-0"
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-slate-500 font-medium block">
                      Пользователь перейдет по ссылке в бота и автоматически получит доступ к администрированию.
                    </span>
                    {createdBot?.id ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 rounded-lg text-xs text-slate-500 hover:text-slate-800"
                        type="button"
                        onClick={async () => {
                          try {
                            const data = await regenerateInvite(createdBot.id, accessToken);
                            if (data.invite_link) setInviteLink(data.invite_link);
                            setInviteRevealed(false);
                            toast.success('Ссылка перевыпущена. Старая больше не работает.');
                          } catch (err) {
                            toast.error(err.message || 'Не удалось перевыпустить ссылку.');
                          }
                        }}
                      >
                        <RefreshCcw className="w-3.5 h-3.5 mr-1 inline" /> Перевыпустить
                      </Button>
                    ) : null}
                  </div>
                </div>
              )}

              {/* Список текущих админов */}
              <div className="space-y-3">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 block">Список админов ({admins.length})</label>
                <div className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden max-w-md">
                  {admins.map((adminId) => {
                    return (
                      <div key={adminId} className="flex items-center justify-between p-3.5 bg-white text-sm font-semibold">
                        <span className="font-mono text-slate-700">{adminId}</span>
                        {(
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => askRemoveAdmin(adminId)}
                            className="text-rose-500 hover:text-rose-600 hover:bg-rose-50 h-8 rounded-lg"
                          >
                            Удалить
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-slate-500">Первый в списке — владелец бота: он добавляется автоматически при подключении.</p>
              </div>

              {/* Ручное добавление */}
              <div className="space-y-2 max-w-md">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 block">Добавить вручную по Telegram ID</label>
                <div className="flex gap-2">
                  <Input
                    value={newAdminTgId}
                    onChange={(e) => setNewAdminTgId(e.target.value)}
                    placeholder="Пример: 123456789"
                    className="bg-white h-11 rounded-xl border-slate-200 shadow-sm"
                  />
                  <Button
                    onClick={handleAddAdmin}
                    disabled={!newAdminTgId.trim() || addingAdmin}
                    className="h-11 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-md shadow-indigo-200"
                  >
                    {addingAdmin ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4 mr-2" />}
                    Добавить
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Диалог подтверждения опасных действий */}
      {confirmState && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4"
          onClick={() => closeConfirm(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            className="bg-white w-full max-w-md rounded-2xl shadow-xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${confirmState.danger ? 'bg-rose-50 text-rose-600' : 'bg-indigo-50 text-indigo-600'}`}>
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 id="confirm-dialog-title" className="text-lg font-bold text-slate-900">{confirmState.title}</h3>
                <p className="text-sm text-slate-500 mt-1 leading-relaxed">{confirmState.description}</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                ref={confirmCancelRef}
                variant="outline"
                className="h-10 px-4 rounded-xl font-semibold border-slate-200 text-slate-700"
                onClick={() => closeConfirm(false)}
              >
                Отмена
              </Button>
              <Button
                className={`h-10 px-4 rounded-xl font-bold text-white shadow-md ${confirmState.danger ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-200' : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200'}`}
                onClick={() => {
                  const action = confirmState.onConfirm;
                  closeConfirm(true);
                  if (action) action();
                }}
              >
                {confirmState.actionLabel || 'Подтвердить'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
