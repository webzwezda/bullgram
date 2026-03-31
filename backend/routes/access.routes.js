import express from 'express';
import { authenticateUser } from '../middlewares/auth.middleware.js';

export default function(supabase) {
    const router = express.Router();

    router.get('/', authenticateUser, async (req, res) => {
        try {
            const ownerId = req.user.id;

            const { data: channels, error: channelsError } = await supabase
                .from('channels')
                .select('id, title, tg_chat_id')
                .eq('owner_id', ownerId)
                .order('created_at', { ascending: false });

            if (channelsError) throw channelsError;

            const channelMap = new Map((channels || []).map(channel => [channel.id, channel]));
            const channelIds = (channels || []).map(channel => channel.id);

            const [invitesResp, eventsResp, subsResp] = await Promise.all([
                supabase
                    .from('access_invites')
                    .select('*')
                    .eq('owner_id', ownerId)
                    .order('issued_at', { ascending: false })
                    .limit(100),
                supabase
                    .from('access_events')
                    .select('*')
                    .eq('owner_id', ownerId)
                    .order('created_at', { ascending: false })
                    .limit(150),
                channelIds.length > 0
                    ? supabase
                        .from('subscriptions')
                        .select('id, tg_user_id, channel_id, status, expires_at, last_join_request_at, last_join_approved_at, last_access_event, access_note')
                        .in('channel_id', channelIds)
                        .order('created_at', { ascending: false })
                    : Promise.resolve({ data: [], error: null })
            ]);

            if (invitesResp.error) throw invitesResp.error;
            if (eventsResp.error) throw eventsResp.error;
            if (subsResp.error) throw subsResp.error;

            const invites = (invitesResp.data || []).map(invite => ({
                ...invite,
                channel_title: channelMap.get(invite.channel_id)?.title || 'Неизвестный канал'
            }));

            const events = (eventsResp.data || []).map(event => ({
                ...event,
                channel_title: channelMap.get(event.channel_id)?.title || 'Неизвестный канал'
            }));

            const subscriptions = (subsResp.data || []).map(subscription => ({
                ...subscription,
                channel_title: channelMap.get(subscription.channel_id)?.title || 'Неизвестный канал'
            }));

            const now = Date.now();
            const accessIssues = subscriptions.filter(subscription => {
                if (subscription.status === 'active' && !subscription.last_join_approved_at) {
                    return true;
                }

                if (subscription.status === 'expired' && subscription.last_access_event !== 'kicked') {
                    if (!subscription.expires_at) return false;
                    return new Date(subscription.expires_at).getTime() < now;
                }

                return false;
            });

            const summary = {
                totalInvites: invites.length,
                issuedInvites: invites.filter(invite => invite.status === 'issued').length,
                approvedInvites: invites.filter(invite => invite.status === 'approved').length,
                declinedInvites: invites.filter(invite => invite.status === 'declined').length,
                kickedUsers: events.filter(event => event.event_type === 'kicked').length,
                pendingAccess: accessIssues.filter(issue => issue.status === 'active').length,
                staleExpired: accessIssues.filter(issue => issue.status === 'expired').length
            };

            res.json({
                success: true,
                summary,
                invites,
                events,
                accessIssues,
                channels
            });
        } catch (error) {
            console.error('Ошибка access ledger:', error);
            res.status(500).json({ error: 'Ошибка загрузки access ledger' });
        }
    });

    return router;
}
