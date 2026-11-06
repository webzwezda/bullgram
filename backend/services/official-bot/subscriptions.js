// Тарифные бандлы и подписки (чтение бандла, продление expires_at с TOCTOU-гардом) —
// вынесены дословно из official-bot.service.js; this.supabase -> параметр supabase.

export async function getTariffBundleItems(supabase, tariff, ownerId) {
    try {
        const { data, error } = await supabase
            .from('tariff_bundle_items')
            .select('id, tariff_id, item_type, channel_id, resource_title, resource_url, sort_order, is_active, channels(id, title, tg_chat_id, owner_id, chat_type)')
            .eq('owner_id', ownerId)
            .eq('tariff_id', tariff.id)
            .eq('is_active', true)
            .order('sort_order', { ascending: true })
            .order('created_at', { ascending: true });

        if (error) {
            if ((error.message || '').includes('tariff_bundle_items')) {
                return [];
            }
            throw error;
        }

        return data || [];
    } catch (error) {
        if ((error.message || '').includes('tariff_bundle_items')) {
            return [];
        }
        throw error;
    }
}

function computeExtendedExpiresAt(sub, durationDays) {
    if (Number(durationDays) <= 0) return null;

    const now = new Date();
    let baseDate = new Date();

    if (sub && sub.expires_at) {
        const currentExp = new Date(sub.expires_at);
        if (currentExp > now) {
            baseDate = currentExp;
        }
    }

    baseDate.setDate(baseDate.getDate() + Number(durationDays));
    return baseDate.toISOString();
}

export async function upsertSubscriptionForChannel(supabase, tgUserId, channelId, durationDays) {
    const { data: existingSub } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('tg_user_id', tgUserId)
        .eq('channel_id', channelId)
        .single();

    let newExpiresAt = null;
    let subscriptionId = existingSub?.id || null;

    if (existingSub) {
        // Оптимистический гард от TOCTOU: expires_at читаем и пишем по очереди,
        // поэтому обновляем только если оно не изменилось с момента чтения.
        // Конфликт — перечитываем подписку, пересчитываем и повторяем (макс. 2 ретрая).
        let current = existingSub;
        let applied = false;

        for (let attempt = 0; attempt < 3 && !applied; attempt++) {
            newExpiresAt = computeExtendedExpiresAt(current, durationDays);

            let updateQuery = supabase
                .from('subscriptions')
                .update({
                    expires_at: newExpiresAt,
                    status: 'active'
                })
                .eq('id', current.id);
            updateQuery = current.expires_at == null
                ? updateQuery.is('expires_at', null)
                : updateQuery.eq('expires_at', current.expires_at);

            const { data: updatedRows, error: updateError } = await updateQuery.select('id');
            if (updateError) throw updateError;

            if ((updatedRows || []).length > 0) {
                applied = true;
            } else {
                const { data: rereadSub, error: rereadError } = await supabase
                    .from('subscriptions')
                    .select('*')
                    .eq('tg_user_id', tgUserId)
                    .eq('channel_id', channelId)
                    .single();
                if (rereadError) throw rereadError;
                if (!rereadSub) break;
                current = rereadSub;
            }
        }

        if (!applied) {
            // Деньги уже уплачены (платёжный путь) — покупатель должен получить
            // доступ, поэтому после исчерпания ретраев делаем финальную запись
            // без гарда. В худшем случае теряется параллельное продление (не
            // двойное), ошибка логируется для ручной компенсации.
            const fallbackExpiresAt = computeExtendedExpiresAt(current, durationDays);
            const { error: fallbackError } = await supabase
                .from('subscriptions')
                .update({
                    expires_at: fallbackExpiresAt,
                    status: 'active'
                })
                .eq('id', current.id);
            if (fallbackError) throw fallbackError;
            newExpiresAt = fallbackExpiresAt;
            console.error('upsertSubscriptionForChannel: исчерпаны ретраи TOCTOU-гарда, применён фолбэк без гарда', {
                tgUserId,
                channelId,
                durationDays,
                expires_at: fallbackExpiresAt
            });
        }

        subscriptionId = current.id;
    } else {
        newExpiresAt = computeExtendedExpiresAt(null, durationDays);

        const { data: createdSub } = await supabase
            .from('subscriptions')
            .insert({
                tg_user_id: tgUserId,
                channel_id: channelId,
                expires_at: newExpiresAt,
                status: 'active'
            })
            .select()
            .single();
        subscriptionId = createdSub?.id || null;
    }

    if (!subscriptionId && existingSub) {
        subscriptionId = existingSub.id;
    }

    return {
        subscriptionId,
        expiresAt: newExpiresAt
    };
}
