// Блок «Автореакция на посты» конфига канала (behavior-preserving разрезка
// 2026-11-07). JSX и parseReactionEmojis дословно перенесены из страницы;
// рендерится внутри карты активного канала (ChannelConfig.jsx).
import { toast } from 'sonner';

function parseReactionEmojis(value) {
  // VS16 (U+FE0F) вырезаем: в БД/Telegram хранится каноничное '❤', без селектора.
  return String(value || '').split(',').map(s => s.trim().replace(/\uFE0F/g, '')).filter(Boolean);
}

export default function ChannelReactions({ tab, config, setChannelConfigs }) {
  return (
    <>
                    {/* Автореакция на посты */}
                    <div className="bg-slate-50/50 hover:bg-slate-50/80 rounded-2xl p-4 border border-slate-100 flex flex-col gap-3 transition-all">
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <label htmlFor={`seed-reaction-toggle-${tab}`} className="text-sm font-bold text-slate-800 block">Автореакция на посты</label>
                          <span className="text-xs text-ink-muted font-semibold leading-relaxed block">
                            Бот ставит эту эмоцию на каждый пост. Эмодзи должен быть разрешён в настройках реакций самого канала.
                          </span>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1 select-none">
                          <input
                            type="checkbox"
                            id={`seed-reaction-toggle-${tab}`}
                            className="sr-only peer"
                            checked={Boolean(config.seedReactionEmoji)}
                            onChange={(e) => setChannelConfigs(prev => ({
                              ...prev,
                              [tab]: { ...prev[tab], seedReactionEmoji: e.target.checked ? (prev[tab].seedReactionEmoji || '👍') : null }
                            }))}
                          />
                          <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                        </label>
                      </div>
                      {Boolean(config.seedReactionEmoji) && (
                        <div className="flex flex-col gap-3 pt-1 animate-fade-in">
                          {/* Премиум-режим: доверяем заявке владельца; если бот
                              не премиум, рантайм сам деградирует до 1 реакции. */}
                          <div className="flex items-start justify-between gap-4">
                            <div className="space-y-0.5">
                              <label htmlFor={`seed-premium-toggle-${tab}`} className="text-xs font-bold text-ink-body block">Премиум бот</label>
                              <span className="text-xs text-ink-muted font-semibold leading-relaxed block">
                                Премиум-боты ставят до 3 реакций на пост. Без премиума Telegram примет только первую — остальные отработают как запасные.
                              </span>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer shrink-0 select-none">
                              <input
                                type="checkbox"
                                id={`seed-premium-toggle-${tab}`}
                                className="sr-only peer"
                                checked={Boolean(config.seedReactionPremium)}
                                onChange={(e) => setChannelConfigs(prev => {
                                  const premiumOn = e.target.checked;
                                  const emojis = parseReactionEmojis(prev[tab].seedReactionEmoji);
                                  // Выключение премиума схлопывает выбор до первой эмоции:
                                  // не-премиум бот физически ставит только одну, оставлять
                                  // «выбрано три» = снова вводить админа в заблуждение.
                                  if (!premiumOn && emojis.length > 1) {
                                    toast.info(`Премиум выключен — осталась первая эмоция ${emojis[0]}`);
                                    return { ...prev, [tab]: { ...prev[tab], seedReactionPremium: false, seedReactionEmoji: emojis[0] } };
                                  }
                                  return { ...prev, [tab]: { ...prev[tab], seedReactionPremium: premiumOn } };
                                })}
                              />
                              <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-4 peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border-border-strong after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-action-primary"></div>
                            </label>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            {[
                              { emoji: '👍', label: 'Лайк' },
                              { emoji: '👎', label: 'Дизлайк' },
                              { emoji: '❤️', value: '❤', label: 'Сердце' },
                              { emoji: '🔥', label: 'Огонь' },
                              { emoji: '🥰', label: 'Восхищение' },
                              { emoji: '🎉', label: 'Праздник' }
                            ].map(opt => {
                              // value — то, что уходит в БД ('❤' без VS16); emoji — что рисуем.
                              const val = opt.value || opt.emoji;
                              const activeReactions = parseReactionEmojis(config.seedReactionEmoji);
                              const active = activeReactions.includes(val);
                              return (
                                <button
                                  key={val}
                                  type="button"
                                  onClick={() => setChannelConfigs(prev => {
                                    const premium = Boolean(prev[tab].seedReactionPremium);
                                    const cur = parseReactionEmojis(prev[tab].seedReactionEmoji);
                                    // Клик по активному снимает его; последний эмодзи выключает автореакцию.
                                    if (cur.includes(val)) {
                                      const next = cur.filter((x) => x !== val);
                                      return { ...prev, [tab]: { ...prev[tab], seedReactionEmoji: next.length ? next.join(',') : null } };
                                    }
                                    if (premium) {
                                      if (cur.length >= 3) {
                                        toast.info('Максимум 3 реакции на пост');
                                        return prev;
                                      }
                                      return { ...prev, [tab]: { ...prev[tab], seedReactionEmoji: [...cur, val].join(',') } };
                                    }
                                    // Одиночный выбор: лимит не-премиум бота — 1 реакция на пост.
                                    if (cur.length > 0) {
                                      toast.info('Две эмоции — только с Telegram Premium');
                                      return prev;
                                    }
                                    return { ...prev, [tab]: { ...prev[tab], seedReactionEmoji: val } };
                                  })}
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
                        </div>
                      )}
                    </div>
    </>
  );
}
