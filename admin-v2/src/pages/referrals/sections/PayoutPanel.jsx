import { formatTon, payoutFieldClass, shortTxHash } from '../components/TransferBoxes.jsx';

export function PayoutPanel({ panel, state, payoutForm, payoutFormErrors, setPayoutForm, closePayoutPanel, submitPayoutForm, submitPayoutNoteForm, submitAutoSend }) {
    const panelRow = panel.row;
    const partnerName = panelRow.display_name || panelRow.username || panelRow.tg_user_id;

    const actionButtons = (confirmLabel, onConfirm) => (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="px-5 py-2.5 bg-slate-900 text-white rounded-xl font-bold text-sm shadow-md shadow-slate-900/20 hover:bg-slate-800 transition-all disabled:opacity-50"
          onClick={onConfirm}
          disabled={state.payouting}
        >
          {state.payouting ? 'Секунду...' : confirmLabel}
        </button>
        <button
          type="button"
          className="px-5 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl font-bold text-sm hover:bg-slate-50 transition-all disabled:opacity-50"
          onClick={closePayoutPanel}
          disabled={state.payouting}
        >
          Отмена
        </button>
      </div>
    );

    if (panel.kind === 'payout') {
      const balanceField = panel.currency === 'TON' ? 'balance_ton' : 'balance_usdt';
      const currentBalance = Number(panelRow?.[balanceField] || 0);
      const pendingTon = Number(panelRow?.pending_payout_ton || 0);
      const hasPendingTonRequest = panel.currency === 'TON' && pendingTon > 0 && panelRow?.pending_payout_id;
      return (
        <div className="bg-slate-50/70 border border-slate-200 rounded-2xl p-5 space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">Выплата партнеру</div>
            <div className="text-xs font-bold text-slate-500">Баланс: {currentBalance} {panel.currency}</div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block space-y-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Сумма, {panel.currency}</span>
              <input
                type="number"
                min="0"
                step="any"
                className={payoutFieldClass}
                value={payoutForm.amount}
                onChange={(event) => setPayoutForm((prev) => ({ ...prev, amount: event.target.value }))}
              />
              {hasPendingTonRequest && !payoutFormErrors.amount && (
                <span className="block text-xs font-medium text-slate-500">Активная заявка: закрой ровно <strong className="whitespace-nowrap">{pendingTon} TON.</strong></span>
              )}
              {payoutFormErrors.amount && <span className="block text-xs font-bold text-rose-600">{payoutFormErrors.amount}</span>}
            </label>
            {hasPendingTonRequest && (
              <label className="block space-y-1.5">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Комиссия сети, TON — опционально</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  className={payoutFieldClass}
                  value={payoutForm.networkFee}
                  onChange={(event) => setPayoutForm((prev) => ({ ...prev, networkFee: event.target.value }))}
                />
                {payoutFormErrors.networkFee && <span className="block text-xs font-bold text-rose-600">{payoutFormErrors.networkFee}</span>}
              </label>
            )}
            {hasPendingTonRequest && (
              <label className="block space-y-1.5 sm:col-span-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Tx hash TON-перевода</span>
                <input
                  type="text"
                  className={`${payoutFieldClass} font-mono`}
                  value={payoutForm.txHash}
                  onChange={(event) => setPayoutForm((prev) => ({ ...prev, txHash: event.target.value }))}
                />
                {payoutFormErrors.txHash && <span className="block text-xs font-bold text-rose-600">{payoutFormErrors.txHash}</span>}
              </label>
            )}
            <label className="block space-y-1.5 sm:col-span-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Примечание (карта, кошелек, дата) — опционально</span>
              <input
                type="text"
                className={payoutFieldClass}
                value={payoutForm.note}
                onChange={(event) => setPayoutForm((prev) => ({ ...prev, note: event.target.value }))}
              />
            </label>
          </div>
          <div
            className="text-xs font-bold text-slate-500 truncate"
            title={`Партнёр ${partnerName} · сумма ${payoutForm.amount || 0} ${panel.currency} · hash ${payoutForm.txHash || '—'}`}
          >
            Партнёр {partnerName} · сумма {payoutForm.amount || 0} {panel.currency} · hash {payoutForm.txHash ? shortTxHash(payoutForm.txHash) : '—'}
          </div>
          {actionButtons('Подтвердить выплату', submitPayoutForm)}
        </div>
      );
    }

    if (panel.kind === 'note') {
      const isFail = panel.status === 'failed';
      return (
        <div className="bg-slate-50/70 border border-slate-200 rounded-2xl p-5 space-y-4">
          <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">
            {isFail ? 'Отметить ошибку выплаты' : 'Отклонить заявку на выплату'}
          </div>
          <label className="block space-y-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Комментарий</span>
            <input
              type="text"
              className={payoutFieldClass}
              value={payoutForm.note}
              onChange={(event) => setPayoutForm((prev) => ({ ...prev, note: event.target.value }))}
            />
          </label>
          <div className="text-xs font-bold text-slate-500 truncate">
            Партнёр {partnerName} · заявка {formatTon(panelRow.pending_payout_ton)}
          </div>
          {actionButtons(isFail ? 'Подтвердить ошибку' : 'Подтвердить отклонение', submitPayoutNoteForm)}
        </div>
      );
    }

    // panel.kind === 'auto'
    return (
      <div className="bg-blue-50/60 border border-blue-100 rounded-2xl p-5 space-y-4">
        <div className="text-[11px] font-black uppercase tracking-widest text-blue-700">Авто-выплата TON</div>
        <div className="text-sm font-bold text-slate-800">
          Отправить {formatTon(panelRow.pending_payout_ton)} на TON-кошелек партнера автоматически?
        </div>
        <div className="text-xs font-bold text-slate-500 truncate">Партнёр {partnerName}</div>
        {actionButtons('Отправить автоматически', submitAutoSend)}
      </div>
    );
}
