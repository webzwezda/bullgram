// Админ-контекст бота (мульти-админка) и определение роли пользователя — вынесено
// дословно из official-bot.service.js; this.supabase -> параметр supabase.

export async function getBotAdminContext(supabase, botId, ownerIdFallback = null) {
    try {
        const { data: botAccount, error: botError } = await supabase
            .from('tg_accounts')
            .select('owner_id, admin_tg_id, admin_tg_ids')
            .eq('id', botId)
            .maybeSingle();

        if (botError) throw botError;

        const ownerId = botAccount?.owner_id || ownerIdFallback || null;
        // admin_tg_ids — канонический список всех админов бота (мульти-админка).
        // admin_tg_id (scalar) — для backward-compat с notifications-кодом.
        const botAdminIds = Array.isArray(botAccount?.admin_tg_ids)
            ? botAccount.admin_tg_ids.map((n) => String(n)).filter(Boolean)
            : [];

        if (!ownerId) {
            const botAdminTgId = botAccount?.admin_tg_id ? String(botAccount.admin_tg_id) : '';
            return {
                ownerId: null,
                botAdminTgId,
                botAdminIds,
                fallbackAdminTgId: '',
                adminTgId: botAdminTgId,
                adminLabel: botAdminTgId ? `TG ID ${botAdminTgId}` : 'Админ проекта',
                referralEnabled: false
            };
        }

        const [settingsResp, profileResp] = await Promise.all([
            supabase
                .from('payment_settings')
                .select('admin_tg_id, referral_enabled')
                .eq('owner_id', ownerId)
                .maybeSingle(),
            supabase
                .from('profiles')
                .select('full_name, email')
                .eq('id', ownerId)
                .maybeSingle()
        ]);

        const botAdminTgId = botAccount?.admin_tg_id ? String(botAccount.admin_tg_id) : '';
        const fallbackAdminTgId = settingsResp.data?.admin_tg_id ? String(settingsResp.data.admin_tg_id) : '';
        const adminTgId = botAdminTgId || fallbackAdminTgId;
        const profile = profileResp.data || null;
        const adminLabel = adminTgId
            ? `TG ID ${adminTgId}`
            : profile?.full_name || profile?.email || 'Админ проекта';

        return {
            ownerId,
            botAdminTgId,
            botAdminIds,
            fallbackAdminTgId,
            adminTgId,
            adminLabel,
            referralEnabled: !!settingsResp.data?.referral_enabled
        };
    } catch (error) {
        console.error('Ошибка загрузки bot admin context для official bot:', error);
        return {
            ownerId: ownerIdFallback || null,
            botAdminTgId: '',
            botAdminIds: [],
            fallbackAdminTgId: '',
            adminTgId: '',
            adminLabel: 'Админ проекта',
            referralEnabled: false
        };
    }
}

export function buildAdminOwnershipHint(context, role = 'sales') {
    if (!context) return '';

    const roleText = role === 'ops'
        ? 'Этот бот относится к админскому контуру юзерботов.'
        : 'Этот бот обслуживает оплату и доступ по подпискам.';

    if (context.adminTgId) {
        return `${roleText}\nТвой админ: ${context.adminLabel}`;
    }

    return `${roleText}\nТвой админ: ${context.adminLabel}`;
}

export async function getUserRole(supabase, ctx, botId) {
    try {
        const tgUserId = String(ctx.from?.id || '');
        if (!tgUserId) return 'user';

        const adminContext = await getBotAdminContext(supabase, botId);
        if (!adminContext) return 'user';

        const botAdminId = adminContext.botAdminTgId ? String(adminContext.botAdminTgId) : '';
        const fallbackAdminId = adminContext.fallbackAdminTgId ? String(adminContext.fallbackAdminTgId) : '';

        // Мульти-админка: если TG ID есть в admin_tg_ids — это админ.
        const isMultiAdmin = Array.isArray(adminContext.botAdminIds)
            && adminContext.botAdminIds.map((id) => String(id)).includes(tgUserId);

        if (isMultiAdmin || tgUserId === botAdminId || tgUserId === fallbackAdminId) {
            return 'admin';
        }

        return 'user';
    } catch (error) {
        console.error('Ошибка определения роли пользователя:', error);
        return 'user';
    }
}
