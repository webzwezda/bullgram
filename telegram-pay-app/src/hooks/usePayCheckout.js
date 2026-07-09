import { useCallback, useRef, useState } from 'react';
import { useTonConnectUI } from '@tonconnect/ui-react';
import { beginCell, toNano } from '@ton/core';
import { apiRequest } from '../api/client.js';

// WebApp-side checkout:
// 1) user sends TON via connected wallet
// 2) we poll /api/payment/public/verify-ton-connect up to 12 times (60s)
// 3) if not confirmed in 60s — UI shows "pending", Phase 0 cron handles late activation
//
// Memo is embedded in the TON transfer as `comment` (base64 in payload).
// Backend matches memo + amount on TonAPI.

const MAX_VERIFY_ATTEMPTS = 12;
const VERIFY_INTERVAL_MS = 5000;

export function usePayCheckout({ onStateChange } = {}) {
    const [tonConnectUI] = useTonConnectUI();
    const [state, setState] = useState('idle');
    const [errorMessage, setErrorMessage] = useState(null);
    const timerRef = useRef(null);

    const updateState = useCallback((next, message) => {
        setState(next);
        setErrorMessage(message || null);
        onStateChange?.(next, message);
    }, [onStateChange]);

    const wallet = tonConnectUI?.wallet;
    const connected = !!wallet;

    const verify = useCallback(async ({ invoiceId, senderWallet }) => {
        for (let attempt = 1; attempt <= MAX_VERIFY_ATTEMPTS; attempt += 1) {
            try {
                const data = await apiRequest('/api/payment/public/verify-ton-connect', {
                    method: 'POST',
                    body: {
                        invoice_id: invoiceId,
                        sender_wallet: senderWallet || null
                    }
                });
                if (data?.status === 'paid') {
                    updateState('paid');
                    return true;
                }
                if (data?.status === 'expired') {
                    updateState('failed', 'Срок счёта истёк');
                    return false;
                }
            } catch (err) {
                // 429 / 5xx — keep polling, backend may recover
            }
            await new Promise((resolve) => {
                timerRef.current = setTimeout(resolve, VERIFY_INTERVAL_MS);
            });
        }
        // Did not confirm in 60s — show pending state, Phase 0 cron will catch up.
        updateState('pending');
        return false;
    }, [updateState]);

    const pay = useCallback(async ({ invoice }) => {
        if (!invoice) return;
        if (!tonConnectUI?.connected || !wallet) {
            // Open modal so user can pick a wallet.
            tonConnectUI?.openModal?.();
            return;
        }

        const memo = invoice.memo;
        if (!memo) {
            updateState('failed', 'Счёт не поддерживает оплату через TON Connect');
            return;
        }

        const amountNano = toNano(Number(invoice.amount)).toString();
        const body = beginCell()
            .storeUint(0, 32) // text comment opcode
            .storeStringTail(memo)
            .endCell();

        updateState('sending');

        try {
            const result = await tonConnectUI.sendTransaction({
                validUntil: Math.floor(Date.now() / 1000) + 600,
                messages: [
                    {
                        address: invoice.seller_wallet,
                        amount: amountNano,
                        payload: body.toBoc().toString('base64')
                    }
                ]
            });

            if (!result) {
                updateState('failed', 'Транзакция не подписана');
                return;
            }

            updateState('verifying');
            await verify({
                invoiceId: invoice.id,
                senderWallet: wallet?.account?.address || null
            });
        } catch (err) {
            updateState('failed', err?.message || 'Не удалось отправить транзакцию');
        }
    }, [tonConnectUI, wallet, verify, updateState]);

    const reset = useCallback(() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        updateState('idle');
    }, [updateState]);

    return { state, errorMessage, connected, pay, verify, reset };
}
