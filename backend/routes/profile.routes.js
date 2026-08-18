import { Router } from 'express';
import { authenticateUser } from '../middlewares/auth.middleware.js';

export default function profileRoutes(supabase) {
    const router = Router();

    router.get('/telegram/status', authenticateUser, async (req, res) => {
        const [adminResp, profileResp, settingsResp] = await Promise.all([
            supabase.auth.admin.getUserById(req.user.id),
            supabase
                .from('profiles')
                .select('telegram_user_id, telegram_username')
                .eq('id', req.user.id)
                .maybeSingle(),
            supabase
                .from('payment_settings')
                .select('admin_tg_id')
                .eq('owner_id', req.user.id)
                .maybeSingle()
        ]);
        if (adminResp.error) return res.status(500).json({ error: adminResp.error.message });
        if (profileResp.error) return res.status(500).json({ error: profileResp.error.message });

        // TG-логин = custom:telegram identity в gotrue. «Залогинен» — только она:
        // ручной admin_tg_id и admin-права автопост-ботов — настройки, не логин.
        const identities = adminResp.data?.user?.identities || [];
        const tgIdentity = identities.find((identity) => identity.provider === 'custom:telegram') || null;
        // gotrue >=2.195: provider_id убран из сериализации, uid провайдера теперь в `id`.
        // ВАЖНО: это oauth-субъект Telegram (sub), НЕ классический аккаунтный TG ID,
        // который видят боты — в admin_tg_id (уведомления) его писать нельзя.
        const telegramUserId = tgIdentity ? String(tgIdentity.provider_id ?? tgIdentity.id) : null;
        const telegramUsername = tgIdentity?.identity_data?.preferred_username
            || tgIdentity?.identity_data?.name
            || null;

        // Ленивый синк логин-identity в profiles. payment_settings.admin_tg_id
        // не трогаем никогда: ботам нужен классический TG ID, его знает только юзер.
        if (telegramUserId && String(profileResp.data?.telegram_user_id || '') !== telegramUserId) {
            await supabase
                .from('profiles')
                .update({ telegram_user_id: telegramUserId, telegram_username: telegramUsername })
                .eq('id', req.user.id);
        }

        const manualTgId = settingsResp.data?.admin_tg_id
            ? String(settingsResp.data.admin_tg_id).trim() || null
            : null;

        return res.json({
            linked: Boolean(telegramUserId),
            telegram_user_id: telegramUserId,
            telegram_username: telegramUsername,
            source: telegramUserId ? 'verified' : null,
            manual_tg_id: manualTgId,
            can_unlink: identities.length > 1
        });
    });

    router.delete('/telegram', authenticateUser, async (req, res) => {
        // Отвязка = logout из TG: чистим только verified-привязку.
        // Ручной admin_tg_id (куда слать уведомления) и admin-права
        // автопост-ботов не трогаем — это не «логин». Саму oidc-identity
        // в gotrue отвязывает фронт через supabase.auth.unlinkIdentity
        // до этого вызова (нельзя удалить единственный способ входа).
        const { error } = await supabase
            .from('profiles')
            .update({ telegram_user_id: null, telegram_username: null })
            .eq('id', req.user.id);
        if (error) return res.status(500).json({ error: error.message });
        return res.json({ success: true });
    });

    return router;
}
