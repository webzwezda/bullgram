import { authenticateUser } from '../../middlewares/auth.middleware.js';

export function registerMembersRoute(router, deps) {
    const { supabase, loadOwnedBase } = deps;

    router.get('/:id/members', authenticateUser, async (req, res) => {
        try {
            const baseId = req.params.id;
            const base = await loadOwnedBase(req.user.id, baseId);
            if (!base) return res.status(404).json({ error: 'База не найдена' });

            // count:'exact' поверх limit: считаем весь отфильтрованный набор,
            // чтобы честно сказать, что выдача обрезана лимитом 1000.
            const { data: members, error, count: totalCount } = await supabase
                .from('channel_audience_members')
                .select('*', { count: 'exact' })
                .eq('owner_id', req.user.id)
                .eq('base_id', baseId)
                .order('channels_count', { ascending: false })
                .order('updated_at', { ascending: false })
                .limit(1000);

            if (error) throw error;

            const { data: links } = await supabase
                .from('channel_audience_channels')
                .select('channel_id, channels(id, title)')
                .eq('base_id', baseId);

            const linkedChannels = (links || [])
                .map(link => link.channels || null)
                .filter(Boolean);
            const totalChannels = linkedChannels.length;
            const linkedChannelIds = linkedChannels.map(channel => channel.id);

            const { data: linkedTariffs, error: linkedTariffsError } = linkedChannelIds.length > 0
                ? await supabase
                    .from('tariffs')
                    .select('id, channel_id')
                    .in('channel_id', linkedChannelIds)
                : { data: [], error: null };

            if (linkedTariffsError) throw linkedTariffsError;

            const linkedTariffIds = (linkedTariffs || []).map(tariff => tariff.id);

            const [{ data: subscriptions, error: subscriptionsError }, { data: invoices, error: invoicesError, count: invoicesCount }] = await Promise.all([
                linkedChannelIds.length > 0
                    ? supabase
                        .from('subscriptions')
                        .select('tg_user_id, channel_id, status, expires_at')
                        .in('channel_id', linkedChannelIds)
                    : Promise.resolve({ data: [], error: null }),
                linkedTariffIds.length > 0
                    ? supabase
                        .from('invoices')
                        .select('tg_user_id, status, created_at, paid_at', { count: 'exact' })
                        .in('tariff_id', linkedTariffIds)
                        .order('created_at', { ascending: false })
                        .limit(5000)
                    : Promise.resolve({ data: [], error: null, count: 0 })
            ]);

            if (subscriptionsError) throw subscriptionsError;
            if (invoicesError) throw invoicesError;

            const nowIso = new Date().toISOString();
            const subscriptionStatsByUser = new Map();
            for (const subscription of subscriptions || []) {
                const tgUserId = String(subscription.tg_user_id);
                if (!subscriptionStatsByUser.has(tgUserId)) {
                    subscriptionStatsByUser.set(tgUserId, {
                        active_subscription_count: 0,
                        expired_subscription_count: 0
                    });
                }

                const stats = subscriptionStatsByUser.get(tgUserId);
                const isActive = subscription.status === 'active' && (!subscription.expires_at || subscription.expires_at >= nowIso);
                if (isActive) stats.active_subscription_count += 1;
                else stats.expired_subscription_count += 1;
            }

            const invoiceStatsByUser = new Map();
            for (const invoice of invoices || []) {
                const tgUserId = String(invoice.tg_user_id);
                if (!invoiceStatsByUser.has(tgUserId)) {
                    invoiceStatsByUser.set(tgUserId, {
                        has_any_paid_invoice: false,
                        has_pending_invoice: false,
                        last_paid_at: null,
                        last_invoice_status: null
                    });
                }

                const stats = invoiceStatsByUser.get(tgUserId);
                stats.last_invoice_status = stats.last_invoice_status || invoice.status;

                if (invoice.status === 'paid') {
                    stats.has_any_paid_invoice = true;
                    if (!stats.last_paid_at || new Date(invoice.paid_at || invoice.created_at || 0) > new Date(stats.last_paid_at)) {
                        stats.last_paid_at = invoice.paid_at || invoice.created_at || null;
                    }
                }

                if (['pending', 'awaiting_receipt', 'wait_admin'].includes(invoice.status)) {
                    stats.has_pending_invoice = true;
                }
            }

            const hydratedMembers = (members || []).map(member => ({
                ...member,
                total_channels: totalChannels,
                present_channel_titles: linkedChannels
                    .filter(channel => (member.source_channel_ids || []).includes(channel.id))
                    .map(channel => channel.title),
                missing_channel_titles: linkedChannels
                    .filter(channel => !(member.source_channel_ids || []).includes(channel.id))
                    .map(channel => channel.title),
                ...(() => {
                    const tgUserId = String(member.tg_user_id);
                    const subscriptionStats = subscriptionStatsByUser.get(tgUserId) || {
                        active_subscription_count: 0,
                        expired_subscription_count: 0
                    };
                    const invoiceStats = invoiceStatsByUser.get(tgUserId) || {
                        has_any_paid_invoice: false,
                        has_pending_invoice: false,
                        last_paid_at: null
                    };

                    let payment_status = 'no_payment_history';
                    if (subscriptionStats.active_subscription_count > 0) payment_status = 'active_paid';
                    else if (invoiceStats.has_any_paid_invoice) payment_status = 'expired_paid';
                    else if (invoiceStats.has_pending_invoice) payment_status = 'unpaid_lead';

                    if (member.present_now && subscriptionStats.active_subscription_count === 0 && !member.is_bot) {
                        payment_status = invoiceStats.has_any_paid_invoice ? 'expired_paid_inside' : 'free_rider';
                    }

                    return {
                        active_subscription_count: subscriptionStats.active_subscription_count,
                        expired_subscription_count: subscriptionStats.expired_subscription_count,
                        has_any_paid_invoice: invoiceStats.has_any_paid_invoice,
                        has_pending_invoice: invoiceStats.has_pending_invoice,
                        last_paid_at: invoiceStats.last_paid_at,
                        payment_status
                    };
                })(),
                coverage_status: totalChannels > 0 && member.channels_count >= totalChannels
                    ? 'all_channels'
                    : (member.channels_count > 0 ? 'partial_channels' : 'missing_everywhere')
            }));

            const summary = hydratedMembers.reduce((stats, member) => {
                if (member.is_bot) {
                    stats.bots += 1;
                    return stats;
                }
                stats.total += 1;
                stats.humans += 1;
                if (member.payment_status === 'active_paid') stats.active_paid += 1;
                if (member.payment_status === 'expired_paid' || member.payment_status === 'expired_paid_inside') stats.expired_paid += 1;
                if (member.payment_status === 'unpaid_lead') stats.unpaid_leads += 1;
                if (member.payment_status === 'free_rider' || member.payment_status === 'expired_paid_inside') stats.free_riders += 1;
                return stats;
            }, {
                total: 0,
                humans: 0,
                bots: 0,
                active_paid: 0,
                expired_paid: 0,
                unpaid_leads: 0,
                free_riders: 0
            });

            res.json({
                success: true,
                members: hydratedMembers,
                summary,
                total_count: totalCount || 0,
                truncated: (totalCount || 0) > hydratedMembers.length,
                payments_truncated: (invoicesCount || 0) > (invoices || []).length
            });
        } catch (error) {
            console.error('Ошибка загрузки участников базы:', error);
            res.status(500).json({ error: 'Ошибка загрузки участников базы' });
        }
    });
}
