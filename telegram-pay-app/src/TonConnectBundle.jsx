import { TonConnectUIProvider } from '@tonconnect/ui-react';
import { useEffect, useState } from 'react';
import { App } from './App.jsx';

export default function TonConnectBundle({ invoiceId }) {
    const [manifestUrl, setManifestUrl] = useState(null);
    const [configError, setConfigError] = useState(null);

    useEffect(() => {
        let cancelled = false;
        fetch('/api/payment/public/config')
            .then((r) => r.json())
            .then((data) => {
                if (cancelled) return;
                if (data?.manifestUrl) {
                    setManifestUrl(data.manifestUrl);
                } else {
                    setConfigError('Не удалось получить конфигурацию TON Connect.');
                }
            })
            .catch((err) => {
                if (cancelled) return;
                setConfigError(err?.message || 'Сеть недоступна');
            });
        return () => { cancelled = true; };
    }, []);

    if (configError) {
        return (
            <div className="pay-app">
                <div className="pay-error">
                    <h2 style={{ marginBottom: 8 }}>Ошибка загрузки</h2>
                    <p className="pay-hint">{configError}</p>
                </div>
            </div>
        );
    }

    if (!manifestUrl) return null;

    return (
        <TonConnectUIProvider manifestUrl={manifestUrl} actionsConfiguration={{ returnStrategy: 'back', twaReturnUrl: window.location.href }}>
            <App invoiceId={invoiceId} />
        </TonConnectUIProvider>
    );
}
