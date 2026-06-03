import { useEffect, useState } from 'react';
import { Bot, CheckCircle2, ExternalLink, ImagePlus, Loader2, Zap } from 'lucide-react';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { Badge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';
import { Card, CardContent } from '../components/ui/card.jsx';
import { Input } from '../components/ui/input.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select.jsx';
import { supabase } from '../lib/supabase.js';
import { LoadingState } from '../ui/LoadingState.jsx';

export function QuickStartPage() {
  const { user, accessToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [botToken, setBotToken] = useState('');
  const [targetChannel, setTargetChannel] = useState('');
  const [postsPerDay, setPostsPerDay] = useState('1');
  const [channels, setChannels] = useState([]);
  const [existingBots, setExistingBots] = useState([]);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(false);

  useEffect(() => {
    async function load() {
      if (!user?.id) return;
      try {
        const [chResult, botsResult] = await Promise.all([
          supabase.from('channels').select('id, title, tg_chat_id').eq('owner_id', user.id).order('created_at', { ascending: false }),
          supabase.from('autopost_bots').select('*').eq('owner_id', user.id).order('created_at', { ascending: false })
        ]);
        setChannels(chResult.data || []);
        setExistingBots(botsResult.data || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [user?.id]);

  async function handleCreateBot() {
    if (!botToken.trim() || !targetChannel) return;
    setSaving(true);
    setError('');
    try {
      const n = Number(postsPerDay);
      const res = await fetch('/api/autopost/bots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          botToken: botToken.trim(),
          targetChannelTgId: targetChannel,
          postsPerDay: n,
          postingTimes: n === 1 ? ['10:00'] : n === 2 ? ['10:00', '18:00'] : ['08:00', '14:00', '20:00']
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка создания бота');
      setExistingBots((prev) => [...prev, data.bot]);
      setCreated(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState text="Загружаем quick start..." />;

  const canSubmit = botToken.trim() && targetChannel && !saving;

  return (
    <section className="page">
      {/* Setup card */}
      {!created && (
        <Card className="border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl relative" style={{ marginTop: 0 }}>
          <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
            <div className="flex flex-row items-start justify-between gap-4">
              <div className="flex flex-row items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
                  <Zap className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Подключить автопостер</h2>
                  <p className="text-sm font-medium text-slate-500 mt-0.5">
                    Создайте бота через{' '}
                    <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
                      @BotFather
                    </a>, выберите канал и расписание.
                  </p>
                </div>
              </div>
              <Select defaultValue="new">
                <SelectTrigger className="h-9 w-[160px] bg-white rounded-lg border-slate-200 shadow-sm text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-lg">
                  <SelectItem value="new" className="rounded-md">Новый</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="p-5 sm:p-6 space-y-5">
            <div className="flex flex-col sm:flex-row items-end gap-4">
              <div className="flex-1 w-full">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 block">Токен бота</label>
                <Input
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                  placeholder="123456:ABC-DEF..."
                  spellCheck="false"
                  className="font-mono bg-white h-11 rounded-xl border-slate-200 shadow-sm focus-visible:ring-indigo-500"
                />
              </div>
              <Button variant="outline" asChild className="h-11 rounded-xl text-slate-700 border-slate-200 shadow-sm">
                <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="flex items-center gap-2 font-bold">
                  @BotFather <ExternalLink className="w-4 h-4" />
                </a>
              </Button>
            </div>

            <div className="flex flex-col sm:flex-row items-end gap-4">
              <div className="flex-1 w-full">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 block">Канал для постинга</label>
                <Select value={targetChannel} onValueChange={setTargetChannel}>
                  <SelectTrigger className="h-11 w-full bg-white rounded-xl border-slate-200 shadow-sm focus:ring-indigo-500">
                    <SelectValue placeholder="Выберите канал" />
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
              <div className="w-full sm:w-[200px]">
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
              <div className="flex gap-3 w-full sm:w-auto">
                <Button
                  onClick={handleCreateBot}
                  disabled={!canSubmit}
                  className="h-11 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-200 w-full sm:w-auto font-bold"
                >
                  {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ImagePlus className="w-4 h-4 mr-2" />}
                  {saving ? 'Создание...' : 'Создать бота'}
                </Button>
              </div>
            </div>

            {error && (
              <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 px-4 py-3 rounded-xl">{error}</div>
            )}
          </div>

          {/* Steps footer */}
          <div className="bg-slate-50/50 border-t border-slate-100 px-5 py-4 sm:px-6 flex items-center justify-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
            <div className="w-2.5 h-2.5 rounded-full bg-slate-200" />
            <div className="w-2.5 h-2.5 rounded-full bg-slate-200" />
          </div>
        </Card>
      )}

      {/* Existing bots */}
      {existingBots.length > 0 && (
        <div className="section space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">Ваши автопостеры</h3>
          {existingBots.map((bot) => (
            <Card key={bot.id} className="border-slate-200/70 bg-white shadow-sm overflow-hidden rounded-2xl">
              <div className="flex items-center justify-between p-4 sm:p-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-600 shrink-0">
                    <Bot className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="font-bold text-slate-900">@{bot.username || 'бот'}</span>
                    <div className="text-xs text-slate-500 mt-0.5">{bot.posts_per_day} пост{bot.posts_per_day > 1 ? 'а' : ''} в день</div>
                  </div>
                </div>
                <Badge variant="outline" className={bot.is_active
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-slate-100 text-slate-500 border-slate-200'
                }>
                  {bot.is_active ? 'Активен' : 'Выключен'}
                </Badge>
              </div>
            </Card>
          ))}

          {created && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <span className="font-bold text-emerald-800">Бот готов!</span>
              </div>
              <ol className="text-sm text-emerald-700 space-y-1 list-decimal list-inside">
                <li>Откройте бота в Telegram</li>
                <li>Скиньте картинки (с подписями)</li>
                <li>Отправьте /schedule — бот распланирует по дням</li>
              </ol>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
