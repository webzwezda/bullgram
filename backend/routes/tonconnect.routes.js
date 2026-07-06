import express from 'express';

export default function tonconnectRoutes() {
    const router = express.Router();

    router.get('/tonconnect-manifest.json', (_req, res) => {
        const siteUrl = String(process.env.PUBLIC_SITE_URL || '').replace(/\/$/, '');
        if (!siteUrl) {
            return res.status(500).json({ error: 'PUBLIC_SITE_URL is not configured' });
        }
        const iconUrl = String(process.env.TONCONNECT_MANIFEST_ICON_URL || `${siteUrl}/icon-256.png`);
        res.json({
            url: siteUrl,
            name: 'Bullgram',
            iconUrl,
            termsOfUseUrl: `${siteUrl}/terms`,
            privacyPolicyUrl: `${siteUrl}/privacy`
        });
    });

    return router;
}
