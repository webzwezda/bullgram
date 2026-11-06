import { AlertCircle } from 'lucide-react';
import { Input } from '../../../components/ui/input.jsx';
import { Textarea } from '../../../components/ui/textarea.jsx';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '../../../components/ui/select.jsx';
import { Toggle, FieldLabel, ErrorText } from './shared.jsx';

/* Секция «Методы выдачи» диалога создания тарифа: закрытый канал, закрытый чат
   и ссылка/текст. Чистый рендер + прокидка апдейтеров из CreateTariffPanel. */
export function CreateAccessSection({
  errors, bundleSupport, groupAccess, chatAccess, resourceAccess,
  groupChannels, chatChannels, newTariff, setNewTariff, updateAccessMethod
}) {
  return (
    <div className="space-y-3">
          <ErrorText>{errors.access}</ErrorText>

          {/* Closed channel (private) */}
          <div className={`rounded-xl border transition-all ${groupAccess.enabled ? 'border-indigo-200 bg-indigo-50/30' : 'border-slate-200 bg-white'}`}>
            <div className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="text-sm font-bold text-slate-900">Закрытый канал</div>
                <div className="text-xs text-slate-500 font-medium">Приватный канал — бот выдаст доступ после оплаты</div>
              </div>
              <Toggle checked={groupAccess.enabled} onChange={(v) => updateAccessMethod('group', { enabled: v })} label="Закрытый канал" />
            </div>
            {groupAccess.enabled && (
              <div className="px-3 pb-3 space-y-2">
                {groupChannels.length > 0 ? (
                  <Select
                    value={newTariff.channel_id}
                    onValueChange={(v) => setNewTariff((prev) => ({ ...prev, channel_id: v }))}
                  >
                    <SelectTrigger className={`h-10 w-full bg-white rounded-xl shadow-sm ${errors.group_channel ? 'border-rose-300' : 'border-slate-200'}`}>
                      <SelectValue placeholder="Выбери закрытый канал" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      {groupChannels.map((channel) => (
                        <SelectItem key={channel.id} value={channel.id}>{channel.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="space-y-2">
                    <Input value="Нет закрытых каналов у этого бота" disabled className="bg-slate-50 text-slate-400 h-10" />
                    <div className="flex items-start gap-2 text-[11px] font-medium text-slate-500 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                      <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-400" />
                      <span>
                        Создайте приватный канал в Telegram, добавьте этого бота админом с правом приглашать, затем привяжите канал выше в секции «Контур продаж» и обновите данные.
                      </span>
                    </div>
                  </div>
                )}
                <ErrorText>{errors.group_channel}</ErrorText>
              </div>
            )}
          </div>

          {/* Closed chat (private) — only if bundleSupport */}
          {bundleSupport && (
            <div className={`rounded-xl border transition-all ${chatAccess.enabled ? 'border-indigo-200 bg-indigo-50/30' : 'border-slate-200 bg-white'}`}>
              <div className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900">Закрытый чат</div>
                  <div className="text-xs text-slate-500 font-medium">Приватная группа — бот отправит ссылку на вступление</div>
                </div>
                <Toggle checked={chatAccess.enabled} onChange={(v) => updateAccessMethod('chat', { enabled: v })} label="Закрытый чат" />
              </div>
              {chatAccess.enabled && (
                <div className="px-3 pb-3">
                  {chatChannels.length > 0 ? (
                    <Select
                      value={chatAccess.channel_id || ''}
                      onValueChange={(v) => updateAccessMethod('chat', { channel_id: v })}
                    >
                      <SelectTrigger className={`h-10 w-full bg-white rounded-xl shadow-sm ${errors.chat_channel ? 'border-rose-300' : 'border-slate-200'}`}>
                        <SelectValue placeholder="Выбери закрытый чат" />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl">
                        {chatChannels.map((channel) => (
                          <SelectItem key={channel.id} value={channel.id}>{channel.title}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input value="Нет закрытых чатов у этого бота" disabled className="bg-slate-50 text-slate-400 h-10" />
                  )}
                  <ErrorText>{errors.chat_channel}</ErrorText>
                </div>
              )}
            </div>
          )}

          {/* Resource (only if bundleSupport) */}
          {bundleSupport && (
            <div className={`rounded-xl border transition-all ${resourceAccess.enabled ? 'border-indigo-200 bg-indigo-50/30' : 'border-slate-200 bg-white'}`}>
              <div className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900">Ссылка / текст</div>
                  <div className="text-xs text-slate-500 font-medium">Бот отправит материал после оплаты</div>
                </div>
                <Toggle checked={resourceAccess.enabled} onChange={(v) => updateAccessMethod('resource', { enabled: v })} label="Ссылка / текст" />
              </div>
              {resourceAccess.enabled && (
                <div className="px-3 pb-3 space-y-3">
                  <div>
                    <FieldLabel>Название материала</FieldLabel>
                    <Input
                      value={resourceAccess.title || ''}
                      onChange={(e) => updateAccessMethod('resource', { title: e.target.value })}
                      placeholder="Гайд / курс / ссылка"
                      className="h-10"
                    />
                  </div>
                  <div>
                    <FieldLabel required>URL или текст</FieldLabel>
                    <Textarea
                      value={resourceAccess.text || ''}
                      onChange={(e) => updateAccessMethod('resource', { text: e.target.value })}
                      placeholder="https://... или текст, который получит покупатель"
                      rows={2}
                      className={errors.resource_text ? 'border-rose-300 focus-visible:ring-rose-500' : ''}
                    />
                    <ErrorText>{errors.resource_text}</ErrorText>
                  </div>
                </div>
              )}
            </div>
          )}

          {!bundleSupport && (
            <div className="flex items-start gap-2 text-[11px] font-bold text-amber-700 bg-amber-50 p-3 rounded-xl border border-amber-200">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>Bundle-пакеты в БД не активированы — доступны только закрытые группы.</span>
            </div>
          )}
    </div>
  );
}
