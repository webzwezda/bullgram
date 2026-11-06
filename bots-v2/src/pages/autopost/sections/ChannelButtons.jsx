// Хендлеры конфигурации канала AutopostManagePage (behavior-preserving
// разрезка 2026-11-07): кнопки под постами, времена публикаций (основные
// и предложки), сохранение/отвязка/обновление канала. Тела дословно
// перенесены из страницы в фабрику: она вызывается на каждый рендер
// композитора с актуальными channelConfigs/createdBot — ровно как раньше
// замыкались хендлеры внутри компонента. Редактор кнопок — вложенная секция.
import { Layout, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/button.jsx';
import { Input } from '../../../components/ui/input.jsx';
import { patchChannel, refreshChannel, unlinkChannel } from '../api.js';

export function createChannelConfigHandlers({
  setChannelConfigs,
  channelConfigs,
  createdBot,
  accessToken,
  askConfirm,
  setSavingChannel,
  setUnlinkingChannel,
  setRefreshingChannel
}) {
  // Сохранить настройки конкретного канала
  async function handleSaveChannelConfig(channelId) {
    const config = channelConfigs[channelId];
    if (!config.id || !createdBot?.id) return;

    setSavingChannel(prev => ({ ...prev, [channelId]: true }));
    try {
      const sortedPostingTimes = [...new Set(config.postingTimes || ['10:00'])].sort();
      const sortedSuggestionTimes = [...new Set(config.suggestionPostingTimes || ['12:00'])].sort();

      const data = await patchChannel(createdBot.id, config.id, {
        auto_accept_suggestions: config.autoAccept,
        buttons_config: config.buttons,
        posts_per_day: sortedPostingTimes.length,
        posting_times: sortedPostingTimes,
        timezone: config.timezone,
        suggestion_posts_per_day: sortedSuggestionTimes.length,
        suggestion_posting_times: sortedSuggestionTimes,
        suggest_button_enabled: config.suggestButtonEnabled,
        max_suggestions_per_day: Number(config.maxSuggestionsPerDay !== '' ? config.maxSuggestionsPerDay : 5),
        seed_reaction_emoji: config.seedReactionEmoji || null,
        seed_reaction_premium: config.seedReactionPremium === true
      }, accessToken);

      setChannelConfigs(prev => ({
        ...prev,
        [channelId]: {
          ...prev[channelId],
          postingTimes: sortedPostingTimes,
          suggestionPostingTimes: sortedSuggestionTimes,
          suggestButtonEnabled: config.suggestButtonEnabled,
          maxSuggestionsPerDay: config.maxSuggestionsPerDay !== '' ? config.maxSuggestionsPerDay : 5,
          seedReactionEmoji: config.seedReactionEmoji || null,
          seedReactionPremium: config.seedReactionPremium === true
        }
      }));

      toast.success(`Настройки канала "${config.title}" успешно сохранены`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingChannel(prev => ({ ...prev, [channelId]: false }));
    }
  }

  // Отвязать канал от автопостера (только в Bullgram, бот остаётся админом в Telegram)
  function askUnlinkChannel(channelId) {
    const cfg = channelConfigs[channelId];
    if (!cfg.id || !createdBot?.id) return;
    askConfirm({
      title: 'Отвязать канал',
      description: `Канал «${cfg.title}» будет отвязан от автопостера. Бот останется админом в Telegram — канал можно привязать заново без повторного добавления.`,
      actionLabel: 'Отвязать',
      onConfirm: () => doUnlinkChannel(channelId)
    });
  }

  async function doUnlinkChannel(channelId) {
    const cfg = channelConfigs[channelId];
    if (!cfg.id || !createdBot?.id) return;
    setUnlinkingChannel(prev => ({ ...prev, [channelId]: true }));
    try {
      await unlinkChannel(createdBot.id, cfg.id, accessToken);
      toast.success(`Канал "${cfg.title}" отвязан`);
      // UI обновится через realtime
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUnlinkingChannel(prev => ({ ...prev, [channelId]: false }));
    }
  }

  // Обновить метаданные канала из Telegram (title, username, visibility).
  // Если бот больше не админ — бэкенд авто-отвяжет канал.
  async function handleRefreshChannel(channelId) {
    const cfg = channelConfigs[channelId];
    if (!cfg.id || !createdBot?.id) return;

    setRefreshingChannel(prev => ({ ...prev, [channelId]: true }));
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
      setRefreshingChannel(prev => ({ ...prev, [channelId]: false }));
    }
  }

  // Изменение кнопок
  const handleAddButton = (channelId) => {
    setChannelConfigs(prev => {
      const ch = prev[channelId];
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

  // Изменение времени публикаций
  const handleAddPostingTime = (channelId) => {
    setChannelConfigs(prev => {
      const ch = prev[channelId];
      const currentTimes = ch.postingTimes || ['10:00'];
      const freeSlot = ['12:00', '15:00', '18:00', '09:00', '21:00', '06:00'].find(t => !currentTimes.includes(t)) || '00:00';
      return {
        ...prev,
        [channelId]: {
          ...ch,
          postingTimes: [...currentTimes, freeSlot]
        }
      };
    });
  };

  const handleRemovePostingTime = (channelId, index) => {
    setChannelConfigs(prev => {
      const ch = prev[channelId];
      const currentTimes = ch.postingTimes || ['10:00'];
      if (currentTimes.length <= 1) {
        toast.error('Должно быть выбрано хотя бы одно время публикации');
        return prev;
      }
      return {
        ...prev,
        [channelId]: {
          ...ch,
          postingTimes: currentTimes.filter((_, i) => i !== index)
        }
      };
    });
  };

  const handlePostingTimeChange = (channelId, index, val) => {
    setChannelConfigs(prev => {
      const ch = prev[channelId];
      const newTimes = [...(ch.postingTimes || ['10:00'])];
      newTimes[index] = val;
      return {
        ...prev,
        [channelId]: {
          ...ch,
          postingTimes: newTimes
        }
      };
    });
  };

  // Изменение времени публикаций для предложений
  const handleAddSuggestionTime = (channelId) => {
    setChannelConfigs(prev => {
      const ch = prev[channelId];
      const currentTimes = ch.suggestionPostingTimes || ['12:00'];
      const freeSlot = ['15:00', '18:00', '21:00', '09:00'].find(t => !currentTimes.includes(t)) || '00:00';
      return {
        ...prev,
        [channelId]: {
          ...ch,
          suggestionPostingTimes: [...currentTimes, freeSlot]
        }
      };
    });
  };

  const handleRemoveSuggestionTime = (channelId, index) => {
    setChannelConfigs(prev => {
      const ch = prev[channelId];
      const currentTimes = ch.suggestionPostingTimes || ['12:00'];
      if (currentTimes.length <= 1) {
        toast.error('Должно быть выбрано хотя бы одно время публикации предложений');
        return prev;
      }
      return {
        ...prev,
        [channelId]: {
          ...ch,
          suggestionPostingTimes: currentTimes.filter((_, i) => i !== index)
        }
      };
    });
  };

  const handleSuggestionTimeChange = (channelId, index, val) => {
    setChannelConfigs(prev => {
      const ch = prev[channelId];
      const newTimes = [...(ch.suggestionPostingTimes || ['12:00'])];
      newTimes[index] = val;
      return {
        ...prev,
        [channelId]: {
          ...ch,
          suggestionPostingTimes: newTimes
        }
      };
    });
  };

  return {
    handleAddButton,
    handleRemoveButton,
    handleButtonChange,
    handleAddPostingTime,
    handleRemovePostingTime,
    handlePostingTimeChange,
    handleAddSuggestionTime,
    handleRemoveSuggestionTime,
    handleSuggestionTimeChange,
    handleSaveChannelConfig,
    askUnlinkChannel,
    handleRefreshChannel
  };
}

export default function ChannelButtonsEditor({ tab, config, handleAddButton, handleRemoveButton, handleButtonChange }) {
  return (
    <>
                    {/* Конструктор кнопок */}
                    <div className="space-y-4">
                      <div className="space-y-1">
                        <label className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                          <Layout className="w-3.5 h-3.5 text-indigo-500" /> Кнопки под каждым постом
                        </label>
                        <span className="text-xs text-slate-500 font-semibold leading-relaxed block">
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
                          className="h-11 px-4 rounded-xl border-dashed text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-indigo-600 hover:border-indigo-200 font-semibold text-xs transition-all flex items-center justify-center gap-1.5"
                        >
                          <Plus className="w-4 h-4 text-indigo-500" /> Добавить кнопку
                        </Button>
                      </div>
                    </div>
    </>
  );
}
