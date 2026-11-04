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
