import { useCallback, useEffect, useState } from 'react';
import { Users, RefreshCw, MessageCircle, Eye, Clock, Megaphone, AlertCircle } from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { useAuth } from '../../app/providers/AuthProvider.jsx';
import { toast } from 'sonner';

const TARGETS = [
  { type: 'public_channel', label: 'Открытый канал', icon: Eye },
  { type: 'paid_channel', label: 'Платный канал', icon: Users },
  { type: 'public_chat', label: 'Открытый чат', icon: MessageCircle },
  { type: 'paid_chat', label: 'Платный чат', icon: Users }
];

const ACTIVITY_FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'active', label: 'Пишут и комментируют' },
  { id: 'silent', label: 'Молчат' }
];

function formatLastSeen(dateStr) {
  if (!dateStr) return 'давно';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 5) return 'только что';
  if (diffMin < 60) return `${diffMin} мин назад`;
  if (diffHours < 24) return `${diffHours} ч назад`;
  if (diffDays === 1) return 'вчера';
  if (diffDays < 7) return `${diffDays} дн назад`;
  return 'давно';
}

function formatSyncTime(dateStr) {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  return date.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function AudienceSection() {
  const { accessToken } = useAuth();
  const [state, setState] = useState({
    loading: true,
    contourId: null,
    targets: [],
    activeTab: 'public_channel',
    activityFilter: 'all',
    syncingType: null,
    error: ''
  });

  const loadAudience = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, loading: true, error: '' }));
      const data = await apiRequest('/api/audience', { accessToken });
      setState((prev) => ({
        ...prev,
        loading: false,
        contourId: data.contourId || null,
        targets: data.targets || [],
        error: ''
      }));
    } catch (err) {
      setState((prev) => ({ ...prev, loading: false, error: err.message }));
    }
  }, [accessToken]);

  useEffect(() => { loadAudience(); }, [loadAudience]);

  async function handleSync(targetType) {
    const cid = state.contourId;
    try {
      setState((prev) => ({ ...prev, syncingType: targetType }));
      const body = { targetType };
      if (cid) body.contourId = cid;
      const result = await apiRequest('/api/audience/sync', {
        accessToken,
        method: 'POST',
        body
      });
      toast.success(`Загружено ${result.synced_count} участников, из них ${result.active_count} активных`);
      await loadAudience();
    } catch (err) {
      toast.error(err.message || 'Ошибка обновления');
    } finally {
      setState((prev) => ({ ...prev, syncingType: null }));
    }
  }

  const { targets, activeTab, activityFilter, syncingType, loading, contourId, error } = state;
  const currentTarget = targets.find((t) => t.targetType === activeTab);
  const members = currentTarget?.members || [];

  const filteredMembers = activityFilter === 'active'
    ? members.filter((m) => (m.activity_score || 0) > 0)
    : activityFilter === 'silent'
      ? members.filter((m) => (m.activity_score || 0) === 0)
      : members;

  return (
    <div className="bg-white border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="p-6 md:p-8 border-b border-slate-100 bg-slate-50/50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-600">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-black text-slate-900">Аудитория ваших групп</h3>
            <p className="text-sm text-slate-500">Все участники и их активность</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-6 pt-2 border-b border-slate-100">
        <div className="flex gap-1 overflow-x-auto">
          {TARGETS.map(({ type, label, icon: Icon }) => {
            const target = targets.find((t) => t.targetType === type);
            const isDisabled = !loading && target && !target.channelId;
            const isActive = activeTab === type;
            const count = target?.totalMembers || 0;
            return (
              <button
                key={type}
                onClick={() => setState((prev) => ({ ...prev, activeTab: type }))}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-bold whitespace-nowrap border-b-2 transition-all ${
                  isActive
                    ? 'border-indigo-600 text-indigo-600'
                    : isDisabled
                      ? 'border-transparent text-slate-300'
                      : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
                {count > 0 && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-md ${isActive ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-500'}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-slate-400">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" />
            Загрузка...
          </div>
        ) : error && !targets.length ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center mb-3">
              <AlertCircle className="w-7 h-7 text-amber-500" />
            </div>
            <p className="text-sm text-slate-600 font-medium max-w-sm mb-1">Не удалось загрузить аудиторию</p>
            <p className="text-xs text-slate-400 mb-4">{error}</p>
            <button
              onClick={loadAudience}
              className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 transition-all"
            >
              Попробовать снова
            </button>
          </div>
        ) : !currentTarget?.channelId ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-3">
              <Users className="w-7 h-7 text-slate-400" />
            </div>
            <p className="text-sm text-slate-500 font-medium max-w-sm">
              {targets.length === 0
                ? 'Сначала настройте контур продаж на странице Бот-отец'
                : 'Добавьте эту группу в контуре продаж'}
            </p>
          </div>
        ) : (
          <>
            {/* Header row */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <div className="font-black text-slate-900">{currentTarget.channelTitle || 'Группа'}</div>
                <div className="text-sm text-slate-500">
                  {currentTarget.totalMembers} участников
                  {currentTarget.activeMembers > 0 && (
                    <span className="text-emerald-600 ml-2">
                      {currentTarget.activeMembers} активных
                    </span>
                  )}
                  {currentTarget.syncedAt && (
                    <span className="ml-2">
                      Обновлено: {formatSyncTime(currentTarget.syncedAt)}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleSync(activeTab)}
                  disabled={!!syncingType}
                  className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 transition-all disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${syncingType === activeTab ? 'animate-spin' : ''}`} />
                  {syncingType === activeTab ? 'Загружаем...' : 'Обновить список'}
                </button>
                {currentTarget.baseId && (
                  <a
                    href={`/app/broadcast?baseId=${currentTarget.baseId}`}
                    className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-bold shadow-md shadow-indigo-200 hover:bg-indigo-700 transition-all"
                  >
                    <Megaphone className="w-4 h-4" />
                    Отправить рассылку
                  </a>
                )}
              </div>
            </div>

            {/* Activity filters */}
            {members.length > 0 && (
              <div className="flex gap-1 p-1 bg-slate-100/80 rounded-xl border border-slate-200/60 w-fit mb-4">
                {ACTIVITY_FILTERS.map(({ id, label }) => (
                  <button
                    key={id}
                    onClick={() => setState((prev) => ({ ...prev, activityFilter: id }))}
                    className={`px-3.5 py-2 text-sm font-semibold rounded-lg transition-all ${
                      activityFilter === id
                        ? 'text-slate-900 bg-white shadow-sm ring-1 ring-slate-200/50'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {/* Table */}
            {filteredMembers.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-3">
                  <Users className="w-7 h-7 text-slate-400" />
                </div>
                <p className="text-sm text-slate-500 font-medium max-w-sm">
                  {!currentTarget?.baseId
                    ? 'Нажмите «Обновить список» чтобы загрузить участников из Telegram'
                    : 'В этой группе пока нет участников'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-slate-100">
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-50/80">
                      <th className="text-left px-4 py-3 text-xs font-black uppercase text-slate-400 tracking-wider">Имя</th>
                      <th className="text-left px-4 py-3 text-xs font-black uppercase text-slate-400 tracking-wider">Username</th>
                      <th className="text-left px-4 py-3 text-xs font-black uppercase text-slate-400 tracking-wider">Активность</th>
                      <th className="text-left px-4 py-3 text-xs font-black uppercase text-slate-400 tracking-wider">Сообщений</th>
                      <th className="text-left px-4 py-3 text-xs font-black uppercase text-slate-400 tracking-wider">Был(а) активен</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredMembers.slice(0, 100).map((member) => {
                      const isActive = (member.activity_score || 0) > 0;
                      return (
                        <tr key={member.id || member.tg_user_id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-4 py-3">
                            <span className="font-bold text-slate-900 text-sm">{member.display_name || member.first_name || '—'}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm text-slate-600 font-medium">
                              {member.username ? `@${member.username}` : '—'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-lg ${
                              isActive
                                ? 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200'
                                : 'bg-slate-100 text-slate-400 ring-1 ring-slate-200'
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                              {isActive ? 'Пишет' : 'Молчит'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm font-bold text-slate-700">{member.comments_count || 0}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="flex items-center gap-1.5 text-sm text-slate-500">
                              <Clock className="w-3.5 h-3.5" />
                              {formatLastSeen(member.last_activity_at)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredMembers.length > 100 && (
                  <div className="px-4 py-3 text-sm text-slate-500 font-medium border-t border-slate-100 bg-slate-50/50">
                    Показано 100 из {filteredMembers.length}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
