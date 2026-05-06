import { AlertTriangle, Bot, Link2, MessageSquare, Radio, Save, UserRound } from 'lucide-react';

function renderOptionLabel(option) {
  if (!option) return '';
  return option.label || option.title || option.id;
}

export function SalesContourSection({
  contourError,
  contourWarnings,
  draft,
  paidChannelOptions,
  publicChatOptions,
  saveContour,
  savingContour,
  selectedOfficialBot,
  setFieldValue,
  setUserbotMode,
  userbotOptions
}) {
  const isPoolMode = draft.userbotMode === 'pool';

  return (
    <section className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden transition-all hover:border-slate-300/60">
      <div className="p-6 md:p-8 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white relative z-10">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20 text-white shrink-0">
            <Radio className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-xl font-black text-slate-900 tracking-tight">Контур продаж</h3>
            <p className="text-sm text-slate-500 font-medium mt-0.5">
              Привязка оплачиваемого канала, публичного чата и режима юзербота для @{selectedOfficialBot?.tg_username || `bot-${String(selectedOfficialBot?.tg_account_id || selectedOfficialBot?.id || '')}`}
            </p>
          </div>
        </div>
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-50 text-emerald-700 text-[13px] font-bold border border-emerald-100">
          <Bot className="w-4 h-4" />
          Только для ботов продаж
        </div>
      </div>

      <div className="p-6 md:p-8 bg-slate-50/50 space-y-5">
        {contourError ? (
          <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
            <div>
              <p className="font-bold">Контурный endpoint ответил ошибкой</p>
              <p className="mt-0.5 text-amber-800/90">
                Форма осталась рабочей на локальных данных бота, но итоговую готовность лучше перепроверить после ответа backend.
              </p>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
          <div className="md:col-span-5">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-bold text-slate-700 flex items-center gap-2">
                <Link2 className="w-4 h-4 text-emerald-600" />
                Платный канал / группа
              </span>
              <div className="relative">
                <select
                  className="w-full h-12 pl-4 pr-10 rounded-xl border border-slate-200 bg-white text-[15px] font-medium text-slate-900 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 appearance-none cursor-pointer shadow-sm"
                  value={draft.paidChannelId}
                  onChange={(event) => setFieldValue('paidChannelId', event.target.value)}
                >
                  <option value="">Выбери платный контур</option>
                  {paidChannelOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {renderOptionLabel(option)}
                    </option>
                  ))}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                </div>
              </div>
            </label>
          </div>

          <div className="md:col-span-4">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-bold text-slate-700 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-sky-600" />
                Публичный чат
                <span className="text-[11px] font-semibold text-slate-400">необязательно</span>
              </span>
              <div className="relative">
                <select
                  className="w-full h-12 pl-4 pr-10 rounded-xl border border-slate-200 bg-white text-[15px] font-medium text-slate-900 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 appearance-none cursor-pointer shadow-sm"
                  value={draft.publicChatId}
                  onChange={(event) => setFieldValue('publicChatId', event.target.value)}
                >
                  <option value="">Без публичного чата</option>
                  {publicChatOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {renderOptionLabel(option)}
                    </option>
                  ))}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                </div>
              </div>
            </label>
          </div>

          <div className="md:col-span-3">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-bold text-slate-700 flex items-center gap-2">
                <UserRound className="w-4 h-4 text-violet-600" />
                Режим юзербота
              </span>
              <div className="relative">
                <select
                  className="w-full h-12 pl-4 pr-10 rounded-xl border border-slate-200 bg-white text-[15px] font-medium text-slate-900 transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 appearance-none cursor-pointer shadow-sm"
                  value={draft.userbotMode}
                  onChange={(event) => setUserbotMode(event.target.value)}
                >
                  <option value="none">Без юзербота</option>
                  <option value="single">Один юзербот</option>
                  <option value="pool">Пул юзерботов</option>
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                </div>
              </div>
            </label>
          </div>

          {draft.userbotMode === 'single' ? (
            <div className="md:col-span-6">
              <label className="flex flex-col gap-2">
                <span className="text-sm font-bold text-slate-700">Выбранный юзербот</span>
                <div className="relative">
                  <select
                    className="w-full h-12 pl-4 pr-10 rounded-xl border border-slate-200 bg-white text-[15px] font-medium text-slate-900 transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 appearance-none cursor-pointer shadow-sm"
                    value={draft.selectedUserbotId}
                    onChange={(event) => setFieldValue('selectedUserbotId', event.target.value)}
                  >
                    <option value="">Выбери юзербота</option>
                    {userbotOptions.map((option) => (
                      <option key={option.id} value={option.id} disabled={option.eligible === false}>
                        {renderOptionLabel(option)}
                      </option>
                    ))}
                  </select>
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                  </div>
                </div>
              </label>
            </div>
          ) : null}

          {isPoolMode ? (
            <div className="md:col-span-12">
              <div className="flex gap-3 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-violet-500" />
                <div>
                  <p className="font-bold">Пул оставили на следующий шаг</p>
                  <p className="mt-0.5 text-violet-800/90">
                    В этом MVP режим уже виден оператору, но сохраняем пока только `без юзербота` и `один юзербот`, чтобы не обещать полурабочую автоматику.
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {contourWarnings.length ? (
          <div className="grid gap-3">
            {contourWarnings.map((warning) => (
              <div key={warning} className="flex gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
                <p>{warning}</p>
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
          <p className="text-sm text-slate-500 max-w-2xl leading-relaxed">
            Если ждешь ручной outreach через юзербота, Telegram может писать человеку только когда аккаунт уже знает цель или сидит с ней в общем чате. Права админа у юзербота в таком чате обычно повышают шанс доставки.
          </p>
          <button
            className="inline-flex items-center justify-center gap-2 h-12 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[15px] font-bold shadow-sm shadow-emerald-500/20 transition-all active:scale-[0.98] disabled:opacity-60 disabled:pointer-events-none"
            onClick={saveContour}
            disabled={savingContour || isPoolMode}
          >
            <Save className="w-4 h-4" />
            {savingContour ? 'Сохраняем...' : 'Сохранить контур'}
          </button>
        </div>
      </div>
    </section>
  );
}
