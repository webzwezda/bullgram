import { MessageSquare, Plus, Loader2 } from 'lucide-react';
import { PreparationRunner } from '../PreparationRunner.jsx';
import { ReadinessDashboard } from '../ReadinessDashboard.jsx';
import { ACTIVE_PREPARATION_STATUSES } from '../utils/broadcastDraft.js';
import {
  Card, Section, SectionTitle, EmptyNote, inputCls, btnPrimary, btnGhost
} from '../ui.jsx';

const BROADCAST_TEMPLATES = [
  {
    label: 'Дожим базы',
    text: 'Салют! Видел, что ты интересовался нашим каналом, но подписка так и не оформилась. Контент уже ждёт — вступай: [ссылка]. Если что-то не получается, просто ответь на это сообщение, помогу.'
  },
  {
    label: 'Продление',
    text: 'Привет! Подписка на канал скоро заканчивается. Чтобы не потерять доступ, продлить можно здесь: [ссылка]. Цена для тебя не меняется — успей на прежних условиях.'
  },
  {
    label: 'Скидка',
    text: 'Короткая новость: на этой неделе скидка [размер]% на любую подписку. Акция действует до [дата]. Забрать: [ссылка].'
  },
  {
    label: 'Возврат в канал',
    text: 'Давно не виделись в канале! Пока тебя не было, мы добавили много нового. Вернуться можно за пару секунд: [ссылка] — старая цена для тебя сохранена.'
  },
  {
    label: 'Реактивация',
    text: 'Привет! Ты раньше был с нами — открываем доступ обратно на льготных условиях: [ссылка]. Если канал больше не интересен, просто не отвечай на это сообщение.'
  }
];

export function StepSend({
  step,
  preparation,
  selectionMatchesPreparation,
  groupsText,
  setGroupsText,
  pendingGroups,
  addingGroups,
  submitGroups,
  cancelPreparation,
  recheckPreparation,
  sending,
  accessToken,
  applyTemplate,
  form,
  setField,
  preparationBlocking,
  broadcastEnabled,
  titleEmpty,
  messageEmpty,
  sendDisabled,
  planRules,
  setStep
}) {
  return (
    <>
      {step === 'prepare' ? (
        preparation ? (
          <>
            <Card>
              <Section>
                <SectionTitle icon={Plus}>Группы для касания</SectionTitle>
                <div className="text-sm text-slate-500 font-medium mb-3">
                  Юзерботы сами вступают в каналы, где замечены получатели базы. Если человеку не хватает общего чата — добавь группу руками: юзерботы вступятся и получат точки касания.
                </div>
                <textarea
                  className={`${inputCls} resize-none min-h-[90px] font-medium`}
                  rows="3"
                  value={groupsText}
                  onChange={(e) => setGroupsText(e.target.value)}
                  placeholder={'@group\nhttps://t.me/+AbCdEf...\nПо одной группе на строку'}
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs font-bold text-amber-700">
                    {pendingGroups.length > 0
                      ? `В очереди: ${pendingGroups.length} — вступятся сразу после конца подготовки`
                      : ''}
                  </div>
                  <button
                    type="button"
                    className={btnPrimary}
                    disabled={addingGroups || !groupsText.trim()}
                    onClick={submitGroups}
                  >
                    {addingGroups ? <><Loader2 className="w-4 h-4 animate-spin" /> Добавляем...</> : 'Вступиться и пересчитать'}
                  </button>
                </div>
              </Section>
            </Card>
            <PreparationRunner preparation={preparation} onCancel={cancelPreparation}>
              {['ready', 'failed'].includes(preparation.status) && selectionMatchesPreparation ? (
                <ReadinessDashboard
                  accessToken={accessToken}
                  preparation={preparation}
                  onRecheck={recheckPreparation}
                  busy={sending}
                />
              ) : null}
            </PreparationRunner>
          </>
        ) : (
          <Card>
            <Section>
              <EmptyNote>Активной подготовки нет. Вернись к юзерботам и нажми «Подготовить».</EmptyNote>
            </Section>
          </Card>
        )
      ) : null}

      {step === 'send' && !(preparation?.status === 'ready' && selectionMatchesPreparation) ? (
        <Card>
          <Section>
            <EmptyNote>
              {preparation && ACTIVE_PREPARATION_STATUSES.has(preparation.status)
                ? 'Подготовка ещё идёт — вернись на шаг 3.'
                : 'Сначала прогони подготовку.'}
            </EmptyNote>
          </Section>
        </Card>
      ) : null}

      {step === 'send' ? (
        <>
          <Card>
            <Section>
              <SectionTitle icon={MessageSquare}>Сообщение</SectionTitle>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="text-xs font-black uppercase tracking-wider text-slate-500">Шаблоны</span>
                {BROADCAST_TEMPLATES.map((template) => (
                  <button
                    key={template.label}
                    type="button"
                    className="px-3 py-1.5 rounded-full bg-white border border-slate-200 text-xs font-bold text-slate-600 hover:border-indigo-400 hover:text-indigo-700 transition-colors"
                    onClick={() => applyTemplate(template)}
                  >
                    {template.label}
                  </button>
                ))}
              </div>
              <textarea
                className="w-full px-4 py-3 rounded-xl bg-white border border-slate-200 text-sm font-medium text-slate-900 focus:outline-none focus:border-slate-400 shadow-sm transition resize-none min-h-[160px]"
                rows="8"
                value={form.message_text}
                onChange={(e) => setField('message_text', e.target.value)}
                placeholder="Текст сообщения"
              />
              {preparationBlocking ? (
                <div className="mt-3 text-sm text-amber-700 font-medium">
                  {preparationBlocking}
                </div>
              ) : null}
              {!broadcastEnabled ? (
                <div className="mt-3 text-sm text-amber-700 font-medium">
                  Рассылка выключена на сервере (USERBOT_BROADCAST_ENABLED) — попроси владельца включить флаг, кнопка отправки заблокирована.
                </div>
              ) : null}
              {titleEmpty ? (
                <div className="mt-3">
                  <input
                    className={`${inputCls} !border-rose-300 focus:!border-rose-400`}
                    type="text"
                    value={form.title}
                    onChange={(e) => setField('title', e.target.value)}
                    placeholder="Название рассылки — обязательно"
                  />
                </div>
              ) : null}
              {!preparationBlocking && messageEmpty ? (
                <div className="mt-3 text-sm text-amber-700 font-medium">Напиши текст сообщения — без него кнопка отправки серая.</div>
              ) : null}
              <label className="mt-5 flex items-start gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="w-4 h-4 mt-0.5 accent-action-primary shrink-0"
                  checked={form.leave_groups_on_complete === true}
                  onChange={(e) => setField('leave_groups_on_complete', e.target.checked)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-ink-strong">Юзерботы выйдут из групп после рассылки</span>
                  <span className="block text-xs text-ink-muted font-medium mt-0.5">
                    Кто вступал ради охвата — выйдет (вместе с админкой, если её давали). Свои каналы и контурные площадки не тронем, старые админы останутся.
                  </span>
                </span>
              </label>
              <div className="mt-6 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <button type="button" className={`${btnGhost} w-full sm:w-auto`} onClick={() => setStep('userbots')}>
                  Назад
                </button>
                <button type="button" className={`${btnPrimary} w-full sm:w-auto`} onClick={sendCampaign} disabled={sendDisabled}>
                  {sending ? <><Loader2 className="w-4 h-4 animate-spin" /> Отправляем...</> : !planRules.canSendBroadcasts ? 'Нужен Pro' : 'Отправить рассылку'}
                </button>
              </div>
            </Section>
          </Card>
        </>
      ) : null}
    </>
  );
}
