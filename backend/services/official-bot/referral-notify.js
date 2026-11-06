// Уведомления партнерки (notify* для админа-владельца и партнеров) — вынесены дословно
// из official-bot.service.js; this.supabase -> параметр supabase, module-level activeBots
// главного файла передается параметром, чтобы Map осталась одной и той же.

import { getReferralEconomics } from '../referral-reserve.service.js';

export async function getOwnerAdminContext(supabase, ownerId) {
    try {
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

        const adminTgId = settingsResp.data?.admin_tg_id ? String(settingsResp.data.admin_tg_id) : '';
        const profile = profileResp.data || null;
        const adminLabel = profile?.full_name || profile?.email || (adminTgId ? `TG ID ${adminTgId}` : 'Админ проекта');

        return {
            adminTgId,
            adminLabel,
            referralEnabled: !!settingsResp.data?.referral_enabled
        };
    } catch (error) {
        console.error('Ошибка загрузки admin context для official bot:', error);
        return {
            adminTgId: '',
            adminLabel: 'Админ проекта',
            referralEnabled: false
        };
    }
}

export async function getOwnerNotificationBot(activeBots, supabase, ownerId) {
    if (!ownerId) return null;

    const { data: accounts, error } = await supabase
        .from('tg_accounts')
        .select('id, bot_role, tg_username')
        .eq('owner_id', ownerId)
        .eq('account_type', 'bot')
        .order('created_at', { ascending: true });

    if (error) {
        console.error('Ошибка загрузки бота для уведомлений:', error.message);
        return null;
    }

    const candidates = [
        ...(accounts || []).filter(account => (account.bot_role || 'sales') === 'sales'),
        ...(accounts || [])
    ];

    for (const account of candidates) {
        const bot = activeBots.get(account.id);
        if (bot?.telegram) {
            return { bot, account };
        }
    }

    return null;
}

export async function notifyOwnerAdmin(activeBots, supabase, ownerId, text, options = {}) {
    try {
        const adminContext = await getOwnerAdminContext(supabase, ownerId);
        const adminTgId = String(adminContext?.adminTgId || '').trim();
        if (!adminTgId) {
            return { sent: false, reason: 'admin_tg_id_missing' };
        }

        const notificationBot = await getOwnerNotificationBot(activeBots, supabase, ownerId);
        if (!notificationBot?.bot?.telegram) {
            return { sent: false, reason: 'active_bot_missing' };
        }

        await notificationBot.bot.telegram.sendMessage(adminTgId, text, options);
        return { sent: true, bot_id: notificationBot.account?.id || null };
    } catch (error) {
        console.error('Ошибка отправки admin notification:', error.message || error);
        return { sent: false, reason: 'send_failed' };
    }
}

export async function notifyReferralPayoutRequested(activeBots, supabase, ownerId, payout) {
    const amountTon = Number(payout?.amount_ton || 0);
    const text = [
        '💸 Новая заявка на выплату по партнерке.',
        '',
        `Партнер: ${payout?.tg_user_id}`,
        `Сумма: ${amountTon} TON`,
        `Кошелек: ${payout?.ton_wallet || 'не указан'}`,
        '',
        'Открой /app/referrals и проверь очередь выплат.'
    ].join('\n');

    return notifyOwnerAdmin(activeBots, supabase, ownerId, text, { disable_web_page_preview: true });
}

export async function notifyReferralLeadCreated(activeBots, supabase, ownerId, attribution) {
    const notificationBot = await getOwnerNotificationBot(activeBots, supabase, ownerId);
    if (!notificationBot?.bot?.telegram) {
        return { sent: false, reason: 'active_bot_missing' };
    }

    const referrerTgUserId = String(attribution?.referrer_tg_user_id || '').trim();
    if (!referrerTgUserId) return { sent: false, reason: 'referrer_missing' };

    const discountPercent = Number(attribution?.client_discount_percent_snapshot || 0);
    const eligible = attribution?.discount_eligible !== false;
    const expiresAt = attribution?.expires_at
        ? new Date(attribution.expires_at).toLocaleDateString('ru-RU')
        : '';
    const referredLabel = attribution?.referred_username
        ? `@${attribution.referred_username}`
        : `TG ${attribution?.referred_tg_user_id || 'неизвестен'}`;

    const text = eligible
        ? [
            '🤝 Новый лид по твоей партнерской ссылке.',
            '',
            `Клиент: ${referredLabel}`,
            discountPercent > 0 ? `Скидка клиента: ${discountPercent}%` : '',
            expiresAt ? `Окно закрепления: до ${expiresAt}` : '',
            '',
            'Если клиент оплатит в это окно, бонус появится на твоем балансе.'
        ].filter(Boolean).join('\n')
        : [
            '🤝 По твоей ссылке был новый переход.',
            '',
            `Клиент: ${referredLabel}`,
            'Сейчас новые скидки на паузе из-за резерва админа.',
            'Мы записали переход, но скидку для нового клиента не закрепили.'
        ].join('\n');

    try {
        await notificationBot.bot.telegram.sendMessage(referrerTgUserId, text, { disable_web_page_preview: true });
        return { sent: true };
    } catch (error) {
        console.error('Ошибка отправки referral lead notification:', error.message || error);
        return { sent: false, reason: 'send_failed' };
    }
}

export async function notifyReferralPayoutAvailable(activeBots, supabase, ownerId, tgUserId, balanceTon) {
    const notificationBot = await getOwnerNotificationBot(activeBots, supabase, ownerId);
    if (!notificationBot?.bot?.telegram) {
        return { sent: false, reason: 'active_bot_missing' };
    }

    const targetTgUserId = String(tgUserId || '').trim();
    if (!targetTgUserId) return { sent: false, reason: 'tg_user_id_missing' };

    const minPayoutTon = Number(getReferralEconomics().minPayoutTon || 5);
    const text = [
        '💸 Выплата уже доступна.',
        '',
        `Баланс: ${Number(balanceTon || 0)} TON`,
        `Минимум для вывода: ${minPayoutTon} TON`,
        '',
        'Открой партнерку в боте, укажи TON-кошелек и запроси выплату.'
    ].join('\n');

    try {
        await notificationBot.bot.telegram.sendMessage(targetTgUserId, text, { disable_web_page_preview: true });
        return { sent: true };
    } catch (error) {
        console.error('Ошибка отправки referral payout available notification:', error.message || error);
        return { sent: false, reason: 'send_failed' };
    }
}

export async function notifyReferralPayoutStatus(activeBots, supabase, ownerId, payout, status, meta = {}) {
    const notificationBot = await getOwnerNotificationBot(activeBots, supabase, ownerId);
    if (!notificationBot?.bot?.telegram) {
        return { partner: { sent: false, reason: 'active_bot_missing' }, admin: null };
    }

    const tgUserId = String(payout?.tg_user_id || '').trim();
    const amountTon = Number(payout?.amount_ton || 0);
    const wallet = payout?.ton_wallet || '';
    const txHash = meta.chainTxHash || payout?.chain_tx_hash || '';
    const networkFeeTon = Number(meta.networkFeeTon ?? payout?.network_fee_ton ?? 0);

    const partnerTexts = {
        queued: `💸 Заявка на выплату ${amountTon} TON взята в очередь.`,
        sending: `💸 Выплата ${amountTon} TON отправляется на твой кошелек.`,
        sent: [
            `✅ Выплата отправлена: ${amountTon} TON.`,
            wallet ? `Кошелек: ${wallet}` : '',
            txHash ? `Tx: ${txHash}` : ''
        ].filter(Boolean).join('\n'),
        failed: [
            `⚠️ Выплата ${amountTon} TON не прошла.`,
            meta.note ? `Причина: ${meta.note}` : 'Админ проверит и повторит обработку.'
        ].join('\n'),
        cancelled: [
            `⚠️ Заявка на выплату ${amountTon} TON отклонена.`,
            meta.note ? `Причина: ${meta.note}` : 'Свяжись с админом, если нужна проверка.'
        ].join('\n')
    };

    const partnerText = partnerTexts[status];
    let partnerResult = { sent: false, reason: 'unsupported_status' };
    if (tgUserId && partnerText) {
        try {
            await notificationBot.bot.telegram.sendMessage(tgUserId, partnerText, { disable_web_page_preview: true });
            partnerResult = { sent: true };
        } catch (error) {
            console.error('Ошибка отправки partner payout notification:', error.message || error);
            partnerResult = { sent: false, reason: 'send_failed' };
        }
    }

    let adminResult = null;
    if (['sent', 'failed', 'cancelled'].includes(status)) {
        const adminText = [
            status === 'sent' ? '✅ Партнерская выплата отмечена отправленной.' : '⚠️ Статус партнерской выплаты изменен.',
            '',
            `Партнер: ${tgUserId || 'неизвестен'}`,
            `Статус: ${status}`,
            `Сумма: ${amountTon} TON`,
            networkFeeTon > 0 ? `Комиссия сети: ${networkFeeTon} TON` : '',
            txHash ? `Tx: ${txHash}` : '',
            meta.note ? `Комментарий: ${meta.note}` : ''
        ].filter(Boolean).join('\n');

        adminResult = await notifyOwnerAdmin(activeBots, supabase, ownerId, adminText, { disable_web_page_preview: true });
    }

    return { partner: partnerResult, admin: adminResult };
}

export async function notifyReferralReserveDeposit(activeBots, supabase, ownerId, depositResult) {
    const amountTon = Number(depositResult?.amountTon || 0);
    const text = [
        '✅ TON-резерв партнерки пополнен.',
        '',
        `Сумма: ${amountTon} TON`,
        depositResult?.chainTxHash ? `Tx: ${depositResult.chainTxHash}` : '',
        depositResult?.lockCreated ? 'Депозит заблокирован на 30 дней. Партнерку можно включать.' : 'Резерв пересчитан.'
    ].filter(Boolean).join('\n');

    return notifyOwnerAdmin(activeBots, supabase, ownerId, text, { disable_web_page_preview: true });
}

export async function notifyReferralReserveRefund(activeBots, supabase, ownerId, refund, status) {
    const amountTon = Number(refund?.amountTon || refund?.amount_ton || 0);
    const txHash = refund?.chainTxHash || refund?.chain_tx_hash || '';
    const text = status === 'sent'
        ? [
            '✅ Возврат TON-резерва отмечен отправленным.',
            '',
            `Сумма: ${amountTon} TON`,
            txHash ? `Tx: ${txHash}` : ''
        ].filter(Boolean).join('\n')
        : [
            '↩️ Запрошен возврат свободного TON-резерва.',
            '',
            `Сумма: ${amountTon} TON`,
            'Новые партнеры будут на паузе до завершения возврата.'
        ].join('\n');

    return notifyOwnerAdmin(activeBots, supabase, ownerId, text, { disable_web_page_preview: true });
}

export async function notifyReferralReserveStatus(activeBots, supabase, ownerId, reserveAccount, previousStatus = null) {
    const status = String(reserveAccount?.status || '');
    if (!['reserve_low', 'over_limit', 'closed_for_new_partners'].includes(status)) {
        return { admin: { sent: false, reason: 'status_not_notifiable' }, partners: null };
    }

    const availableReserveTon = Number(reserveAccount?.available_reserve_ton || 0);
    const adminDebtTon = Number(reserveAccount?.admin_debt_ton || 0);
    const reservedObligationsTon = Number(reserveAccount?.reserved_obligations_ton || 0);

    const adminText = status === 'reserve_low'
        ? [
            '⚠️ TON-резерв партнерки на исходе.',
            '',
            `Свободно: ${availableReserveTon} TON`,
            `Обязательства: ${reservedObligationsTon} TON`,
            '',
            'Пополни резерв, чтобы не закрывать новых партнеров.'
        ].join('\n')
        : [
            '⛔ TON-резерв партнерки не покрывает обязательства.',
            '',
            `Свободно: ${availableReserveTon} TON`,
            `Долг админа: ${adminDebtTon} TON`,
            `Обязательства: ${reservedObligationsTon} TON`,
            '',
            'Новые партнеры и новые скидки по рефкам должны быть на паузе. Старые закрепленные лиды продолжают жить по своим условиям.'
        ].join('\n');

    const admin = await notifyOwnerAdmin(activeBots, supabase, ownerId, adminText, { disable_web_page_preview: true });
    let partners = null;

    if (['over_limit', 'closed_for_new_partners'].includes(status)) {
        partners = await notifyReferralPartnersProgramPaused(activeBots, supabase, ownerId, previousStatus);
    }

    return { admin, partners };
}

export async function notifyReferralPartnersProgramPaused(activeBots, supabase, ownerId, previousStatus = null) {
    const notificationBot = await getOwnerNotificationBot(activeBots, supabase, ownerId);
    if (!notificationBot?.bot?.telegram) {
        return { sent: 0, failed: 0, reason: 'active_bot_missing' };
    }

    const { data: partners, error } = await supabase
        .from('referral_profiles')
        .select('tg_user_id')
        .eq('owner_id', ownerId)
        .order('created_at', { ascending: true })
        .limit(100);

    if (error) {
        console.error('Ошибка загрузки партнеров для reserve pause notification:', error.message || error);
        return { sent: 0, failed: 0, reason: 'profiles_load_failed' };
    }

    const text = [
        '⚠️ Партнерская программа временно на паузе для новых переходов.',
        '',
        'Старые закрепленные лиды остаются за тобой до конца своего окна. Новые переходы могут быть без скидки, пока админ не пополнит резерв.'
    ].join('\n');

    let sent = 0;
    let failed = 0;
    for (const partner of partners || []) {
        const tgUserId = String(partner?.tg_user_id || '').trim();
        if (!tgUserId) continue;
        try {
            await notificationBot.bot.telegram.sendMessage(tgUserId, text, { disable_web_page_preview: true });
            sent += 1;
        } catch (error) {
            failed += 1;
            console.error('Ошибка отправки partner reserve pause notification:', error.message || error);
        }
    }

    return { sent, failed, previousStatus };
}
