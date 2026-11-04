// Цикл авторизации по QR с перезапуском при истечении токена.
//
// Telegram отдаёт токен QR на ~30 секунд; если скан не успели, очередной
// auth.exportLoginToken отвечает RPC-ошибкой AUTH_TOKEN_EXPIRED, и
// signInUserWithQrCode GramJS падает целиком (колбека с новым токеном не
// будет). Каждый перезапуск выдаёт свежий токен через qrCode-коллбек — на
// экране обновляется QR. Лимит перезапусков страхует от бесконечного цикла;
// параллельно брошенные QR-сессии подрезает TTL-свипер (sweepStaleQrSessions).

export const QR_TOKEN_EXPIRED = 'AUTH_TOKEN_EXPIRED';

export function isQrTokenExpiredError(error) {
    const raw = String(error?.errorMessage || error?.message || error || '');
    return raw.includes(QR_TOKEN_EXPIRED);
}

export async function runQrAuthWithRotation(startCycle, {
    maxRestarts = 60,
    isRotatable = isQrTokenExpiredError
} = {}) {
    let restarts = 0;
    for (;;) {
        try {
            return await startCycle();
        } catch (error) {
            if (!isRotatable(error) || restarts >= maxRestarts) {
                throw error;
            }
            restarts += 1;
            console.warn(`[QR-AUTH] Токен QR истёк до скана, перезапуск ${restarts}/${maxRestarts}`);
        }
    }
}

// Гейт облачного пароля (2FA). После принятого скана Telegram требует
// auth.checkPassword с НОВОГО клиента (SESSION_PASSWORD_NEEDED →
// signInWithPassword); пароль приходит от владельца отдельным HTTP-запросом,
// поэтому авторизация паркуется на deferred-промисе, пока он не придет.
// Один гейт на QR-сессию: каждый запрос пароля (в т.ч. повторный после
// PASSWORD_HASH_INVALID) создает новый deferred, старый остается одноразовым.
export function createQrPasswordGate() {
    let pending = null;
    let hint = '';
    let error = null;

    return {
        // Паркует цикл авторизации: вызывается коллбеком password GramJS.
        request(nextHint = '') {
            hint = String(nextHint || '');
            let resolve;
            const promise = new Promise((res) => { resolve = res; });
            pending = { promise, resolve };
            return promise;
        },
        // POST /qr-password: отдает пароль в авторизацию. false = запроса нет
        // (повторный сабмит или сабмит вне парковки).
        submit(password) {
            if (!pending) return false;
            const { resolve } = pending;
            pending = null;
            resolve(String(password || ''));
            return true;
        },
        hasRequest() {
            return !!pending;
        },
        setError(value) {
            error = value ? String(value) : null;
        },
        getHint() {
            return hint;
        },
        getError() {
            return error;
        }
    };
}
