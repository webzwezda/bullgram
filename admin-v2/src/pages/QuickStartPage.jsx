import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Hash, Loader2, Save, Trash2, Zap, Copy, Plus, Lock, Globe, Shield, UserPlus, Check, Clock, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { Button } from '../components/ui/button.jsx';
import { Card } from '../components/ui/card.jsx';
import { Input } from '../components/ui/input.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select.jsx';
import { supabase } from '../lib/supabase.js';
import { LoadingState } from '../ui/LoadingState.jsx';

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
  const [addingAdmin, setAddingAdmin] = useState(false);
  const [newAdminTgId, setNewAdminTgId] = useState('');
  
  // Active Tab for connected channels config
  const [activeTab, setActiveTab] = useState('public');
  
  // Configs for channels
  const [channelConfigs, setChannelConfigs] = useState({
    public: { id: null, tgChatId: null, title: '', postsPerDay: '1', autoAccept: false, buttons: [] },
    private: { id: null, tgChatId: null, title: '', postsPerDay: '1', autoAccept: false, buttons: [] }
  });

  const pollRef = useRef(null);

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
      setChannelConfigs({
        public: { id: null, tgChatId: null, title: '', postsPerDay: '1', autoAccept: false, buttons: [] },
        private: { id: null, tgChatId: null, title: '', postsPerDay: '1', autoAccept: false, buttons: [] }
      });
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    
    const bot = existingBots.find((b) => b.id === selectedBotId);
    if (!bot) return;
    
    setBotToken(bot.bot_token || '');
    setCreatedBot({ id: bot.id, bot_username: bot.username, admin_tg_id: bot.admin_tg_id });
    
    fetchChannels(bot.id);
    fetchAdmins(bot.id);
  }, [selectedBotId, existingBots]);

  async function fetchChannels(botId) {
    try {
      const res = await fetch(`/api/autopost/bots/${botId}/channels`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const data = await res.json();
      if (data.channels) {
        setChannels(data.channels);
        
        const pubCh = data.channels.find(c => c.visibility === 'public');
        const privCh = data.channels.find(c => c.visibility === 'private');
        
        setChannelConfigs({
          public: {
            id: pubCh?.id || null,
            tgChatId: pubCh?.tg_chat_id || null,
            title: pubCh?.title || '',
            postsPerDay: String(pubCh?.posts_per_day || 1),
            autoAccept: pubCh?.auto_accept_suggestions || false,
            buttons: pubCh?.buttons_config || []
          },
          private: {
            id: privCh?.id || null,
            tgChatId: privCh?.tg_chat_id || null,
            title: privCh?.title || '',
            postsPerDay: String(privCh?.posts_per_day || 1),
            autoAccept: privCh?.auto_accept_suggestions || false,
            buttons: privCh?.buttons_config || []
          }
        });
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function fetchAdmins(botId) {
    try {
      const res = await fetch(`/api/autopost/bots/${botId}/admins`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const data = await res.json();
      if (data.admin_tg_ids) {
        setAdmins(data.admin_tg_ids);
        setInviteLink(data.invite_link || '');
      }
    } catch (e) {
      console.error(e);
    }
  }

  // Поллинг состояния каналов и админов (для онбординга)
  useEffect(() => {
    if (selectedBotId === 'new' || !createdBot?.id) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }

    pollRef.current = setInterval(async () => {
      try {
        // Опрос каналов
        const chRes = await fetch(`/api/autopost/bots/${createdBot.id}/channels`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        const chData = await chRes.json();
        if (chData.channels) {
          setChannels(chData.channels);
          
          const pubCh = chData.channels.find(c => c.visibility === 'public');
          const privCh = chData.channels.find(c => c.visibility === 'private');
          
          setChannelConfigs(prev => ({
            public: {
              ...prev.public,
              id: pubCh?.id || null,
              tgChatId: pubCh?.tg_chat_id || null,
              title: pubCh?.title || '',
              postsPerDay: String(pubCh?.posts_per_day || prev.public.postsPerDay || 1),
              autoAccept: pubCh?.auto_accept_suggestions ?? prev.public.autoAccept ?? false,
              buttons: pubCh?.buttons_config || prev.public.buttons || []
            },
            private: {
              ...prev.private,
              id: privCh?.id || null,
              tgChatId: privCh?.tg_chat_id || null,
              title: privCh?.title || '',
              postsPerDay: String(privCh?.posts_per_day || prev.private.postsPerDay || 1),
              autoAccept: privCh?.auto_accept_suggestions ?? prev.private.autoAccept ?? false,
              buttons: privCh?.buttons_config || prev.private.buttons || []
            }
          }));
        }

        // Опрос списка админов
        const admRes = await fetch(`/api/autopost/bots/${createdBot.id}/admins`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        const admData = await admRes.json();
        if (admData.admin_tg_ids) {
          setAdmins(admData.admin_tg_ids);
          setInviteLink(admData.invite_link || '');
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 3000);

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [createdBot?.id, selectedBotId, accessToken]);

  // Подключение бота (валидация токена + создание)
  async function handleConnect() {
    if (!botToken.trim() || initing) return;
    setIniting(true);
    try {
      const res = await fetch('/api/autopost/bots/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          botToken: botToken.trim()
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка подключения бота');
      
      setCreatedBot({ id: data.bot.id, bot_username: data.bot.username, admin_tg_id: null });
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
      const n = Number(config.postsPerDay);
      const res = await fetch(`/api/autopost/bots/${createdBot.id}/channels/${config.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          auto_accept_suggestions: config.autoAccept,
          buttons_config: config.buttons,
          posts_per_day: n,
          posting_times: postingTimesFor(n)
        })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка сохранения настроек канала');
      
      toast.success(`Настройки канала "${config.title}" успешно сохранены`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingChannel(prev => ({ ...prev, [type]: false }));
    }
  }

  // Добавить администратора вручную
  async function handleAddAdmin() {
    if (!newAdminTgId.trim() || addingAdmin || !createdBot?.id) return;
    setAddingAdmin(true);
    try {
      const res = await fetch(`/api/autopost/bots/${createdBot.id}/admins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ adminTgId: newAdminTgId.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка добавления администратора');
      
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
      const res = await fetch(`/api/autopost/bots/${createdBot.id}/admins/${tgId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка удаления администратора');
      
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
      const res = await fetch(`/api/autopost/bots/${createdBot.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Ошибка удаления');
      }
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

  if (loading) return <LoadingState text="Загружаем автопостер..." />;

  // Определяем шаги онбординга
  const hasAdmin = admins.length > 0;
  const hasChannels = channels.length > 0;

  return (
    <section className="page page--flush space-y-6">
      {/* Подключение бота */}
      <Card className="border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
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
          {/* Переключатель вкладок каналов */}
          <div className="flex border-b border-slate-200 bg-slate-50/50 p-1.5 rounded-2xl ring-1 ring-slate-200/50">
            <button
              onClick={() => setActiveTab('public')}
              className={`flex-1 py-3 px-4 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${
                activeTab === 'public'
                  ? 'bg-white text-slate-900 shadow-md shadow-slate-200/60'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Globe className="w-4 h-4" />
              Публичный канал
              {channelConfigs.public.id ? (
                <span className="w-2 h-2 rounded-full bg-emerald-500 ml-1"></span>
              ) : (
                <span className="text-xs font-medium text-slate-400">(не привязан)</span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('private')}
              className={`flex-1 py-3 px-4 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${
                activeTab === 'private'
                  ? 'bg-white text-slate-900 shadow-md shadow-slate-200/60'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Lock className="w-4 h-4" />
              Приватный канал
              {channelConfigs.private.id ? (
                <span className="w-2 h-2 rounded-full bg-emerald-500 ml-1"></span>
              ) : (
                <span className="text-xs font-medium text-slate-400">(не привязан)</span>
              )}
            </button>
          </div>

          {/* Контент активной вкладки */}
          {['public', 'private'].map((tab) => {
            if (activeTab !== tab) return null;
            const config = channelConfigs[tab];
            
            if (!config.id) {
              return (
                <Card key={tab} className="border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl p-8 text-center space-y-4">
                  <div className="mx-auto w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                    {tab === 'public' ? <Globe className="w-6 h-6" /> : <Lock className="w-6 h-6" />}
                  </div>
                  <div className="max-w-md mx-auto space-y-1">
                    <h3 className="font-bold text-slate-800">Канал не подключен</h3>
                    <p className="text-sm text-slate-500">
                      Для настройки добавьте бота в ваш {tab === 'public' ? 'публичный' : 'приватный'} канал в Telegram.
                    </p>
                  </div>
                </Card>
              );
            }

            return (
              <Card key={tab} className="border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
                <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
                      <Settings className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-900">{config.title}</h3>
                      <p className="text-xs font-semibold text-slate-400">Настройки публикации и предложки для этого канала</p>
                    </div>
                  </div>
                </div>
                
                <div className="p-5 sm:p-6 space-y-6">
                  {/* Частота постинга */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" /> Частота постов в день
                    </label>
                    <Select
                      value={config.postsPerDay}
                      onValueChange={(val) => setChannelConfigs(prev => ({
                        ...prev,
                        [tab]: { ...prev[tab], postsPerDay: val }
                      }))}
                    >
                      <SelectTrigger className="h-11 w-full max-w-md bg-white rounded-xl border-slate-200 shadow-sm focus:ring-indigo-500 font-medium">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl">
                        <SelectItem value="1" className="rounded-lg">1 пост в день (10:00)</SelectItem>
                        <SelectItem value="2" className="rounded-lg">2 поста (10:00, 18:00)</SelectItem>
                        <SelectItem value="3" className="rounded-lg">3 поста (08:00, 14:00, 20:00)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <hr className="border-slate-100" />

                  {/* Автопринятие предложек */}
                  <div className="flex items-start justify-between gap-4 max-w-2xl">
                    <div className="space-y-1">
                      <label className="text-sm font-bold text-slate-800 block">Автопринятие предложений</label>
                      <span className="text-xs text-slate-500 font-medium leading-relaxed block">
                        Если включено, контент от пользователей в предложке будет автоматически одобряться и ставиться в расписание без вашей ручной модерации.
                      </span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
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

                  <hr className="border-slate-100" />

                  {/* Конструктор кнопок */}
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <label className="text-sm font-bold text-slate-800 block">Кнопки под каждым постом</label>
                      <span className="text-xs text-slate-500 font-medium leading-relaxed block">
                        Вы можете настроить инлайн-кнопки (например, ссылку на оплату подписки), которые будут автоматически прикрепляться под каждым постом в этом канале.
                      </span>
                    </div>

                    <div className="space-y-3 max-w-3xl">
                      {config.buttons.map((btn, idx) => (
                        <div key={idx} className="flex items-center gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100">
                          <div className="flex-1">
                            <Input
                              value={btn.text}
                              onChange={(e) => handleButtonChange(tab, idx, 'text', e.target.value)}
                              placeholder="Текст кнопки"
                              className="bg-white h-10 rounded-lg border-slate-200 shadow-sm"
                            />
                          </div>
                          <div className="flex-[2]">
                            <Input
                              value={btn.url}
                              onChange={(e) => handleButtonChange(tab, idx, 'url', e.target.value)}
                              placeholder="Ссылка (https://...)"
                              className="bg-white h-10 rounded-lg border-slate-200 shadow-sm"
                            />
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemoveButton(tab, idx)}
                            className="h-10 w-10 text-rose-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}

                      <Button
                        variant="outline"
                        onClick={() => handleAddButton(tab)}
                        className="w-full max-w-xs h-10 rounded-lg border-dashed text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-slate-800 font-semibold text-sm"
                      >
                        <Plus className="w-4 h-4 mr-2" /> Добавить кнопку
                      </Button>
                    </div>
                  </div>

                  <hr className="border-slate-100" />

                  {/* Кнопка сохранения настроек канала */}
                  <div className="flex justify-start">
                    <Button
                      onClick={() => handleSaveChannelConfig(tab)}
                      disabled={savingChannel[tab]}
                      className="h-11 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-md shadow-indigo-200 disabled:opacity-50"
                    >
                      {savingChannel[tab] ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                      Сохранить настройки канала
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}

          {/* Список Администраторов (В самом низу) */}
          <Card className="border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
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
                  {admins.map((adminId) => {
                    const isOwner = String(adminId) === String(createdBot.admin_tg_id);
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
