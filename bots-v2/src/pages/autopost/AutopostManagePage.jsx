// Управление автопостером («Боты», план 2026-09-27-bots-app-split, Фаза 3).
// Перенесено из admin-v2/src/pages/QuickStartPage.jsx: сменились только
// относительные импорты, имя компонента, заголовок страницы и внешний
// указатель на выпуск API-токена (ключи теперь живут в «Юзерботе»).
// 2026-11-07 — behavior-preserving разрезка под pre-commit лимит 20КБ:
// страница — композитор (стейт channelConfigs, загрузки с reqId-refs,
// realtime-подписка и общий confirm-диалог); секции — в ./sections/,
// помощники журнала — в ./utils/journal.js. Поведение не менялось.
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '../../app/providers/AuthProvider.jsx';
import { LoadingState } from '../../ui/LoadingState.jsx';
import { supabase } from '../../lib/supabase.js';
import { fetchAdmins, fetchChannels, initBot } from './api.js';
import { createChannelConfigHandlers } from './sections/ChannelButtons.jsx';
import BotConnect from './sections/BotConnect.jsx';
import OnboardingStates from './sections/OnboardingStates.jsx';
import ChannelConfig from './sections/ChannelConfig.jsx';
import JournalPanel from './sections/JournalPanel.jsx';
import AdminsPanel from './sections/AdminsPanel.jsx';
import ConfirmDialog from './sections/ConfirmDialog.jsx';

export default function AutopostManagePage() {
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

  // Active channel UUID for config panel (null when no channels connected).
  // Таб больше не 'public'/'private' — каналов может быть N любого visibility.
  const [activeChannelId, setActiveChannelId] = useState(null);

  // Раскрытая инструкция под slot-карточкой «Подключить ещё канал».
  const [showAddChannelHint, setShowAddChannelHint] = useState(false);

  // Configs for channels — keyed by channel UUID (supports N channels per bot,
  // включая несколько public или несколько private).
  const [channelConfigs, setChannelConfigs] = useState({});

  // Мост к журналу: JournalPanel кладёт сюда { scheduleRefetch, clearDebounce }
  // на каждый свой рендер; realtime-эффект ниже дергает их по событиям
  // autopost_items и в cleanup при смене бота/токена.
  const journalApiRef = useRef(null);

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
  // Загрузка/сброс журнала уехали в JournalPanel (его эффект по botId+accessToken).
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
      return;
    }

    const bot = existingBotsRef.current.find((b) => b.id === selectedBotId);
    if (!bot) return;

    setTokenRevealed(false);
    setInviteRevealed(false);
    setBotToken(bot.bot_token || '');
    setCreatedBot({ id: bot.id, bot_username: bot.username });

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
      seedReactionPremium: row?.seed_reaction_premium === true
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
      // События autopost_items: тихо освежаем «Журнал публикаций».
      // Дебаунс — агент часто ставит в очередь серию постов, дёргать API
      // на каждый item не нужно. Журнальный стейт живёт в JournalPanel —
      // зовём его scheduleRefetch через ref-мост.
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'autopost_items', filter: `bot_id=eq.${botId}` },
        () => { journalApiRef.current?.scheduleRefetch(botId); }
      )
      .subscribe();

    return () => {
      // Дебаунс журнала гасим через мост (стейт журнала — в JournalPanel);
      // дословный аналог прежнего cleanup с clearTimeout.
      journalApiRef.current?.clearDebounce();
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
      toast.success('Бот успешно инициализирован! Теперь активируй его в Telegram.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setIniting(false);
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

  // Хендлеры конфига канала — фабрика на каждый рендер: замыкания должны
  // видеть актуальные channelConfigs/createdBot, как раньше внутри компонента.
  const channelHandlers = createChannelConfigHandlers({
    setChannelConfigs,
    channelConfigs,
    createdBot,
    accessToken,
    askConfirm,
    setSavingChannel,
    setUnlinkingChannel,
    setRefreshingChannel
  });

  if (loading) return <LoadingState text="Загружаем автопостер..." />;

  // Определяем шаги онбординга
  const hasAdmin = admins.length > 0;
  const hasChannels = channels.length > 0;
  const selectedBot = existingBots.find((b) => String(b.id) === String(selectedBotId)) || null;
  const botPaused = selectedBot ? selectedBot.is_active === false : false;

  return (
    <section className="page page--flush space-y-6">
      {/* Заголовок только для скринридеров: экран начинается с карты выбора бота
          (решение владельца — без видимых титулов, как на дашборде «Юзербота»). */}
      <h1 className="sr-only">Автопостер</h1>
      {/* Подключение бота */}
      <BotConnect
        selectedBotId={selectedBotId}
        setSelectedBotId={setSelectedBotId}
        botToken={botToken}
        setBotToken={setBotToken}
        tokenRevealed={tokenRevealed}
        setTokenRevealed={setTokenRevealed}
        existingBots={existingBots}
        togglePause={togglePause}
        pausing={pausing}
        botPaused={botPaused}
        handleConnect={handleConnect}
        initing={initing}
        askDelete={askDelete}
      />
      <OnboardingStates createdBot={createdBot} hasAdmin={hasAdmin} hasChannels={hasChannels} />

      {/* Конфигурация настроек каналов (доступна, когда подключен хотя бы один канал) */}
      {createdBot && hasAdmin && hasChannels && (
        <div className="space-y-6 animate-fade-in">
          {/* Объединенное окно конфигурации каналов */}
          <ChannelConfig
            channelConfigs={channelConfigs}
            setChannelConfigs={setChannelConfigs}
            activeChannelId={activeChannelId}
            setActiveChannelId={setActiveChannelId}
            showAddChannelHint={showAddChannelHint}
            setShowAddChannelHint={setShowAddChannelHint}
            createdBot={createdBot}
            savingChannel={savingChannel}
            unlinkingChannel={unlinkingChannel}
            refreshingChannel={refreshingChannel}
            {...channelHandlers}
          />
          <JournalPanel
            botId={createdBot?.id}
            accessToken={accessToken}
            channelConfigs={channelConfigs}
            createdBot={createdBot}
            journalApiRef={journalApiRef}
          />
          <AdminsPanel
            admins={admins}
            setAdmins={setAdmins}
            inviteLink={inviteLink}
            setInviteLink={setInviteLink}
            inviteRevealed={inviteRevealed}
            setInviteRevealed={setInviteRevealed}
            createdBot={createdBot}
            accessToken={accessToken}
            askConfirm={askConfirm}
          />
        </div>
      )}

      {/* Диалог подтверждения опасных действий */}
      <ConfirmDialog confirmState={confirmState} closeConfirm={closeConfirm} confirmCancelRef={confirmCancelRef} />
    </section>
  );
}
