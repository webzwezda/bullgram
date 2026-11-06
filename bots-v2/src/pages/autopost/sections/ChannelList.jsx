// Список каналов конфига автопостера (behavior-preserving разрезка
// 2026-11-07): карточки каналов, slot-карточка «Подключить ещё канал»
// и раскрывающаяся инструкция под ней. JSX дословно перенесён из страницы.
import { Globe, Lock, Plus } from 'lucide-react';

export default function ChannelList({
  channelConfigs,
  activeChannelId,
  setActiveChannelId,
  showAddChannelHint,
  setShowAddChannelHint,
  createdBot
}) {
  return (
    <>
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
                      className={`p-5 rounded-2xl border text-left transition-colors duration-200 cursor-pointer flex flex-col justify-between h-32 ${
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
                  className={`p-5 rounded-2xl border-2 border-dashed text-left transition-colors duration-200 cursor-pointer flex flex-col justify-between h-32 ${
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
                        <li>Добавь бота <span className="font-bold text-slate-800">@{createdBot.bot_username}</span> с правом <b>«Публиковать посты»</b>.</li>
                        <li>Канал появится здесь автоматически — настраивайте кнопки, реакции и расписание.</li>
                      </ol>
                      <p className="text-[11px] text-slate-500 pt-1">Можно подключить сколько угодно каналов. Каждый публикует со своими кнопками и реакциями.</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
    </>
  );
}
