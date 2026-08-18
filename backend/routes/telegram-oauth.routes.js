import { Router } from 'express';

const TELEGRAM_DISCOVERY_URL = 'https://oauth.telegram.org/.well-known/openid-configuration';
const TELEGRAM_JWKS_URL = 'https://oauth.telegram.org/.well-known/jwks.json';
const PUBLIC_BASE_URL = 'https://bullgram.xyz';
const CACHE_TTL_MS = 60 * 60 * 1000;

// go-jose внутри gotrue не умеет кривую secp256k1 и из-за одного такого ключа
// отбраковывает весь JWKS-набор Telegram — верификация ID-токена падает.
// Поэтому gotrue ходит за discovery/JWKS к нам, а мы отдаём набор без этого ключа.
function isUnsupportedKey(key) {
    return key?.kty === 'EC' && key?.crv === 'secp256k1';
}

export default function telegramOauthRoutes() {
    const router = Router();
    const cache = { discovery: null, jwks: null };

    async function fetchJson(url) {
        const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!resp.ok) throw new Error(`upstream ${resp.status}`);
        return resp.json();
    }

    async function getCached(kind, url, transform) {
        const entry = cache[kind];
        if (entry && Date.now() - entry.fetchedAt < CACHE_TTL_MS) return entry.data;
        try {
            const data = transform(await fetchJson(url));
            cache[kind] = { data, fetchedAt: Date.now() };
            return data;
        } catch (err) {
            if (entry) return entry.data;
            throw err;
        }
    }

    router.get('/discovery', async (_req, res) => {
        try {
            const data = await getCached('discovery', TELEGRAM_DISCOVERY_URL, (doc) => ({
                ...doc,
                jwks_uri: `${PUBLIC_BASE_URL}/api/public/telegram-oidc/jwks`
            }));
            res.set('Cache-Control', 'public, max-age=600');
            res.json(data);
        } catch (err) {
            res.status(502).json({ error: err?.message || 'discovery fetch failed' });
        }
    });

    router.get('/jwks', async (_req, res) => {
        try {
            const data = await getCached('jwks', TELEGRAM_JWKS_URL, (doc) => ({
                ...doc,
                keys: (doc.keys || []).filter((key) => !isUnsupportedKey(key))
            }));
            res.set('Cache-Control', 'public, max-age=600');
            res.json(data);
        } catch (err) {
            res.status(502).json({ error: err?.message || 'jwks fetch failed' });
        }
    });

    return router;
}
