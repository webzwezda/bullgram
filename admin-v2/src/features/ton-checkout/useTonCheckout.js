import { useCallback, useState } from 'react';
import { useTonConnectUI, CHAIN } from '@tonconnect/ui-react';
import { buildTonPayload } from '../../lib/build-ton-payload.js';
import { apiRequest } from '../../api/client.js';

const VERIFY_POLL_DELAY_MS = 5000;
const VERIFY_POLL_MAX_RETRIES = 4;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useTonCheckout({ verifyEndpoint, buildVerifyBody, accessToken, onComplete, onError }) {
  const [tonConnectUI] = useTonConnectUI();
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);

  const paying = status === 'sending';
  const verifying = status === 'verifying';

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
  }, []);

  const pay = useCallback(
    async ({ amountNano, merchantWallet, memo }) => {
      if (!tonConnectUI) {
        setError('TON Connect не инициализирован');
        return;
      }
      if (!amountNano || !merchantWallet || !memo) {
        setError('Не переданы параметры платежа');
        return;
      }

      const payloadBase64 = buildTonPayload(memo);
      const validUntil = Math.floor(Date.now() / 1000) + 300;

      setStatus('sending');
      setError(null);

      try {
        await tonConnectUI.sendTransaction({
          validUntil,
          network: CHAIN.MAINNET,
          messages: [
            {
              address: merchantWallet,
              amount: String(amountNano),
              payload: payloadBase64
            }
          ]
        });
      } catch (sendError) {
        setStatus('failed');
        const message = sendError?.message || 'Транзакция отклонена';
        setError(message);
        onError?.(new Error(message));
        return;
      }

      setStatus('verifying');

      const senderWallet = tonConnectUI.account?.address || '';
      const body = buildVerifyBody({ boc: null, senderWallet });

      for (let attempt = 1; attempt <= VERIFY_POLL_MAX_RETRIES; attempt += 1) {
        try {
          const data = await apiRequest(verifyEndpoint, {
            accessToken,
            method: 'POST',
            body
          });

          if (data?.status === 'paid' || (data?.success === true && data?.status === 'paid')) {
            setStatus('paid');
            onComplete?.(data);
            return;
          }
          if (data?.status === 'pending' || data?.retry) {
            if (attempt < VERIFY_POLL_MAX_RETRIES) {
              await sleep(VERIFY_POLL_DELAY_MS);
              continue;
            }
          }
        } catch (verifyError) {
          if (attempt >= VERIFY_POLL_MAX_RETRIES) {
            setStatus('failed');
            const message = verifyError?.message || 'Не удалось верифицировать платеж';
            setError(message);
            onError?.(new Error(message));
            return;
          }
        }
      }

      setStatus('pending');
      setError('Платёж отправлен, но ещё не подтверждён блокчейном. Попробуйте проверить позже или обновите страницу.');
    },
    [tonConnectUI, verifyEndpoint, buildVerifyBody, accessToken, onComplete, onError]
  );

  return { pay, paying, verifying, status, error, reset };
}
