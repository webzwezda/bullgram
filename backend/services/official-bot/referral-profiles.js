// Профили партнерки: referral_profiles, способы выплат, лиды/атрибуции, снапшоты,
// настройки и скидка follow-up — вынесено дословно из official-bot.service.js;
// this.supabase -> параметр supabase, notify-вызовы переведены на импорт функций.

import { getReferralEconomics } from '../referral-reserve.service.js';
import { notifyReferralLeadCreated } from './referral-notify.js';

export function generateReferralCode(tgUserId) {
    return `r${String(tgUserId)}${Math.random().toString(36).slice(2, 8)}`.toLowerCase();
}

export async function getReferralSettings(supabase, ownerId) {
    try {
        const { data, error } = await supabase
            .from('payment_settings')
            .select('referral_enabled, referral_reward_percent, referral_client_discount_percent, referral_welcome_text, admin_tg_id')
            .eq('owner_id', ownerId)
            .maybeSingle();

        if (error) {
            if ((error.message || '').includes('referral_')) {
                return { referral_enabled: false, referral_reward_percent: 20, referral_welcome_text: '' };
            }
            throw error;
        }

        return {
            referral_enabled: !!data?.referral_enabled,
            referral_reward_percent: Number(data?.referral_reward_percent ?? 20),
            referral_client_discount_percent: Number(data?.referral_client_discount_percent ?? getReferralEconomics().clientDiscountPercent),
            referral_welcome_text: data?.referral_welcome_text || '',
            admin_tg_id: data?.admin_tg_id ? String(data.admin_tg_id) : ''
        };
    } catch (error) {
        if ((error.message || '').includes('referral_')) {
            return { referral_enabled: false, referral_reward_percent: 20, referral_welcome_text: '', admin_tg_id: '' };
        }
        throw error;
    }
}

export async function ensureReferralProfile(supabase, ownerId, tgUserId, username = null, displayName = null) {
    try {
        const { data: existing, error: existingError } = await supabase
            .from('referral_profiles')
            .select('*')
            .eq('owner_id', ownerId)
            .eq('tg_user_id', String(tgUserId))
            .maybeSingle();

        if (existingError) {
            if ((existingError.message || '').includes('referral_profiles')) return null;
            throw existingError;
        }

        if (existing) {
            const nextUsername = username || existing.username || null;
            const nextDisplayName = displayName || existing.display_name || null;

            if (nextUsername !== existing.username || nextDisplayName !== existing.display_name) {
                await supabase
                    .from('referral_profiles')
                    .update({
                        username: nextUsername,
                        display_name: nextDisplayName
                    })
                    .eq('id', existing.id);
            }

            return {
                ...existing,
                username: nextUsername,
                display_name: nextDisplayName
            };
        }

        const { data: created, error: createError } = await supabase
            .from('referral_profiles')
            .insert({
                owner_id: ownerId,
                tg_user_id: String(tgUserId),
                username: username || null,
                display_name: displayName || null,
                referral_code: generateReferralCode(tgUserId)
            })
            .select()
            .single();

        if (createError) {
            if ((createError.message || '').includes('referral_profiles')) return null;
            throw createError;
        }

        return created;
    } catch (error) {
        if ((error.message || '').includes('referral_profiles')) return null;
        throw error;
    }
}

export async function getReferralProfile(supabase, ownerId, tgUserId) {
    try {
        const { data, error } = await supabase
            .from('referral_profiles')
            .select('*')
            .eq('owner_id', ownerId)
            .eq('tg_user_id', String(tgUserId))
            .maybeSingle();

        if (error) {
            if ((error.message || '').includes('referral_profiles')) return null;
            throw error;
        }

        return data || null;
    } catch (error) {
        if ((error.message || '').includes('referral_profiles')) return null;
        throw error;
    }
}

export async function getReferralPayoutMethod(supabase, ownerId, tgUserId) {
    try {
        const { data, error } = await supabase
            .from('referral_partner_payout_methods')
            .select('*')
            .eq('owner_id', ownerId)
            .eq('tg_user_id', String(tgUserId))
            .maybeSingle();

        if (error) {
            if ((error.message || '').includes('referral_partner_payout_methods')) return null;
            throw error;
        }

        return data || null;
    } catch (error) {
        if ((error.message || '').includes('referral_partner_payout_methods')) return null;
        throw error;
    }
}

export async function getPendingReferralPayout(supabase, ownerId, tgUserId) {
    try {
        const { data, error } = await supabase
            .from('referral_partner_payouts')
            .select('*')
            .eq('owner_id', ownerId)
            .eq('tg_user_id', String(tgUserId))
            .in('status', ['requested', 'queued', 'sending'])
            .order('requested_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) {
            if ((error.message || '').includes('referral_partner_payouts')) return null;
            throw error;
        }

        return data || null;
    } catch (error) {
        if ((error.message || '').includes('referral_partner_payouts')) return null;
        throw error;
    }
}

export async function registerReferralLead(activeBots, supabase, {
    ownerId,
    referralCode,
    referredTgUserId,
    referredUsername = null,
    referredDisplayName = null,
    rewardPercent = 20,
    clientDiscountPercent = 10,
    discountEligible = true,
    reserveStatus = 'active'
}) {
    try {
        const normalizedCode = String(referralCode || '').trim().toLowerCase();
        if (!normalizedCode) return null;

        const { data: referrer, error: referrerError } = await supabase
            .from('referral_profiles')
            .select('*')
            .eq('owner_id', ownerId)
            .eq('referral_code', normalizedCode)
            .maybeSingle();

        if (referrerError) {
            if ((referrerError.message || '').includes('referral_profiles')) return null;
            throw referrerError;
        }

        if (!referrer) return null;
        if (String(referrer.tg_user_id) === String(referredTgUserId)) return null;

        const { data: existing, error: existingError } = await supabase
            .from('referral_attributions')
            .select('*')
            .eq('owner_id', ownerId)
            .eq('referred_tg_user_id', String(referredTgUserId))
            .maybeSingle();

        if (existingError) {
            if ((existingError.message || '').includes('referral_attributions')) return null;
            throw existingError;
        }

        if (existing?.referrer_tg_user_id && String(existing.referrer_tg_user_id) !== String(referrer.tg_user_id)) {
            return existing;
        }

        const nowIso = new Date().toISOString();
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        const { data: attribution, error: upsertError } = await supabase
            .from('referral_attributions')
            .upsert({
                owner_id: ownerId,
                referrer_tg_user_id: String(referrer.tg_user_id),
                referred_tg_user_id: String(referredTgUserId),
                referral_code: normalizedCode,
                referred_username: referredUsername || null,
                referred_display_name: referredDisplayName || null,
                first_seen_at: existing?.first_seen_at || nowIso,
                last_seen_at: nowIso,
                expires_at: existing?.expires_at || expiresAt,
                reward_percent_snapshot: existing?.reward_percent_snapshot ?? Number(rewardPercent || 0),
                client_discount_percent_snapshot: existing?.client_discount_percent_snapshot ?? Number(clientDiscountPercent || 0),
                terms_status: existing?.terms_status || 'active',
                discount_eligible: existing?.discount_eligible ?? !!discountEligible,
                reserve_status_snapshot: existing?.reserve_status_snapshot || reserveStatus
            }, { onConflict: 'owner_id,referred_tg_user_id' })
            .select()
            .single();

        if (upsertError) {
            if ((upsertError.message || '').includes('referral_attributions')) return null;
            throw upsertError;
        }

        if (!existing?.id) {
            notifyReferralLeadCreated(activeBots, supabase, ownerId, attribution).catch((notifyError) => {
                console.error('Ошибка уведомления о referral lead:', notifyError.message || notifyError);
            });
        }

        return attribution;
    } catch (error) {
        if ((error.message || '').includes('referral_')) return null;
        throw error;
    }
}

export async function getReferralSnapshot(supabase, ownerId, tgUserId) {
    try {
        const [profileResp, eventsResp, leadsResp] = await Promise.all([
            supabase
                .from('referral_profiles')
                .select('*')
                .eq('owner_id', ownerId)
                .eq('tg_user_id', String(tgUserId))
                .maybeSingle(),
            supabase
                .from('referral_events')
                .select('*')
                .eq('owner_id', ownerId)
                .eq('referrer_tg_user_id', String(tgUserId))
                .order('created_at', { ascending: false })
                .limit(50),
            supabase
                .from('referral_attributions')
                .select('*')
                .eq('owner_id', ownerId)
                .eq('referrer_tg_user_id', String(tgUserId))
                .order('created_at', { ascending: false })
                .limit(100)
        ]);

        if (profileResp.error || eventsResp.error || leadsResp.error) {
            const joinedError = [
                profileResp.error?.message || '',
                eventsResp.error?.message || '',
                leadsResp.error?.message || ''
            ].join(' ');

            if (joinedError.includes('referral_')) return null;
            throw profileResp.error || eventsResp.error || leadsResp.error;
        }

        return {
            profile: profileResp.data || null,
            events: eventsResp.data || [],
            leads: leadsResp.data || []
        };
    } catch (error) {
        if ((error.message || '').includes('referral_')) return null;
        throw error;
    }
}

export async function getActiveReferralAttribution(supabase, ownerId, tgUserId) {
    try {
        const { data, error } = await supabase
            .from('referral_attributions')
            .select('*')
            .eq('owner_id', ownerId)
            .eq('referred_tg_user_id', String(tgUserId))
            .maybeSingle();

        if (error) {
            if ((error.message || '').includes('referral_attributions')) return null;
            throw error;
        }

        if (!data) return null;
        if (data.converted_at) return null;
        if (data.discount_eligible === false) return null;
        if (data.expires_at && new Date(data.expires_at) < new Date()) return null;

        return data;
    } catch (error) {
        if ((error.message || '').includes('referral_attributions')) return null;
        throw error;
    }
}

export async function getBrowseFollowupDiscount(supabase, ownerId, tgUserId) {
    try {
        const { data: settings } = await supabase
            .from('payment_settings')
            .select('abandoned_discount_percent')
            .eq('owner_id', ownerId)
            .maybeSingle();

        const discountPercent = Number(settings?.abandoned_discount_percent || 0);
        if (discountPercent <= 0) return 0;

        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: recentFollowUp } = await supabase
            .from('customer_funnel_events')
            .select('id')
            .eq('tg_user_id', String(tgUserId))
            .eq('owner_id', ownerId)
            .in('event_type', ['tariff_list_opened', 'tariff_card_opened'])
            .eq('followed_up', true)
            .gte('created_at', oneDayAgo)
            .limit(1);

        if (recentFollowUp && recentFollowUp.length > 0) {
            return discountPercent;
        }
        return 0;
    } catch (err) {
        console.error('[getBrowseFollowupDiscount] error:', err.message);
        return 0;
    }
}
