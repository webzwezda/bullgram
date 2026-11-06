function dedupeAudience(rows = []) {
    const seen = new Set();
    return rows.filter(row => {
        const key = `${row.tg_user_id}:${row.channel_id || 'global'}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function buildAudienceKey(tgUserId, channelId) {
    return `${tgUserId}:${channelId || 'global'}`;
}

export async function buildAudience(supabase, loadOwnerContext, loadLatestPaidTariffMap, ownerId, audienceType, channelId = null, baseId = null, manualTgUserIds = [], baseFilter = 'all_members', manualMembers = []) {
        const { channels } = await loadOwnerContext(ownerId);
        const channelIds = channels.map(channel => channel.id);
        const channelMap = new Map(channels.map(channel => [channel.id, channel]));
        const nowIso = new Date().toISOString();
        const trialSoonIso = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

        if (audienceType === 'manual_list') {
            const manualMemberMap = new Map((manualMembers || [])
                .filter(member => member?.tg_user_id)
                .map(member => [String(member.tg_user_id), member]));
            const uniqueUserIds = Array.from(new Set((manualTgUserIds || []).map(value => String(value)).filter(Boolean)));
            return uniqueUserIds.map(tgUserId => ({
                tg_user_id: tgUserId,
                channel_id: null,
                channel_title: 'Ручная выборка',
                bot_id: null,
                source_type: 'manual_list',
                source_id: tgUserId,
                is_trial: false,
                segment_label: 'Выбрано руками',
                tariff_title: manualMemberMap.get(tgUserId)?.display_name || null,
                username: manualMemberMap.get(tgUserId)?.username || null
            }));
        }

        if (audienceType === 'channel_audience_members') {
            if (!baseId) return [];

            const { data: base } = await supabase
                .from('channel_audiences')
                .select('id, name')
                .eq('id', baseId)
                .eq('owner_id', ownerId)
                .single();

            if (!base) return [];

            const { data: members, error } = await supabase
                .from('channel_audience_members')
                .select('id, tg_user_id, display_name, username, present_now, channels_count, is_bot')
                .eq('owner_id', ownerId)
                .eq('base_id', baseId)
                .eq('is_bot', false)
                .order('channels_count', { ascending: false })
                .order('updated_at', { ascending: false });

            if (error) throw error;

            return dedupeAudience((members || [])
                .filter(member => {
                    if (baseFilter === 'present_only') return !!member.present_now;
                    if (baseFilter === 'missing_only') return !member.present_now;
                    if (baseFilter === 'partial_only') return Number(member.channels_count || 0) > 0 && !!member.present_now;
                    if (baseFilter === 'multi_channel_only') return Number(member.channels_count || 0) >= 2;
                    return true;
                })
                .map(member => ({
                tg_user_id: String(member.tg_user_id),
                channel_id: null,
                channel_title: base.name,
                bot_id: null,
                source_type: 'channel_audience',
                source_id: member.id,
                is_trial: false,
                segment_label: !member.present_now
                    ? 'Сейчас не найден'
                    : (Number(member.channels_count || 0) >= 2 ? 'Есть в нескольких местах' : 'Есть только в части базы'),
                tariff_title: member.display_name || null,
                username: member.username || null,
                channels_count: member.channels_count || 0
            })));
        }

        if (audienceType === 'client_base_members') {
            if (!baseId) return [];

            const { data: base } = await supabase
                .from('client_bases')
                .select('id, name')
                .eq('id', baseId)
                .eq('owner_id', ownerId)
                .single();

            if (!base) return [];

            const { data: members, error } = await supabase
                .from('client_base_members')
                .select('id, tg_user_id, display_name, username')
                .eq('owner_id', ownerId)
                .eq('base_id', baseId);

            if (error) throw error;

            return dedupeAudience((members || []).map(member => ({
                tg_user_id: String(member.tg_user_id),
                channel_id: null,
                channel_title: base.name,
                bot_id: null,
                source_type: 'client_base',
                source_id: member.id,
                is_trial: false,
                segment_label: 'Из базы клиентов',
                tariff_title: member.display_name || null,
                username: member.username || null
            })));
        }

        if (channelIds.length === 0) return [];

        if (
            audienceType === 'active_subscribers' ||
            audienceType === 'channel_active' ||
            audienceType === 'trial_active' ||
            audienceType === 'trial_expiring'
        ) {
            const latestPaidTariffMap = await loadLatestPaidTariffMap(channelIds);
            const query = supabase
                .from('subscriptions')
                .select('id, tg_user_id, channel_id, status, expires_at')
                .eq('status', 'active');

            if (audienceType === 'channel_active' && channelId) {
                query.eq('channel_id', channelId);
            } else {
                query.in('channel_id', channelIds);
            }

            const { data } = await query.order('created_at', { ascending: false });
            return dedupeAudience((data || [])
                .map(row => {
                    const key = buildAudienceKey(String(row.tg_user_id), row.channel_id);
                    const latestTariff = latestPaidTariffMap.get(key) || null;

                    return {
                        tg_user_id: String(row.tg_user_id),
                        channel_id: row.channel_id,
                        channel_title: channelMap.get(row.channel_id)?.title || 'Неизвестный канал',
                        bot_id: channelMap.get(row.channel_id)?.bot_id || null,
                        source_type: 'subscription',
                        source_id: row.id,
                        is_trial: !!latestTariff?.is_trial,
                        segment_label: latestTariff?.is_trial
                            ? (latestTariff?.trial_label || 'Пробник')
                            : 'Обычная подписка',
                        tariff_title: latestTariff?.title || null,
                        expires_at: row.expires_at || null
                    };
                })
                .filter(row => {
                    if (audienceType === 'trial_active') return row.is_trial;
                    if (audienceType === 'trial_expiring') {
                        return row.is_trial && row.expires_at && row.expires_at <= trialSoonIso && row.expires_at >= nowIso;
                    }
                    return true;
                }));
        }

        if (audienceType === 'expired_subscribers') {
            const latestPaidTariffMap = await loadLatestPaidTariffMap(channelIds);
            const { data } = await supabase
                .from('subscriptions')
                .select('id, tg_user_id, channel_id, status, expires_at')
                .in('channel_id', channelIds)
                .order('created_at', { ascending: false });

            return dedupeAudience((data || [])
                .filter(row => row.status === 'expired' || (row.expires_at && row.expires_at < nowIso))
                .map(row => ({
                    tg_user_id: String(row.tg_user_id),
                    channel_id: row.channel_id,
                    channel_title: channelMap.get(row.channel_id)?.title || 'Неизвестный канал',
                    bot_id: channelMap.get(row.channel_id)?.bot_id || null,
                    source_type: 'subscription',
                    source_id: row.id,
                    is_trial: !!latestPaidTariffMap.get(buildAudienceKey(String(row.tg_user_id), row.channel_id))?.is_trial,
                    segment_label: latestPaidTariffMap.get(buildAudienceKey(String(row.tg_user_id), row.channel_id))?.is_trial
                        ? (latestPaidTariffMap.get(buildAudienceKey(String(row.tg_user_id), row.channel_id))?.trial_label || 'Пробник')
                        : 'Обычная подписка',
                    expires_at: row.expires_at || null
                })));
        }

        if (audienceType === 'paid_not_joined') {
            const latestPaidTariffMap = await loadLatestPaidTariffMap(channelIds);
            const { data } = await supabase
                .from('subscriptions')
                .select('id, tg_user_id, channel_id, status, expires_at, last_join_approved_at')
                .in('channel_id', channelIds)
                .eq('status', 'active')
                .order('created_at', { ascending: false });

            return dedupeAudience((data || [])
                .filter(row => !row.last_join_approved_at)
                .map(row => ({
                    tg_user_id: String(row.tg_user_id),
                    channel_id: row.channel_id,
                    channel_title: channelMap.get(row.channel_id)?.title || 'Неизвестный канал',
                    bot_id: channelMap.get(row.channel_id)?.bot_id || null,
                    source_type: 'subscription',
                    source_id: row.id,
                    is_trial: !!latestPaidTariffMap.get(buildAudienceKey(String(row.tg_user_id), row.channel_id))?.is_trial,
                    segment_label: latestPaidTariffMap.get(buildAudienceKey(String(row.tg_user_id), row.channel_id))?.is_trial
                        ? (latestPaidTariffMap.get(buildAudienceKey(String(row.tg_user_id), row.channel_id))?.trial_label || 'Пробник')
                        : 'Обычная подписка',
                    expires_at: row.expires_at || null
                })));
        }

        if (audienceType === 'unpaid_leads' || audienceType === 'trial_unpaid') {
            const { data: tariffs, error: tariffsError } = await supabase
                .from('tariffs')
                .select('id, channel_id, title, is_trial, trial_label')
                .in('channel_id', channelIds.length > 0 ? channelIds : ['00000000-0000-0000-0000-000000000000']);

            if (tariffsError) throw tariffsError;

            const tariffIds = (tariffs || []).map(tariff => tariff.id);
            const tariffMap = new Map((tariffs || []).map(tariff => [tariff.id, tariff]));
            if (tariffIds.length === 0) return [];

            const { data: invoices, error: invoicesError } = await supabase
                .from('invoices')
                .select('id, tg_user_id, tariff_id, status, created_at')
                .in('tariff_id', tariffIds)
                .in('status', ['pending', 'awaiting_receipt'])
                .order('created_at', { ascending: false });

            if (invoicesError) throw invoicesError;

            return dedupeAudience((invoices || [])
                .filter(invoice => {
                    const tariff = tariffMap.get(invoice.tariff_id);
                    if (!tariff) return false;
                    if (audienceType === 'trial_unpaid') return !!tariff.is_trial;
                    return true;
                })
                .map(invoice => {
                    const tariff = tariffMap.get(invoice.tariff_id);
                    return {
                        tg_user_id: String(invoice.tg_user_id),
                        channel_id: tariff.channel_id,
                        channel_title: channelMap.get(tariff.channel_id)?.title || tariff.title || 'Неизвестный канал',
                        bot_id: channelMap.get(tariff.channel_id)?.bot_id || null,
                        source_type: 'invoice',
                        source_id: invoice.id,
                        is_trial: !!tariff.is_trial,
                        segment_label: tariff.is_trial
                            ? (tariff.trial_label || 'Пробник')
                            : 'Обычный тариф',
                        tariff_title: tariff.title,
                        created_at: invoice.created_at
                    };
                }));
        }

        if (audienceType === 'viewed_no_invoice') {
            const { data: tariffs, error: tariffsError } = await supabase
                .from('tariffs')
                .select('id, channel_id, title, is_trial, trial_label')
                .in('channel_id', channelIds.length > 0 ? channelIds : ['00000000-0000-0000-0000-000000000000']);

            if (tariffsError) throw tariffsError;

            const tariffIds = (tariffs || []).map(tariff => tariff.id);
            const tariffMap = new Map((tariffs || []).map(tariff => [tariff.id, tariff]));
            if (tariffIds.length === 0) return [];

            const [{ data: events, error: eventsError }, { data: invoices, error: invoicesError }] = await Promise.all([
                supabase
                    .from('customer_funnel_events')
                    .select('id, tg_user_id, tariff_id, event_type, source, referral_code, payload, created_at')
                    .eq('owner_id', ownerId)
                    .in('event_type', ['tariff_list_opened', 'tariff_card_opened', 'payment_method_selected'])
                    .order('created_at', { ascending: false })
                    .limit(500),
                supabase
                    .from('invoices')
                    .select('id, tg_user_id, tariff_id, created_at')
                    .in('tariff_id', tariffIds)
                    .order('created_at', { ascending: false })
                    .limit(5000)
            ]);

            if (eventsError && !(eventsError.message || '').includes('customer_funnel_events')) throw eventsError;
            if (invoicesError) throw invoicesError;

            // Индекс счетов строится один раз — проверка события O(1) вместо скана всех счетов на каждое событие.
            // Ключи строковые, как в исходном сравнении String(a) !== String(b): 5 и "5" склеивались и раньше.
            // Берём максимум created_at на пользователя (и на пользователя+тариф): «есть счёт после события» === «максимум >= событие».
            const maxInvoiceMsByUser = new Map();
            const maxInvoiceMsByUserTariff = new Map();
            for (const invoice of invoices || []) {
                const userKey = String(invoice.tg_user_id);
                const invoiceMs = new Date(invoice.created_at).getTime();
                if (!Number.isFinite(invoiceMs)) continue;

                const userMax = maxInvoiceMsByUser.get(userKey);
                if (userMax === undefined || invoiceMs > userMax) maxInvoiceMsByUser.set(userKey, invoiceMs);

                if (invoice.tariff_id) {
                    const tariffKey = String(invoice.tariff_id);
                    let byTariff = maxInvoiceMsByUserTariff.get(userKey);
                    if (!byTariff) {
                        byTariff = new Map();
                        maxInvoiceMsByUserTariff.set(userKey, byTariff);
                    }
                    const tariffMax = byTariff.get(tariffKey);
                    if (tariffMax === undefined || invoiceMs > tariffMax) byTariff.set(tariffKey, invoiceMs);
                }
            }

            return dedupeAudience((events || [])
                .filter(event => {
                    if (event.tariff_id && !tariffMap.has(event.tariff_id)) return false;
                    const eventMs = new Date(event.created_at).getTime();
                    const invoiceMaxMs = event.tariff_id
                        ? maxInvoiceMsByUserTariff.get(String(event.tg_user_id))?.get(String(event.tariff_id))
                        : maxInvoiceMsByUser.get(String(event.tg_user_id));
                    return !(invoiceMaxMs !== undefined && eventMs <= invoiceMaxMs);
                })
                .map(event => {
                    const tariff = tariffMap.get(event.tariff_id) || null;
                    const channel = tariff ? channelMap.get(tariff.channel_id) : null;
                    return {
                        tg_user_id: String(event.tg_user_id),
                        channel_id: tariff?.channel_id || null,
                        channel_title: channel?.title || 'Смотрел тарифы',
                        bot_id: channel?.bot_id || null,
                        source_type: 'customer_funnel_event',
                        source_id: event.id,
                        is_trial: !!tariff?.is_trial,
                        segment_label: event.event_type,
                        tariff_title: tariff?.title || event.payload?.tariff_title || null,
                        referral_code: event.referral_code || null,
                        created_at: event.created_at
                    };
                }));
        }

        return [];
    }
