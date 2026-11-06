// Вынесено из ProxyConnectPanel.jsx (механическая разрезка под лимит
// pre-commit 20KB): админ-ветка «Поднять серверный прокси». Тело JSX
// перенесено дословно; ссылки на состояние родителя заменены на props:
// state.support → support, state.error → error, state.saving → saving.
// isAdminCreate в точке рендера родителя всегда true (ветка его тернарника).
// closeTrigger собран на месте из prop onClose — тот же JSX, что в родителе
// (клиентской ветке), чтобы не дублировать проп.

import { Check, Lock, Plus, Store, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const CARD_CLASS = 'bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden';

export function AdminServerProxyForm({
  formState,
  setFormState,
  bulkCount,
  setBulkCount,
  externalProxyMode,
  setExternalProxyMode,
  raisePriceTon,
  setRaisePriceTon,
  support,
  showQuotaLock,
  serverProxyMode,
  serverBatchCount,
  suggestedServerProxyName,
  isAdminCreate,
  error,
  saving,
  saveProxy,
  onClose
}) {
  const closeTrigger = (
    <Button
      variant="ghost"
      size="icon"
      className="shrink-0"
      onClick={onClose}
      title="Скрыть окно подключения прокси"
    >
      <X className="w-4 h-4" />
    </Button>
  );

  return (
    <div className={CARD_CLASS}>
          <div className="p-6 md:p-8 border-b border-slate-100">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
                <Plus className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-bold text-slate-900">Поднять серверный прокси</h2>
                <p className="text-sm text-slate-500 font-medium mt-0.5">
                  Создай новый прокси на сервере или добавь внешний
                </p>
              </div>
              <div className="px-3 py-1.5 rounded-lg bg-blue-100 text-blue-700 text-sm font-semibold">
                {suggestedServerProxyName}
              </div>
              {closeTrigger}
            </div>
          </div>

          <div className="p-6 md:p-8">
            {showQuotaLock ? (
              <div className="mb-6 p-4 rounded-2xl bg-red-50 border border-red-200 text-red-800 font-medium">
                На Trial можно держать только один свой прокси. Чтобы добавить следующий, сначала перейди на Pro.
              </div>
            ) : null}

            <div className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-slate-700">Название</label>
                <input
                  className="h-11 w-full px-4 rounded-[14px] border border-slate-200 bg-slate-50 text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 shadow-sm"
                  type="text"
                  value={formState.name}
                  onChange={(event) => setFormState((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="Например: Прокси #5"
                />
              </div>

              {support?.profile_role === 'admin' ? (
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-slate-700">Зачем поднимаешь</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[
                      {
                        value: 'self_use',
                        icon: Lock,
                        title: 'Для себя',
                        text: 'Останется в инвентаре «Свои» — привяжешь к своему юзерботу.'
                      },
                      {
                        value: 'shop_sale',
                        icon: Store,
                        title: 'На продажу в shop',
                        text: 'Сразу после подъёма встанет на витрину по твоей цене.'
                      }
                    ].map((option) => {
                      const selected = formState.inventory_group === option.value;
                      const Icon = option.icon;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setFormState((prev) => ({ ...prev, inventory_group: option.value }))}
                          className={`relative text-left p-4 rounded-[16px] border-2 transition-all ${
                            selected
                              ? 'border-violet-500 bg-violet-50/60'
                              : 'border-slate-200 bg-white hover:border-slate-300'
                          }`}
                        >
                          {selected ? (
                            <span className="absolute top-3 right-3 w-5 h-5 rounded-full bg-violet-600 flex items-center justify-center">
                              <Check className="w-3 h-3 text-white" strokeWidth={3} />
                            </span>
                          ) : null}
                          <div className="flex items-center gap-2.5 mb-1.5">
                            <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${selected ? 'bg-violet-100 text-violet-600' : 'bg-slate-100 text-slate-500'}`}>
                              <Icon className="w-[18px] h-[18px]" />
                            </span>
                            <span className="text-[14px] font-bold text-slate-900">{option.title}</span>
                          </div>
                          <p className="text-[12px] font-medium text-slate-500 leading-snug">{option.text}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {serverProxyMode && formState.inventory_group === 'shop_sale' ? (
                <div className="space-y-1.5 max-w-xs">
                  <label className="text-[13px] font-semibold text-slate-700">Цена за штуку, TON</label>
                  <input
                    className="h-11 w-full px-4 rounded-[14px] border border-slate-200 bg-white text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
                    type="number"
                    min="0"
                    step="0.01"
                    value={raisePriceTon}
                    onChange={(event) => setRaisePriceTon(event.target.value)}
                    placeholder="0"
                  />
                  <div className="text-[12px] text-blue-600 font-medium">
                    Прокси сразу уйдут на витрину по этой цене.
                  </div>
                </div>
              ) : null}

              {serverProxyMode ? (
                <div className="rounded-[16px] bg-blue-50/40 p-4 border border-blue-100 space-y-4">
                  <div>
                    <div className="text-[13px] font-bold text-slate-800">Прокси поднимется на сервере Bullgram</div>
                    <p className="text-[12px] text-slate-500 mt-1">
                      Host, порт, логин и пароль сгенерируются автоматически. Проверка здоровья пойдёт в фоне.
                    </p>
                  </div>

                  <div className="space-y-1.5 max-w-xs">
                    <label className="text-[13px] font-semibold text-slate-700">Сколько прокси поднять (1–100)</label>
                    <input
                      className="h-11 w-full px-4 rounded-[14px] border border-slate-200 bg-white text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
                      type="number"
                      min="1"
                      max="100"
                      value={bulkCount}
                      onChange={(event) => setBulkCount(event.target.value)}
                    />
                    {serverBatchCount > 1 ? (
                      <div className="text-[12px] text-blue-600 font-medium">
                        Имена пронумеруются сами: {formState.name.replace(/\s*#?\d+\s*$/, '').trim() || 'Прокси'} #1…#{serverBatchCount}
                      </div>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    className="text-[12px] font-semibold text-blue-600 hover:text-blue-700 transition"
                    onClick={() => setExternalProxyMode(true)}
                  >
                    У меня внешний прокси — указать вручную
                  </button>
                </div>
              ) : (
                <>
                  <div className="rounded-[16px] bg-slate-50/50 p-4 border border-slate-100">
                    <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500 mb-3">Подключение</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-[13px] font-semibold text-slate-700">Host / IP</label>
                        <input
                          className="h-11 w-full px-4 rounded-[14px] border border-slate-200 bg-white text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
                          type="text"
                          value={formState.host}
                          onChange={(event) => setFormState((prev) => ({ ...prev, host: event.target.value }))}
                          placeholder="192.168.1.1"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[13px] font-semibold text-slate-700">Порт</label>
                        <input
                          className="h-11 w-full px-4 rounded-[14px] border border-slate-200 bg-white text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
                          type="number"
                          min="1"
                          max="65535"
                          value={formState.port}
                          onChange={(event) => setFormState((prev) => ({ ...prev, port: event.target.value }))}
                          placeholder="1080"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[16px] bg-slate-50/50 p-4 border border-slate-100">
                    <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500 mb-3">Авторизация</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-[13px] font-semibold text-slate-700">Username</label>
                        <input
                          className="h-11 w-full px-4 rounded-[14px] border border-slate-200 bg-white text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
                          type="text"
                          value={formState.username}
                          onChange={(event) => setFormState((prev) => ({ ...prev, username: event.target.value }))}
                          placeholder="Необязательно"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[13px] font-semibold text-slate-700">Password</label>
                        <input
                          className="h-11 w-full px-4 rounded-[14px] border border-slate-200 bg-white text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
                          type="password"
                          autoComplete="new-password"
                          value={formState.password}
                          onChange={(event) => setFormState((prev) => ({ ...prev, password: event.target.value }))}
                          placeholder="Необязательно"
                        />
                      </div>
                    </div>
                  </div>

                  {isAdminCreate && externalProxyMode ? (
                    <button
                      type="button"
                      className="text-[12px] font-semibold text-blue-600 hover:text-blue-700 transition self-start"
                      onClick={() => {
                        setExternalProxyMode(false);
                        setFormState((prev) => ({ ...prev, host: '', port: '', username: '', password: '' }));
                      }}
                    >
                      ← Вернуться к серверному прокси
                    </button>
                  ) : null}
                </>
              )}
            </div>

            {error ? (
              <div className="mt-4 p-3 rounded-xl bg-rose-50 border border-rose-100 text-sm font-medium text-rose-600">
                {error}
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-3 pt-6 border-t border-slate-100">
              <button
                className="flex-1 min-w-[200px] h-11 inline-flex items-center justify-center rounded-[14px] bg-blue-600 text-[14px] font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                onClick={saveProxy}
                disabled={saving || showQuotaLock}
              >
                {saving ? 'Сохраняем...'
                  : serverProxyMode
                    ? (formState.inventory_group === 'shop_sale'
                        ? `Поднять${serverBatchCount > 1 ? ` ${serverBatchCount}` : ''} и выставить на продажу`
                        : serverBatchCount > 1 ? `Поднять ${serverBatchCount} прокси на сервере` : 'Поднять прокси на сервере')
                  : 'Сохранить внешний прокси'}
              </button>
            </div>
          </div>
        </div>
  );
}
