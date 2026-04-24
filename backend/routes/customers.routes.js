import express from 'express';
import { authenticateUser } from '../middlewares/auth.middleware.js';

function latestBy(list = [], keyFn, dateField = 'created_at') {
    const map = new Map();

    for (const item of list) {
        const key = keyFn(item);
        if (!key) continue;

        const prev = map.get(key);
        const itemDate = new Date(item?.[dateField] || item?.issued_at || 0).getTime();
        const prevDate = new Date(prev?.[dateField] || prev?.issued_at || 0).getTime();

        if (!prev || itemDate >= prevDate) {
            map.set(key, item);
        }
    }

    return map;
}

function emptyListResult() {
    return Promise.resolve({ data: [], error: null });
}

function getAbandonedStatus(invoice) {
    const createdAt = new Date(invoice.created_at).getTime();
    const ageHours = (Date.now() - createdAt) / (1000 * 60 * 60);

    if (invoice.status === 'awaiting_receipt') return 'awaiting_receipt';
    if (invoice.reminded) return 'reminded';
    if (ageHours < 2) return 'fresh';
    if (ageHours < 24) return 'queued';
    return 'stale';
}

function buildPersonDisplayName(profile = {}) {
    const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim();
    if (fullName) return fullName;
    if (profile.display_name) return String(profile.display_name).trim();
    return null;
}

function buildFunnelPersonProfile(event = {}) {
    const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
    const first_name = payload.first_name || null;
    const last_name = payload.last_name || null;
    const display_name = payload.display_name || null;
    const username = payload.username || null;

    return {
        first_name,
        last_name,
        display_name: buildPersonDisplayName({ first_name, last_name, display_name }),
        username
    };
}

function normalizeUuidLike(value) {
    const raw = String(value || '').trim();
    return raw || null;
}

function requireProjectAdmin(req, res) {
    if (req.profile?.role !== 'admin') {
        res.status(403).json({ error: 'Демо-данные может создавать только админ проекта' });
        return false;
    }

    return true;
}

function makeDemoSeedId(value) {
    const raw = String(value || '').trim();
    if (raw) {
        if (!/^[a-zA-Z0-9_-]{3,64}$/.test(raw)) {
            return null;
        }

        return raw;
    }

    return `demo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function hoursAgo(hours) {
    return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

async function deleteByJsonMarker(query, column, seedId) {
    const { error } = await query.filter(`${column}->>demo_seed_id`, 'eq', seedId);
    if (error) throw error;
}

async function cleanupCustomerDemoSeed(supabase, ownerId, seedId) {
    const tariffPrefix = `[DEMO ${seedId}]%`;
    const invoiceMemoPrefix = `demo_${seedId}_%`;

    const { data: demoChannels, error: channelsLookupError } = await supabase
        .from('channels')
        .select('id')
        .eq('owner_id', ownerId)
        .like('title', tariffPrefix);
    if (channelsLookupError) throw channelsLookupError;

    const { data: demoTariffs, error: tariffsLookupError } = await supabase
        .from('tariffs')
        .select('id')
        .eq('owner_id', ownerId)
        .like('title', tariffPrefix);
    if (tariffsLookupError) throw tariffsLookupError;

    const { data: demoBases, error: basesLookupError } = await supabase
        .from('customer_bases')
        .select('id')
        .eq('owner_id', ownerId)
        .eq('description', `demo_seed_id=${seedId}`);
    if (basesLookupError && !(basesLookupError.message || '').includes('customer_bases')) throw basesLookupError;

    const channelIds = (demoChannels || []).map(row => row.id);
    const tariffIds = (demoTariffs || []).map(row => row.id);
    const baseIds = (demoBases || []).map(row => row.id);

    await deleteByJsonMarker(
        supabase.from('customer_funnel_events').delete().eq('owner_id', ownerId),
        'payload',
        seedId
    );
    await deleteByJsonMarker(
        supabase.from('access_events').delete().eq('owner_id', ownerId),
        'payload',
        seedId
    );
    await deleteByJsonMarker(
        supabase.from('payment_events').delete().eq('owner_id', ownerId),
        'payload',
        seedId
    );
    await deleteByJsonMarker(
        supabase.from('referral_events').delete().eq('owner_id', ownerId),
        'payload',
        seedId
    );
    await deleteByJsonMarker(
        supabase.from('access_invites').delete().eq('owner_id', ownerId),
        'meta',
        seedId
    );

    if (baseIds.length > 0) {
        const { error } = await supabase
            .from('customer_base_members')
            .delete()
            .eq('owner_id', ownerId)
            .in('base_id', baseIds);
        if (error) throw error;
    }

    if (channelIds.length > 0) {
        const { error } = await supabase
            .from('subscriptions')
            .delete()
            .in('channel_id', channelIds)
            .ilike('access_note', `%demo_seed_id=${seedId}%`);
        if (error) throw error;
    }

    const { error: invoiceDeleteError } = await supabase
        .from('invoices')
        .delete()
        .like('memo', invoiceMemoPrefix);
    if (invoiceDeleteError) throw invoiceDeleteError;

    if (baseIds.length > 0) {
        const { error } = await supabase
            .from('customer_bases')
            .delete()
            .eq('owner_id', ownerId)
            .in('id', baseIds);
        if (error) throw error;
    }

    if (tariffIds.length > 0) {
        const { error } = await supabase
            .from('tariffs')
            .delete()
            .eq('owner_id', ownerId)
            .in('id', tariffIds);
        if (error) throw error;
    }

    if (channelIds.length > 0) {
        const { error } = await supabase
            .from('channels')
            .delete()
            .eq('owner_id', ownerId)
            .in('id', channelIds);
        if (error) throw error;
    }
}

export default function customersRoutes(supabase) {
    const router = express.Router();

    router.post('/demo-seed', authenticateUser, async (req, res) => {
        if (!requireProjectAdmin(req, res)) return;

        const seedId = makeDemoSeedId(req.body?.seedId);
        if (!seedId) {
            return res.status(400).json({ error: 'seedId должен быть 3-64 символа: буквы, цифры, _ или -' });
        }

        const ownerId = req.user.id;
        const demoTg = {
            viewed: 900000000001,
            pending: 900000000002,
            receipt: 900000000003,
            joined: 900000000004,
            noJoin: 900000000005,
            expiredInside: 900000000006,
            referralBuyer: 900000000007,
            referralPartner: 900000000099
        };
        const demoProfiles = {
            viewed: { username: 'ivan_petrov', first_name: 'Иван', last_name: 'Петров', display_name: 'Иван Петров' },
            joined: { username: 'anna_sokolova', first_name: 'Анна', last_name: 'Соколова', display_name: 'Анна Соколова' },
            noJoin: { username: 'maxim_orlov', first_name: 'Максим', last_name: 'Орлов', display_name: 'Максим Орлов' },
            expiredInside: { username: 'elena_vasileva', first_name: 'Елена', last_name: 'Васильева', display_name: 'Елена Васильева' },
            referralBuyer: { username: 'dmitry_kuznetsov', first_name: 'Дмитрий', last_name: 'Кузнецов', display_name: 'Дмитрий Кузнецов' }
        };

        try {
            await cleanupCustomerDemoSeed(supabase, ownerId, seedId);

            const marker = { demo_seed_id: seedId };
            const { data: channel, error: channelError } = await supabase
                .from('channels')
                .insert({
                    owner_id: ownerId,
                    tg_chat_id: -9000000000000 - Math.floor(Math.random() * 1000000),
                    title: `[DEMO ${seedId}] Канал клиентов`,
                    chat_type: 'channel'
                })
                .select('id, title, tg_chat_id')
                .single();
            if (channelError) throw channelError;

            const { data: base, error: baseError } = await supabase
                .from('customer_bases')
                .insert({
                    owner_id: ownerId,
                    name: `[DEMO ${seedId}] База клиентов`,
                    description: `demo_seed_id=${seedId}`
                })
                .select('id, name')
                .single();
            if (baseError) throw baseError;

            const { data: tariffs, error: tariffsError } = await supabase
                .from('tariffs')
                .insert([
                    {
                        owner_id: ownerId,
                        channel_id: channel.id,
                        title: `[DEMO ${seedId}] Normal`,
                        price: 10,
                        currency: 'TON',
                        duration_days: 30,
                        is_active: true
                    },
                    {
                        owner_id: ownerId,
                        channel_id: channel.id,
                        title: `[DEMO ${seedId}] Пробник`,
                        price: 1,
                        currency: 'TON',
                        duration_days: 3,
                        is_active: true,
                        is_trial: true,
                        trial_label: 'Пробник'
                    },
                    {
                        owner_id: ownerId,
                        channel_id: channel.id,
                        title: `[DEMO ${seedId}] Партнерский`,
                        price: 20,
                        currency: 'TON',
                        duration_days: 30,
                        is_active: true
                    }
                ])
                .select('id, title, price, currency, is_trial, trial_label');
            if (tariffsError) throw tariffsError;

            const normalTariff = tariffs.find(tariff => tariff.title.endsWith('Normal'));
            const trialTariff = tariffs.find(tariff => tariff.is_trial);
            const referralTariff = tariffs.find(tariff => tariff.title.endsWith('Партнерский'));

            const { data: invoices, error: invoicesError } = await supabase
                .from('invoices')
                .insert([
                    {
                        tg_user_id: demoTg.pending,
                        tariff_id: normalTariff.id,
                        channel_id: channel.id,
                        amount: 10,
                        currency: 'TON',
                        memo: `demo_${seedId}_pending`,
                        status: 'pending',
                        created_at: hoursAgo(0.5)
                    },
                    {
                        tg_user_id: demoTg.receipt,
                        tariff_id: normalTariff.id,
                        channel_id: channel.id,
                        amount: 10,
                        currency: 'TON',
                        memo: `demo_${seedId}_receipt`,
                        status: 'awaiting_receipt',
                        created_at: hoursAgo(4)
                    },
                    {
                        tg_user_id: demoTg.joined,
                        tariff_id: normalTariff.id,
                        channel_id: channel.id,
                        amount: 10,
                        currency: 'TON',
                        memo: `demo_${seedId}_joined`,
                        status: 'paid',
                        created_at: hoursAgo(28),
                        paid_at: hoursAgo(27)
                    },
                    {
                        tg_user_id: demoTg.noJoin,
                        tariff_id: normalTariff.id,
                        channel_id: channel.id,
                        amount: 10,
                        currency: 'TON',
                        memo: `demo_${seedId}_no_join`,
                        status: 'paid',
                        created_at: hoursAgo(18),
                        paid_at: hoursAgo(17)
                    },
                    {
                        tg_user_id: demoTg.referralBuyer,
                        tariff_id: referralTariff.id,
                        channel_id: channel.id,
                        amount: 18,
                        currency: 'TON',
                        memo: `demo_${seedId}_referral`,
                        status: 'paid',
                        created_at: hoursAgo(8),
                        paid_at: hoursAgo(7)
                    }
                ])
                .select('*');
            if (invoicesError) throw invoicesError;

            const invoiceByMemo = new Map(invoices.map(invoice => [invoice.memo, invoice]));
            const joinedInvoice = invoiceByMemo.get(`demo_${seedId}_joined`);
            const noJoinInvoice = invoiceByMemo.get(`demo_${seedId}_no_join`);
            const referralInvoice = invoiceByMemo.get(`demo_${seedId}_referral`);

            const { data: subscriptions, error: subscriptionsError } = await supabase
                .from('subscriptions')
                .insert([
                    {
                        channel_id: channel.id,
                        tg_user_id: demoTg.joined,
                        tg_username: demoProfiles.joined.username,
                        status: 'active',
                        expires_at: hoursAgo(-20 * 24),
                        last_join_approved_at: hoursAgo(26),
                        last_access_event: 'join_approved',
                        access_note: `demo_seed_id=${seedId}; paid_and_joined`
                    },
                    {
                        channel_id: channel.id,
                        tg_user_id: demoTg.noJoin,
                        tg_username: demoProfiles.noJoin.username,
                        status: 'active',
                        expires_at: hoursAgo(-20 * 24),
                        last_access_event: 'invite_issued',
                        access_note: `demo_seed_id=${seedId}; join_not_confirmed`
                    },
                    {
                        channel_id: channel.id,
                        tg_user_id: demoTg.expiredInside,
                        tg_username: demoProfiles.expiredInside.username,
                        status: 'expired',
                        expires_at: hoursAgo(12),
                        last_join_approved_at: hoursAgo(35 * 24),
                        last_access_event: 'join_approved',
                        access_note: `demo_seed_id=${seedId}; expired_but_present`
                    },
                    {
                        channel_id: channel.id,
                        tg_user_id: demoTg.referralBuyer,
                        tg_username: demoProfiles.referralBuyer.username,
                        status: 'active',
                        expires_at: hoursAgo(-20 * 24),
                        last_join_approved_at: hoursAgo(6),
                        last_access_event: 'join_approved',
                        access_note: `demo_seed_id=${seedId}; referral_order`
                    }
                ])
                .select('id, tg_user_id');
            if (subscriptionsError) throw subscriptionsError;

            const subscriptionByTg = new Map(subscriptions.map(sub => [String(sub.tg_user_id), sub]));

            const inviteRows = [
                {
                    owner_id: ownerId,
                    channel_id: channel.id,
                    tariff_id: normalTariff.id,
                    invoice_id: joinedInvoice.id,
                    subscription_id: subscriptionByTg.get(String(demoTg.joined))?.id || null,
                    tg_user_id: String(demoTg.joined),
                    invite_link: `https://t.me/+demo-${seedId}-joined`,
                    invite_name: `[DEMO ${seedId}] joined`,
                    status: 'used',
                    issued_at: hoursAgo(27),
                    used_at: hoursAgo(26),
                    expires_at: hoursAgo(-24),
                    meta: marker
                },
                {
                    owner_id: ownerId,
                    channel_id: channel.id,
                    tariff_id: normalTariff.id,
                    invoice_id: noJoinInvoice.id,
                    subscription_id: subscriptionByTg.get(String(demoTg.noJoin))?.id || null,
                    tg_user_id: String(demoTg.noJoin),
                    invite_link: `https://t.me/+demo-${seedId}-no-join`,
                    invite_name: `[DEMO ${seedId}] no join`,
                    status: 'issued',
                    issued_at: hoursAgo(17),
                    expires_at: hoursAgo(-24),
                    meta: marker
                },
                {
                    owner_id: ownerId,
                    channel_id: channel.id,
                    tariff_id: referralTariff.id,
                    invoice_id: referralInvoice.id,
                    subscription_id: subscriptionByTg.get(String(demoTg.referralBuyer))?.id || null,
                    tg_user_id: String(demoTg.referralBuyer),
                    invite_link: `https://t.me/+demo-${seedId}-referral`,
                    invite_name: `[DEMO ${seedId}] referral`,
                    status: 'used',
                    issued_at: hoursAgo(7),
                    used_at: hoursAgo(6),
                    expires_at: hoursAgo(-24),
                    meta: marker
                }
            ];
            const { error: invitesError } = await supabase.from('access_invites').insert(inviteRows);
            if (invitesError) throw invitesError;

            const accessRows = [
                {
                    owner_id: ownerId,
                    channel_id: channel.id,
                    subscription_id: subscriptionByTg.get(String(demoTg.joined))?.id || null,
                    invoice_id: joinedInvoice.id,
                    tg_user_id: String(demoTg.joined),
                    event_type: 'join_approved',
                    event_source: 'demo_seed',
                    payload: marker,
                    created_at: hoursAgo(26)
                },
                {
                    owner_id: ownerId,
                    channel_id: channel.id,
                    subscription_id: subscriptionByTg.get(String(demoTg.noJoin))?.id || null,
                    invoice_id: noJoinInvoice.id,
                    tg_user_id: String(demoTg.noJoin),
                    event_type: 'invite_issued',
                    event_source: 'demo_seed',
                    payload: marker,
                    created_at: hoursAgo(17)
                },
                {
                    owner_id: ownerId,
                    channel_id: channel.id,
                    subscription_id: subscriptionByTg.get(String(demoTg.referralBuyer))?.id || null,
                    invoice_id: referralInvoice.id,
                    tg_user_id: String(demoTg.referralBuyer),
                    event_type: 'join_approved',
                    event_source: 'demo_seed',
                    payload: marker,
                    created_at: hoursAgo(6)
                }
            ];
            const { error: accessEventsError } = await supabase.from('access_events').insert(accessRows);
            if (accessEventsError) throw accessEventsError;

            const baseMemberRows = [
                [demoTg.viewed, demoProfiles.viewed, true],
                [demoTg.joined, demoProfiles.joined, true],
                [demoTg.noJoin, demoProfiles.noJoin, false],
                [demoTg.expiredInside, demoProfiles.expiredInside, true],
                [demoTg.referralBuyer, demoProfiles.referralBuyer, true]
            ].map(([tgUserId, profile, presentNow]) => ({
                owner_id: ownerId,
                base_id: base.id,
                tg_user_id: String(tgUserId),
                username: profile.username,
                display_name: profile.display_name,
                first_name: profile.first_name,
                last_name: profile.last_name,
                is_bot: false,
                source_channel_ids: [channel.id],
                channels_count: 1,
                present_now: presentNow,
                last_seen_at: hoursAgo(1)
            }));
            const { error: baseMembersError } = await supabase.from('customer_base_members').insert(baseMemberRows);
            if (baseMembersError) throw baseMembersError;

            const { error: funnelError } = await supabase.from('customer_funnel_events').insert([
                {
                    owner_id: ownerId,
                    tg_user_id: String(demoTg.viewed),
                    tariff_id: trialTariff.id,
                    event_type: 'tariff_list_opened',
                    source: 'demo_seed',
                    session_key: `demo:${seedId}:${demoTg.viewed}:list`,
                    payload: { ...marker, label: 'opened_list', ...demoProfiles.viewed },
                    created_at: hoursAgo(2)
                },
                {
                    owner_id: ownerId,
                    tg_user_id: String(demoTg.viewed),
                    tariff_id: normalTariff.id,
                    event_type: 'tariff_card_opened',
                    source: 'demo_seed',
                    session_key: `demo:${seedId}:${demoTg.viewed}:card`,
                    payload: { ...marker, label: 'opened_card', ...demoProfiles.viewed },
                    created_at: hoursAgo(1.5)
                },
                {
                    owner_id: ownerId,
                    tg_user_id: String(demoTg.viewed),
                    tariff_id: normalTariff.id,
                    event_type: 'payment_method_selected',
                    source: 'demo_seed',
                    session_key: `demo:${seedId}:${demoTg.viewed}:method`,
                    payload: { ...marker, label: 'selected_method', ...demoProfiles.viewed },
                    created_at: hoursAgo(1)
                }
            ]);
            if (funnelError) throw funnelError;

            const paymentRows = invoices.map(invoice => ({
                owner_id: ownerId,
                invoice_id: invoice.id,
                provider: 'demo',
                external_payment_id: `demo:${seedId}:${invoice.id}`,
                event_type: invoice.status === 'paid' ? 'payment_confirmed' : 'invoice_created',
                status: invoice.status,
                payload: {
                    ...marker,
                    original_amount: invoice.memo === `demo_${seedId}_referral` ? 20 : Number(invoice.amount),
                    referral_code: invoice.memo === `demo_${seedId}_referral` ? `demo-ref-${seedId}` : null,
                    referral_discount_percent: invoice.memo === `demo_${seedId}_referral` ? 10 : 0,
                    referral_discount_amount: invoice.memo === `demo_${seedId}_referral` ? 2 : 0
                },
                created_at: invoice.status === 'paid' ? invoice.paid_at : invoice.created_at
            }));
            const { error: paymentEventsError } = await supabase.from('payment_events').insert(paymentRows);
            if (paymentEventsError) throw paymentEventsError;

            const { error: referralError } = await supabase.from('referral_events').insert({
                owner_id: ownerId,
                referrer_tg_user_id: String(demoTg.referralPartner),
                referred_tg_user_id: String(demoTg.referralBuyer),
                invoice_id: referralInvoice.id,
                tariff_id: referralTariff.id,
                event_type: 'reward_granted',
                status: 'completed',
                reward_amount: 4,
                reward_currency: 'TON',
                reward_ton_amount: 4,
                client_discount_percent: 10,
                client_discount_original_amount: 2,
                sale_original_amount: 20,
                sale_original_currency: 'TON',
                reserve_coverage_status: 'covered',
                payload: marker
            });
            if (referralError) throw referralError;

            res.json({
                success: true,
                seedId,
                created: {
                    channels: 1,
                    tariffs: tariffs.length,
                    invoices: invoices.length,
                    subscriptions: subscriptions.length,
                    accessInvites: inviteRows.length,
                    accessEvents: accessRows.length,
                    baseMembers: baseMemberRows.length,
                    funnelEvents: 3,
                    paymentEvents: paymentRows.length,
                    referralEvents: 1
                },
                tgUserIds: demoTg
            });
        } catch (error) {
            console.error('Ошибка создания demo customers seed:', error);
            res.status(500).json({ error: 'Не удалось создать демо-данные клиентов' });
        }
    });

    router.delete('/demo-seed/:seedId', authenticateUser, async (req, res) => {
        if (!requireProjectAdmin(req, res)) return;

        const seedId = makeDemoSeedId(req.params.seedId);
        if (!seedId) {
            return res.status(400).json({ error: 'Некорректный seedId' });
        }

        try {
            await cleanupCustomerDemoSeed(supabase, req.user.id, seedId);
            res.json({ success: true, seedId });
        } catch (error) {
            console.error('Ошибка удаления demo customers seed:', error);
            res.status(500).json({ error: 'Не удалось удалить демо-данные клиентов' });
        }
    });

    router.get('/workbench', authenticateUser, async (req, res) => {
        try {
            const ownerId = req.user.id;
            const selectedBotId = normalizeUuidLike(req.query.bot_id);

            const [
                botsResp,
                channelsResp,
                tariffsResp,
                basesResp,
                baseMembersResp,
                funnelResp
            ] = await Promise.all([
                supabase
                    .from('tg_accounts')
                    .select('id, tg_username, tg_account_id, bot_role, runtime_status, created_at')
                    .eq('owner_id', ownerId)
                    .eq('account_type', 'bot')
                    .order('created_at', { ascending: false }),
                supabase
                    .from('channels')
                    .select('id, title, tg_chat_id, bot_id')
                    .eq('owner_id', ownerId)
                    .order('created_at', { ascending: false }),
                supabase
                    .from('tariffs')
                    .select('id, title, owner_id, channel_id, is_trial, trial_label')
                    .eq('owner_id', ownerId)
                    .order('created_at', { ascending: false }),
                supabase
                    .from('customer_bases')
                    .select('id, name, description, created_at, updated_at')
                    .eq('owner_id', ownerId)
                    .order('created_at', { ascending: false }),
                supabase
                    .from('customer_base_members')
                    .select('base_id, tg_user_id, username, display_name, first_name, last_name, last_seen_at, present_now, is_bot, source_channel_ids')
                    .eq('owner_id', ownerId),
                supabase
                    .from('customer_funnel_events')
                    .select('id, owner_id, bot_id, tg_user_id, tariff_id, event_type, source, referral_code, session_key, payload, created_at')
                    .eq('owner_id', ownerId)
                    .order('created_at', { ascending: false })
                    .limit(150)
            ]);

            if (botsResp.error) throw botsResp.error;
            if (channelsResp.error) throw channelsResp.error;
            if (tariffsResp.error) throw tariffsResp.error;
            if (basesResp.error && !(basesResp.error.message || '').includes('customer_bases')) throw basesResp.error;
            if (baseMembersResp.error && !(baseMembersResp.error.message || '').includes('customer_base_members')) throw baseMembersResp.error;

            const allBots = botsResp.data || [];
            const allChannels = channelsResp.data || [];
            const allTariffs = tariffsResp.data || [];
            const allFunnelEvents = funnelResp.error ? [] : (funnelResp.data || []);

            const orphanBotIds = new Set([
                ...allChannels.map(channel => channel.bot_id).filter(Boolean),
                ...allFunnelEvents.map(event => event.bot_id).filter(Boolean)
            ]);
            for (const bot of allBots) {
                orphanBotIds.delete(bot.id);
            }

            const botOptions = [
                ...allBots.map(bot => ({
                    id: bot.id,
                    label: bot.tg_username ? `@${bot.tg_username}` : `ID ${bot.tg_account_id || bot.id}`,
                    tg_username: bot.tg_username || null,
                    tg_account_id: bot.tg_account_id || null,
                    bot_role: bot.bot_role || 'sales',
                    status: 'active',
                    runtime_status: bot.runtime_status || null
                })),
                ...Array.from(orphanBotIds).map(botId => ({
                    id: botId,
                    label: `Удаленный бот ${String(botId).slice(0, 8)}`,
                    tg_username: null,
                    tg_account_id: null,
                    bot_role: 'sales',
                    status: 'deleted',
                    runtime_status: 'deleted'
                }))
            ];

            const channels = selectedBotId
                ? allChannels.filter(channel => String(channel.bot_id || '') === selectedBotId)
                : allChannels;
            const channelIds = channels.map(channel => channel.id);
            const tariffs = allTariffs.filter(tariff => channelIds.includes(tariff.channel_id));
            const tariffIds = tariffs.map(tariff => tariff.id);
            const channelMap = new Map(channels.map(channel => [channel.id, channel]));
            const tariffMap = new Map(tariffs.map(tariff => [tariff.id, tariff]));

            const [
                invoicesResp,
                subscriptionsResp,
                invitesResp,
                accessEventsResp,
                paymentEventsResp,
                referralEventsResp
            ] = await Promise.all([
                tariffIds.length > 0
                    ? supabase
                        .from('invoices')
                        .select('*')
                        .in('tariff_id', tariffIds)
                        .order('created_at', { ascending: false })
                        .limit(250)
                    : emptyListResult(),
                channelIds.length > 0
                    ? supabase
                        .from('subscriptions')
                        .select('id, tg_user_id, tg_username, channel_id, status, expires_at, last_join_request_at, last_join_approved_at, last_access_event, access_note, created_at')
                        .in('channel_id', channelIds)
                        .order('created_at', { ascending: false })
                        .limit(1000)
                    : emptyListResult(),
                supabase
                    .from('access_invites')
                    .select('*')
                    .eq('owner_id', ownerId)
                    .order('issued_at', { ascending: false })
                    .limit(150),
                supabase
                    .from('access_events')
                    .select('*')
                    .eq('owner_id', ownerId)
                    .order('created_at', { ascending: false })
                    .limit(250),
                supabase
                    .from('payment_events')
                    .select('*')
                    .eq('owner_id', ownerId)
                    .order('created_at', { ascending: false })
                    .limit(300),
                supabase
                    .from('referral_events')
                    .select('id, invoice_id, referrer_tg_user_id, referred_tg_user_id, event_type, status, reward_amount, reward_currency, reward_ton_amount, client_discount_percent, client_discount_original_amount, sale_original_amount, sale_original_currency, reserve_coverage_status, created_at')
                    .eq('owner_id', ownerId)
                    .order('created_at', { ascending: false })
                    .limit(200)
            ]);

            if (invoicesResp.error) throw invoicesResp.error;
            if (subscriptionsResp.error) throw subscriptionsResp.error;
            if (invitesResp.error && !(invitesResp.error.message || '').includes('access_invites')) throw invitesResp.error;
            if (accessEventsResp.error && !(accessEventsResp.error.message || '').includes('access_events')) throw accessEventsResp.error;
            if (paymentEventsResp.error && !(paymentEventsResp.error.message || '').includes('payment_events')) throw paymentEventsResp.error;
            if (referralEventsResp.error && !(referralEventsResp.error.message || '').includes('referral_events')) throw referralEventsResp.error;

            const invoices = invoicesResp.data || [];
            const subscriptions = subscriptionsResp.data || [];
            const invites = invitesResp.data || [];
            const accessEvents = accessEventsResp.data || [];
            const paymentEvents = paymentEventsResp.data || [];
            const referralEvents = referralEventsResp.data || [];
            const baseMembers = baseMembersResp.data || [];

            const presentByUserChannel = new Set();
            for (const member of baseMembers) {
                if (!member.present_now || !member.tg_user_id) continue;
                const sourceChannelIds = Array.isArray(member.source_channel_ids) ? member.source_channel_ids : [];
                for (const channelId of sourceChannelIds) {
                    if (channelId) {
                        presentByUserChannel.add(`${member.tg_user_id}:${channelId}`);
                    }
                }
            }

            const latestPaymentByInvoice = latestBy(paymentEvents, event => event.invoice_id);
            const invoiceCreatedByInvoice = latestBy(
                paymentEvents.filter(event => event.event_type === 'invoice_created'),
                event => event.invoice_id
            );
            const latestInviteByInvoice = latestBy(invites, invite => invite.invoice_id, 'issued_at');
            const latestAccessEventByInvoice = latestBy(accessEvents, event => event.invoice_id);
            const referralRewardByInvoice = latestBy(
                referralEvents.filter(event => event.event_type === 'reward_granted'),
                event => event.invoice_id
            );
            const subscriptionByUserChannel = latestBy(
                subscriptions,
                sub => `${sub.tg_user_id}:${sub.channel_id}`
            );
            const latestBaseProfileByUser = latestBy(
                baseMembers.filter(member => member.tg_user_id),
                member => String(member.tg_user_id),
                'last_seen_at'
            );
            const latestFunnelProfileByUser = latestBy(
                allFunnelEvents.filter(event => event.tg_user_id),
                event => String(event.tg_user_id)
            );

            function getPersonProfile(tgUserId, fallbackUsername = null) {
                const baseProfile = latestBaseProfileByUser.get(String(tgUserId)) || null;
                const funnelProfile = buildFunnelPersonProfile(latestFunnelProfileByUser.get(String(tgUserId)) || null);
                const displayName = buildPersonDisplayName({
                    first_name: baseProfile?.first_name || funnelProfile.first_name,
                    last_name: baseProfile?.last_name || funnelProfile.last_name,
                    display_name: baseProfile?.display_name || funnelProfile.display_name
                });

                return {
                    tg_username: fallbackUsername || baseProfile?.username || funnelProfile.username || null,
                    display_name: displayName,
                    first_name: baseProfile?.first_name || funnelProfile.first_name || null,
                    last_name: baseProfile?.last_name || funnelProfile.last_name || null
                };
            }

            const recentOrders = invoices.map(invoice => {
                const tariff = tariffMap.get(invoice.tariff_id) || null;
                const channel = channelMap.get(tariff?.channel_id) || null;
                const subscription = subscriptionByUserChannel.get(`${invoice.tg_user_id}:${tariff?.channel_id}`) || null;
                const paymentEvent = latestPaymentByInvoice.get(invoice.id) || null;
                const invoiceCreatedEvent = invoiceCreatedByInvoice.get(invoice.id) || null;
                const invite = latestInviteByInvoice.get(invoice.id) || null;
                const accessEvent = latestAccessEventByInvoice.get(invoice.id) || null;
                const referralReward = referralRewardByInvoice.get(invoice.id) || null;
                const invoicePayload = invoiceCreatedEvent?.payload || {};
                const referralDiscountPercent = Number(invoicePayload.referral_discount_percent || referralReward?.client_discount_percent || 0);
                const presenceConfirmed = presentByUserChannel.has(`${invoice.tg_user_id}:${tariff?.channel_id}`);
                const joined = !!subscription?.last_join_approved_at || presenceConfirmed;
                const person = getPersonProfile(invoice.tg_user_id, subscription?.tg_username || null);

                let problemReason = 'Все выглядит ровно';
                if (invoice.status === 'awaiting_receipt') problemReason = 'Клиент нажал “я оплатил”, но чек еще не загружен';
                else if (invoice.status === 'wait_admin') problemReason = 'Чек загружен, но админ еще не подтвердил';
                else if (invoice.status === 'rejected') problemReason = 'Оплата отклонена вручную';
                else if (invoice.status === 'paid' && invite?.status === 'issued' && !joined) problemReason = 'Оплата есть, ссылка выдана, но Telegram-вход не подтвержден';
                else if (invoice.status === 'paid' && !invite && !accessEvent) problemReason = 'Оплата есть, но по доступу нет движения';
                else if (invoice.status === 'pending') problemReason = 'Счет создан, оплаты пока нет';

                return {
                    id: invoice.id,
                    created_at: invoice.created_at,
                    tg_user_id: String(invoice.tg_user_id),
                    tg_username: person.tg_username,
                    display_name: person.display_name,
                    first_name: person.first_name,
                    last_name: person.last_name,
                    channel_id: tariff?.channel_id || null,
                    subscription_id: subscription?.id || null,
                    amount: invoice.amount,
                    currency: invoice.currency,
                    invoice_status: invoice.status,
                    tariff_title: tariff?.title || 'Неизвестный тариф',
                    tariff_id: invoice.tariff_id,
                    is_trial: !!tariff?.is_trial,
                    trial_label: tariff?.trial_label || null,
                    channel_title: channel?.title || 'Неизвестный канал',
                    payment_event_type: paymentEvent?.event_type || null,
                    payment_event_status: paymentEvent?.status || null,
                    referral_discount_percent: referralDiscountPercent,
                    referral_discount_amount: Number(invoicePayload.referral_discount_amount || referralReward?.client_discount_original_amount || 0),
                    referral_original_amount: Number(invoicePayload.original_amount || referralReward?.sale_original_amount || 0),
                    referral_code: invoicePayload.referral_code || null,
                    referral_reward_status: referralReward?.status || null,
                    referral_reward_ton: referralReward ? Number(referralReward.reward_ton_amount || referralReward.reward_amount || 0) : 0,
                    referral_reward_currency: referralReward?.reward_currency || null,
                    referral_referrer_tg_user_id: referralReward?.referrer_tg_user_id || null,
                    referral_reserve_coverage_status: referralReward?.reserve_coverage_status || null,
                    access_invite_status: invite?.status || null,
                    last_access_event: accessEvent?.event_type || subscription?.last_access_event || null,
                    subscription_status: subscription?.status || null,
                    joined,
                    presence_confirmed: presenceConfirmed,
                    expires_at: subscription?.expires_at || null,
                    problem_reason: problemReason
                };
            });

            const activeCustomers = subscriptions
                .filter(sub => sub.status === 'active')
                .map(sub => {
                    const person = getPersonProfile(sub.tg_user_id, sub.tg_username || null);
                    return {
                    ...sub,
                    tg_username: person.tg_username,
                    display_name: person.display_name,
                    first_name: person.first_name,
                    last_name: person.last_name,
                    in_group: !!sub.last_join_approved_at || presentByUserChannel.has(`${sub.tg_user_id}:${sub.channel_id}`),
                    presence_confirmed: presentByUserChannel.has(`${sub.tg_user_id}:${sub.channel_id}`),
                    channel_title: channelMap.get(sub.channel_id)?.title || 'Неизвестный канал'
                };});

            const expiredCustomers = subscriptions
                .filter(sub => sub.status === 'expired')
                .map(sub => {
                    const person = getPersonProfile(sub.tg_user_id, sub.tg_username || null);
                    return {
                    ...sub,
                    tg_username: person.tg_username,
                    display_name: person.display_name,
                    first_name: person.first_name,
                    last_name: person.last_name,
                    in_group: !!sub.last_join_approved_at || presentByUserChannel.has(`${sub.tg_user_id}:${sub.channel_id}`),
                    presence_confirmed: presentByUserChannel.has(`${sub.tg_user_id}:${sub.channel_id}`),
                    channel_title: channelMap.get(sub.channel_id)?.title || 'Неизвестный канал'
                };});

            const inGroupLeaks = subscriptions
                .filter(sub => sub.status === 'expired' && sub.last_access_event !== 'kicked')
                .map(sub => {
                    const person = getPersonProfile(sub.tg_user_id, sub.tg_username || null);
                    return {
                    ...sub,
                    tg_username: person.tg_username,
                    display_name: person.display_name,
                    first_name: person.first_name,
                    last_name: person.last_name,
                    in_group: !!sub.last_join_approved_at || presentByUserChannel.has(`${sub.tg_user_id}:${sub.channel_id}`),
                    presence_confirmed: presentByUserChannel.has(`${sub.tg_user_id}:${sub.channel_id}`),
                    channel_title: channelMap.get(sub.channel_id)?.title || 'Неизвестный канал'
                };});

            const needsAccessCheck = subscriptions
                .filter(sub => sub.status === 'active' && !sub.last_join_approved_at && !presentByUserChannel.has(`${sub.tg_user_id}:${sub.channel_id}`))
                .map(sub => {
                    const person = getPersonProfile(sub.tg_user_id, sub.tg_username || null);
                    return {
                    ...sub,
                    tg_username: person.tg_username,
                    display_name: person.display_name,
                    first_name: person.first_name,
                    last_name: person.last_name,
                    in_group: false,
                    presence_confirmed: false,
                    channel_title: channelMap.get(sub.channel_id)?.title || 'Неизвестный канал'
                };});

            const abandonedInvoices = recentOrders
                .filter(order => order.invoice_status === 'pending' || order.invoice_status === 'awaiting_receipt')
                .map(order => ({
                    ...order,
                    abandoned_status: getAbandonedStatus(order),
                    status: order.invoice_status,
                    tariffs: {
                        id: order.tariff_id,
                        title: order.tariff_title,
                        is_trial: order.is_trial,
                        trial_label: order.trial_label
                    }
                }));

            const scopedFunnelEvents = selectedBotId
                ? allFunnelEvents.filter(event => String(event.bot_id || '') === selectedBotId)
                : allFunnelEvents;

            const viewedEvents = scopedFunnelEvents.map(event => ({
                    ...event,
                    tariff_title: tariffMap.get(event.tariff_id)?.title || null,
                    channel_id: tariffMap.get(event.tariff_id)?.channel_id || null,
                    channel_title: channelMap.get(tariffMap.get(event.tariff_id)?.channel_id)?.title || null
                }));

            const viewedTariffs = viewedEvents.filter(event =>
                ['tariff_list_opened', 'tariff_card_opened', 'payment_method_selected'].includes(event.event_type) &&
                !invoices.some(invoice => {
                    if (String(invoice.tg_user_id) !== String(event.tg_user_id)) return false;
                    if (event.tariff_id && String(invoice.tariff_id) !== String(event.tariff_id)) return false;
                    return new Date(invoice.created_at).getTime() >= new Date(event.created_at).getTime();
                })
            ).map(event => {
                const person = getPersonProfile(event.tg_user_id, null);
                return {
                    ...event,
                    tg_username: person.tg_username,
                    display_name: person.display_name,
                    first_name: person.first_name,
                    last_name: person.last_name
                };
            });

            const startedContacts = viewedEvents
                .filter(event => event.event_type === 'bot_started')
                .reduce((acc, event) => {
                    const existing = acc.get(String(event.tg_user_id));
                    const eventTime = new Date(event.created_at || 0).getTime();
                    const existingTime = new Date(existing?.created_at || 0).getTime();
                    if (!existing || eventTime < existingTime) {
                        const person = getPersonProfile(event.tg_user_id, null);
                        acc.set(String(event.tg_user_id), {
                            ...event,
                            tg_username: person.tg_username,
                            display_name: person.display_name,
                            first_name: person.first_name,
                            last_name: person.last_name,
                            status: 'Нажал /start',
                            reason: event.payload?.start_payload ? `Payload: ${event.payload.start_payload}` : 'Первое касание с ботом'
                        });
                    }
                    return acc;
                }, new Map());

            const baseStatsById = new Map();
            for (const member of baseMembers) {
                if (!baseStatsById.has(member.base_id)) {
                    baseStatsById.set(member.base_id, { total: 0, humans: 0, bots: 0, present: 0 });
                }
                const stats = baseStatsById.get(member.base_id);
                stats.total += 1;
                if (member.is_bot) stats.bots += 1;
                else stats.humans += 1;
                if (member.present_now) stats.present += 1;
            }

            const bases = (basesResp.data || []).map(base => ({
                ...base,
                stats: baseStatsById.get(base.id) || { total: 0, humans: 0, bots: 0, present: 0 }
            }));

            const segments = {
                startedContacts: Array.from(startedContacts.values()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
                viewedTariffs,
                abandonedInvoices,
                activeCustomers,
                expiredCustomers,
                inGroupLeaks,
                needsAccessCheck,
                recentOrders,
                bases
            };

            res.json({
                success: true,
                updatedAt: new Date().toISOString(),
                selectedBotId,
                bots: botOptions,
                summary: {
                    startedContacts: startedContacts.size,
                    viewedTariffs: viewedTariffs.length,
                    abandonedInvoices: abandonedInvoices.length,
                    activeCustomers: activeCustomers.length,
                    expiredCustomers: expiredCustomers.length,
                    inGroupLeaks: inGroupLeaks.length,
                    needsAccessCheck: needsAccessCheck.length,
                    recentOrders: recentOrders.length,
                    bases: bases.length
                },
                segments,
                channels
            });
        } catch (error) {
            console.error('Ошибка customers workbench:', error);
            res.status(500).json({ error: 'Ошибка загрузки клиентов' });
        }
    });

    return router;
}
