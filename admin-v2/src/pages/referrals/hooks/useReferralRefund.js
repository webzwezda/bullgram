import { useState } from 'react';
import { apiRequest } from '../../../api/client.js';
import { formatTon } from '../components/TransferBoxes.jsx';

export function useReferralRefund({ accessToken, state, setState, refreshReferralState }) {
  // Инлайн-форма возврата депозита вместо цепочки window.prompt/confirm.
  const [refundPanel, setRefundPanel] = useState(null); // { kind: 'request' | 'sent' | 'cancel' | 'auto' }
  const [refundForm, setRefundForm] = useState({ amount: '', wallet: '', txHash: '', note: '' });
  const [refundFormErrors, setRefundFormErrors] = useState({});
  function resetRefundFormState() {
    setRefundForm({ amount: '', wallet: '', txHash: '', note: '' });
    setRefundFormErrors({});
  }

  function closeRefundPanel() {
    setRefundPanel(null);
    resetRefundFormState();
  }

  function openRefundRequestForm() {
    const refundableTon = Number(state.reserve?.refundableTon || 0);
    if (!state.reserve?.canRequestRefund) {
      window.alert('Депозит еще в локе. Возврат доступен после 30 дней.');
      return;
    }
    if (refundableTon <= 0) {
      window.alert('Свободного резерва для возврата нет после комиссии сети.');
      return;
    }
    setRefundPanel({ kind: 'request' });
    setRefundForm({
      amount: String(refundableTon),
      wallet: state.reserve?.defaultRefundWallet || state.reserve?.refundWallet || '',
      txHash: '',
      note: ''
    });
    setRefundFormErrors({});
  }

  function openRefundSentForm() {
    const requestedTon = Number(state.reserve?.refundRequestedTon || 0);
    if (state.reserve?.status !== 'refund_requested' || requestedTon <= 0) {
      window.alert('Нет активного запроса на возврат.');
      return;
    }
    setRefundPanel({ kind: 'sent' });
    setRefundForm({ amount: String(requestedTon), wallet: '', txHash: '', note: '' });
    setRefundFormErrors({});
  }

  function openRefundCancelForm() {
    if (state.reserve?.status !== 'refund_requested') {
      window.alert('Активной заявки на возврат нет.');
      return;
    }
    setRefundPanel({ kind: 'cancel' });
    setRefundForm({ amount: String(state.reserve?.refundRequestedTon || ''), wallet: '', txHash: '', note: '' });
    setRefundFormErrors({});
  }

  function openRefundAutoForm() {
    const requestedTon = Number(state.reserve?.refundRequestedTon || 0);
    const refundWallet = state.reserve?.refundWallet || '';
    if (state.reserve?.status !== 'refund_requested' || requestedTon <= 0 || !refundWallet) {
      window.alert('Нет активного запроса на возврат с TON-кошельком.');
      return;
    }
    setRefundPanel({ kind: 'auto' });
    setRefundForm({ amount: String(requestedTon), wallet: refundWallet, txHash: '', note: '' });
    setRefundFormErrors({});
  }

  async function requestReserveRefund({ refundWallet, note }) {
    const automaticRefund = !!state.support?.automaticRefundSender;

    setState((prev) => ({ ...prev, refunding: true, error: '' }));
    try {
      await apiRequest('/api/referrals/reserve/refund-request', {
        accessToken,
        method: 'POST',
        body: {
          note,
          refund_wallet: refundWallet
        }
      });
      if (automaticRefund) {
        await apiRequest('/api/referrals/reserve/refund-send-auto', {
          accessToken,
          method: 'POST'
        });
      }
      await refreshReferralState({ refunding: false });
      closeRefundPanel();
    } catch (error) {
      await refreshReferralState({ refunding: false }).catch(() => {
        setState((prev) => ({ ...prev, refunding: false }));
      });
      window.alert(error.message);
    }
  }

  async function submitRefundRequestForm() {
    if (refundPanel?.kind !== 'request') return;
    const refundWallet = String(refundForm.wallet || '').trim();
    const errors = {};
    if (!refundWallet) {
      errors.wallet = 'Нужен TON-кошелек для возврата. Укажи его в Кассе на табе «Оплаты от подписчиков» (/app/billing).';
    }
    if (Object.keys(errors).length > 0) {
      setRefundFormErrors(errors);
      return;
    }
    await requestReserveRefund({ refundWallet, note: String(refundForm.note || '').trim() });
  }

  async function markReserveRefundSent({ amountTon, chainTxHash, note }) {
    setState((prev) => ({ ...prev, refunding: true, error: '' }));
    try {
      await apiRequest('/api/referrals/reserve/refund-sent', {
        accessToken,
        method: 'POST',
        body: {
          amount_ton: amountTon,
          chain_tx_hash: chainTxHash,
          note
        }
      });
      await refreshReferralState({ refunding: false });
      closeRefundPanel();
    } catch (error) {
      setState((prev) => ({ ...prev, refunding: false }));
      window.alert(error.message);
    }
  }

  async function submitRefundSentForm() {
    if (refundPanel?.kind !== 'sent') return;
    const refundableTon = Number(state.reserve?.refundableTon || 0);
    const amount = Number(String(refundForm.amount || '').replace(',', '.'));
    const chainTxHash = String(refundForm.txHash || '').trim();

    const errors = {};
    if (!Number.isFinite(amount) || amount <= 0) {
      errors.amount = 'Сумма должна быть больше нуля.';
    } else if (refundableTon > 0 && amount > refundableTon) {
      errors.amount = `К возврату сейчас только ${formatTon(refundableTon)} после комиссии сети.`;
    }
    if (!chainTxHash) {
      errors.txHash = 'Нужен tx hash TON-возврата.';
    }
    if (Object.keys(errors).length > 0) {
      setRefundFormErrors(errors);
      return;
    }
    await markReserveRefundSent({ amountTon: amount, chainTxHash, note: String(refundForm.note || '').trim() });
  }

  async function cancelReserveRefund({ note }) {
    setState((prev) => ({ ...prev, refunding: true, error: '' }));
    try {
      await apiRequest('/api/referrals/reserve/refund-cancel', {
        accessToken,
        method: 'POST',
        body: { note }
      });
      await refreshReferralState({ refunding: false });
      closeRefundPanel();
    } catch (error) {
      setState((prev) => ({ ...prev, refunding: false }));
      window.alert(error.message);
    }
  }

  async function submitRefundCancelForm() {
    if (refundPanel?.kind !== 'cancel') return;
    await cancelReserveRefund({ note: String(refundForm.note || '').trim() });
  }

  async function sendReserveRefundAutomatically() {
    setState((prev) => ({ ...prev, refunding: true, error: '' }));
    try {
      await apiRequest('/api/referrals/reserve/refund-send-auto', {
        accessToken,
        method: 'POST'
      });
      await refreshReferralState({ refunding: false });
      closeRefundPanel();
    } catch (error) {
      setState((prev) => ({ ...prev, refunding: false }));
      window.alert(error.message);
    }
  }

  return {
    refundPanel,
    refundForm,
    setRefundForm,
    refundFormErrors,
    closeRefundPanel,
    openRefundRequestForm,
    openRefundSentForm,
    openRefundCancelForm,
    openRefundAutoForm,
    submitRefundRequestForm,
    submitRefundSentForm,
    submitRefundCancelForm,
    sendReserveRefundAutomatically
  };
}
