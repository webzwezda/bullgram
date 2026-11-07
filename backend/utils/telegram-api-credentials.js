// Волна 5.3 (план 2026-11-07): хардкод-fallback api_id=4 / api_hash удалён.
// env — единственный источник Telegram API-креденшелов: сессии, созданные
// под чужой api-профиль, Telegram считает подозрительными (троттлинг/бан).
// Без TG_API_ID/TG_API_HASH процесс обязан падать на старте — молчаливый
// fallback с публичной парой хуже явного отказа.
export function requireTelegramApiCredentials(env = process.env) {
    const apiId = Number(env.TG_API_ID);
    const apiHash = String(env.TG_API_HASH || '').trim();
    if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash) {
        throw new Error(
            'TG_API_ID/TG_API_HASH must be set in backend/.env: the hardcoded api_id=4 fallback was removed (hardening wave 5.3).'
        );
    }
    return { apiId, apiHash };
}
