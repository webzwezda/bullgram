import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Hash, Loader2, Save, Trash2, Zap } from 'lucide-react';
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
  const [adminTgId, setAdminTgId] = useState('');
  const [targetChannel, setTargetChannel] = useState('');
  const [postsPerDay, setPostsPerDay] = useState('1');
  const [channels, setChannels] = useState([]);
  const [existingBots, setExistingBots] = useState([]);
  const [saving, setSaving] = useState(false);
  const [initing, setIniting] = useState(false);
  const [createdBot, setCreatedBot] = useState(null);
  const pollRef = useRef(null);

  // Загрузка существующих ботов
  useEffect(() => {
    async function load() {
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
    }
    load();
  }, [user?.id]);

  // При выборе существующего бота — загрузить его настройки
  useEffect(() => {
    if (selectedBotId === 'new') {
      setBotToken('');
      setAdminTgId('');
      setTargetChannel('');
      setPostsPerDay('1');
      setChannels([]);
      setCreatedBot(null);
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    const bot = existingBots.find((b) => b.id === selectedBotId);
    if (!bot) return;
    setBotToken(bot.bot_token || '');
    setAdminTgId(bot.admin_tg_id ? String(bot.admin_tg_id) : '');
    setTargetChannel(bot.target_channel_tg_id ? String(bot.target_channel_tg_id) : '');
    setPostsPerDay(String(bot.posts_per_day || 1));
    setCreatedBot({ id: bot.id, bot_username: bot.username });
    fetchChannels(bot.id);
  }, [selectedBotId]);

  async function fetchChannels(botId) {
    try {
      const res = await fetch(`/api/autopost/bots/${botId}/channels`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const data = await res.json();
      if (data.channels) setChannels(data.channels);
    } catch {}
  }

  // Поллинг каналов
  const startPolling = useCallback((botId) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/autopost/bots/${botId}/channels`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        const data = await res.json();
        if (data.channels) {
          const prevLen = channels.length;
          setChannels(data.channels);
          if (data.channels.length > 0 && !targetChannel) {
            setTargetChannel(String(data.channels[0].tg_chat_id));
            toast.success('Канал обнаружен и привязан');
          }
          if (data.channels.length > prevLen && prevLen > 0) {
            toast.success('Новый канал обнаружен');
          }
        }
      } catch {}
    }, 3000);
  }, [accessToken, targetChannel]);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // Подключение бота (валидация токена + создание)
  async function handleConnect() {
    if (!botToken.trim() || initing) return;
    setIniting(true);
    try {
      const res = await fetch('/api/autopost/bots/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          botToken: botToken.trim(),
          adminTgId: adminTgId.trim() || undefined
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка подключения бота');
      setCreatedBot({ id: data.bot.id, bot_username: data.bot.username });
      setExistingBots((prev) => [...prev, data.bot]);
      setSelectedBotId(data.bot.id);
      startPolling(data.bot.id);
      toast.success('Бот подключен');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setIniting(false);
    }
  }

  // Сохранить настройки
  async function handleSave() {
    if (!createdBot?.id || !targetChannel) return;
    setSaving(true);
    try {
      const n = Number(postsPerDay);
      const updates = {
        targetChannelTgId: targetChannel,
        postsPerDay: n,
        postingTimes: postingTimesFor(n)
      };
      if (adminTgId.trim()) updates.adminTgId = adminTgId.trim();
      const res = await fetch(`/api/autopost/bots/${createdBot.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(updates)
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Ошибка сохранения');
      }
      setExistingBots((prev) => prev.map((b) => b.id === createdBot.id ? { ...b, target_channel_tg_id: targetChannel, posts_per_day: n, admin_tg_id: adminTgId.trim() || null } : b));
      toast.success('Настройки сохранены');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  // Удалить бота
  async function handleDelete() {
    if (!createdBot?.id) return;
    if (!confirm('Удалить бота навсегда?')) return;
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
      setCreatedBot(null);
      setBotToken('');
      setAdminTgId('');
      setTargetChannel('');
      setPostsPerDay('1');
      setChannels([]);
      if (pollRef.current) clearInterval(pollRef.current);
      toast.success('Бот удалён');
    } catch (err) {
      toast.error(err.message);
    }
  }

  // Dirty state
  const bot = existingBots.find((b) => b.id === selectedBotId);
  const isDirty = selectedBotId === 'new'
    ? false
    : (targetChannel !== String(bot?.target_channel_tg_id || '') || postsPerDay !== String(bot?.posts_per_day || 1) || adminTgId !== String(bot?.admin_tg_id || ''));
  const canSave = createdBot?.id && targetChannel && isDirty && !saving;
  const canConnect = selectedBotId === 'new' && botToken.trim() && !initing;

  if (loading) return <LoadingState text="Загружаем автопостер..." />;

  return (
    <section className="page page--flush space-y-5">
      {/* Подключение бота */}
      <Card className="border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
        <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
          <div className="flex flex-row items-start justify-between gap-4">
            <div className="flex flex-row items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
                <Zap className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">Автопостер</h2>
                <p className="text-sm font-medium text-slate-500 mt-0.5">
                  Создайте бота через{' '}
                  <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
                    @BotFather
                  </a>, подключите и настройте расписание постинга.
                </p>
              </div>
            </div>
            <Select value={selectedBotId} onValueChange={setSelectedBotId}>
              <SelectTrigger className="h-9 w-[180px] bg-white rounded-lg border-slate-200 shadow-sm text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-lg">
                <SelectItem value="new" className="rounded-md">Новый бот</SelectItem>
                {existingBots.map((b) => (
                  <SelectItem key={b.id} value={b.id} className="rounded-md">
                    @{b.username || 'бот'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="p-5 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row items-end gap-3">
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
            <div className="w-full sm:w-[200px]">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 block">Админ TG ID</label>
              <Input
                value={adminTgId}
                onChange={(e) => setAdminTgId(e.target.value)}
                placeholder="123456789"
                spellCheck="false"
                className="font-mono bg-white h-11 rounded-xl border-slate-200 shadow-sm focus-visible:ring-indigo-500"
              />
            </div>
            <Button
              onClick={handleConnect}
              disabled={!canConnect}
              className="h-11 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-md shadow-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              {initing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Подключение...</> : 'Подключить'}
            </Button>
            <Button variant="outline" asChild className="h-11 rounded-xl text-slate-700 border-slate-200 shadow-sm shrink-0">
              <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="flex items-center gap-2 font-bold">
                @BotFather <ExternalLink className="w-4 h-4" />
              </a>
            </Button>
          </div>

          {createdBot && selectedBotId !== 'new' && (
            <div className="flex justify-start">
              <Button
                variant="ghost"
                onClick={handleDelete}
                className="h-8 px-3 rounded-lg text-sm font-medium text-rose-600 hover:text-rose-700 hover:bg-rose-50"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                Удалить бота
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* Канал и расписание */}
      <Card className="border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
        <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
          <div className="flex flex-row items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
              <Hash className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">Канал и расписание</h2>
              <p className="text-sm font-medium text-slate-500 mt-0.5">Добавьте бота в канал как администратора и выберите частоту постинга</p>
            </div>
          </div>
        </div>
        <div className="p-5 sm:p-6 space-y-5">
          {createdBot && channels.length === 0 && (
            <div className="rounded-xl bg-indigo-50 border border-indigo-100 p-4">
              <p className="text-sm font-medium text-indigo-800">
                Добавьте{' '}
                <span className="font-bold">@{createdBot?.bot_username || 'бота'}</span>{' '}
                в канал как администратора — канал появится автоматически.
                {!createdBot?.bot_username && (
                  <Loader2 className="w-3 h-3 inline animate-spin ml-1" />
                )}
              </p>
            </div>
          )}

          <div className="flex flex-col sm:flex-row items-end gap-4">
            <div className="flex-1 w-full">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 block">
                Канал для постинга
                {createdBot && channels.length === 0 && (
                  <span className="ml-2 text-indigo-500 normal-case tracking-normal font-medium">
                    <Loader2 className="w-3 h-3 inline animate-spin mr-1" />
                    ожидаем...
                  </span>
                )}
              </label>
              <Select value={targetChannel} onValueChange={setTargetChannel}>
                <SelectTrigger className="h-11 w-full bg-white rounded-xl border-slate-200 shadow-sm focus:ring-indigo-500">
                  <SelectValue placeholder={channels.length === 0 ? 'Канал не найден' : 'Выберите канал'} />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {channels.length === 0 ? (
                    <SelectItem value="_empty" disabled>Каналов не найдено</SelectItem>
                  ) : (
                    channels.map((ch) => (
                      <SelectItem key={ch.id} value={String(ch.tg_chat_id)} className="rounded-lg">
                        {ch.title || ch.tg_chat_id}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="w-full sm:w-[220px]">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 block">Постов в день</label>
              <Select value={postsPerDay} onValueChange={setPostsPerDay}>
                <SelectTrigger className="h-11 w-full bg-white rounded-xl border-slate-200 shadow-sm focus:ring-indigo-500">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="1" className="rounded-lg">1 пост в день (10:00)</SelectItem>
                  <SelectItem value="2" className="rounded-lg">2 поста (10:00, 18:00)</SelectItem>
                  <SelectItem value="3" className="rounded-lg">3 поста (08:00, 14:00, 20:00)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex justify-start">
            <Button
              onClick={handleSave}
              disabled={!canSave}
              className="h-11 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-md shadow-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Сохранить
            </Button>
          </div>
        </div>
      </Card>
    </section>
  );
}
