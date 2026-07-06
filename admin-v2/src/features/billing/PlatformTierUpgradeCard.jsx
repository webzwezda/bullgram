import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Sparkles, RefreshCw } from 'lucide-react';
import { useAuth } from '../../app/providers/AuthProvider.jsx';
import { apiRequest } from '../../api/client.js';
import { TonConnectPayButton } from '../ton-checkout/TonConnectPayButton.jsx';
import { TonWalletChip } from '../ton-checkout/TonWalletChip.jsx';

const VERIFY_ENDPOINT = '/api/billing/checkout/ton-connect/verify';

function formatEndsAt(value) {
  if (!value) return null;
  try {
    return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' }).format(new Date(value));
  } catch {
    return value;
  }
}

export function PlatformTierUpgradeCard() {
  const { user, accessToken, profilePlan, refreshProfile, normalEndsAt } = useAuth();
  const [order, setOrder] = useState(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const isNormal = String(profilePlan || '').toLowerCase() === 'normal';
  const isPro = String(profilePlan || '').toLowerCase() === 'pro';

  const createOrder = useCallback(async () => {
    setCreating(true);
    setError('');
    try {
      const data = await apiRequest('/api/billing/checkout/ton-connect', {
        accessToken,
        method: 'POST',
        body: {}
      });
      setOrder(data);
    } catch (err) {
      setError(err?.message || 'Не удалось создать счёт');
    } finally {
      setCreating(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (!order && !isNormal && !isPro && !creating && user?.id) {
      createOrder();
    }
  }, [order, isNormal, isPro, creating, user?.id, createOrder]);

  const handlePaid = useCallback(
    async (data) => {
      if (refreshProfile) {
        try {
          await refreshProfile();
        } catch {}
      }
      if (data?.profile?.normal_ends_at) {
        // optional: surface to UI via state if needed
      }
    },
    [refreshProfile]
  );

  return (
    <div className="bg-white border border-slate-200/60 rounded-3xl p-6 md:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-sky-500/20 shrink-0">
          <Sparkles className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-bold text-slate-900">Подписка Bullgram</h3>
          <p className="text-sm text-slate-500 mt-0.5">
            Оплата тарифа Normal через TON Connect — без комиссии, мгновенно.
          </p>
        </div>
        <TonWalletChip />
      </div>

      {isPro ? (
        <div className="rounded-2xl bg-slate-50 border border-slate-200 p-6 text-center">
          <CheckCircle2 className="w-8 h-8 mx-auto text-slate-500 mb-2" />
          <p className="text-base font-bold text-slate-700">У вас активен тариф Pro</p>
          <p className="text-sm text-slate-500 mt-1">Это максимальный тариф, обновление недоступно.</p>
        </div>
      ) : isNormal ? (
        <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-6 text-center">
          <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-600 mb-2" />
          <p className="text-base font-bold text-emerald-700">Normal активен</p>
          {normalEndsAt ? (
            <p className="text-sm text-emerald-700/80 mt-1">Действует до {formatEndsAt(normalEndsAt)}</p>
          ) : null}
        </div>
      ) : (
        <>
          <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-5 space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-bold text-slate-700">Тариф</span>
              <span className="text-base font-black text-slate-900">Trial → Normal</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-bold text-slate-700">Длительность</span>
              <span className="text-base font-bold text-slate-900">365 дней</span>
            </div>
            <div className="flex items-baseline justify-between gap-3 pt-2 border-t border-slate-200">
              <span className="text-sm font-bold text-slate-700">К оплате</span>
              <div className="text-right">
                <div className="text-xl font-black text-slate-900">
                  {order?.amount_ton ? `${order.amount_ton} TON` : '—'}
                </div>
                {order?.ton_priced ? null : (
                  <div className="text-xs text-slate-500">≈ {order?.amount_rub || 900} ₽</div>
                )}
              </div>
            </div>
          </div>

          {order ? (
            <div className="pt-2">
              <TonConnectPayButton
                amountTon={order.amount_ton}
                amountNano={order.amount_nanoton}
                merchantWallet={order.merchant_wallet}
                memo={order.memo}
                network={order.network}
                verifyEndpoint={VERIFY_ENDPOINT}
                buildVerifyBody={({ senderWallet }) => ({ order_id: order.order_id, sender_wallet: senderWallet })}
                accessToken={accessToken}
                onPaid={handlePaid}
                onError={(err) => setError(err?.message || 'Ошибка оплаты')}
              />
              <p className="text-[11px] text-slate-400 mt-2">
                Memo: <code className="font-mono">{order.memo}</code> · истекает {formatEndsAt(order.expires_at)}
              </p>
            </div>
          ) : creating ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <RefreshCw className="w-4 h-4 animate-spin" />
              Готовим счёт…
            </div>
          ) : (
            <button
              type="button"
              onClick={createOrder}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white font-bold text-sm hover:bg-slate-800 transition-all"
            >
              Создать счёт
            </button>
          )}

          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        </>
      )}
    </div>
  );
}
