import React, { Suspense, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { PayAppSkeleton } from './PayAppSkeleton.jsx';

// Lazy-load TonConnectUIProvider + App so the ~250KB TON Connect SDK stays out
// of the initial bundle. Telegram Mobile WebApp first paint stays fast even on
// slow connections. Provider mounts on first user interaction (tap anywhere).
const TonConnectBundle = React.lazy(() => import('./TonConnectBundle.jsx'));

function useInvoiceIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('invoice');
    if (fromQuery) return fromQuery;
    // tgWebAppStartParam is what Telegram injects when bot launches WebApp with a start param.
    const startParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
    if (startParam) return startParam;
    const tgWebAppStartParam = params.get('tgWebAppStartParam');
    if (tgWebAppStartParam) return tgWebAppStartParam;
    return null;
}

function Root() {
    const [activated, setActivated] = useState(false);
    const invoiceId = useInvoiceIdFromUrl();

    React.useEffect(() => {
        const tg = window.Telegram?.WebApp;
        if (!tg) return;
        try { tg.ready(); } catch {}
        try { tg.expand(); } catch {}
        try {
            const bg = getComputedStyle(document.documentElement).getPropertyValue('--tg-bg').trim();
            if (bg) tg.setHeaderColor?.(bg);
        } catch {}
    }, []);

    // Mount the heavy TON Connect bundle on first interaction. Without this,
    // opening the WebApp downloads the SDK on every cold load even for users
    // who just want to glance at the invoice.
    const activate = React.useCallback(() => {
        if (activated) return;
        setActivated(true);
    }, [activated]);

    React.useEffect(() => {
        if (activated) return;
        const opts = { once: true, passive: true };
        window.addEventListener('pointerdown', activate, opts);
        window.addEventListener('touchstart', activate, opts);
        return () => {
            window.removeEventListener('pointerdown', activate, opts);
            window.removeEventListener('touchstart', activate, opts);
        };
    }, [activated, activate]);

    if (!invoiceId) {
        return (
            <div className="pay-app">
                <div className="pay-error">
                    <h2 style={{ marginBottom: 8 }}>Счёт не найден</h2>
                    <p className="pay-hint">Откройте бота и попробуйте снова.</p>
                </div>
            </div>
        );
    }

    if (!activated) {
        return <PayAppSkeleton invoiceId={invoiceId} onActivate={activate} />;
    }

    return (
        <Suspense fallback={<PayAppSkeleton invoiceId={invoiceId} />}>
            <TonConnectBundle invoiceId={invoiceId} />
        </Suspense>
    );
}

createRoot(document.getElementById('root')).render(<Root />);
