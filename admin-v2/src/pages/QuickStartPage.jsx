import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Hash, Loader2, Save, Trash2, Zap, Copy, Plus, Lock, Globe, Shield, UserPlus, Check, Clock, AlertTriangle, Settings, Layout, RefreshCw, Unlink } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { Button } from '../components/ui/button.jsx';
import { Card } from '../components/ui/card.jsx';
import { Input } from '../components/ui/input.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select.jsx';
import { supabase } from '../lib/supabase.js';
import { LoadingState } from '../ui/LoadingState.jsx';
import {
    fetchChannels,
    fetchAdmins,
    initBot,
    patchChannel,
    unlinkChannel,
    refreshChannel,
    addAdmin,
    removeAdmin,
    deleteBot
} from './autopost/api.js';

function postingTimesFor(n) {
  return n === 1 ? ['10:00'] : n === 2 ? ['10:00', '18:00'] : ['08:00', '14:00', '20:00'];
}

export function QuickStartPage() {
  const { user, accessToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [selectedBotId, setSelectedBotId] = useState('new');
  const [botToken, setBotToken] = useState('');
  
  // Bot settings states
  const [existingBots, setExistingBots] = useState([]);
  const [createdBot, setCreatedBot] = useState(null);
  const [channels, setChannels] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [inviteLink, setInviteLink] = useState('');
  
  // Modals & Action loading states
  const [initing, setIniting] = useState(false);
  const [savingChannel, setSavingChannel] = useState({ public: false, private: false });
  const [unlinkingChannel, setUnlinkingChannel] = useState({ public: false, private: false });
  const [refreshingChannel, setRefreshingChannel] = useState({ public: false, private: false });
  const [addingAdmin, setAddingAdmin] = useState(false);
  const [newAdminTgId, setNewAdminTgId] = useState('');
  
  // Active Tab for connected channels config
  const [activeTab, setActiveTab] = useState('public');
  
  // Configs for channels
  const [channelConfigs, setChannelConfigs] = useState({
    public: { id: null, tgChatId: null, title: '', username: null, visibility: null, postsPerDay: '1', postingTimes: ['10:00'], autoAccept: false, buttons: [], timezone: 'Europe/Moscow', suggestionPostingTimes: ['12:00'], suggestButtonEnabled: false, maxSuggestionsPerDay: 5, seedReactionEmoji: null },
    private: { id: null, tgChatId: null, title: '', username: null, visibility: null, postsPerDay: '1', postingTimes: ['10:00'], autoAccept: false, buttons: [], timezone: 'Europe/Moscow', suggestionPostingTimes: ['12:00'], suggestButtonEnabled: false, maxSuggestionsPerDay: 5, seedReactionEmoji: null }
  });

  // Загрузка существующих ботов
  const loadBots = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { data } = await supabase
        .from('autopost_bots')
        .select('*')
        .eq('owner_id', user.id)
        .order('created_at', { ascending: false });
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

  // При выборе существующего бота — загрузить его настройки
  useEffect(() => {
    if (selectedBotId === 'new') {
      setBotToken('');
      setChannels([]);
      setAdmins([]);
      setInviteLink('');
      setCreatedBot(null);
      const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow';
      setChannelConfigs({
        public: { id: null, tgChatId: null, title: '', username: null, visibility: null, postsPerDay: '1', postingTimes: ['10:00'], autoAccept: false, buttons: [], timezone: browserTz, suggestionPostingTimes: ['12:00'], suggestButtonEnabled: false, maxSuggestionsPerDay: 5, seedReactionEmoji: null },
        private: { id: null, tgChatId: null, title: '', username: null, visibility: null, postsPerDay: '1', postingTimes: ['10:00'], autoAccept: false, buttons: [], timezone: browserTz, suggestionPostingTimes: ['12:00'], suggestButtonEnabled: false, maxSuggestionsPerDay: 5, seedReactionEmoji: null }
      });
      return;
    }

    const bot = existingBots.find((b) => b.id === selectedBotId);
    if (!bot) return;

    setBotToken(bot.bot_token || '');
    setCreatedBot({ id: bot.id, bot_username: bot.username });

    loadChannels(bot.id);
    loadAdmins(bot.id);
  }, [selectedBotId, existingBots]);

  async function loadChannels(botId, { merge = false } = {}) {
    try {
      const data = await fetchChannels(botId, accessToken);
      if (!data.channels) return;
      setChannels(data.channels);
      if (merge) {
        mergeChannelsIntoConfig(data.channels);
      } else {
        applyChannelsToConfig(data.channels);
      }
    } catch (e) {
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
      seedReactionEmoji: row?.seed_reaction_emoji || null
    };
  }

  function emptyChannelConfig() {
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow';
    return { id: null, tgChatId: null, title: '', username: null, visibility: null, postsPerDay: '1', postingTimes: ['10:00'], autoAccept: false, buttons: [], timezone: browserTz, suggestionPostingTimes: ['12:00'], suggestButtonEnabled: false, maxSuggestionsPerDay: 5, seedReactionEmoji: null };
  }

  function applyChannelsToConfig(channelsList) {
    const pubCh = channelsList.find(c => c.visibility === 'public');
    const privCh = channelsList.find(c => c.visibility === 'private');
    setChannelConfigs({
      public: mapChannelRow(pubCh),
      private: mapChannelRow(privCh)
    });
  }

  // Polling-режим: не затираем поля, которые уже редактирует пользователь.
  // Заполняем конфиг только при первом обнаружении канала и сбрасываем при исчезновении.
  function mergeChannelsIntoConfig(channelsList) {
    const pubCh = channelsList.find(c => c.visibility === 'public');
    const privCh = channelsList.find(c => c.visibility === 'private');
    setChannelConfigs(prev => ({
      public: !pubCh && prev.public.id
        ? emptyChannelConfig()
        : pubCh && !prev.public.id ? mapChannelRow(pubCh) : prev.public,
      private: !privCh && prev.private.id
        ? emptyChannelConfig()
        : privCh && !prev.private.id ? mapChannelRow(privCh) : prev.private
    }));
  }

  async function loadAdmins(botId) {
    try {
      const data = await fetchAdmins(botId, accessToken);
      if (data.admin_tg_ids) {
        setAdmins(data.admin_tg_ids);
        setInviteLink(data.invite_link || '');
      }
    } catch (e) {
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
      .subscribe();

    return () => {
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
  async function handleSaveChannelConfig(type) {
    const config = channelConfigs[type];
    if (!config.id || !createdBot?.id) return;
    
    setSavingChannel(prev => ({ ...prev, [type]: true }));
    try {
      const sortedPostingTimes = [...(config.postingTimes || ['10:00'])].sort();
      const sortedSuggestionTimes = [...(config.suggestionPostingTimes || ['12:00'])].sort();

      await patchChannel(createdBot.id, config.id, {
        auto_accept_suggestions: config.autoAccept,
        buttons_config: config.buttons,
        posts_per_day: sortedPostingTimes.length,
        posting_times: sortedPostingTimes,
        timezone: config.timezone,
        suggestion_posts_per_day: sortedSuggestionTimes.length,
        suggestion_posting_times: sortedSuggestionTimes,
        suggest_button_enabled: config.suggestButtonEnabled,
        max_suggestions_per_day: Number(config.maxSuggestionsPerDay !== '' ? config.maxSuggestionsPerDay : 5),
        seed_reaction_emoji: config.seedReactionEmoji || null
      }, accessToken);

      setChannelConfigs(prev => ({
        ...prev,
        [type]: {
          ...prev[type],
          postingTimes: sortedPostingTimes,
          suggestionPostingTimes: sortedSuggestionTimes,
          suggestButtonEnabled: config.suggestButtonEnabled,
          maxSuggestionsPerDay: config.maxSuggestionsPerDay !== '' ? config.maxSuggestionsPerDay : 5,
          seedReactionEmoji: config.seedReactionEmoji || null
        }
      }));
      
      toast.success(`Настройки канала "${config.title}" успешно сохранены`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingChannel(prev => ({ ...prev, [type]: false }));
    }
  }

  // Отвязать канал от автопостера (только в Bullgram, бот остаётся админом в Telegram)
  async function handleUnlinkChannel(type) {
    const cfg = channelConfigs[type];
    if (!cfg.id || !createdBot?.id) return;
    if (!confirm(`Отвязать канал "${cfg.title}" от автопостера?\n\nБот останется админом в Telegram — вы сможете привязать канал заново без повторного добавления.`)) return;

    setUnlinkingChannel(prev => ({ ...prev, [type]: true }));
    try {
      await unlinkChannel(createdBot.id, cfg.id, accessToken);
      toast.success(`Канал "${cfg.title}" отвязан`);
      // UI обновится через realtime
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUnlinkingChannel(prev => ({ ...prev, [type]: false }));
    }
  }

  // Обновить метаданные канала из Telegram (title, username, visibility).
  // Если бот больше не админ — бэкенд авто-отвяжет канал.
  async function handleRefreshChannel(type) {
    const cfg = channelConfigs[type];
    if (!cfg.id || !createdBot?.id) return;

    setRefreshingChannel(prev => ({ ...prev, [type]: true }));
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
      setRefreshingChannel(prev => ({ ...prev, [type]: false }));
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
  async function handleRemoveAdmin(tgId) {
    if (!createdBot?.id) return;
    if (!confirm(`Удалить администратора ${tgId}?`)) return;
    try {
      const data = await removeAdmin(createdBot.id, tgId, accessToken);

      setAdmins(data.admin_tg_ids || []);
      toast.success('Администратор удален из списка');
    } catch (err) {
      toast.error(err.message);
    }
  }

  // Удалить бота
  async function handleDelete() {
    if (!createdBot?.id) return;
    if (!confirm('Удалить бота и все связанные каналы/посты навсегда?')) return;
    try {
      await deleteBot(createdBot.id, accessToken);

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
    navigator.clipboard.writeText(inviteLink);
    toast.success('Ссылка скопирована в буфер обмена');
  }

  // Изменение кнопок
  const handleAddButton = (type) => {
    setChannelConfigs(prev => {
      const ch = prev[type];
      return {
        ...prev,
        [type]: {
          ...ch,
          buttons: [...ch.buttons, { text: '', url: '' }]
        }
      };
    });
  };

  const handleRemoveButton = (type, index) => {
    setChannelConfigs(prev => {
      const ch = prev[type];
      return {
        ...prev,
        [type]: {
          ...ch,
          buttons: ch.buttons.filter((_, i) => i !== index)
        }
      };
    });
  };

  const handleButtonChange = (type, index, field, val) => {
    setChannelConfigs(prev => {
      const ch = prev[type];
      const newButtons = [...ch.buttons];
      newButtons[index] = { ...newButtons[index], [field]: val };
      return {
        ...prev,
        [type]: {
          ...ch,
          buttons: newButtons
        }
      };
    });
  };

  // Изменение времени публикаций
  const handleAddPostingTime = (type) => {
    setChannelConfigs(prev => {
      const ch = prev[type];
      const currentTimes = ch.postingTimes || ['10:00'];
      return {
        ...prev,
        [type]: {
          ...ch,
          postingTimes: [...currentTimes, '12:00']
        }
      };
    });
  };

  const handleRemovePostingTime = (type, index) => {
    setChannelConfigs(prev => {
      const ch = prev[type];
      const currentTimes = ch.postingTimes || ['10:00'];
      if (currentTimes.length <= 1) {
        toast.error('Должно быть выбрано хотя бы одно время публикации');
        return prev;
      }
      return {
        ...prev,
        [type]: {
          ...ch,
          postingTimes: currentTimes.filter((_, i) => i !== index)
        }
      };
    });
  };

  const handlePostingTimeChange = (type, index, val) => {
    setChannelConfigs(prev => {
      const ch = prev[type];
      const newTimes = [...(ch.postingTimes || ['10:00'])];
      newTimes[index] = val;
      return {
        ...prev,
        [type]: {
          ...ch,
          postingTimes: newTimes
        }
      };
    });
  };

  // Изменение времени публикаций для предложений
  const handleAddSuggestionTime = (type) => {
    setChannelConfigs(prev => {
      const ch = prev[type];
      const currentTimes = ch.suggestionPostingTimes || ['12:00'];
      return {
        ...prev,
        [type]: {
          ...ch,
          suggestionPostingTimes: [...currentTimes, '12:00']
        }
      };
    });
  };

  const handleRemoveSuggestionTime = (type, index) => {
    setChannelConfigs(prev => {
      const ch = prev[type];
      const currentTimes = ch.suggestionPostingTimes || ['12:00'];
      if (currentTimes.length <= 1) {
        toast.error('Должно быть выбрано хотя бы одно время публикации предложений');
        return prev;
      }
      return {
        ...prev,
        [type]: {
          ...ch,
          suggestionPostingTimes: currentTimes.filter((_, i) => i !== index)
        }
      };
    });
  };

  const handleSuggestionTimeChange = (type, index, val) => {
    setChannelConfigs(prev => {
      const ch = prev[type];
      const newTimes = [...(ch.suggestionPostingTimes || ['12:00'])];
      newTimes[index] = val;
      return {
        ...prev,
        [type]: {
          ...ch,
          suggestionPostingTimes: newTimes
        }
      };
    });
  };

  if (loading) return <LoadingState text="Загружаем автопостер..." />;

  // Определяем шаги онбординга
  const hasAdmin = admins.length > 0;
  const hasChannels = channels.length > 0;

  return (
    <section className="page page--flush space-y-6">
      {/* Подключение бота */}
      <Card className="p-0 gap-0 border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
        <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex flex-row items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0 animate-pulse">
                <Zap className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">Бот Автопостинга</h2>
                <p className="text-sm font-medium text-slate-500 mt-0.5">
                  Подключите Telegram-бота для автоматического постинга и приема предложений
                </p>
              </div>
            </div>
            <Select value={selectedBotId} onValueChange={setSelectedBotId}>
              <SelectTrigger className="h-10 w-[200px] bg-white rounded-xl border-slate-200 shadow-sm text-sm font-semibold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="new" className="rounded-lg">➕ Подключить нового</SelectItem>
                {existingBots.map((b) => (
                  <SelectItem key={b.id} value={b.id} className="rounded-lg">
                    @{b.username || 'Telegram Bot'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="p-5 sm:p-6 space-y-4">
          <div className="flex flex-col md:flex-row items-end gap-4">
            <div className="flex-1 w-full">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 block">Токен бота</label>
              <Input
                value={botToken}
                onChange={selectedBotId === 'new' ? (e) => setBotToken(e.target.value) : undefined}
                readOnly={selectedBotId !== 'new'}
                placeholder="123456:ABC-DEF..."
                spellCheck="false"
                className="font-mono bg-white h-11 rounded-xl border-slate-200 shadow-sm focus-visible:ring-indigo-500"
              />
            </div>
            <div className="flex gap-2 w-full md:w-auto">
              {selectedBotId === 'new' ? (
                <Button
                  onClick={handleConnect}
                  disabled={!botToken.trim() || initing}
                  className="h-11 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-md shadow-indigo-200 disabled:opacity-50 w-full md:w-auto"
                >
                  {initing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Инициализация...</> : 'Подключить'}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  onClick={handleDelete}
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

      {/* Onboarding State: Ожидание администратора */}
      {createdBot && !hasAdmin && (
        <Card className="border-0 shadow-lg shadow-indigo-100 ring-2 ring-indigo-500 bg-white overflow-hidden rounded-2xl p-6 sm:p-8 text-center space-y-6">
          <div className="mx-auto w-16 h-16 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600">
            <Loader2 className="w-8 h-8 animate-spin" />
          </div>
          <div className="max-w-md mx-auto space-y-2">
            <h3 className="text-lg font-bold text-slate-900">Ожидание активации бота</h3>
            <p className="text-sm text-slate-500">
              Пожалуйста, откройте вашего бота в Telegram и отправьте ему команду запуска. Это привяжет ваш аккаунт в качестве главного администратора.
            </p>
          </div>
          <div className="pt-2">
            <Button asChild size="lg" className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-8 py-6 text-base shadow-lg shadow-indigo-200">
              <a href={`https://t.me/${createdBot.bot_username}`} target="_blank" rel="noreferrer" className="flex items-center gap-2">
                Открыть @{createdBot.bot_username} <ExternalLink className="w-5 h-5" />
              </a>
            </Button>
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
              <li>Добавьте бота <span className="font-bold text-slate-800">@{createdBot.bot_username}</span> в ваш <b>Публичный канал</b> в качестве администратора (с правами на публикацию сообщений).</li>
              <li>Добавьте бота в ваш <b>Приватный канал</b> в качестве администратора.</li>
              <li>Бот автоматически поймает добавление и подключит каналы на эту страницу.</li>
            </ol>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400 font-semibold">
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
            {/* Интегрированный современный переключатель каналов внутри шапки карточки */}
            <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button
                  onClick={() => setActiveTab('public')}
                  className={`p-5 rounded-2xl border text-left transition-all duration-200 hover:scale-[1.01] active:scale-[0.99] cursor-pointer flex flex-col justify-between h-32 ${
                    activeTab === 'public'
                      ? 'border-indigo-600 bg-white ring-1 ring-indigo-600 shadow-md shadow-indigo-100/55'
                      : 'border-slate-200 bg-white/60 hover:border-slate-300 hover:bg-white/80 shadow-sm'
                  }`}
                >
                  <div className="flex items-start justify-between w-full">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${
                      activeTab === 'public' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-500'
                    }`}>
                      <Globe className="w-5 h-5" />
                    </div>
                    {channelConfigs.public.id ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1 animate-pulse"></span>
                        Подключен
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-50 text-slate-500 border border-slate-200">
                        Ожидание
                      </span>
                    )}
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-slate-900">Публичный канал</h4>
                    <p className="text-xs text-slate-400 font-semibold mt-1">
                      Предложка новостей и открытая лента
                    </p>
                  </div>
                </button>

                <button
                  onClick={() => setActiveTab('private')}
                  className={`p-5 rounded-2xl border text-left transition-all duration-200 hover:scale-[1.01] active:scale-[0.99] cursor-pointer flex flex-col justify-between h-32 ${
                    activeTab === 'private'
                      ? 'border-indigo-600 bg-white ring-1 ring-indigo-600 shadow-md shadow-indigo-100/55'
                      : 'border-slate-200 bg-white/60 hover:border-slate-300 hover:bg-white/80 shadow-sm'
                  }`}
                >
                  <div className="flex items-start justify-between w-full">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${
                      activeTab === 'private' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-500'
                    }`}>
                      <Lock className="w-5 h-5" />
                    </div>
                    {channelConfigs.private.id ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1 animate-pulse"></span>
                        Подключен
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-50 text-slate-500 border border-slate-200">
                        Ожидание
                      </span>
                    )}
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-slate-900">Приватный канал</h4>
                    <p className="text-xs text-slate-400 font-semibold mt-1">
                      Платный доступ по подписке
                    </p>
                  </div>
                </button>
              </div>
            </div>

            {/* Контент activeTab */}
            {['public', 'private'].map((tab) => {
              if (activeTab !== tab) return null;
              const config = channelConfigs[tab];

              if (!config.id) {
                return (
                  <div key={tab} className="p-8 text-center space-y-4 animate-fade-in">
                    <div className="mx-auto w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                      {tab === 'public' ? <Globe className="w-6 h-6" /> : <Lock className="w-6 h-6" />}
                    </div>
                    <div className="max-w-md mx-auto space-y-1">
                      <h3 className="font-bold text-slate-800">Канал не подключен</h3>
                      <p className="text-sm text-slate-500">
                        Для настройки добавьте бота в ваш {tab === 'public' ? 'публичный' : 'приватный'} канал в Telegram.
                      </p>
                    </div>
                  </div>
                );
              }

              return (
                <div key={tab} className="animate-fade-in divide-y divide-slate-100">
                  <div className="bg-slate-50/30 p-5 sm:p-6">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
                        <Settings className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-lg font-bold text-slate-900 truncate">{config.title}</h3>
                        <p className="text-xs font-semibold text-slate-400">Настройки публикации и предложки для этого канала</p>
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
                          onClick={() => handleUnlinkChannel(tab)}
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
                        <span className="text-xs text-slate-400 font-semibold leading-relaxed block">
                          Настройте точное время автоматической выкладки постов из очереди.
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5">
                        {(config.postingTimes || ['10:00']).map((time, idx) => (
                          <div key={idx} className="flex items-center gap-2 bg-slate-50 hover:bg-slate-100/70 p-2.5 rounded-xl border border-slate-200 transition-all focus-within:ring-1 focus-within:ring-indigo-500 focus-within:border-indigo-500">
                            <span className="text-[10px] font-bold text-slate-400 font-mono w-5 text-center">#{idx + 1}</span>
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
                          className="h-10 rounded-xl border-dashed text-slate-650 border-slate-200 hover:bg-slate-50 hover:text-indigo-600 hover:border-indigo-200 font-semibold text-xs transition-all flex items-center justify-center gap-1.5"
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
                      <p className="text-[11px] text-slate-400 font-semibold leading-relaxed">
                        По умолчанию используется часовой пояс вашего браузера.
                      </p>
                    </div>

                    <hr className="border-slate-100" />

                    {/* Кнопка предложки под постами */}
                    <div className="bg-slate-50/50 hover:bg-slate-50/80 rounded-2xl p-4 border border-slate-100 flex items-start justify-between gap-4 transition-all">
                      <div className="space-y-1">
                        <label className="text-sm font-bold text-slate-800 block">Кнопка «Предложить новость» под постами</label>
                        <span className="text-xs text-slate-400 font-semibold leading-relaxed block">
                          Добавляет под каждым публикуемым постом кнопку со ссылкой на бота для сбора предложений.
                        </span>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1 select-none">
                        <input
                          type="checkbox"
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

                    {/* Автореакция на посты */}
                    <div className="bg-slate-50/50 hover:bg-slate-50/80 rounded-2xl p-4 border border-slate-100 flex flex-col gap-3 transition-all">
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <label className="text-sm font-bold text-slate-800 block">Автореакция на посты</label>
                          <span className="text-xs text-slate-400 font-semibold leading-relaxed block">
                            Бот будет ставить выбранную реакцию под каждый новый пост сразу после публикации.
                          </span>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1 select-none">
                          <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={Boolean(config.seedReactionEmoji)}
                            onChange={(e) => setChannelConfigs(prev => ({
                              ...prev,
                              [tab]: { ...prev[tab], seedReactionEmoji: e.target.checked ? (prev[tab].seedReactionEmoji || '❤️') : null }
                            }))}
                          />
                          <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                        </label>
                      </div>
                      {Boolean(config.seedReactionEmoji) && (
                        <div className="flex items-center gap-2 flex-wrap pt-1 animate-fade-in">
                          {[
                            { emoji: '👍', label: 'Лайк' },
                            { emoji: '👎', label: 'Дизлайк' },
                            { emoji: '❤️', label: 'Сердце' },
                            { emoji: '🔥', label: 'Огонь' },
                            { emoji: '🥰', label: 'Восхищение' },
                            { emoji: '🎉', label: 'Праздник' }
                          ].map(opt => {
                            const active = config.seedReactionEmoji === opt.emoji;
                            return (
                              <button
                                key={opt.emoji}
                                type="button"
                                onClick={() => setChannelConfigs(prev => ({
                                  ...prev,
                                  [tab]: { ...prev[tab], seedReactionEmoji: opt.emoji }
                                }))}
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
                      )}
                    </div>

                    {/* Суточный лимит предложений */}
                    <div className="bg-slate-50/50 hover:bg-slate-50/80 rounded-2xl p-4 border border-slate-100 flex flex-col gap-3.5 transition-all">
                      <div className="space-y-1">
                        <label className="text-sm font-bold text-slate-800 block">Лимит предложений в сутки</label>
                        <span className="text-xs text-slate-400 font-semibold leading-relaxed block">
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
                        <span className="text-xs text-slate-400 font-semibold">постов / 24 часа</span>
                      </div>
                    </div>

                    {/* Автопринятие предложений */}
                    <div className="bg-slate-50/50 hover:bg-slate-50/80 rounded-2xl p-4 border border-slate-100 flex items-start justify-between gap-4 transition-all">
                      <div className="space-y-1">
                        <label className="text-sm font-bold text-slate-800 block">Автопринятие предложений</label>
                        <span className="text-xs text-slate-400 font-semibold leading-relaxed block">
                          Если включено, контент от пользователей в предложке будет автоматически публиковаться без ручной модерации.
                        </span>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1 select-none">
                        <input
                          type="checkbox"
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
                      <div className="space-y-4 pt-4 border-t border-slate-100 animate-fade-in">
                        <div className="space-y-1">
                          <label className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-indigo-500" /> Время публикаций предложенных постов
                          </label>
                          <span className="text-xs text-slate-400 font-semibold leading-relaxed block">
                            Отдельное расписание для автопринятых предложений от подписчиков.
                          </span>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5">
                          {(config.suggestionPostingTimes || ['12:00']).map((time, idx) => (
                            <div key={idx} className="flex items-center gap-2 bg-slate-50 hover:bg-slate-100/70 p-2.5 rounded-xl border border-slate-200 transition-all focus-within:ring-1 focus-within:ring-indigo-500 focus-within:border-indigo-500">
                              <span className="text-[10px] font-bold text-slate-400 font-mono w-5 text-center">#{idx + 1}</span>
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
                            className="h-10 rounded-xl border-dashed text-slate-650 border-slate-200 hover:bg-slate-50 hover:text-indigo-600 hover:border-indigo-200 font-semibold text-xs transition-all flex items-center justify-center gap-1.5"
                          >
                            <Plus className="w-3.5 h-3.5 text-indigo-500" /> Добавить время
                          </Button>
                        </div>
                      </div>
                    )}

                    <hr className="border-slate-100" />

                    {/* Конструктор кнопок */}
                    <div className="space-y-4">
                      <div className="space-y-1">
                        <label className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                          <Layout className="w-3.5 h-3.5 text-indigo-500" /> Кнопки под каждым постом
                        </label>
                        <span className="text-xs text-slate-400 font-semibold leading-relaxed block">
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
                          className="h-11 px-4 rounded-xl border-dashed text-slate-650 border-slate-200 hover:bg-slate-50 hover:text-indigo-650 hover:border-indigo-200 font-semibold text-xs transition-all flex items-center justify-center gap-1.5"
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

          {/* Список Администраторов (В самом низу) */}
          <Card className="p-0 gap-0 border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
            <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Администраторы бота</h3>
                  <p className="text-xs font-semibold text-slate-400">Управляйте правами доступа и генерируйте приглашения</p>
                </div>
              </div>
            </div>
            
            <div className="p-5 sm:p-6 space-y-6">
              {/* Ссылка-приглашение */}
              {inviteLink && (
                <div className="space-y-2 max-w-xl">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-500 block">Пригласить администратора</label>
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={inviteLink}
                      onClick={handleCopyInvite}
                      className="font-mono bg-slate-50 h-11 rounded-xl border-slate-200 shadow-sm cursor-pointer"
                    />
                    <Button onClick={handleCopyInvite} className="h-11 px-4 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-600 border-0">
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                  <span className="text-xs text-slate-400 font-medium block">
                    Пользователь перейдет по ссылке в бота и автоматически получит доступ к администрированию постов и модерации.
                  </span>
                </div>
              )}

              {/* Список текущих админов */}
              <div className="space-y-3">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 block">Список админов ({admins.length})</label>
                <div className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden max-w-md">
                  {admins.map((adminId, idx) => {
                    const isOwner = idx === 0;
                    return (
                      <div key={adminId} className="flex items-center justify-between p-3.5 bg-white text-sm font-semibold">
                        <span className="font-mono text-slate-700">{adminId}</span>
                        {isOwner ? (
                          <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-md">Владелец</span>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveAdmin(adminId)}
                            className="text-rose-500 hover:text-rose-600 hover:bg-rose-50 h-8 rounded-lg"
                          >
                            Удалить
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
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
    </section>
  );
}
