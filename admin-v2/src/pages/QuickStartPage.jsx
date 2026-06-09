import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Hash, Loader2, Save, Trash2, Zap, Copy, Plus, Lock, Globe, Shield, UserPlus, Check, Clock, AlertTriangle, RefreshCw, X, Settings } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { Button } from '../components/ui/button.jsx';
import { Card } from '../components/ui/card.jsx';
import { Input } from '../components/ui/input.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select.jsx';
import { Badge } from '../components/ui/badge.jsx';
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
  
  // Bot states
  const [existingBots, setExistingBots] = useState([]);
  const [createdBot, setCreatedBot] = useState(null);
  const [channels, setChannels] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [inviteLink, setInviteLink] = useState('');
  
  // Action loading states
  const [initing, setIniting] = useState(false);
  const [savingBotStatus, setSavingBotStatus] = useState(false);
  const [savingChannelId, setSavingChannelId] = useState('');
  const [refreshingChannelId, setRefreshingChannelId] = useState('');
  const [addingAdmin, setAddingAdmin] = useState(false);
  const [newAdminTgId, setNewAdminTgId] = useState('');
  
  // Channels local configs mapping
  const [channelConfigs, setChannelConfigs] = useState({});

  const pollRef = useRef(null);

  // Загрузка существующих ботов
  const loadBots = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { data } = await supabase
        .from('autopost_bots')
        .select('*')
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
      setChannelConfigs({});
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    
    const bot = existingBots.find((b) => b.id === selectedBotId);
    if (!bot) return;
    
    setBotToken(bot.bot_token || '');
    setCreatedBot({ id: bot.id, bot_username: bot.username, admin_tg_id: bot.admin_tg_id, is_active: bot.is_active });
    
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
        
        // Populate local configs for each channel
        const newConfigs = {};
        data.channels.forEach(ch => {
          newConfigs[ch.id] = {
            id: ch.id,
            tgChatId: ch.tg_chat_id,
            title: ch.title || '',
            postsPerDay: String(ch.posts_per_day || 1),
            autoAccept: ch.auto_accept_suggestions || false,
            buttons: ch.buttons_config || []
          };
        });
        setChannelConfigs(newConfigs);
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
          
          setChannelConfigs(prev => {
            const updated = { ...prev };
            chData.channels.forEach(ch => {
              if (!updated[ch.id]) {
                updated[ch.id] = {
                  id: ch.id,
                  tgChatId: ch.tg_chat_id,
                  title: ch.title || '',
                  postsPerDay: String(ch.posts_per_day || 1),
                  autoAccept: ch.auto_accept_suggestions || false,
                  buttons: ch.buttons_config || []
                };
              } else {
                // Merge update safely
                updated[ch.id] = {
                  ...updated[ch.id],
                  title: ch.title || updated[ch.id].title,
                  postsPerDay: String(ch.posts_per_day || updated[ch.id].postsPerDay || 1),
                  autoAccept: ch.auto_accept_suggestions ?? updated[ch.id].autoAccept ?? false,
                  buttons: ch.buttons_config || updated[ch.id].buttons || []
                };
              }
            });
            return updated;
          });
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
      
      setCreatedBot({ id: data.bot.id, bot_username: data.bot.username, admin_tg_id: null, is_active: true });
      setExistingBots((prev) => [...prev, data.bot]);
      setSelectedBotId(data.bot.id);
      toast.success('Бот успешно подключен! Активируйте его в Telegram.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setIniting(false);
    }
  }

  // Переключить статус активности бота
  async function handleToggleBotStatus(newStatus) {
    if (!createdBot?.id || savingBotStatus) return;
    setSavingBotStatus(true);
    try {
      const res = await fetch(`/api/autopost/bots/${createdBot.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ is_active: newStatus })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка изменения статуса');
      
      setCreatedBot(prev => ({ ...prev, is_active: data.bot.is_active }));
      setExistingBots(prev => prev.map(b => b.id === createdBot.id ? { ...b, is_active: data.bot.is_active } : b));
      toast.success(newStatus ? 'Автопостер включен' : 'Автопостер отключен');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingBotStatus(false);
    }
  }

  // Сохранить настройки конкретного канала
  async function handleSaveChannelConfig(channelId) {
    const config = channelConfigs[channelId];
    if (!config || !createdBot?.id) return;
    
    setSavingChannelId(channelId);
    try {
      const n = Number(config.postsPerDay);
      const res = await fetch(`/api/autopost/bots/${createdBot.id}/channels/${channelId}`, {
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
      
      toast.success(`Настройки для канала "${config.title}" сохранены`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingChannelId('');
    }
  }

  // Обновить информацию о канале с Telegram
  async function handleRefreshChannel(channel) {
    const channelId = String(channel?.id || '').trim();
    if (!channelId || !createdBot?.id) return;
    
    setRefreshingChannelId(channelId);
    try {
      await fetchChannels(createdBot.id);
      toast.success('Информация о канале обновлена');
    } catch (e) {
      toast.error('Ошибка обновления информации');
    } finally {
      setRefreshingChannelId('');
    }
  }

  // Удалить канал
  async function handleDeleteChannel(channel) {
    const channelId = String(channel?.id || '').trim();
    if (!channelId || !createdBot?.id) return;
    if (!confirm(`Отвязать канал "${channel.title || channel.tg_chat_id}" от автопостера?`)) return;
    
    try {
      const { error } = await supabase.from('channels').delete().eq('id', channelId);
      if (error) throw error;
      
      setChannels(prev => prev.filter(c => c.id !== channelId));
      setChannelConfigs(prev => {
        const updated = { ...prev };
        delete updated[channelId];
        return updated;
      });
      toast.success('Канал успешно отвязан');
    } catch (err) {
      toast.error(err.message);
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
  const handleAddButton = (channelId) => {
    setChannelConfigs(prev => {
      const ch = prev[channelId];
      if (!ch) return prev;
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
      if (!ch) return prev;
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
      if (!ch) return prev;
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

  if (loading) return <LoadingState text="Загружаем автопостер..." />;

  const hasAdmin = admins.length > 0;
  const hasChannels = channels.length > 0;

  return (
    <section className="page page--flush flex flex-col gap-6">
      
      {/* 1. Подключить нового бота */}
      <Card className="border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
        <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
          <div className="flex flex-row items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
              <Zap className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">Подключить новый автопостер</h2>
              <p className="text-sm font-medium text-slate-500 mt-0.5">
                Получите токен у @BotFather и вставьте его сюда для запуска автопостинга.
              </p>
            </div>
          </div>
        </div>
        <div className="p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row items-end gap-4 max-w-4xl">
            <div className="flex-1 w-full">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 block">Токен бота</label>
              <Input
                value={botToken}
                onChange={selectedBotId === 'new' ? (e) => setBotToken(e.target.value) : undefined}
                readOnly={selectedBotId !== 'new'}
                placeholder="8123456789:AAE_x7v9Kq2Lm..."
                spellCheck="false"
                className="font-mono bg-white h-11 rounded-xl border-slate-200 shadow-sm focus-visible:ring-indigo-500"
              />
            </div>
            <div className="flex gap-3 w-full sm:w-auto">
              {selectedBotId === 'new' ? (
                <Button
                  onClick={handleConnect}
                  disabled={!botToken.trim() || initing}
                  className="h-11 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-md shadow-indigo-200 w-full sm:w-auto"
                >
                  {initing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  {initing ? 'Подключение...' : 'Подключить'}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  onClick={handleDelete}
                  className="h-11 px-4 rounded-xl text-rose-600 hover:bg-rose-50 font-bold border border-rose-100 w-full sm:w-auto"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Удалить бота
                </Button>
              )}
              <Button variant="outline" asChild className="h-11 rounded-xl w-full sm:w-auto text-slate-700 border-slate-200 shadow-sm font-semibold">
                <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="flex items-center gap-2">
                  @BotFather <ExternalLink className="w-4 h-4" />
                </a>
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* 2. Выбор и статус бота (Настройка бота) */}
      <Card className="border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
        <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
          <div className="flex flex-row items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
              <Settings className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">Настройка автопостинга</h2>
              <p className="text-sm font-medium text-slate-500 mt-0.5">
                Конфигурация активности автопостера и управление доступом.
              </p>
            </div>
          </div>
        </div>
        
        <div className="p-5 sm:p-6 bg-white space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 block">Выбранный автопостер</label>
              <Select value={selectedBotId} onValueChange={setSelectedBotId}>
                <SelectTrigger className="h-11 w-full bg-white rounded-xl border-slate-200 shadow-sm focus:ring-indigo-500 font-semibold text-slate-800">
                  <SelectValue placeholder="Выберите бота" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="new" className="rounded-lg">➕ Подключить нового</SelectItem>
                  {existingBots.map((b) => (
                    <SelectItem key={b.id} value={b.id} className="rounded-lg py-2.5">
                      <span className="font-semibold">@{b.username || 'Telegram Bot'}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {createdBot && (
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 block">Состояние работы</label>
                <div className="flex items-center gap-3 h-11">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={createdBot.is_active}
                    disabled={savingBotStatus}
                    onClick={() => handleToggleBotStatus(!createdBot.is_active)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
                      savingBotStatus ? 'opacity-50 pointer-events-none' : ''
                    } ${createdBot.is_active ? 'bg-indigo-600' : 'bg-slate-200'}`}
                  >
                    <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${createdBot.is_active ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                  <span className={`text-sm font-bold ${createdBot.is_active ? 'text-indigo-600' : 'text-slate-400'}`}>
                    {createdBot.is_active ? 'Автопостинг включен' : 'Автопостинг выключен'}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Onboarding State: Ожидание администратора */}
          {createdBot && !hasAdmin && (
            <div className="rounded-2xl border-2 border-dashed border-indigo-200 bg-indigo-50/50 p-6 text-center space-y-4 max-w-2xl mx-auto">
              <div className="mx-auto w-12 h-12 rounded-full bg-white flex items-center justify-center text-indigo-600 shadow-sm">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-slate-900">Ожидание активации в Telegram</h3>
                <p className="text-xs text-slate-500 leading-relaxed max-w-md mx-auto">
                  Откройте вашего бота в Telegram, введите команду <b>`/start`</b> и нажмите кнопку <b>`✅ Я администратор`</b> для подтверждения прав владельца.
                </p>
              </div>
              <Button asChild className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold h-10 px-5 shadow-sm text-sm">
                <a href={`https://t.me/${createdBot.bot_username}`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5">
                  Открыть @{createdBot.bot_username} <ExternalLink className="w-4 h-4" />
                </a>
              </Button>
            </div>
          )}

          {/* Onboarding State: Ожидание подключения каналов */}
          {createdBot && hasAdmin && !hasChannels && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-6 space-y-3 max-w-2xl mx-auto">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div className="space-y-1.5">
                  <h3 className="text-sm font-bold text-slate-900">Подключение каналов</h3>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Администратор успешно привязан. Чтобы автопостер заработал, сделайте бота администратором в ваших каналах:
                  </p>
                  <ul className="list-disc list-inside text-xs text-slate-600 space-y-1">
                    <li>Добавьте бота в ваш <b>Публичный канал</b> (с правами на посты).</li>
                    <li>Добавьте бота в ваш <b>Приватный канал</b>.</li>
                  </ul>
                  <p className="text-[11px] text-indigo-500 font-semibold flex items-center gap-1">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Ожидание авто-привязки каналов...
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* 3. Подключенные каналы (PlacesSection) */}
      {createdBot && hasAdmin && (
        <Card className="border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
          <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
            <div className="flex flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
                  <Globe className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                    Настройки публикаций в каналах
                    {channels.length > 0 && (
                      <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border-0 text-xs rounded-full px-2">
                        {channels.length}
                      </Badge>
                    )}
                  </h2>
                  <p className="text-sm font-medium text-slate-500 mt-0.5">
                    Индивидуальные параметры постинга, предложек и кнопок для каждого канала.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {!channels.length ? (
            <div className="p-12 text-center flex flex-col items-center justify-center bg-white">
              <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4 ring-1 ring-slate-100">
                <Globe className="w-8 h-8 text-slate-300" />
              </div>
              <h3 className="text-base font-bold text-slate-900">Каналов пока нет</h3>
              <p className="mt-1 text-sm text-slate-500 max-w-sm">
                Назначьте бота администратором в вашем канале Telegram, чтобы он автоматически отобразился в этом списке.
              </p>
            </div>
          ) : (
            <div className="p-5 sm:p-6 space-y-4 bg-white">
              {channels.map((channel) => {
                const config = channelConfigs[channel.id];
                if (!config) return null;
                const isSaving = savingChannelId === channel.id;
                const isRefreshing = refreshingChannelId === channel.id;
                const username = String(channel?.username || '').trim().replace(/^@/, '');
                
                return (
                  <div key={channel.id} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:border-slate-300 transition-colors space-y-5">
                    {/* Channel Info Header */}
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2.5 flex-wrap mb-1">
                          <span className="text-base font-bold text-slate-900 truncate">{channel.title || 'Без названия'}</span>
                          <Badge variant="outline" className={`shadow-sm px-2 py-0.5 text-xs font-bold border ${
                            channel.visibility === 'public' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-700 border-slate-200'
                          }`}>
                            {channel.visibility === 'public' ? 'Открытый канал 📢' : 'Закрытый канал 🔒'}
                          </Badge>
                          {username && (
                            <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200 shadow-sm px-2 py-0.5 text-xs font-bold">
                              @{username}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                          <span className="font-mono bg-slate-50 px-2 py-0.5 rounded-md border border-slate-100">ID: {channel.tg_chat_id}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 rounded-xl text-slate-700 font-bold border-slate-200 shadow-sm hover:bg-slate-50"
                          onClick={() => handleRefreshChannel(channel)}
                          disabled={isRefreshing}
                        >
                          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                          {isRefreshing ? 'Обновление...' : 'Обновить'}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 rounded-xl text-rose-600 border-rose-200 bg-rose-50 hover:bg-rose-100 font-bold shadow-sm"
                          onClick={() => handleDeleteChannel(channel)}
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                          Удалить
                        </Button>
                      </div>
                    </div>

                    {/* Settings Form for this Channel */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-slate-400" /> Частота постинга в день
                        </label>
                        <Select
                          value={config.postsPerDay}
                          onValueChange={(val) => setChannelConfigs(prev => ({
                            ...prev,
                            [channel.id]: { ...prev[channel.id], postsPerDay: val }
                          }))}
                        >
                          <SelectTrigger className="h-10 w-full bg-white rounded-xl border-slate-200 shadow-sm font-semibold">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl">
                            <SelectItem value="1" className="rounded-lg">1 пост в день (10:00)</SelectItem>
                            <SelectItem value="2" className="rounded-lg">2 поста (10:00, 18:00)</SelectItem>
                            <SelectItem value="3" className="rounded-lg">3 поста (08:00, 14:00, 20:00)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="flex items-start justify-between gap-4 bg-slate-50/50 p-3.5 border border-slate-100 rounded-xl">
                        <div className="space-y-0.5">
                          <label className="text-sm font-bold text-slate-800 block">Автопринятие предложений</label>
                          <span className="text-[11px] text-slate-500 font-medium leading-relaxed block">
                            Автоматическая публикация предложенного пользователями контента без ручной модерации.
                          </span>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-0.5">
                          <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={config.autoAccept}
                            onChange={(e) => setChannelConfigs(prev => ({
                              ...prev,
                              [channel.id]: { ...prev[channel.id], autoAccept: e.target.checked }
                            }))}
                          />
                          <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                        </label>
                      </div>
                    </div>

                    {/* Inline Buttons Constructor */}
                    <div className="space-y-3 pt-2">
                      <div className="space-y-0.5">
                        <label className="text-sm font-bold text-slate-800 block">Кнопки под постами в канале</label>
                        <span className="text-xs text-slate-400 font-medium leading-relaxed block">
                          Инлайн-кнопки (например, ссылка на оплату подписки), которые прикрепляются к публикациям.
                        </span>
                      </div>
                      
                      <div className="space-y-2 max-w-2xl">
                        {config.buttons.map((btn, idx) => (
                          <div key={idx} className="flex items-center gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                            <div className="flex-1">
                              <Input
                                value={btn.text}
                                onChange={(e) => handleButtonChange(channel.id, idx, 'text', e.target.value)}
                                placeholder="Текст кнопки"
                                className="bg-white h-9 rounded-lg border-slate-200 shadow-sm text-sm"
                              />
                            </div>
                            <div className="flex-[2]">
                              <Input
                                value={btn.url}
                                onChange={(e) => handleButtonChange(channel.id, idx, 'url', e.target.value)}
                                placeholder="Ссылка (https://...)"
                                className="bg-white h-9 rounded-lg border-slate-200 shadow-sm text-sm"
                              />
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleRemoveButton(channel.id, idx)}
                              className="h-9 w-9 text-rose-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg shrink-0"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        ))}
                        
                        <Button
                          variant="outline"
                          onClick={() => handleAddButton(channel.id)}
                          className="w-full max-w-xs h-9 rounded-lg border-dashed text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-slate-800 font-semibold text-xs"
                        >
                          <Plus className="w-3.5 h-3.5 mr-1" /> Добавить кнопку под пост
                        </Button>
                      </div>
                    </div>

                    {/* Save Config Button */}
                    <div className="flex justify-start pt-2 border-t border-slate-100">
                      <Button
                        onClick={() => handleSaveChannelConfig(channel.id)}
                        disabled={isSaving}
                        className="h-10 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-md shadow-indigo-200 disabled:opacity-50 text-sm"
                      >
                        {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                        Сохранить настройки канала
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* 4. Администраторы бота */}
      {createdBot && hasAdmin && (
        <Card className="border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
          <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
            <div className="flex flex-row items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
                <Shield className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900">Администраторы автопостера</h3>
                <p className="text-sm font-medium text-slate-500 mt-0.5">
                  Управляйте правами доступа и генерируйте приглашения для соадминистраторов.
                </p>
              </div>
            </div>
          </div>
          
          <div className="p-5 sm:p-6 bg-white space-y-6">
            {inviteLink && (
              <div className="space-y-1.5 max-w-xl">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 block">Ссылка-приглашение соадмина</label>
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
                  Перейдя по этой ссылке, пользователь привяжет свой Telegram ID и сможет наполнять/управлять очередями постов.
                </span>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 block">Зарегистрированные администраторы ({admins.length})</label>
              <div className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden max-w-md bg-slate-50/30">
                {admins.map((adminId) => {
                  const isOwner = String(adminId) === String(createdBot.admin_tg_id);
                  return (
                    <div key={adminId} className="flex items-center justify-between p-3.5 bg-white text-sm font-semibold">
                      <span className="font-mono text-slate-700">{adminId}</span>
                      {isOwner ? (
                        <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100 shadow-sm">Владелец</span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveAdmin(adminId)}
                          className="text-rose-500 hover:text-rose-600 hover:bg-rose-50 h-8 rounded-lg font-bold"
                        >
                          Удалить
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5 max-w-md">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 block">Добавить вручную по Telegram ID</label>
              <div className="flex gap-2">
                <Input
                  value={newAdminTgId}
                  onChange={(e) => setNewAdminTgId(e.target.value)}
                  placeholder="ID (например: 123456789)"
                  className="bg-white h-11 rounded-xl border-slate-200 shadow-sm"
                />
                <Button
                  onClick={handleAddAdmin}
                  disabled={!newAdminTgId.trim() || addingAdmin}
                  className="h-11 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-md shadow-indigo-200 shrink-0"
                >
                  {addingAdmin ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4 mr-2" />}
                  Добавить
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}
    </section>
  );
}
