// Блок «Предложки от подписчиков» конфига канала (behavior-preserving
// разрезка 2026-11-07). JSX дословно перенесён из страницы; рендерится
// внутри карты активного канала (ChannelConfig.jsx).
import { Clock, Inbox, Plus, Trash2 } from 'lucide-react';
import { Button } from '../../../components/ui/button.jsx';

export default function ChannelSuggestions({
  tab,
  config,
  setChannelConfigs,
  handleAddSuggestionTime,
  handleRemoveSuggestionTime,
  handleSuggestionTimeChange
}) {
  return (
    <>
                    {/* Предложки от подписчиков — группируем все настройки предложки в одном блоке */}
                    <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4 sm:p-5 space-y-3">
                      <div className="space-y-1">
                        <label className="text-xs font-bold uppercase tracking-wider text-indigo-600 flex items-center gap-1.5">
                          <Inbox className="w-3.5 h-3.5" /> Предложки от подписчиков
                        </label>
                        <span className="text-xs text-slate-500 font-semibold leading-relaxed block">
                          Тумблер включает кнопку «Предложить новость» под постами и открывает настройки: лимит, автопринятие, расписание.
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

                      {/* Зависимые настройки — видимы только при включенной кнопке предложки */}
                      {(config.suggestButtonEnabled || false) && (<>
                      {/* Суточный лимит предложений */}
                      <div className="bg-white hover:bg-slate-50 rounded-2xl p-4 border border-slate-100 flex flex-col gap-3.5 transition-all">
                        <div className="space-y-1">
                          <label className="text-sm font-bold text-slate-800 block">Лимит предложений в сутки</label>
                          <span className="text-xs text-slate-500 font-semibold leading-relaxed block">
                            Максимальное количество предложений от одного пользователя за последние 24 часа. Поставь «0», чтобы снять ограничение.
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
                      </>)}
                    </div>
    </>
  );
}
