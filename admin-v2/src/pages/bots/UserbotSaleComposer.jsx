import { saleTitleForAccount } from './bots-accounts.utils.js';

export function UserbotSaleComposer({
  account,
  saleComposer,
  saveUserbotSaleLot,
  setSaleComposer,
  toggleSalePaymentMethod
}) {
  return (
    <div className="rounded-[20px] border border-slate-200 bg-slate-50/70 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[18px] font-semibold tracking-[-0.02em] text-slate-900">Продажа юзербота</div>
        </div>
      </div>
      <div className="mt-5">
        <div className="mb-3 text-[13px] font-semibold uppercase tracking-[0.08em] text-slate-400">Что продаем</div>
        <div className="grid gap-3 md:grid-cols-2">
          <button
            type="button"
            className={`rounded-[18px] border px-4 py-4 text-left transition ${
              saleComposer.sale_type === 'userbot'
                ? 'border-slate-900 bg-slate-900 text-white shadow-[0_12px_32px_rgba(15,23,42,0.18)]'
                : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300'
            }`}
            onClick={() => setSaleComposer((prev) => ({
              ...prev,
              sale_type: 'userbot',
              title: saleTitleForAccount(account),
              error: ''
            }))}
          >
            <div className="text-[15px] font-semibold">Только аккаунт</div>
            <div className={`mt-1 text-[13px] ${saleComposer.sale_type === 'userbot' ? 'text-slate-200' : 'text-slate-500'}`}>
              В Shop уйдет только этот юзербот.
            </div>
          </button>
          <button
            type="button"
            className={`rounded-[18px] border px-4 py-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
              saleComposer.sale_type === 'bundle'
                ? 'border-blue-600 bg-blue-600 text-white shadow-[0_12px_32px_rgba(37,99,235,0.22)]'
                : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300'
            }`}
            onClick={() => {
              if (!account.proxy_id) return;
              setSaleComposer((prev) => ({
                ...prev,
                sale_type: 'bundle',
                title: saleTitleForAccount(account),
                error: ''
              }));
            }}
            disabled={!account.proxy_id}
          >
            <div className="text-[15px] font-semibold">Аккаунт + прокси</div>
            <div className={`mt-1 text-[13px] ${saleComposer.sale_type === 'bundle' ? 'text-blue-100' : 'text-slate-500'}`}>
              Вместе с аккаунтом уходит и его текущий прокси.
            </div>
          </button>
        </div>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <label className="block md:col-span-2">
          <span className="mb-2 block text-[13px] font-semibold uppercase tracking-[0.08em] text-slate-400">Название лота</span>
          <input
            className="h-11 w-full rounded-[14px] border border-slate-200 bg-white px-4 text-[14px] text-slate-900 outline-none transition focus:border-blue-500"
            value={saleComposer.title}
            onChange={(event) => setSaleComposer((prev) => ({ ...prev, title: event.target.value }))}
          />
        </label>
        <div className="md:col-span-2">
          <div className="mb-3 text-[13px] font-semibold uppercase tracking-[0.08em] text-slate-400">Цена и оплата</div>
          <div className="grid gap-3">
            <div className="rounded-[18px] border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold text-slate-900">TON</div>
                  <div className="mt-1 text-[13px] text-slate-500">Покупатель оплачивает лот напрямую в TON.</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={(saleComposer.payment_methods || []).includes('ton')}
                  aria-label="Оплата TON"
                  onClick={() => toggleSalePaymentMethod('ton', !(saleComposer.payment_methods || []).includes('ton'))}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-[2px] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
                    (saleComposer.payment_methods || []).includes('ton') ? 'bg-emerald-500' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`size-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                      (saleComposer.payment_methods || []).includes('ton') ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
              {(saleComposer.payment_methods || []).includes('ton') ? (
                <label className="mt-4 block">
                  <span className="mb-2 block text-[13px] font-medium text-slate-600">Цена в TON</span>
                  <input
                    className="h-11 w-full rounded-[14px] border border-slate-200 bg-slate-50 px-4 text-[14px] text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white"
                    inputMode="decimal"
                    value={saleComposer.price_ton}
                    onChange={(event) => setSaleComposer((prev) => ({ ...prev, price_ton: event.target.value }))}
                  />
                </label>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      {saleComposer.error ? (
        <div className="mt-4 userbots-status-note userbots-status-note--error">
          {saleComposer.error}
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className="inline-flex h-11 items-center justify-center rounded-[14px] bg-blue-600 px-4 text-[14px] font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-200"
          type="button"
          onClick={() => saveUserbotSaleLot(account)}
          disabled={saleComposer.saving}
        >
          {saleComposer.saving ? 'Сохраняем лот...' : 'Опубликовать лот'}
        </button>
      </div>
    </div>
  );
}
