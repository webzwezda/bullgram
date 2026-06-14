import { UserbotService } from '../services/userbot.service.js';

const TARGET_FIELDS = {
    public_channel: 'public_channel_id',
    paid_channel: 'paid_channel_id',
    public_chat: 'public_chat_id',
    paid_chat: 'paid_chat_id'
};

function buildDisplayName(user) {
    if (user.username) return `@${user.username}`;
    return [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || `ID ${user.tg_user_id}`;
}

async function getParticipantsSafely(client, chatId) {
    let participants = [];
    let offset = 0;
    const limit = 100;
    while (true) {
        const chunk = await client.getParticipants(chatId, { limit, offset });
        if (!chunk || chunk.length === 0) {
            break;
        }
        participants.push(...chunk);
        if (chunk.length < limit) {
            break;
        }
        offset += chunk.length;
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    return participants;
}

export const startAudienceSync = (supabase) => {
    const userbotService = new UserbotService(
        supabase,
        process.env.TG_API_ID,
        process.env.TG_API_HASH
    );

    async function loadContourUserbot(contour) {
        let userbotIds = [];
        if (contour.userbot_mode === 'single') {
            if (contour.selected_userbot_id) {
                userbotIds = [contour.selected_userbot_id];
            }
        } else if (contour.userbot_mode === 'pool') {
            const { data: activeBindings, error: bindingsError } = await supabase
                .from('official_bot_userbot_bindings')
                .select('userbot_id')
                .eq('bot_id', contour.bot_id)
                .eq('is_active', true);
            
            if (!bindingsError && activeBindings) {
                const activeSet = new Set(activeBindings.map((r) => String(r.userbot_id)));
                userbotIds = (contour.selected_userbot_ids || []).filter((id) => activeSet.has(String(id)));
            }
        }

        if (userbotIds.length === 0) return null;

        for (const userbotId of userbotIds) {
            const { data: userbot, error } = await supabase
                .from('tg_accounts')
                .select('*, proxies(id, host, port, username, password, is_working, provision_source)')
                .eq('id', userbotId)
                .eq('owner_id', contour.owner_id)
                .eq('account_type', 'userbot')
                .single();

            if (error || !userbot) continue;

            let operationalUserbot = userbot;
            if (operationalUserbot.proxy_id && operationalUserbot.proxies?.is_working === false) {
                try {
                    const failover = await userbotService.tryAutoFailoverUserbot(operationalUserbot);
                    if (failover?.switched && failover?.account) {
                        operationalUserbot = {
                            ...operationalUserbot,
                            ...failover.account,
                            proxies: failover.account.proxies || operationalUserbot.proxies
                        };
                    }
                } catch (failoverErr) {
                    console.error(`[loadContourUserbot] failover failed for userbot ${userbotId}:`, failoverErr);
                }
            }

            if (operationalUserbot.proxy_id && operationalUserbot.proxies?.is_working === false) {
                console.warn(`[loadContourUserbot] Skipping userbot ${userbotId} because proxy is dead.`);
                continue;
            }

            return operationalUserbot;
        }

        return null;
    }

    async function syncTarget(contour, targetType, userbot) {
        const channelId = contour[TARGET_FIELDS[targetType]];
        if (!channelId) return;

        const { data: channel } = await supabase
            .from('channels')
            .select('id, tg_chat_id')
            .eq('id', channelId)
            .single();
        if (!channel?.tg_chat_id) return;

        const { data: base } = await supabase
            .from('customer_bases')
            .select('id')
            .eq('contour_id', contour.bot_id)
            .eq('target_type', targetType)
            .maybeSingle();
        if (!base) return;

        const client = await userbotService.createAuthorizedClient(userbot, 1);
        try {
            await supabase
                .from('customer_base_members')
                .update({ present_now: false, updated_at: new Date().toISOString() })
                .eq('base_id', base.id)
                .eq('owner_id', contour.owner_id);

            const participants = await getParticipantsSafely(client, channel.tg_chat_id);

            const upsertPayload = [];
            for (const p of participants || []) {
                const tgUserId = String(p.id);
                upsertPayload.push({
                    owner_id: contour.owner_id,
                    base_id: base.id,
                    tg_user_id: tgUserId,
                    username: p.username || null,
                    first_name: p.firstName || null,
                    last_name: p.lastName || null,
                    display_name: buildDisplayName({
                        tg_user_id: tgUserId,
                        username: p.username || null,
                        first_name: p.firstName || null,
                        last_name: p.lastName || null
                    }),
                    is_bot: !!p.bot,
                    source_channel_ids: [channel.id],
                    channels_count: 1,
                    present_now: true,
                    last_seen_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                });
            }

            if (upsertPayload.length > 0) {
                await supabase
                    .from('customer_base_members')
                    .upsert(upsertPayload, { onConflict: 'base_id,tg_user_id' });
            }

            await supabase
                .from('customer_bases')
                .update({ updated_at: new Date().toISOString() })
                .eq('id', base.id);

            console.log(`[audience-sync] ${targetType}: ${upsertPayload.length} members synced`);
        } finally {
            await client.disconnect();
        }
    }

    async function runSync() {
        console.log('[audience-sync] starting daily sync...');
        const { data: contours } = await supabase
            .from('sales_bot_contours')
            .select('*')
            .neq('userbot_mode', 'none');

        if (!contours?.length) return;

        for (const contour of contours) {
            try {
                const userbot = await loadContourUserbot(contour);
                if (!userbot) continue;

                for (const targetType of Object.keys(TARGET_FIELDS)) {
                    try {
                        await syncTarget(contour, targetType, userbot);
                    } catch (err) {
                        console.error(`[audience-sync] error for ${targetType}:`, err.message);
                    }
                }
            } catch (err) {
                console.error(`[audience-sync] contour error:`, err.message);
            }
        }
        console.log('[audience-sync] daily sync complete');
    }

    // Run daily at 03:00
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const now = new Date();
    const target = new Date(now);
    target.setHours(3, 0, 0, 0);
    if (target <= now) target.setTime(target.getTime() + MS_PER_DAY);
    const initialDelay = target.getTime() - now.getTime();

    setTimeout(() => {
        runSync();
        setInterval(runSync, MS_PER_DAY);
    }, initialDelay);

    console.log(`[audience-sync] first run in ${Math.round(initialDelay / 60000)} minutes`);
};
