import { useCallback, useState } from 'react';
import { useTonConnectUI, CHAIN } from '@tonconnect/ui-react';
import { buildTonPayload } from '../../lib/build-ton-payload.js';
import { apiRequest } from '../../api/client.js';

const VERIFY_POLL_DELAY_MS = 5000;
const VERIFY_POLL_MAX_RETRIES = 13;
const PENDING_MESSAGE = 'Платёж отправлен, но ещё не подтверждён блокчейном. Попробуйте проверить позже или обновите страницу.';

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

  const runVerifyLoop = useCallback(
    async ({ senderWallet, onStillPending }) => {
      const body = buildVerifyBody ? buildVerifyBody({ boc: null, senderWallet }) : { sender_wallet: senderWallet };

      for (let attempt = 1; attempt <= VERIFY_POLL_MAX_RETRIES; attempt += 1) {
        let data;
        try {
          data = await apiRequest(verifyEndpoint, {
            accessToken,
            method: 'POST',
            body
          });
        } catch (verifyError) {
          if (attempt >= VERIFY_POLL_MAX_RETRIES) {
            throw verifyError;
          }
          await sleep(VERIFY_POLL_DELAY_MS);
          continue;
        }

        if (data?.status === 'paid') {
          setStatus('paid');
          onComplete?.(data);
          return;
        }
        if (data?.status === 'expired') {
          throw new Error('Счёт истёк');
        }
        if (data?.status === 'pending' || data?.retry) {
          if (attempt < VERIFY_POLL_MAX_RETRIES) {
            await sleep(VERIFY_POLL_DELAY_MS);
            continue;
          }
        }
      }

      onStillPending?.();
    },
    [verifyEndpoint, buildVerifyBody, accessToken, onComplete]
  );

  const pay = useCallback(
    async ({ amountNano, merchantWallet, memo, network = 'mainnet' }) => {
      if (!tonConnectUI) {
        setError('TON Connect не инициализирован');
        return;
      }
      if (!amountNano || !merchantWallet || !memo) {
        setError('Не переданы параметры платежа');
        return;
      }

      const chain = network === 'testnet' ? CHAIN.TESTNET : CHAIN.MAINNET;
      const payloadBase64 = buildTonPayload(memo);
      const validUntil = Math.floor(Date.now() / 1000) + 300;

      setStatus('sending');
      setError(null);

      try {
        await tonConnectUI.sendTransaction({
          validUntil,
          network: chain,
          messages: [
            {
              address: merchantWallet,
              amount: String(amountNano),
              payload: payloadBase64
            }
          ]
        });
      } catch (sendError) {
        setStatus('idle');
        const message = sendError?.message || 'Транзакция отклонена';
        setError(message);
        onError?.(new Error(message));
        return;
      }

      setStatus('verifying');

      const senderWallet = tonConnectUI.account?.address || '';
      try {
        await runVerifyLoop({
          senderWallet,
          onStillPending: () => {
            setStatus('pending');
            setError(PENDING_MESSAGE);
          }
        });
      } catch (verifyError) {
        setStatus('failed');
        const message = verifyError?.message || 'Не удалось верифицировать платёж';
        setError(message);
        onError?.(new Error(message));
      }
    },
    [tonConnectUI, runVerifyLoop, onError]
  );

  const verifyCurrent = useCallback(
    async () => {
      if (!tonConnectUI) return;
      const senderWallet = tonConnectUI.account?.address || '';
      if (!senderWallet) {
        setError('Кошелёк не подключён. Подключи кошелёк и попробуй ещё раз.');
        return;
      }

      setStatus('verifying');
      setError(null);
      try {
        await runVerifyLoop({
          senderWallet,
          onStillPending: () => {
            setStatus('pending');
            setError(PENDING_MESSAGE);
          }
        });
      } catch (verifyError) {
        setStatus('failed');
        setError(verifyError?.message || 'Не удалось верифицировать платёж');
      }
    },
    [tonConnectUI, runVerifyLoop]
  );

  return { pay, paying, verifying, status, error, reset, verifyCurrent };
}
