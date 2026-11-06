// Окно конфигурации каналов AutopostManagePage (behavior-preserving
// разрезка 2026-11-07): остов карты — список каналов (ChannelList), шапка
// активного канала, основные времена публикаций, таймзона и сохранение.
// Блоки предложки/автореакции/кнопок — вложенные секции; хендлеры приходят
// пропсами (фабрика createChannelConfigHandlers в ChannelButtons.jsx).
import { Clock, Globe, Loader2, Plus, RefreshCw, Save, Settings, Trash2, Unlink } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/button.jsx';
import { Card } from '../../../components/ui/card.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select.jsx';
import ChannelList from './ChannelList.jsx';
import ChannelSuggestions from './ChannelSuggestions.jsx';
import ChannelReactions from './ChannelReactions.jsx';
import ChannelButtonsEditor from './ChannelButtons.jsx';

// Часовые пояса канала — дословно из страницы (значение от рендера не
// зависит, поэтому модульная константа эквивалентна прежней локальной).
  const TIMEZONES = ['Europe/Moscow', 'Europe/Kaliningrad', 'Europe/Samara', 'Asia/Yekaterinburg', 'Asia/Omsk', 'Asia/Krasnoyarsk', 'Asia/Irkutsk', 'Asia/Yakutsk', 'Asia/Vladivostok', 'Asia/Magadan', 'Asia/Kamchatka', 'UTC'];

export default function ChannelConfig({
  channelConfigs,
  setChannelConfigs,
  activeChannelId,
  setActiveChannelId,
  showAddChannelHint,
  setShowAddChannelHint,
  createdBot,
  savingChannel,
  unlinkingChannel,
  refreshingChannel,
  handleSaveChannelConfig,
  askUnlinkChannel,
  handleRefreshChannel,
  handleAddButton,
  handleRemoveButton,
  handleButtonChange,
  handleAddPostingTime,
  handleRemovePostingTime,
  handlePostingTimeChange,
  handleAddSuggestionTime,
  handleRemoveSuggestionTime,
  handleSuggestionTimeChange
}) {
  return (
          <Card className="p-0 gap-0 border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
      <ChannelList
        channelConfigs={channelConfigs}
        activeChannelId={activeChannelId}
        setActiveChannelId={setActiveChannelId}
        showAddChannelHint={showAddChannelHint}
        setShowAddChannelHint={setShowAddChannelHint}
        createdBot={createdBot}
      />

            {/* Контент activeChannelId */}
            {Object.values(channelConfigs).map((ch) => {
              if (activeChannelId !== ch.id) return null;
              const tab = ch.id;
              const config = channelConfigs[tab];

              return (
                <div key={tab} className="animate-fade-in divide-y divide-slate-100">
                  <div className="bg-slate-50/30 p-5 sm:p-6">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
                        <Settings className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-lg font-bold text-slate-900 truncate">{config.title}</h3>
                        <p className="text-xs font-semibold text-slate-500">Настройки публикации и предложки для этого канала</p>
                      </div>
                      <div className="ml-auto flex gap-2 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRefreshChannel(tab)}
                          disabled={refreshingChannel[tab] || unlinkingChannel[tab] || savingChannel[tab]}
                          className="text-xs h-8"
                        >
                          {refreshingChannel[tab]
                            ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                            : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
                          Обновить
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => askUnlinkChannel(tab)}
                          disabled={refreshingChannel[tab] || unlinkingChannel[tab] || savingChannel[tab]}
                          className="text-xs h-8 text-rose-600 hover:text-rose-700 hover:bg-rose-50 hover:border-rose-200"
                        >
                          {unlinkingChannel[tab]
                            ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                            : <Unlink className="w-3.5 h-3.5 mr-1.5" />}
                          Отвязать
                        </Button>
                      </div>
                    </div>
                    {(config.tgChatId || config.username) && (
                      <div className="flex items-center gap-1.5 flex-wrap mt-3 ml-[52px]">
                        {config.tgChatId && (
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(String(config.tgChatId));
                              toast.success('ID канала скопирован');
                            }}
                            title="Скопировать ID канала"
                            className="font-mono text-[11px] text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200 transition-colors cursor-pointer"
                          >
                            {config.tgChatId}
                          </button>
                        )}
                        {config.username && (
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(`@${config.username}`);
                              toast.success('Username скопирован');
                            }}
                            title="Скопировать @username"
                            className="text-[11px] font-medium text-indigo-700 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded-md border border-indigo-200 transition-colors cursor-pointer"
                          >
                            @{config.username}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  
                  <div className="p-5 sm:p-6 space-y-6">
                    {/* Время публикаций (основная очередь) */}
                    <div className="space-y-4">
                      <div className="space-y-1">
                        <label className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-indigo-500" /> Время публикаций (основная очередь)
                        </label>
                        <span className="text-xs text-slate-500 font-semibold leading-relaxed block">
                          Посты публикуются автоматически — расписание с точностью до ±5 минут.
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5">
                        {(config.postingTimes || ['10:00']).map((time, idx) => (
                          <div key={idx} className="flex items-center gap-2 bg-slate-50 hover:bg-slate-100/70 p-2.5 rounded-xl border border-slate-200 transition-all focus-within:ring-1 focus-within:ring-indigo-500 focus-within:border-indigo-500">
                            <span className="text-[10px] font-bold text-slate-500 font-mono w-5 text-center">#{idx + 1}</span>
                            <input
                              type="time"
                              value={time}
                              onChange={(e) => handlePostingTimeChange(tab, idx, e.target.value)}
                              className="bg-transparent text-xs font-bold text-slate-800 outline-none w-full border-0 p-0 focus:ring-0 cursor-pointer"
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleRemovePostingTime(tab, idx)}
                              className="h-7 w-7 text-rose-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg shrink-0"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        ))}

                        <Button
                          variant="outline"
                          onClick={() => handleAddPostingTime(tab)}
                          className="h-10 rounded-xl border-dashed text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-indigo-600 hover:border-indigo-200 font-semibold text-xs transition-all flex items-center justify-center gap-1.5"
                        >
                          <Plus className="w-3.5 h-3.5 text-indigo-500" /> Добавить время
                        </Button>
                      </div>
                    </div>

                    {/* Часовой пояс канала */}
                    <div className="space-y-2 max-w-md">
                      <label className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                        <Globe className="w-3.5 h-3.5 text-indigo-500" /> Часовой пояс для публикаций
                      </label>
                      <Select
                        value={config.timezone}
                        onValueChange={(val) => setChannelConfigs(prev => ({
                          ...prev,
                          [tab]: { ...prev[tab], timezone: val }
                        }))}
                      >
                        <SelectTrigger className="h-11 w-full bg-white rounded-xl border-slate-200 shadow-sm focus:ring-indigo-500 font-medium">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl">
                          {!TIMEZONES.includes(config.timezone) && config.timezone ? (
                            <SelectItem value={config.timezone}>{config.timezone}</SelectItem>
                          ) : null}
                          <SelectItem value="Europe/Moscow" className="rounded-lg">Europe/Moscow (МСК, UTC+3)</SelectItem>
                          <SelectItem value="Europe/Kaliningrad" className="rounded-lg">Europe/Kaliningrad (MSK-1, UTC+2)</SelectItem>
                          <SelectItem value="Europe/Samara" className="rounded-lg">Europe/Samara (MSK+1, UTC+4)</SelectItem>
                          <SelectItem value="Asia/Yekaterinburg" className="rounded-lg">Asia/Yekaterinburg (MSK+2, UTC+5)</SelectItem>
                          <SelectItem value="Asia/Omsk" className="rounded-lg">Asia/Omsk (MSK+3, UTC+6)</SelectItem>
                          <SelectItem value="Asia/Krasnoyarsk" className="rounded-lg">Asia/Krasnoyarsk (MSK+4, UTC+7)</SelectItem>
                          <SelectItem value="Asia/Irkutsk" className="rounded-lg">Asia/Irkutsk (MSK+5, UTC+8)</SelectItem>
                          <SelectItem value="Asia/Yakutsk" className="rounded-lg">Asia/Yakutsk (MSK+6, UTC+9)</SelectItem>
                          <SelectItem value="Asia/Vladivostok" className="rounded-lg">Asia/Vladivostok (MSK+7, UTC+10)</SelectItem>
                          <SelectItem value="Asia/Magadan" className="rounded-lg">Asia/Magadan (MSK+8, UTC+11)</SelectItem>
                          <SelectItem value="Asia/Kamchatka" className="rounded-lg">Asia/Kamchatka (MSK+9, UTC+12)</SelectItem>
                          <SelectItem value="UTC" className="rounded-lg">UTC (Всемирное время)</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-slate-500 font-semibold leading-relaxed">
                        По умолчанию используется часовой пояс твоего браузера.
                      </p>
                    </div>

                    <hr className="border-slate-100" />
                    <ChannelSuggestions
                      tab={tab}
                      config={config}
                      setChannelConfigs={setChannelConfigs}
                      handleAddSuggestionTime={handleAddSuggestionTime}
                      handleRemoveSuggestionTime={handleRemoveSuggestionTime}
                      handleSuggestionTimeChange={handleSuggestionTimeChange}
                    />
                    <ChannelReactions tab={tab} config={config} setChannelConfigs={setChannelConfigs} />
                    <hr className="border-slate-100" />
                    <ChannelButtonsEditor
                      tab={tab}
                      config={config}
                      handleAddButton={handleAddButton}
                      handleRemoveButton={handleRemoveButton}
                      handleButtonChange={handleButtonChange}
                    />
                    <hr className="border-slate-100 my-6" />

                    {/* Кнопка сохранения настроек канала */}
                    <div className="flex justify-start">
                      <Button
                        onClick={() => handleSaveChannelConfig(tab)}
                        disabled={savingChannel[tab]}
                        className="h-11 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-md shadow-indigo-200 disabled:opacity-50 transition-all"
                      >
                        {savingChannel[tab] ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                        Сохранить настройки канала
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
        </Card>
  );
}
