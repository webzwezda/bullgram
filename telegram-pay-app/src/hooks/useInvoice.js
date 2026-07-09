import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../api/client.js';

export function useInvoice(invoiceId) {
    const [state, setState] = useState({ loading: true, invoice: null, error: null });

    const load = useCallback(async () => {
        if (!invoiceId) {
            setState({ loading: false, invoice: null, error: 'id required' });
            return;
        }
        try {
            const data = await apiRequest(`/api/payment/public/invoice/${encodeURIComponent(invoiceId)}`);
            setState({ loading: false, invoice: data, error: null });
        } catch (err) {
            setState((prev) => ({
                loading: false,
                invoice: prev.invoice,
                error: err.status === 404 ? 'Счёт не найден' : (err.message || 'Ошибка загрузки')
            }));
        }
    }, [invoiceId]);

    useEffect(() => {
        load();
    }, [load]);

    return { ...state, reload: load };
}
