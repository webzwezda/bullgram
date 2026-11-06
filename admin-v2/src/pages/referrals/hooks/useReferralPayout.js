import { useState } from 'react';
import { apiRequest } from '../../../api/client.js';
import { formatTon, payoutNetworkFeeTon, payoutTxHash } from '../components/TransferBoxes.jsx';

export function useReferralPayout({ accessToken, state, setState }) {
  // Инлайн-форма выплаты вместо цепочки window.prompt: какая панель раскрыта и ее поля.
  const [payoutPanel, setPayoutPanel] = useState(null);
  const [payoutForm, setPayoutForm] = useState({ amount: '', txHash: '', networkFee: '', note: '' });
  const [payoutFormErrors, setPayoutFormErrors] = useState({});
  function resetPayoutFormState() {
    setPayoutForm({ amount: '', txHash: '', networkFee: '', note: '' });
    setPayoutFormErrors({});
  }

  function closePayoutPanel() {
    setPayoutPanel(null);
    resetPayoutFormState();
  }

  function openPayoutForm(row, currency) {
    const normalizedCurrency = String(currency || '').toUpperCase();
    const balanceField = normalizedCurrency === 'TON' ? 'balance_ton' : 'balance_usdt';
    const currentBalance = Number(row?.[balanceField] || 0);
    if (currentBalance <= 0) {
      window.alert(`У партнера нет баланса в ${normalizedCurrency}.`);
      return;
    }
    const pendingTon = Number(row?.pending_payout_ton || 0);
    const hasPendingTonRequest = normalizedCurrency === 'TON' && pendingTon > 0 && row?.pending_payout_id;
    setPayoutPanel({ kind: 'payout', row, currency: normalizedCurrency });
    setPayoutForm({
      amount: String(hasPendingTonRequest ? pendingTon : currentBalance),
      txHash: payoutTxHash(row) || '',
      networkFee: String(payoutNetworkFeeTon(row) ?? '0'),
      note: ''
    });
    setPayoutFormErrors({});
  }

  async function markPayout(row, currency, form) {
    const normalizedCurrency = String(currency || '').toUpperCase();
    const balanceField = normalizedCurrency === 'TON' ? 'balance_ton' : 'balance_usdt';
    const currentBalance = Number(row?.[balanceField] || 0);
    if (currentBalance <= 0) {
      window.alert(`У партнера нет баланса в ${normalizedCurrency}.`);
      return;
    }

    setState((prev) => ({ ...prev, payouting: true }));
    try {
      await apiRequest('/api/referrals/payout', {
        accessToken,
        method: 'POST',
        body: {
          tg_user_id: row.tg_user_id,
          currency: normalizedCurrency,
          amount: form.amount,
          note: form.note || '',
          chain_tx_hash: form.chainTxHash || null,
          network_fee_ton: form.networkFeeTon ?? null,
          payout_request_id: form.payoutRequestId || null
        }
      });
      const data = await apiRequest('/api/referrals', { accessToken });
      setState((prev) => ({
        ...prev,
        payouting: false,
        settings: data.settings || prev.settings,
        summary: data.summary || prev.summary,
        topPartners: data.topPartners || prev.topPartners,
        leads: data.leads || prev.leads,
        pendingPayouts: data.pendingPayouts || prev.pendingPayouts,
        recentEvents: data.recentEvents || prev.recentEvents,
        support: data.support || prev.support,
        reserve: data.reserve || prev.reserve,
        economics: data.economics || prev.economics,
        updatedAt: new Date().toISOString()
      }));
      closePayoutPanel();
    } catch (error) {
      setState((prev) => ({ ...prev, payouting: false }));
      window.alert(error.message);
    }
  }

  async function submitPayoutForm() {
    if (payoutPanel?.kind !== 'payout') return;
    const { row, currency: normalizedCurrency } = payoutPanel;
    const balanceField = normalizedCurrency === 'TON' ? 'balance_ton' : 'balance_usdt';
    const currentBalance = Number(row?.[balanceField] || 0);
    const pendingTon = Number(row?.pending_payout_ton || 0);
    const hasPendingTonRequest = normalizedCurrency === 'TON' && pendingTon > 0 && row?.pending_payout_id;

    const amount = Number(String(payoutForm.amount || '').replace(',', '.'));
    const errors = {};
    if (!Number.isFinite(amount) || amount <= 0) {
      errors.amount = 'Сумма должна быть больше нуля.';
    } else if (hasPendingTonRequest && amount !== pendingTon) {
      errors.amount = `Активная заявка — закрой ровно ${pendingTon} TON.`;
    } else if (currentBalance > 0 && amount > currentBalance) {
      errors.amount = `На балансе только ${currentBalance} ${normalizedCurrency}.`;
    }

    // tx hash и комиссия сети бэкенд принимает только при закрытии TON-заявки.
    let chainTxHash = null;
    let networkFeeTon = null;
    if (hasPendingTonRequest) {
      chainTxHash = String(payoutForm.txHash || '').trim();
      if (!chainTxHash) {
        errors.txHash = 'Нужен tx hash TON-перевода.';
      }
      const rawFee = String(payoutForm.networkFee || '').trim();
      if (rawFee) {
        const parsedFee = Number(rawFee.replace(',', '.'));
        if (!Number.isFinite(parsedFee) || parsedFee < 0) {
          errors.networkFee = 'Комиссия должна быть числом не меньше нуля.';
        } else {
          networkFeeTon = parsedFee;
        }
      } else {
        networkFeeTon = 0;
      }
    }

    if (Object.keys(errors).length > 0) {
      setPayoutFormErrors(errors);
      return;
    }

    await markPayout(row, normalizedCurrency, {
      amount,
      note: String(payoutForm.note || '').trim(),
      chainTxHash,
      networkFeeTon,
      payoutRequestId: hasPendingTonRequest ? row.pending_payout_id : null
    });
  }

  function openPayoutNoteForm(row, nextStatus) {
    if (!row?.pending_payout_id) {
      window.alert('У партнера нет активной заявки.');
      return;
    }
    setPayoutPanel({ kind: 'note', row, status: nextStatus });
    resetPayoutFormState();
  }

  async function updatePayoutRequest(row, nextStatus, note = '') {
    if (!row?.pending_payout_id) {
      window.alert('У партнера нет активной заявки.');
      return;
    }

    setState((prev) => ({ ...prev, payouting: true }));
    try {
      await apiRequest('/api/referrals/payout-request-status', {
        accessToken,
        method: 'POST',
        body: {
          payout_request_id: row.pending_payout_id,
          status: nextStatus,
          note
        }
      });
      const data = await apiRequest('/api/referrals', { accessToken });
      setState((prev) => ({
        ...prev,
        payouting: false,
        settings: data.settings || prev.settings,
        summary: data.summary || prev.summary,
        topPartners: data.topPartners || prev.topPartners,
        leads: data.leads || prev.leads,
        pendingPayouts: data.pendingPayouts || [],
        recentEvents: data.recentEvents || prev.recentEvents,
        support: data.support || prev.support,
        reserve: data.reserve || prev.reserve,
        economics: data.economics || prev.economics,
        updatedAt: new Date().toISOString()
      }));
      closePayoutPanel();
    } catch (error) {
      setState((prev) => ({ ...prev, payouting: false }));
      window.alert(error.message);
    }
  }

  async function submitPayoutNoteForm() {
    if (payoutPanel?.kind !== 'note') return;
    await updatePayoutRequest(payoutPanel.row, payoutPanel.status, String(payoutForm.note || '').trim());
  }

  function openAutoSendConfirm(row) {
    if (!row?.pending_payout_id) {
      window.alert('У партнера нет активной заявки.');
      return;
    }
    const maxAutoPayoutTon = Number(state.support?.automaticPayoutSenderMaxAmountTon || 0);
    if (maxAutoPayoutTon > 0 && Number(row.pending_payout_ton || 0) > maxAutoPayoutTon) {
      window.alert(`Авто TON сейчас ограничен ${formatTon(maxAutoPayoutTon)} за одну заявку. Эту выплату нужно закрыть вручную.`);
      return;
    }
    setPayoutPanel({ kind: 'auto', row });
    resetPayoutFormState();
  }

  async function sendPayoutAutomatically(row) {
    if (!row?.pending_payout_id) {
      window.alert('У партнера нет активной заявки.');
      return;
    }

    const maxAutoPayoutTon = Number(state.support?.automaticPayoutSenderMaxAmountTon || 0);
    if (maxAutoPayoutTon > 0 && Number(row.pending_payout_ton || 0) > maxAutoPayoutTon) {
      window.alert(`Авто TON сейчас ограничен ${formatTon(maxAutoPayoutTon)} за одну заявку. Эту выплату нужно закрыть вручную.`);
      return;
    }

    setState((prev) => ({ ...prev, payouting: true }));
    try {
      await apiRequest('/api/referrals/payout-request-send', {
        accessToken,
        method: 'POST',
        body: {
          payout_request_id: row.pending_payout_id
        }
      });
      const data = await apiRequest('/api/referrals', { accessToken });
      setState((prev) => ({
        ...prev,
        payouting: false,
        settings: data.settings || prev.settings,
        summary: data.summary || prev.summary,
        topPartners: data.topPartners || prev.topPartners,
        leads: data.leads || prev.leads,
        pendingPayouts: data.pendingPayouts || [],
        recentEvents: data.recentEvents || prev.recentEvents,
        support: data.support || prev.support,
        reserve: data.reserve || prev.reserve,
        economics: data.economics || prev.economics,
        updatedAt: new Date().toISOString()
      }));
      closePayoutPanel();
    } catch (error) {
      setState((prev) => ({ ...prev, payouting: false }));
      window.alert(error.message);
    }
  }

  async function submitAutoSend() {
    if (payoutPanel?.kind !== 'auto') return;
    await sendPayoutAutomatically(payoutPanel.row);
  }

  function payoutPanelForRow(row) {
    if (!payoutPanel || !row) return null;
    const matches = payoutPanel.kind === 'payout'
      ? payoutPanel.row.tg_user_id === row.tg_user_id
      : payoutPanel.row.pending_payout_id === row.pending_payout_id;
    return matches ? payoutPanel : null;
  }

  return {
    payoutPanel,
    payoutForm,
    setPayoutForm,
    payoutFormErrors,
    closePayoutPanel,
    openPayoutForm,
    openPayoutNoteForm,
    updatePayoutRequest,
    openAutoSendConfirm,
    submitPayoutForm,
    submitPayoutNoteForm,
    submitAutoSend,
    payoutPanelForRow
  };
}
