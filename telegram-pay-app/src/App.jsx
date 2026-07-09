import { useMemo } from 'react';
import { useInvoice } from './hooks/useInvoice.js';
import { PayCard } from './components/PayCard.jsx';

const TON_NANO = 1_000_000_000;

function formatAmount(amount) {
    const num = Number(amount || 0);
    if (!Number.isFinite(num)) return '—';
    return num.toLocaleString('ru-RU', { maximumFractionDigits: 4 });
}

export function App({ invoiceId }) {
    const { loading, invoice, error, reload } = useInvoice(invoiceId);

    const durationText = useMemo(() => {
        const d = Number(invoice?.duration_days || 0);
        return d > 0 ? `${d} дн.` : 'Навсегда';
    }, [invoice?.duration_days]);

    if (loading && !invoice) {
        return (
            <div className="pay-app">
                <div className="pay-card" style={{ minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="pay-hint">Грузим счёт…</div>
                </div>
            </div>
        );
    }

    if (error && !invoice) {
        return (
            <div className="pay-app">
                <ErrorState title="Счёт не найден" text="Откройте бота и попробуйте снова." />
            </div>
        );
    }

    if (!invoice) return null;

    if (invoice.status === 'paid') {
        return (
            <div className="pay-app">
                <PaidState
                    tariffTitle={invoice.tariff_title}
                    inviteLink={invoice.invite_link}
                    channelTitle={invoice.invite_channel_title}
                />
            </div>
        );
    }

    if (invoice.status === 'expired' || (invoice.expires_at && new Date(invoice.expires_at) < new Date())) {
        return (
            <div className="pay-app">
                <ErrorState title="Срок счёта истёк" text="Создайте новый счёт в боте." />
            </div>
        );
    }

    if (String(invoice.currency || '').toUpperCase() !== 'TON') {
        return (
            <div className="pay-app">
                <ErrorState title="Этот счёт нельзя оплатить через TON Connect" text="Используйте кнопку в боте для другого способа оплаты." />
            </div>
        );
    }

    if (!invoice.seller_wallet) {
        return (
            <div className="pay-app">
                <ErrorState title="Продавец не указал TON-кошелёк" text="Сообщите продавцу, чтобы он указал кошелёк в личном кабинете." />
            </div>
        );
    }

    if (invoice.status !== 'pending') {
        return (
            <div className="pay-app">
                <ErrorState title={`Статус счёта: ${invoice.status}`} text="Свяжитесь с продавцом." />
            </div>
        );
    }

    return (
        <div className="pay-app">
            <PayCard
                invoice={invoice}
                amountLabel={`${formatAmount(invoice.amount)} TON`}
                tariffTitle={invoice.tariff_title}
                durationText={durationText}
                onRefreshInvoice={reload}
            />
        </div>
    );
}

function ErrorState({ title, text }) {
    return (
        <div className="pay-card pay-error">
            <h2 style={{ margin: '0 0 8px 0', fontSize: 18 }}>{title}</h2>
            {text ? <p className="pay-hint" style={{ margin: 0 }}>{text}</p> : null}
        </div>
    );
}

function PaidState({ tariffTitle, inviteLink, channelTitle }) {
    return (
        <div className="pay-card" style={{ textAlign: 'center', paddingTop: 32, paddingBottom: 32 }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <h2 style={{ margin: '0 0 8px 0', fontSize: 20 }}>Подписка активирована</h2>
            <p className="pay-hint" style={{ marginTop: 0 }}>
                Тариф «{tariffTitle || '—'}» оплачен и выдан вам в Telegram.
            </p>
            {inviteLink ? (
                <a
                    className="pay-button"
                    style={{ marginTop: 20, textDecoration: 'none', display: 'inline-block' }}
                    href={inviteLink}
                >
                    Открыть {channelTitle ? `«${channelTitle}»` : 'канал'}
                </a>
            ) : (
                <p className="pay-hint" style={{ marginTop: 20 }}>Ссылка на канал появится в боте. Закройте окно и нажмите /start.</p>
            )}
        </div>
    );
}
