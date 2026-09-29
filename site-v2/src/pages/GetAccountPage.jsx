import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, Loader2 } from 'lucide-react';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { SUPPORT_TELEGRAM } from '../contacts.js';
import { createTonConnectOrder, checkoutErrorMessage } from '../features/ton-checkout/pro-order.js';

// Точка входа в оплату Pro: гость возвращается сюда после логина и сразу получает счёт,
// без промежуточного возврата на главную
export function GetAccountPage() {
  const navigate = useNavigate();
  const { user, accessToken, loading, billingOrder, profilePlan, login } = useAuth();
  const startedRef = useRef(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (loading) return;

    if (profilePlan === 'pro' || profilePlan === 'normal') {
      window.location.assign('/userbot');
      return;
    }

    const pending = billingOrder?.status === 'pending' && billingOrder?.provider === 'ton_connect'
      ? billingOrder
      : null;
    if (pending) {
      navigate(`/pay/${pending.id}`, { replace: true });
      return;
    }

    if (!user) {
      login('/get-account');
      return;
    }

    if (startedRef.current) return;
    startedRef.current = true;
    createTonConnectOrder(accessToken)
      .then((orderId) => navigate(`/pay/${orderId}`, { replace: true }))
      .catch((e) => {
        startedRef.current = false;
        setError(checkoutErrorMessage(e));
      });
  }, [loading, user, accessToken, billingOrder, profilePlan, login, navigate]);

  return (
    <section className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      {error ? (
        <>
          <div className="flex items-start gap-1.5 text-sm font-medium text-feedback-error-text">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <a href="/get-account" className="text-sm font-bold text-action-primary underline decoration-2 underline-offset-2">
              Попробовать ещё раз
            </a>
            <a href="/" className="text-sm font-bold text-ink-muted underline decoration-2 underline-offset-2">
              На главную
            </a>
          </div>
          <a
            href={SUPPORT_TELEGRAM}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted underline hover:text-ink-strong"
          >
            Поддержка в Telegram
            <ArrowRight className="h-3 w-3" />
          </a>
        </>
      ) : (
        <>
          <Loader2 className="h-8 w-8 animate-spin text-action-primary" aria-hidden="true" />
          <p className="text-sm font-medium text-ink-muted">Готовим счёт на Pro…</p>
        </>
      )}
    </section>
  );
}
