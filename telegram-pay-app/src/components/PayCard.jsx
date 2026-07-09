import { useState } from 'react';
import { useTonConnectUI } from '@tonconnect/ui-react';
import { usePayCheckout } from '../hooks/usePayCheckout.js';
import { buildTonTransferUri } from '../api/client.js';
import { ManualTransferPanel } from './ManualTransferPanel.jsx';

function toNanoLocal(amount) {
    return Math.round(Number(amount || 0) * 1_000_000_000);
}

export function PayCard({ invoice, amountLabel, tariffTitle, durationText, onRefreshInvoice }) {
    const [tonConnectUI] = useTonConnectUI();
    const [manualOpen, setManualOpen] = useState(false);
    const [manualVerifyState, setManualVerifyState] = useState(null);

    const { state, errorMessage, connected, pay, verify, reset } = usePayCheckout({
        onStateChange: (next) => {
            if (next === 'paid') {
                // give backend a tick then refresh invoice so we can show invite_link
                setTimeout(() => onRefreshInvoice?.(), 800);
            }
        }
    });

    const onPrimary = () => {
        if (!connected) {
            tonConnectUI?.openModal?.();
            return;
        }
        pay({ invoice });
    };

    const onManualVerify = async () => {
        setManualVerifyState('verifying');
        const ok = await verify({ invoiceId: invoice.id, senderWallet: null });
        if (!ok) {
            setManualVerifyState('not_found');
        }
    };

    const isBusy = state === 'sending' || state === 'verifying';

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="pay-card">
                <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{tariffTitle || 'Тариф'}</h1>
                <p className="pay-hint" style={{ marginTop: 4, marginBottom: 20 }}>
                    Доступ: {durationText}
                </p>

                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 36, fontWeight: 800 }}>{amountLabel}</span>
                </div>

                <div style={{ marginTop: 24 }}>
                    <PrimaryButton
                        state={state}
                        connected={connected}
                        isBusy={isBusy}
                        errorMessage={errorMessage}
                        onClick={onPrimary}
                    />
                </div>

                {state === 'pending' ? (
                    <p className="pay-hint" style={{ marginTop: 12, marginBottom: 0 }}>
                        Платёж отправлен. Активируем автоматически в течение минуты — окно можно закрыть.
                    </p>
                ) : null}

                {state === 'paid' ? (
                    <p className="pay-hint" style={{ marginTop: 12, marginBottom: 0 }}>
                        Готово. Подождите, пока мы обновим страницу…
                    </p>
                ) : null}

                <div style={{ marginTop: 16 }}>
                    <button
                        type="button"
                        className="pay-button pay-button--ghost"
                        onClick={() => setManualOpen((v) => !v)}
                    >
                        {manualOpen ? 'Скрыть ручной перевод' : 'Нет TON Connect? Перевести вручную'}
                    </button>
                </div>
            </div>

            {manualOpen ? (
                <ManualTransferPanel
                    invoice={invoice}
                    amountLabel={amountLabel}
                    transferUri={buildTonTransferUri({
                        to: invoice.seller_wallet,
                        amountNano: toNanoLocal(invoice.amount),
                        memo: invoice.memo
                    })}
                    onVerify={onManualVerify}
                    verifyState={manualVerifyState}
                />
            ) : null}

            {state === 'failed' && errorMessage ? (
                <div className="pay-card" style={{ textAlign: 'center' }}>
                    <p style={{ margin: 0, color: 'var(--tg-danger)', fontWeight: 600 }}>{errorMessage}</p>
                    <button
                        type="button"
                        className="pay-button pay-button--ghost"
                        style={{ marginTop: 12 }}
                        onClick={reset}
                    >
                        Попробовать снова
                    </button>
                </div>
            ) : null}
        </div>
    );
}

function PrimaryButton({ state, connected, isBusy, errorMessage, onClick }) {
    let label = connected ? 'Оплатить' : 'Подключить кошелёк';
    if (state === 'sending') label = 'Подтверждаете в кошельке…';
    if (state === 'verifying') label = 'Проверяем оплату…';
    if (state === 'paid') label = '✓ Оплачено';
    if (state === 'pending') label = 'Платёж отправлен';
    if (state === 'failed') label = 'Отменено';

    return (
        <button
            type="button"
            className="pay-button"
            disabled={isBusy || state === 'paid' || state === 'pending'}
            onClick={onClick}
        >
            {isBusy ? <span className="pay-spinner" style={{ marginRight: 8 }} /> : null}
            {label}
        </button>
    );
}
