import express from 'express';
import { authenticateUser } from '../middlewares/auth.middleware.js';
import { BroadcastPreparationService, PreparationError } from '../services/broadcast-preparation.service.js';

export default function(supabase) {
    const router = express.Router();
    const service = new BroadcastPreparationService(supabase);

    function handleError(res, error) {
        if (error instanceof PreparationError) {
            return res.status(error.statusCode).json({ error: error.message });
        }
        console.error('Ошибка broadcast preparation:', error);
        return res.status(500).json({ error: 'Ошибка подготовки рассылки' });
    }

    router.get('/preparations', authenticateUser, async (req, res) => {
        try {
            const [{ data, error }, { data: running }] = await Promise.all([
                supabase
                    .from('broadcast_preparations')
                    .select('id, audience_type, base_id, status, stats, phase_detail, external_targets, created_at, updated_at')
                    .eq('owner_id', req.user.id)
                    .order('created_at', { ascending: false })
                    .limit(20),
                supabase
                    .from('broadcast_preparations')
                    .select('id, audience_type, base_id, status, stats, phase_detail, external_targets, created_at, updated_at')
                    .eq('owner_id', req.user.id)
                    .in('status', ['pending', 'scanning', 'joining', 'recomputing'])
                    .order('created_at', { ascending: false })
                    .limit(1)
            ]);
            if (error) throw error;
            res.json({
                preparations: data || [],
                active: running?.[0] || null,
                flags: {
                    userbot_broadcast_enabled: String(process.env.USERBOT_BROADCAST_ENABLED || '').trim().toLowerCase() === 'true',
                    auto_join_enabled: String(process.env.USERBOT_AUTO_JOIN_ENABLED || '').trim().toLowerCase() === 'true'
                }
            });
        } catch (error) {
            handleError(res, error);
        }
    });

    router.post('/preparations', authenticateUser, async (req, res) => {
        try {
            const result = await service.createPreparation(req.user.id, {
                audience_type: req.body?.audience_type,
                channel_id: req.body?.channel_id,
                base_id: req.body?.base_id,
                base_filter: req.body?.base_filter,
                manual_tg_user_ids: req.body?.manual_tg_user_ids || [],
                manual_members: req.body?.manual_members || [],
                userbot_ids: req.body?.userbot_ids || [],
                external_targets: req.body?.external_targets || []
            });
            res.json({ success: true, ...result });
        } catch (error) {
            handleError(res, error);
        }
    });

    router.get('/preparations/:id', authenticateUser, async (req, res) => {
        try {
            const preparation = await service.getStatus(req.user.id, req.params.id);
            res.json({ preparation });
        } catch (error) {
            handleError(res, error);
        }
    });

    router.get('/preparations/:id/members', authenticateUser, async (req, res) => {
        try {
            const result = await service.listMembers(req.user.id, req.params.id, {
                filter: req.query?.filter || '',
                limit: Math.min(Number(req.query?.limit) || 50, 200),
                offset: Math.max(Number(req.query?.offset) || 0, 0)
            });
            res.json(result);
        } catch (error) {
            handleError(res, error);
        }
    });

    router.post('/preparations/:id/join-targets', authenticateUser, async (req, res) => {
        try {
            const result = await service.addJoinTargets(req.user.id, req.params.id, req.body?.targets || []);
            res.json({ success: true, ...result });
        } catch (error) {
            handleError(res, error);
        }
    });

    router.post('/preparations/:id/recheck', authenticateUser, async (req, res) => {
        try {
            const result = await service.recheck(req.user.id, req.params.id);
            res.json({ success: true, ...result });
        } catch (error) {
            handleError(res, error);
        }
    });

    router.delete('/preparations/:id', authenticateUser, async (req, res) => {
        try {
            const preparation = await service.getStatus(req.user.id, req.params.id);
            if (['pending', 'scanning', 'joining', 'recomputing'].includes(preparation.status)) {
                await service.cancel(req.user.id, req.params.id);
                return res.json({ success: true, status: 'cancelled' });
            }
            const { error } = await supabase
                .from('broadcast_preparations')
                .delete()
                .eq('id', req.params.id)
                .eq('owner_id', req.user.id);
            if (error) throw error;
            res.json({ success: true, status: 'deleted' });
        } catch (error) {
            handleError(res, error);
        }
    });

    return router;
}
