const DEFAULT_TIMEOUT_MS = 10_000;

export async function apiRequest(path, { method = 'GET', body, accessToken, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const headers = { 'Content-Type': 'application/json' };
        if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
        const response = await fetch(path, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal
        });
        const text = await response.text();
        const data = text ? JSON.parse(text) : null;
        if (!response.ok) {
            const message = data?.error || `HTTP ${response.status}`;
            const err = new Error(message);
            err.status = response.status;
            err.data = data;
            throw err;
        }
        return data;
    } finally {
        clearTimeout(timer);
    }
}

export function buildTonTransferUri({ to, amountNano, memo }) {
    return `ton://transfer/${to}?amount=${amountNano}&text=${encodeURIComponent(memo)}`;
}
