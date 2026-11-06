import { formatTon, payoutFieldClass, shortTxHash } from '../components/TransferBoxes.jsx';

  // Инлайн-панель возврата депозита — раскрывается под кнопками в блоке «Возврат депозита».
export function RefundPanel({ state, refundPanel, refundForm, refundFormErrors, setRefundForm, closeRefundPanel, submitRefundRequestForm, submitRefundSentForm, submitRefundCancelForm, sendReserveRefundAutomatically }) {
    if (!refundPanel) return null;
    const reserve = state.reserve || {};
    const refundableTon = Number(reserve.refundableTon || 0);
    const grossRefundableTon = Number(reserve.grossRefundableTon || 0);
    const refundNetworkFeeTon = Number(reserve.refundNetworkFeeTon || 0);
    const requestedTon = Number(reserve.refundRequestedTon || 0);
    const defaultRefundWallet = reserve.defaultRefundWallet || '';
    const automaticRefund = !!state.support?.automaticRefundSender;

    const actionButtons = (confirmLabel, onConfirm) => (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="px-5 py-2.5 bg-slate-900 text-white rounded-xl font-bold text-sm shadow-md shadow-slate-900/20 hover:bg-slate-800 transition-all disabled:opacity-50"
          onClick={onConfirm}
          disabled={state.refunding}
        >
          {state.refunding ? 'Секунду...' : confirmLabel}
        </button>
        <button
          type="button"
          className="px-5 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl font-bold text-sm hover:bg-slate-50 transition-all disabled:opacity-50"
          onClick={closeRefundPanel}
          disabled={state.refunding}
        >
          Отмена
        </button>
      </div>
    );

    if (refundPanel.kind === 'request') {
      return (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">
              {automaticRefund ? 'Запросить и отправить возврат' : 'Запросить возврат депозита'}
            </div>
            <div className="text-xs font-bold text-slate-500">К получению: {formatTon(refundableTon)} TON</div>
          </div>
          <div className="text-xs font-bold text-slate-500">
            Депозит {formatTon(grossRefundableTon)} · комиссия сети {formatTon(refundNetworkFeeTon)} · к получению {formatTon(refundableTon)}
            {!automaticRefund && ' · Новые партнеры будут на паузе, пока возврат не закрыт.'}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block space-y-1.5 sm:col-span-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                {defaultRefundWallet ? 'TON-кошелек возврата — из Кассы (/app/billing)' : 'TON-кошелек, куда вернуть свободный резерв'}
              </span>
              <input
                type="text"
                className={`${payoutFieldClass} font-mono${defaultRefundWallet ? ' opacity-70' : ''}`}
                value={refundForm.wallet}
                readOnly={!!defaultRefundWallet}
                onChange={(event) => setRefundForm((prev) => ({ ...prev, wallet: event.target.value }))}
              />
              {refundFormErrors.wallet && <span className="block text-xs font-bold text-rose-600">{refundFormErrors.wallet}</span>}
              {defaultRefundWallet && !refundFormErrors.wallet && (
                <span className="block text-xs font-medium text-slate-500">
                  Кошелек берется из Кассы → Оплаты от подписчиков (/app/billing). Сменить его можно там.
                </span>
              )}
            </label>
            <label className="block space-y-1.5 sm:col-span-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Комментарий к возврату — опционально</span>
              <input
                type="text"
                className={payoutFieldClass}
                value={refundForm.note}
                onChange={(event) => setRefundForm((prev) => ({ ...prev, note: event.target.value }))}
              />
            </label>
          </div>
          {actionButtons('Подтвердить возврат', submitRefundRequestForm)}
        </div>
      );
    }

    if (refundPanel.kind === 'sent') {
      return (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">Возврат отправлен вручную</div>
            <div className="text-xs font-bold text-slate-500">Заявка: {formatTon(requestedTon)} TON</div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block space-y-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Сумма, TON</span>
              <input
                type="number"
                min="0"
                step="any"
                className={payoutFieldClass}
                value={refundForm.amount}
                onChange={(event) => setRefundForm((prev) => ({ ...prev, amount: event.target.value }))}
              />
              {refundFormErrors.amount && <span className="block text-xs font-bold text-rose-600">{refundFormErrors.amount}</span>}
            </label>
            <label className="block space-y-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Tx hash TON-возврата</span>
              <input
                type="text"
                className={`${payoutFieldClass} font-mono`}
                value={refundForm.txHash}
                onChange={(event) => setRefundForm((prev) => ({ ...prev, txHash: event.target.value }))}
              />
              {refundFormErrors.txHash && <span className="block text-xs font-bold text-rose-600">{refundFormErrors.txHash}</span>}
            </label>
            <label className="block space-y-1.5 sm:col-span-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Комментарий к отправленному возврату — опционально</span>
              <input
                type="text"
                className={payoutFieldClass}
                value={refundForm.note}
                onChange={(event) => setRefundForm((prev) => ({ ...prev, note: event.target.value }))}
              />
            </label>
          </div>
          <div className="text-xs font-bold text-slate-500 truncate">
            Возврат {refundForm.amount || 0} TON · tx {refundForm.txHash ? shortTxHash(refundForm.txHash) : '—'}
          </div>
          {actionButtons('Подтвердить отправку', submitRefundSentForm)}
        </div>
      );
    }

    if (refundPanel.kind === 'cancel') {
      return (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">Отменить заявку на возврат</div>
          <div className="text-sm font-bold text-slate-800">
            Отменить заявку на {formatTon(requestedTon)}? После этого можно создать новую на актуальную сумму.
          </div>
          <label className="block space-y-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Комментарий к отмене — опционально</span>
            <input
              type="text"
              className={payoutFieldClass}
              value={refundForm.note}
              onChange={(event) => setRefundForm((prev) => ({ ...prev, note: event.target.value }))}
            />
          </label>
          {actionButtons('Отменить заявку', submitRefundCancelForm)}
        </div>
      );
    }

    // refundPanel.kind === 'auto'
    return (
      <div className="bg-blue-50/60 border border-blue-100 rounded-2xl p-5 space-y-4">
        <div className="text-[11px] font-black uppercase tracking-widest text-blue-700">Авто TON</div>
        <div className="text-sm font-bold text-slate-800">
          Автоматически отправить {formatTon(requestedTon)} на TON-кошелек {refundForm.wallet}?
        </div>
        {actionButtons('Отправить автоматически', sendReserveRefundAutomatically)}
      </div>
    );
}
