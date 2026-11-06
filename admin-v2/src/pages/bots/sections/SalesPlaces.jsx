import { Users, UserCog, Loader2, Plus, X, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';

function isChatPlace(target) {
  const chatType = String(target?.chat_type || '').toLowerCase();
  return chatType === 'group' || chatType === 'supergroup';
}

function formatPlaceCategory(target) {
  const surface = isChatPlace(target) ? 'чат' : 'канал';
  const visibility = String(target?.visibility || '').toLowerCase();

  if (visibility === 'public') return `Открытый ${surface}`;
  if (visibility === 'private') return `Закрытый ${surface}`;
  return `${surface === 'чат' ? 'Чат' : 'Канал'} - открытость не проверена`;
}

function placeCategoryColor(target) {
  const visibility = String(target?.visibility || '').toLowerCase();
  if (visibility === 'public') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (visibility === 'private') return 'bg-slate-100 text-slate-700 border-slate-200';
  return 'bg-amber-50 text-amber-700 border-amber-200';
}

function UserbotsSection({
  salesContourSectionProps
}) {
  const draft = salesContourSectionProps?.draft || {};
  const setFieldValue = salesContourSectionProps?.setFieldValue;
  const savingContour = salesContourSectionProps?.savingContour;
  const userbotOptions = salesContourSectionProps?.userbotOptions || [];
  const selectedIds = draft.selectedUserbotIds || [];
  const joinAllPending = salesContourSectionProps?.joinAllPending;
  const [adding, setAdding] = useState(false);

  if (!salesContourSectionProps?.isVisible) return null;

  const selectedOptions = userbotOptions.filter((o) => selectedIds.includes(String(o.id)));
  const availableOptions = userbotOptions.filter((o) => !selectedIds.includes(String(o.id)) && o.eligible !== false);

  function statusColor(status) {
    if (status === 'online') return '#10b981';
    if (status === 'restricted' || status === 'expired' || status === 'error') return '#ef4444';
    return '#cbd5e1';
  }

  async function handleAdd(optionId) {
    const next = [...selectedIds, String(optionId)];
    if (setFieldValue) {
      try {
        await setFieldValue({
          selectedUserbotIds: next,
          selectedUserbotId: '',
          userbotMode: 'pool'
        }, null, { autoSave: true });
        setAdding(false);
        salesContourSectionProps?.triggerJoinAll?.();
      } catch (err) {
        console.error('Failed to add userbot to contour:', err);
      }
    } else {
      setAdding(false);
    }
  }

  function handleRemove(optionId) {
    const next = selectedIds.filter((id) => id !== String(optionId));
    if (setFieldValue) {
      const nextMode = next.length > 0 ? 'pool' : 'none';
      setFieldValue({
        selectedUserbotIds: next,
        selectedUserbotId: '',
        userbotMode: nextMode
      }, null, { autoSave: true }).catch((error) => {
        console.error('Failed to remove userbot from contour:', error);
      });
    }
  }

  return (
    <div className="border-t border-slate-100 pb-2">
      <div className="px-5 sm:px-6 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center">
              <UserCog className="w-4 h-4 text-indigo-600" />
            </div>
            <div className="text-base font-bold text-slate-900">Привязанные юзерботы</div>
          </div>
          <div className="flex items-center gap-3">
            {selectedOptions.length ? (
              <Badge variant="secondary" className="bg-white border border-slate-200 text-slate-700 shadow-sm">{selectedOptions.length}</Badge>
            ) : null}
            {availableOptions.length > 0 ? (
              <Button
                size="sm"
                onClick={() => setAdding(true)}
                disabled={joinAllPending}
                className="bg-indigo-600 hover:bg-indigo-700 h-11 rounded-xl text-xs px-4 shadow-sm font-bold"
              >
                <Plus className="w-4 h-4 mr-1.5" />
                Добавить юзербота
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {adding && availableOptions.length > 0 ? (
        <div className="px-5 sm:px-6 py-4 border-y border-slate-100 bg-slate-50/50 flex items-center gap-3">
          <Select disabled={joinAllPending} onValueChange={(value) => { if (value) handleAdd(value); }}>
            <SelectTrigger className="flex-1 w-full bg-white rounded-xl border-slate-200 data-[size=default]:h-11 shadow-sm">
              <SelectValue placeholder="Выберите доступного юзербота" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              {availableOptions.map((option) => (
                <SelectItem key={option.id} value={option.id} className="rounded-lg py-2">{option.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAdding(false)}
            className="h-11 rounded-xl text-slate-600 border-slate-200 bg-white hover:bg-slate-50 font-bold"
          >
            Отмена
          </Button>
        </div>
      ) : null}

      {!selectedOptions.length && !adding ? (
        <div className="px-5 sm:px-6 py-8 text-center">
          <div className="w-12 h-12 bg-white border border-slate-100 rounded-full shadow-sm flex items-center justify-center mx-auto mb-3">
            <UserCog className="w-6 h-6 text-slate-300" />
          </div>
          <p className="text-sm text-slate-700 font-bold">Юзерботы не привязаны</p>
          <p className="mt-1 text-sm text-slate-500 max-w-sm mx-auto">Привяжите юзербота, чтобы он управлял приглашениями и подписчиками в контуре.</p>
        </div>
      ) : (
        <div className="px-5 sm:px-6 pb-2 space-y-2">
          {selectedOptions.map((option) => {
            const isActive = salesContourSectionProps?.userbotActiveMap?.[String(option.id)] !== false;
            const isToggling = salesContourSectionProps?.togglingUserbotId === String(option.id);
            return (
              <div key={option.id} className="p-3 bg-slate-50/50 hover:bg-slate-100 rounded-2xl border border-slate-100 flex items-center justify-between gap-4 transition-all">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-2.5 h-2.5 rounded-full shadow-sm shrink-0" style={{ backgroundColor: statusColor(option.runtimeStatus) }} />
                    <span className="text-sm font-bold text-slate-900 truncate">{option.title}</span>
                  </div>
                  <div className="w-px h-4 bg-slate-200 shrink-0"></div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isActive}
                      onClick={() => salesContourSectionProps?.toggleUserbotActive?.(option.id, !isActive)}
                      disabled={isToggling || joinAllPending}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed ${
                        isToggling || joinAllPending ? 'opacity-50 pointer-events-none' : ''
                      } ${isActive ? 'bg-indigo-600' : 'bg-slate-200'}`}
                    >
                      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${isActive ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                    <span className={`text-xs font-bold ${isActive ? 'text-indigo-600' : 'text-slate-500'}`}>Участвует в ротации</span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 px-3 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg shrink-0"
                  onClick={() => handleRemove(option.id)}
                  disabled={savingContour}
                >
                  <X className="w-4 h-4 mr-1.5" />
                  Отвязать
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {joinAllPending ? (
        <div className="px-5 sm:px-6 py-3 text-xs font-bold text-indigo-500 flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Вступаю в площадки контура... Это занимает до минуты.
        </div>
      ) : null}

      {savingContour ? (
        <div className="px-5 sm:px-6 py-3 text-xs font-bold text-indigo-500 flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Сохранение контура...
        </div>
      ) : null}
    </div>
  );
}

function FreePlacesSection({
  selectedOfficialBot,
  channelsByBotId,
  deleteTelegramPlace,
  refreshTelegramPlaceInfo,
  refreshingTelegramPlaceId,
  assignedIds
}) {
  const selectedBotId = String(selectedOfficialBot?.id || '');
  const allTargets = channelsByBotId?.[selectedBotId] || [];
  const freeTargets = allTargets.filter((t) => !assignedIds.has(String(t.id)));

  if (!selectedOfficialBot || !freeTargets.length) return null;

  return (
    <Card className="border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
      <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
        <div className="flex flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-slate-200 flex items-center justify-center text-white shadow-md shrink-0">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                Свободные площадки
                <Badge variant="secondary" className="bg-slate-100 text-slate-700 hover:bg-slate-200 border-0 text-xs rounded-full px-2">
                  {freeTargets.length}
                </Badge>
              </h2>
              <p className="text-sm font-medium text-slate-500 mt-0.5">Не привязаны ни к одной роли. Назначьте в карточках выше или удалите.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="p-5 sm:p-6 space-y-2 bg-white">
        {freeTargets.map((target) => {
          const isRefreshing = refreshingTelegramPlaceId === String(target.id);
          const categoryLabel = formatPlaceCategory(target);
          const categoryColor = placeCategoryColor(target);
          const username = String(target?.username || '').trim().replace(/^@/, '');

          return (
            <div key={target.id} className="p-4 bg-slate-50/50 hover:bg-slate-100 rounded-2xl border border-slate-100 transition-all">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5 flex-wrap mb-1.5">
                    <span className="text-base font-bold text-slate-900 truncate">{target.title || target.tg_chat_id || 'Без названия'}</span>
                    <Badge variant="outline" className={`${categoryColor} shadow-sm px-2 py-0.5 text-xs font-bold border`}>
                      {categoryLabel}
                    </Badge>
                    {username && (
                      <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200 shadow-sm px-2 py-0.5 text-xs font-bold">
                        @{username}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <span className="font-mono bg-white px-2 py-0.5 rounded-md border border-slate-100">{target.tg_chat_id || '—'}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="outline"
                    className="h-11 rounded-xl text-slate-700 font-bold border-slate-200 bg-white hover:bg-slate-50 shadow-sm"
                    onClick={() => refreshTelegramPlaceInfo(target)}
                    disabled={isRefreshing}
                  >
                    <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
                    {isRefreshing ? 'Обновление...' : 'Обновить'}
                  </Button>
                  <Button
                    variant="outline"
                    className="h-11 rounded-xl text-rose-600 border-rose-200 bg-rose-50 hover:bg-rose-100 font-bold shadow-sm"
                    onClick={() => deleteTelegramPlace(target)}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Удалить
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export { UserbotsSection, FreePlacesSection };
