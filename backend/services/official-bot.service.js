import { Telegraf } from 'telegraf';
import { getReferralEconomics, loadReferralReserveState, reconcileReferralReserveAccount } from './referral-reserve.service.js';
import { convertAmountToTon } from './crypto-rates.service.js';
import {
    generateGiftCode,
    normalizeTonWallet,
    looksLikeTonWallet
} from './official-bot/shared/pending-state.js';
import { createMenuBuilders } from './official-bot/shared/menu-builders.js';
import { registerAllHandlers } from './official-bot/handlers/handler-registry.js';

const activeBots = new Map();

/**
 * Сервис для работы с официальными ботами (Telegraf)
 */
export class OfficialBotService {
    constructor(supabase) {
        this.supabase = supabase;
    }

    async getTariffBundleItems(tariff, ownerId) {
        try {
            const { data, error } = await this.supabase
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

    async upsertSubscriptionForChannel(tgUserId, channelId, durationDays) {
        const { data: existingSub } = await this.supabase
            .from('subscriptions')
            .select('*')
            .eq('tg_user_id', tgUserId)
            .eq('channel_id', channelId)
            .single();

        let newExpiresAt = null;
        if (Number(durationDays) > 0) {
            const now = new Date();
            let baseDate = new Date();

            if (existingSub && existingSub.expires_at) {
                const currentExp = new Date(existingSub.expires_at);
                if (currentExp > now) {
                    baseDate = currentExp;
                }
            }

            baseDate.setDate(baseDate.getDate() + Number(durationDays));
            newExpiresAt = baseDate.toISOString();
        }

        let subscriptionId = existingSub?.id || null;
        if (existingSub) {
            await this.supabase
                .from('subscriptions')
                .update({
                    expires_at: newExpiresAt,
                    status: 'active'
                })
                .eq('id', existingSub.id);
        } else {
            const { data: createdSub } = await this.supabase
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

    formatTariffBundleSummary(tariff, bundleItems = []) {
        const channelItems = bundleItems.filter(item => item.item_type === 'channel' && item.channels);
        const resourceItems = bundleItems.filter(item => item.item_type === 'resource');

        if (channelItems.length === 0 && resourceItems.length === 0) {
            return tariff.channel_id ? 'Доступ в основной канал' : 'Доступ по тарифу';
        }

        const parts = [];

        if (tariff.channel_id) {
            parts.push('основная группа');
        }

        if (channelItems.length > 0) {
            parts.push(channelItems.map(item => item.channels.title).join(', '));
        }

        if (resourceItems.length > 0) {
            parts.push(`+ ${resourceItems.length} доп. материалов`);
        }

        return parts.join(' • ');
    }

    getTariffDisplayTitle(tariff) {
        if (tariff?.is_trial) {
            return tariff.trial_label || `${tariff.title} (пробник)`;
        }
        return tariff?.title || 'Тариф';
    }

    buildTelegramTargets(primaryChannel, channelTargets = []) {
        const targetsById = new Map();
        [primaryChannel, ...channelTargets].filter(Boolean).forEach((channel) => {
            const key = String(channel.id || channel.tg_chat_id || '').trim();
            if (!key || targetsById.has(key)) return;
            targetsById.set(key, channel);
        });
        return Array.from(targetsById.values());
    }

    escapeMarkdownText(value) {
        return String(value || '').replace(/([_*[\]()`])/g, '\\$1');
    }

    escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    formatResourceLine(item, index) {
        const title = this.escapeHtml(item.title || 'Материал');
        const value = this.escapeHtml(item.url || '');
        return `${index + 1}. <b>${title}</b>\n${value}`;
    }

    getTariffPaymentGroupKey(tariff) {
        return [
            tariff?.owner_id || '',
            tariff?.channel_id || '',
            String(tariff?.title || '').trim().toLowerCase(),
            String(tariff?.duration_days || ''),
            tariff?.is_trial ? 'trial' : 'regular',
            String(tariff?.trial_label || '').trim().toLowerCase(),
            tariff?.upsell_tariff_id || ''
        ].join('|');
    }

    sortTariffPaymentVariants(variants = []) {
        const currencyOrder = { TON: 1, RUB: 2, USDT: 3 };
        return [...variants].sort((left, right) => {
            const leftCurrency = String(left.currency || '').toUpperCase();
            const rightCurrency = String(right.currency || '').toUpperCase();
            const byCurrency = (currencyOrder[leftCurrency] || 99) - (currencyOrder[rightCurrency] || 99);
            if (byCurrency !== 0) return byCurrency;
            return Number(left.price || 0) - Number(right.price || 0);
        });
    }

    buildTariffPaymentGroups(tariffs = []) {
        const groupsByKey = new Map();
        tariffs.forEach((tariff) => {
            const key = this.getTariffPaymentGroupKey(tariff);
            if (!groupsByKey.has(key)) {
                groupsByKey.set(key, { key, variants: [] });
            }
            groupsByKey.get(key).variants.push(tariff);
        });

        return Array.from(groupsByKey.values())
            .map((group) => {
                const variants = this.sortTariffPaymentVariants(group.variants);
                return {
                    ...group,
                    lead: variants[0],
                    variants
                };
            })
            .sort((left, right) => Number(left.lead?.price || 0) - Number(right.lead?.price || 0));
    }

    findTariffPaymentGroup(tariffs = [], sourceTariff) {
        const sourceKey = this.getTariffPaymentGroupKey(sourceTariff);
        return this.buildTariffPaymentGroups(tariffs).find((group) => group.key === sourceKey)
            || { key: sourceKey, lead: sourceTariff, variants: [sourceTariff] };
    }

    formatDiscountedAmount(amount, currency, discountPercent) {
        const numericAmount = Number(amount || 0);
        const percent = Number(discountPercent || 0);
        if (!Number.isFinite(numericAmount) || numericAmount <= 0 || !Number.isFinite(percent) || percent <= 0) {
            return numericAmount;
        }
        return Number((numericAmount * (100 - percent) / 100).toFixed(4));
    }

    formatTariffPaymentOptions(variants = [], discountPercent = 0) {
        return this.sortTariffPaymentVariants(variants)
            .map((variant) => {
                const currency = variant.currency || 'TON';
                const price = Number(variant.price || 0);
                if (price === 0) return 'Бесплатно';
                const discountedPrice = this.formatDiscountedAmount(price, currency, discountPercent);
                if (Number(discountPercent || 0) > 0 && discountedPrice < price) {
                    return `${discountedPrice} ${currency} вместо ${price}`;
                }
                return `${price} ${currency}`;
            })
            .join(' / ');
    }

    getTariffCurrencyIcon(currency) {
        return String(currency || '').toUpperCase() === 'RUB' ? '💳' : '💎';
    }

    getTariffGroupIcon(group) {
        const currencies = new Set((group?.variants || []).map((variant) => String(variant.currency || '').toUpperCase()));
        if (currencies.has('TON') && currencies.has('RUB')) return '💎💳';
        return this.getTariffCurrencyIcon(group?.lead?.currency);
    }

    getTariffCategory(tariff) {
        if (!tariff) return 'regular';

        const title = String(tariff.title || '').toLowerCase();
        const price = Number(tariff.price) || 0;
        const durationDays = Number(tariff.duration_days) || 0;

        if (title.includes('trial') || title.includes('проб') || price === 0) return 'trial';
        if (title.includes('bundle') || title.includes('комплект') || title.includes('набор')) return 'bundle';
        if (title.includes('premium') || title.includes('vip') || title.includes('про')) return 'premium';
        if (durationDays === 0) return 'lifetime';

        return 'regular';
    }

    buildTariffCategories(tariffs = []) {
        const categories = {
            trial: [],
            regular: [],
            bundle: [],
            premium: [],
            lifetime: []
        };

        tariffs.forEach((tariff) => {
            const category = this.getTariffCategory(tariff);
            if (categories[category]) {
                categories[category].push(tariff);
            }
        });

        return Object.entries(categories)
            .filter(([_, items]) => items.length > 0)
            .map(([category, items]) => ({ category, items }));
    }

    buildPaginatedTariffMenu(tariffs = [], page = 0, perPage = 5) {
        const totalPages = Math.ceil(tariffs.length / perPage);
        const currentPage = Math.max(0, Math.min(page, totalPages - 1));
        const startIndex = currentPage * perPage;
        const endIndex = startIndex + perPage;
        const pageTariffs = tariffs.slice(startIndex, endIndex);

        return {
            tariffs: pageTariffs,
            currentPage,
            totalPages,
            hasNextPage: currentPage < totalPages - 1,
            hasPrevPage: currentPage > 0
        };
    }

    async logAccessEvent({
        ownerId,
        channelId = null,
        inviteId = null,
        subscriptionId = null,
        invoiceId = null,
        tgUserId,
        eventType,
        eventSource = 'system',
        payload = {}
    }) {
        if (!ownerId || !tgUserId || !eventType) return;

        await this.supabase.from('access_events').insert({
            owner_id: ownerId,
            channel_id: channelId,
            invite_id: inviteId,
            subscription_id: subscriptionId,
            invoice_id: invoiceId,
            tg_user_id: String(tgUserId),
            event_type: eventType,
            event_source: eventSource,
            payload
        });
    }

    async logPaymentEvent({
        ownerId,
        invoiceId,
        provider = 'system',
        externalPaymentId = null,
        eventType,
        status = null,
        payload = {}
    }) {
        if (!ownerId || !invoiceId || !eventType) return;

        try {
            await this.supabase.from('payment_events').insert({
                owner_id: ownerId,
                invoice_id: invoiceId,
                provider,
                external_payment_id: externalPaymentId,
                event_type: eventType,
                status,
                payload
            });
        } catch (error) {
            if ((error.message || '').includes('payment_events')) return;
            console.error('Ошибка payment_events:', error.message);
        }
    }

    async logCustomerFunnelEvent({
        ownerId,
        botId = null,
        tgUserId,
        tariffId = null,
        eventType,
        source = 'official_bot',
        referralCode = null,
        sessionKey = null,
        payload = {}
    }) {
        if (!ownerId || !tgUserId || !eventType) return;

        try {
            await this.supabase
                .from('customer_funnel_events')
                .insert({
                    owner_id: ownerId,
                    bot_id: botId,
                    tg_user_id: String(tgUserId),
                    tariff_id: tariffId,
                    event_type: eventType,
                    source,
                    referral_code: referralCode,
                    session_key: sessionKey,
                    payload
                });
        } catch (error) {
            if ((error.message || '').includes('customer_funnel_events')) return;
            if ((error.message || '').includes('duplicate key')) return;
            console.error('Ошибка customer_funnel_events:', error.message);
        }
    }

    buildCustomerFunnelSessionKey({ botId = null, tgUserId, eventType, tariffId = null }) {
        const day = new Date().toISOString().slice(0, 10);
        return [botId || 'bot', tgUserId || 'user', eventType || 'event', tariffId || 'list', day].join(':');
    }

    async createAccessInvite({
        ownerId,
        channelId,
        tariffId = null,
        invoiceId = null,
        subscriptionId = null,
        tgUserId,
        inviteLink,
        inviteName
    }) {
        const { data, error } = await this.supabase.from('access_invites').insert({
            owner_id: ownerId,
            channel_id: channelId,
            tariff_id: tariffId,
            invoice_id: invoiceId,
            subscription_id: subscriptionId,
            tg_user_id: String(tgUserId),
            invite_link: inviteLink,
            invite_name: inviteName,
            status: 'issued'
        }).select().single();

        if (error) {
            console.error('Ошибка сохранения access_invite:', error.message);
            return null;
        }

        return data;
    }

    async findLatestAccessInvite(channelId, tgUserId) {
        const { data } = await this.supabase
            .from('access_invites')
            .select('*')
            .eq('channel_id', channelId)
            .eq('tg_user_id', String(tgUserId))
            .order('issued_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        return data || null;
    }

    async getOwnedSalesChannels(botId, ownerId) {
        const query = this.supabase
            .from('channels')
            .select('id, title, tg_chat_id, bot_id, chat_type, created_at')
            .eq('owner_id', ownerId)
            .order('created_at', { ascending: false });

        const { data, error } = await query;
        if (error) throw error;

        const channels = (data || []).filter((channel) => {
            if (!channel?.tg_chat_id) return false;
            if (String(channel.chat_type || '').toLowerCase() === 'private') return false;
            return !channel.bot_id || String(channel.bot_id) === String(botId);
        });

        return channels;
    }

    async issueDirectChannelAccess({
        bot,
        ownerId,
        targetTgUserId,
        channel,
        durationDays,
        eventSource = 'system',
        accessNote = null,
        payload = {}
    }) {
        const targetId = String(targetTgUserId || '').trim();
        if (!targetId || !channel?.id || !channel?.tg_chat_id) {
            return { error: 'Не хватает данных для выдачи доступа.' };
        }

        const { subscriptionId, expiresAt } = await this.upsertSubscriptionForChannel(targetId, channel.id, durationDays);
        if (!subscriptionId) {
            return { error: 'Не удалось создать подписку.' };
        }

        const inviteName = `Gift_${targetId}_${new Date().toISOString().split('T')[0]}_${channel.id.slice(0, 6)}`;
        const inviteLink = await bot.telegram.createChatInviteLink(channel.tg_chat_id, {
            creates_join_request: true,
            name: inviteName
        });

        const accessInvite = await this.createAccessInvite({
            ownerId,
            channelId: channel.id,
            subscriptionId,
            tgUserId: targetId,
            inviteLink: inviteLink.invite_link,
            inviteName
        });

        await this.logAccessEvent({
            ownerId,
            channelId: channel.id,
            inviteId: accessInvite?.id || null,
            subscriptionId,
            tgUserId: targetId,
            eventType: 'invite_issued',
            eventSource,
            payload
        });

        await this.supabase
            .from('subscriptions')
            .update({
                last_access_event: 'invite_issued',
                access_note: accessNote || (
                    durationDays === 0
                        ? 'Выдана ссылка с join request (навсегда)'
                        : `Выдана ссылка с join request (+${durationDays} дней)`
                )
            })
            .eq('id', subscriptionId);

        const durationText = durationDays === 0
            ? 'Навсегда'
            : `на ${Number(durationDays)} дней`;

        return {
            success: true,
            subscriptionId,
            expiresAt,
            inviteLink: inviteLink.invite_link,
            durationText
        };
    }

    async createGiftAccessCode({ ownerId, botId, channelId, tariffId, durationDays, createdByTgUserId }) {
        for (let attempt = 0; attempt < 5; attempt += 1) {
            const code = generateGiftCode();
            const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
            const { data, error } = await this.supabase
                .from('gift_access_codes')
                .insert({
                    owner_id: ownerId,
                    bot_id: botId,
                    channel_id: channelId,
                    tariff_id: tariffId || null,
                    code,
                    duration_days: durationDays === 0 ? null : Number(durationDays || 0),
                    status: 'active',
                    created_by_tg_user_id: String(createdByTgUserId || ''),
                    expires_at: expiresAt,
                    payload: {
                        duration_label: durationDays === 0 ? 'forever' : `${durationDays}_days`
                    }
                })
                .select('id, code, channel_id, tariff_id, duration_days, expires_at')
                .single();

            if (!error && data) return data;
            if ((error?.message || '').toLowerCase().includes('duplicate')) continue;
            throw error;
        }

        throw new Error('Не удалось сгенерировать уникальный подарочный код.');
    }

    async redeemGiftAccessCode({ bot, botId, tgUserId, code }) {
        const normalizedCode = String(code || '').trim().toUpperCase();
        if (!normalizedCode) {
            return { error: 'Код пустой.' };
        }

        const { data: giftCode, error } = await this.supabase
            .from('gift_access_codes')
            .select('id, owner_id, bot_id, channel_id, tariff_id, code, duration_days, status, expires_at, redeemed_at')
            .eq('code', normalizedCode)
            .maybeSingle();

        if (error) throw error;
        if (!giftCode) return { error: 'Код не найден.' };
        if (giftCode.bot_id && String(giftCode.bot_id) !== String(botId)) {
            return { error: 'Этот код выпущен для другого бота.' };
        }
        if (giftCode.status === 'redeemed' || giftCode.redeemed_at) {
            return { error: 'Этот код уже использован.' };
        }
        if (giftCode.status === 'revoked') {
            return { error: 'Этот код отозван админом.' };
        }
        if (giftCode.expires_at && new Date(giftCode.expires_at) < new Date()) {
            await this.supabase
                .from('gift_access_codes')
                .update({ status: 'expired', updated_at: new Date().toISOString() })
                .eq('id', giftCode.id);
            return { error: 'Срок действия кода закончился.' };
        }

        const { data: lockingRow, error: lockingError } = await this.supabase
            .from('gift_access_codes')
            .update({
                status: 'redeeming',
                updated_at: new Date().toISOString()
            })
            .eq('id', giftCode.id)
            .eq('status', 'active')
            .is('redeemed_at', null)
            .select('id')
            .maybeSingle();

        if (lockingError) throw lockingError;
        if (!lockingRow) return { error: 'Этот код уже активируется или уже использован.' };

        try {
            const ownerId = giftCode.owner_id;
            const durationDays = Number(giftCode.duration_days || 0);
            const durationText = durationDays > 0 ? `${durationDays} дней` : 'Навсегда';

            let tariff = null;
            let primaryChannel = null;

            if (giftCode.tariff_id) {
                const { data: t } = await this.supabase.from('tariffs').select('*').eq('id', giftCode.tariff_id).single();
                tariff = t;
            }

            if (tariff?.channel_id) {
                const { data } = await this.supabase.from('channels').select('*').eq('id', tariff.channel_id).single();
                primaryChannel = data;
            } else if (giftCode.channel_id) {
                const { data } = await this.supabase.from('channels').select('*').eq('id', giftCode.channel_id).single();
                primaryChannel = data;
            }

            const bundleItems = tariff ? await this.getTariffBundleItems(tariff, ownerId) : [];
            const channelTargets = bundleItems
                .filter(item => item.item_type === 'channel' && item.channels)
                .map(item => item.channels);
            const resourceTargets = bundleItems
                .filter(item => item.item_type === 'resource')
                .map(item => ({ title: item.resource_title, url: item.resource_url }));

            const telegramTargets = this.buildTelegramTargets(primaryChannel, channelTargets);

            if (!telegramTargets.length && !resourceTargets.length) {
                throw new Error('В тарифе нет каналов или ресурсов для выдачи.');
            }

            const inviteLinks = [];
            let finalExpiresAt = null;
            let firstSubscriptionId = null;

            for (const channel of telegramTargets) {
                const { subscriptionId, expiresAt } = await this.upsertSubscriptionForChannel(
                    String(tgUserId), channel.id, durationDays
                );

                if (!firstSubscriptionId) firstSubscriptionId = subscriptionId;
                if (!finalExpiresAt) finalExpiresAt = expiresAt;

                const inviteName = `Gift_${tgUserId}_${new Date().toISOString().split('T')[0]}_${channel.id.slice(0, 6)}`;
                const inviteLink = await bot.telegram.createChatInviteLink(channel.tg_chat_id, {
                    creates_join_request: true,
                    name: inviteName
                });

                await this.createAccessInvite({
                    ownerId,
                    channelId: channel.id,
                    tariffId: tariff?.id || null,
                    subscriptionId,
                    tgUserId: String(tgUserId),
                    inviteLink: inviteLink.invite_link,
                    inviteName
                });

                await this.logAccessEvent({
                    ownerId,
                    channelId: channel.id,
                    subscriptionId,
                    tgUserId: String(tgUserId),
                    eventType: 'invite_issued',
                    eventSource: 'gift_code',
                    payload: {
                        bot_id: botId,
                        gift_code_id: giftCode.id,
                        gift_code: normalizedCode,
                        tariff_title: tariff?.title || null,
                        duration_days: durationDays === 0 ? 'forever' : durationDays
                    }
                });

                await this.supabase
                    .from('subscriptions')
                    .update({
                        last_access_event: 'invite_issued',
                        access_note: `Доступ выдан по промокоду (+${durationText})`
                    })
                    .eq('id', subscriptionId);

                inviteLinks.push({ title: channel.title, url: inviteLink.invite_link });
            }

            await this.supabase
                .from('gift_access_codes')
                .update({
                    status: 'redeemed',
                    redeemed_by_tg_user_id: String(tgUserId),
                    redeemed_subscription_id: firstSubscriptionId,
                    redeemed_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    payload: {
                        redeemed_via: 'official_bot',
                        channels_granted: telegramTargets.length,
                        tariff_title: tariff?.title || null
                    }
                })
                .eq('id', giftCode.id);

            return {
                success: true,
                tariffTitle: tariff?.title || null,
                inviteLinks,
                resourceTargets,
                expiresAt: finalExpiresAt,
                durationText
            };
        } catch (redeemError) {
            await this.supabase
                .from('gift_access_codes')
                .update({
                    status: 'active',
                    updated_at: new Date().toISOString()
                })
                .eq('id', giftCode.id)
                .eq('status', 'redeeming');
            throw redeemError;
        }
    }

    async getBotOwner(botId) {
        const { data } = await this.supabase
            .from('tg_accounts')
            .select('owner_id')
            .eq('id', botId)
            .single();

        return data?.owner_id || null;
    }

    async getChannelByChatId(chatId) {
        const { data } = await this.supabase
            .from('channels')
            .select('*')
            .eq('tg_chat_id', chatId)
            .single();

        return data || null;
    }

    async hasActiveSubscription(tgUserId, channelId) {
        const nowIso = new Date().toISOString();
        const { data: subscription } = await this.supabase
            .from('subscriptions')
            .select('id, expires_at')
            .eq('tg_user_id', tgUserId)
            .eq('channel_id', channelId)
            .eq('status', 'active')
            .single();

        if (!subscription) return false;
        if (!subscription.expires_at) return true;

        return new Date(subscription.expires_at).toISOString() > nowIso;
    }

    generateReferralCode(tgUserId) {
        return `r${String(tgUserId)}${Math.random().toString(36).slice(2, 8)}`.toLowerCase();
    }

    async getReferralSettings(ownerId) {
        try {
            const { data, error } = await this.supabase
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

    async getOwnerAdminContext(ownerId) {
        try {
            const [settingsResp, profileResp] = await Promise.all([
                this.supabase
                    .from('payment_settings')
                    .select('admin_tg_id, referral_enabled')
                    .eq('owner_id', ownerId)
                    .maybeSingle(),
                this.supabase
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

    async getOwnerNotificationBot(ownerId) {
        if (!ownerId) return null;

        const { data: accounts, error } = await this.supabase
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

    async notifyOwnerAdmin(ownerId, text, options = {}) {
        try {
            const adminContext = await this.getOwnerAdminContext(ownerId);
            const adminTgId = String(adminContext?.adminTgId || '').trim();
            if (!adminTgId) {
                return { sent: false, reason: 'admin_tg_id_missing' };
            }

            const notificationBot = await this.getOwnerNotificationBot(ownerId);
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

    async notifyReferralPayoutRequested(ownerId, payout) {
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

        return this.notifyOwnerAdmin(ownerId, text, { disable_web_page_preview: true });
    }

    async notifyReferralLeadCreated(ownerId, attribution) {
        const notificationBot = await this.getOwnerNotificationBot(ownerId);
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

    async notifyReferralPayoutAvailable(ownerId, tgUserId, balanceTon) {
        const notificationBot = await this.getOwnerNotificationBot(ownerId);
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

    async notifyReferralPayoutStatus(ownerId, payout, status, meta = {}) {
        const notificationBot = await this.getOwnerNotificationBot(ownerId);
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

            adminResult = await this.notifyOwnerAdmin(ownerId, adminText, { disable_web_page_preview: true });
        }

        return { partner: partnerResult, admin: adminResult };
    }

    async notifyReferralReserveDeposit(ownerId, depositResult) {
        const amountTon = Number(depositResult?.amountTon || 0);
        const text = [
            '✅ TON-резерв партнерки пополнен.',
            '',
            `Сумма: ${amountTon} TON`,
            depositResult?.chainTxHash ? `Tx: ${depositResult.chainTxHash}` : '',
            depositResult?.lockCreated ? 'Депозит заблокирован на 30 дней. Партнерку можно включать.' : 'Резерв пересчитан.'
        ].filter(Boolean).join('\n');

        return this.notifyOwnerAdmin(ownerId, text, { disable_web_page_preview: true });
    }

    async notifyReferralReserveRefund(ownerId, refund, status) {
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

        return this.notifyOwnerAdmin(ownerId, text, { disable_web_page_preview: true });
    }

    async notifyReferralReserveStatus(ownerId, reserveAccount, previousStatus = null) {
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

        const admin = await this.notifyOwnerAdmin(ownerId, adminText, { disable_web_page_preview: true });
        let partners = null;

        if (['over_limit', 'closed_for_new_partners'].includes(status)) {
            partners = await this.notifyReferralPartnersProgramPaused(ownerId, previousStatus);
        }

        return { admin, partners };
    }

    async notifyReferralPartnersProgramPaused(ownerId, previousStatus = null) {
        const notificationBot = await this.getOwnerNotificationBot(ownerId);
        if (!notificationBot?.bot?.telegram) {
            return { sent: 0, failed: 0, reason: 'active_bot_missing' };
        }

        const { data: partners, error } = await this.supabase
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

    async getBotAdminContext(botId, ownerIdFallback = null) {
        try {
            const { data: botAccount, error: botError } = await this.supabase
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
                this.supabase
                    .from('payment_settings')
                    .select('admin_tg_id, referral_enabled')
                    .eq('owner_id', ownerId)
                    .maybeSingle(),
                this.supabase
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

    buildAdminOwnershipHint(context, role = 'sales') {
        if (!context) return '';

        const roleText = role === 'ops'
            ? 'Этот бот относится к админскому контуру юзерботов.'
            : 'Этот бот обслуживает оплату и доступ по подпискам.';

        if (context.adminTgId) {
            return `${roleText}\nТвой админ: ${context.adminLabel}`;
        }

        return `${roleText}\nТвой админ: ${context.adminLabel}`;
    }

    async getUserRole(ctx, botId) {
        try {
            const tgUserId = String(ctx.from?.id || '');
            if (!tgUserId) return 'user';

            const adminContext = await this.getBotAdminContext(botId);
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

    async ensureReferralProfile(ownerId, tgUserId, username = null, displayName = null) {
        try {
            const { data: existing, error: existingError } = await this.supabase
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
                    await this.supabase
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

            const { data: created, error: createError } = await this.supabase
                .from('referral_profiles')
                .insert({
                    owner_id: ownerId,
                    tg_user_id: String(tgUserId),
                    username: username || null,
                    display_name: displayName || null,
                    referral_code: this.generateReferralCode(tgUserId)
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

    async getReferralProfile(ownerId, tgUserId) {
        try {
            const { data, error } = await this.supabase
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

    async getReferralPayoutMethod(ownerId, tgUserId) {
        try {
            const { data, error } = await this.supabase
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

    async getPendingReferralPayout(ownerId, tgUserId) {
        try {
            const { data, error } = await this.supabase
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

    async saveReferralPayoutWallet(ownerId, tgUserId, tonWallet) {
        const normalizedWallet = normalizeTonWallet(tonWallet);
        if (!looksLikeTonWallet(normalizedWallet)) {
            return { error: 'Похоже, это не TON-кошелек. Пришли адрес из Tonkeeper/Tonhub, который начинается на UQ/EQ, или raw-адрес вида 0:...' };
        }

        const pendingPayout = await this.getPendingReferralPayout(ownerId, tgUserId);
        if (pendingPayout) {
            return { error: 'У тебя уже есть заявка на выплату. Кошелек можно поменять после обработки этой заявки.' };
        }

        const now = new Date().toISOString();
        const { data, error } = await this.supabase
            .from('referral_partner_payout_methods')
            .upsert({
                owner_id: ownerId,
                tg_user_id: String(tgUserId),
                ton_wallet: normalizedWallet,
                status: 'active',
                verified_at: now,
                last_changed_at: now,
                updated_at: now
            }, { onConflict: 'owner_id,tg_user_id' })
            .select('*')
            .single();

        if (error) {
            if ((error.message || '').includes('referral_partner_payout_methods')) {
                return { error: 'SQL под payout-кошельки еще не применен.' };
            }
            throw error;
        }

        return { wallet: data };
    }

    async requestReferralPartnerPayout(ownerId, tgUserId) {
        const economics = getReferralEconomics();
        const minPayoutTon = Number(economics.minPayoutTon || 5);
        const profile = await this.getReferralProfile(ownerId, tgUserId);
        if (!profile) return { error: 'Сначала нужно открыть партнерку и получить ссылку.' };

        const balanceTon = Number(profile.balance_ton || 0);
        if (!Number.isFinite(balanceTon) || balanceTon < minPayoutTon) {
            return { error: `Минимальная выплата ${minPayoutTon} TON. Сейчас на балансе ${balanceTon} TON.` };
        }

        const payoutMethod = await this.getReferralPayoutMethod(ownerId, tgUserId);
        if (!payoutMethod?.ton_wallet || payoutMethod.status !== 'active') {
            return { error: 'Сначала укажи TON-кошелек для выплаты.' };
        }

        const pendingPayout = await this.getPendingReferralPayout(ownerId, tgUserId);
        if (pendingPayout) {
            return { error: `Заявка уже создана: ${Number(pendingPayout.amount_ton || 0)} TON. Дождись обработки.` };
        }

        const amountTon = Number(balanceTon.toFixed(6));
        const { data, error } = await this.supabase
            .from('referral_partner_payouts')
            .insert({
                owner_id: ownerId,
                tg_user_id: String(tgUserId),
                amount_ton: amountTon,
                network_fee_ton: 0,
                status: 'requested',
                ton_wallet: payoutMethod.ton_wallet,
                payload: {
                    source: 'partner_bot_request',
                    balance_ton_at_request: balanceTon
                }
            })
            .select('*')
            .single();

        if (error) {
            if (error.code === '23505' || (error.message || '').includes('duplicate key')) {
                return { error: 'Заявка уже создана. Дождись обработки.' };
            }
            if ((error.message || '').includes('referral_partner_payouts')) {
                return { error: 'SQL под заявки на выплату еще не применен.' };
            }
            throw error;
        }

        this.notifyReferralPayoutRequested(ownerId, data).catch((notifyError) => {
            console.error('Ошибка уведомления админа о referral payout request:', notifyError.message || notifyError);
        });

        return { payout: data };
    }

    async registerReferralLead({
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

            const { data: referrer, error: referrerError } = await this.supabase
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

            const { data: existing, error: existingError } = await this.supabase
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
            const { data: attribution, error: upsertError } = await this.supabase
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
                this.notifyReferralLeadCreated(ownerId, attribution).catch((notifyError) => {
                    console.error('Ошибка уведомления о referral lead:', notifyError.message || notifyError);
                });
            }

            return attribution;
        } catch (error) {
            if ((error.message || '').includes('referral_')) return null;
            throw error;
        }
    }

    async getReferralSnapshot(ownerId, tgUserId) {
        try {
            const [profileResp, eventsResp, leadsResp] = await Promise.all([
                this.supabase
                    .from('referral_profiles')
                    .select('*')
                    .eq('owner_id', ownerId)
                    .eq('tg_user_id', String(tgUserId))
                    .maybeSingle(),
                this.supabase
                    .from('referral_events')
                    .select('*')
                    .eq('owner_id', ownerId)
                    .eq('referrer_tg_user_id', String(tgUserId))
                    .order('created_at', { ascending: false })
                    .limit(50),
                this.supabase
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

    async getActiveReferralAttribution(ownerId, tgUserId) {
        try {
            const { data, error } = await this.supabase
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

    async getBrowseFollowupDiscount(ownerId, tgUserId) {
        try {
            const { data: settings } = await this.supabase
                .from('payment_settings')
                .select('abandoned_discount_percent')
                .eq('owner_id', ownerId)
                .maybeSingle();

            const discountPercent = Number(settings?.abandoned_discount_percent || 0);
            if (discountPercent <= 0) return 0;

            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            const { data: recentFollowUp } = await this.supabase
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

    async processReferralReward(bot, invoice, tariff, ownerId) {
        try {
            const settings = await this.getReferralSettings(ownerId);

            const { data: attribution, error: attributionError } = await this.supabase
                .from('referral_attributions')
                .select('*')
                .eq('owner_id', ownerId)
                .eq('referred_tg_user_id', String(invoice.tg_user_id))
                .maybeSingle();

            if (attributionError) {
                if ((attributionError.message || '').includes('referral_attributions')) return null;
                throw attributionError;
            }

            if (!attribution) return null;
            if (String(attribution.referrer_tg_user_id) === String(invoice.tg_user_id)) return null;
            if (attribution.converted_at) return null;
            if (attribution.discount_eligible === false) return null;

            const settlementTime = invoice.paid_at ? new Date(invoice.paid_at) : new Date();
            if (attribution.expires_at && new Date(attribution.expires_at) < settlementTime) return null;

            const { data: existingReward, error: rewardCheckError } = await this.supabase
                .from('referral_events')
                .select('id')
                .eq('owner_id', ownerId)
                .eq('invoice_id', invoice.id)
                .eq('event_type', 'reward_granted')
                .maybeSingle();

            if (rewardCheckError) {
                if ((rewardCheckError.message || '').includes('referral_events')) return null;
                throw rewardCheckError;
            }

            if (existingReward) return null;

            const reserve = await loadReferralReserveState(this.supabase, ownerId, { ensure: true });
            const economics = getReferralEconomics();
            const rewardPercent = Number(attribution.reward_percent_snapshot ?? settings.referral_reward_percent ?? 0);
            if (rewardPercent <= 0) return null;

            const clientDiscountPercent = Number(attribution.client_discount_percent_snapshot ?? settings.referral_client_discount_percent ?? economics.clientDiscountPercent);
            const rewardBaseAmount = Number(tariff.price || invoice.amount || 0);
            const paidAmount = Number(invoice.amount || 0);
            const rewardAmountRaw = rewardBaseAmount * rewardPercent / 100;
            const currency = String(invoice.currency || '').toUpperCase();
            const rewardAmount = ['TON', 'USDT'].includes(currency)
                ? Number(rewardAmountRaw.toFixed(4))
                : Number(rewardAmountRaw.toFixed(2));
            const clientDiscountAmount = Math.max(0, Number((rewardBaseAmount - paidAmount).toFixed(currency === 'RUB' ? 2 : 4)));

            if (rewardAmount <= 0) return null;
            if (!['RUB', 'TON', 'USDT'].includes(currency)) return null;

            const convertedReward = await convertAmountToTon(this.supabase, rewardAmount, currency);
            if (!convertedReward?.amountTon) {
                throw new Error(`Нет свежего курса TON для ${currency}`);
            }

            const rewardTonAmount = convertedReward.amountTon;
            const bullrunFeeTonAmount = Number((rewardTonAmount * economics.bullrunFeePercent / 100).toFixed(6));

            const referrerProfile = await this.ensureReferralProfile(ownerId, attribution.referrer_tg_user_id);
            if (!referrerProfile) return null;

            const previousBalanceTon = Number(referrerProfile.balance_ton || 0);
            const updates = {
                balance_ton: Number((previousBalanceTon + rewardTonAmount).toFixed(6)),
                total_earned_ton: Number((Number(referrerProfile.total_earned_ton || 0) + rewardTonAmount).toFixed(6))
            };

            await this.supabase
                .from('referral_profiles')
                .update(updates)
                .eq('id', referrerProfile.id);

            const { data: rewardEvent, error: rewardEventError } = await this.supabase
                .from('referral_events')
                .insert({
                    owner_id: ownerId,
                    referrer_tg_user_id: String(attribution.referrer_tg_user_id),
                    referred_tg_user_id: String(invoice.tg_user_id),
                    invoice_id: invoice.id,
                    tariff_id: tariff.id,
                    event_type: 'reward_granted',
                    status: 'completed',
                    reward_amount: rewardTonAmount,
                    reward_currency: 'TON',
                    sale_original_amount: rewardBaseAmount,
                    sale_original_currency: currency,
                    client_discount_percent: clientDiscountPercent,
                    client_discount_original_amount: clientDiscountAmount,
                    reward_original_amount: rewardAmount,
                    reward_original_currency: currency,
                    reward_ton_amount: rewardTonAmount,
                    bullrun_fee_ton_amount: bullrunFeeTonAmount,
                    network_fee_ton_amount: 0,
                    exchange_rate_id: convertedReward.rate?.id || null,
                    reserve_account_id: reserve.id || null,
                    reserve_coverage_status: reserve.canAcceptNewPartners ? 'covered' : 'admin_debt',
                    payload: {
                        tariff_title: tariff.title,
                        reward_percent: rewardPercent,
                        client_discount_percent: clientDiscountPercent,
                        paid_amount: paidAmount,
                        bullrun_fee_percent: economics.bullrunFeePercent,
                        bullrun_fee_ton_amount: bullrunFeeTonAmount,
                        reward_original_amount: rewardAmount,
                        reward_original_currency: currency,
                        reward_ton_amount: rewardTonAmount,
                        exchange_rate: convertedReward.rate
                            ? {
                                id: convertedReward.rate.id || null,
                                base_currency: convertedReward.rate.base_currency,
                                quote_currency: convertedReward.rate.quote_currency,
                                rate: convertedReward.rate.rate,
                                provider: convertedReward.rate.provider,
                                fetched_at: convertedReward.rate.fetched_at
                            }
                            : null
                    }
                })
                .select('id')
                .single();

            if (rewardEventError) throw rewardEventError;

            if (reserve.id) {
                await this.supabase
                    .from('referral_reserve_ledger')
                    .insert([
                        {
                            owner_id: ownerId,
                            reserve_account_id: reserve.id,
                            entry_type: 'reward_obligation_created',
                            amount_ton: rewardTonAmount,
                            direction: 'debit',
                            related_referral_event_id: rewardEvent.id,
                            payload: {
                                invoice_id: invoice.id,
                                referred_tg_user_id: String(invoice.tg_user_id),
                                reward_original_amount: rewardAmount,
                                reward_original_currency: currency,
                                exchange_rate_id: convertedReward.rate?.id || null
                            }
                        },
                        {
                            owner_id: ownerId,
                            reserve_account_id: reserve.id,
                            entry_type: 'bullrun_fee_created',
                            amount_ton: bullrunFeeTonAmount,
                            direction: 'debit',
                            related_referral_event_id: rewardEvent.id,
                            payload: { invoice_id: invoice.id, fee_percent: economics.bullrunFeePercent }
                        }
                    ]);

                const reconciled = await reconcileReferralReserveAccount(this.supabase, {
                    id: reserve.id,
                    owner_id: ownerId,
                    deposit_address: reserve.depositAddress || null,
                    minimum_deposit_ton: reserve.minimumDepositTon,
                    total_deposited_ton: reserve.totalDepositedTon,
                    available_reserve_ton: reserve.availableReserveTon,
                    reserved_obligations_ton: reserve.reservedObligationsTon,
                    admin_debt_ton: reserve.adminDebtTon,
                    bullrun_fee_accrued_ton: reserve.bullrunFeeTon,
                    network_fee_accrued_ton: reserve.networkFeeTon,
                    locked_until: reserve.lockedUntil || null,
                    last_deposit_at: reserve.lastDepositAt || null,
                    status: reserve.status
                });

                if (reconciled.statusChanged) {
                    this.notifyReferralReserveStatus(
                        ownerId,
                        reconciled.reserveAccount,
                        reconciled.previousStatus
                    ).catch((notifyError) => {
                        console.error('Ошибка уведомления о referral reserve status:', notifyError.message || notifyError);
                    });
                }
            }

            await this.supabase
                .from('referral_attributions')
                .update({
                    converted_at: new Date().toISOString(),
                    paid_invoice_id: invoice.id
                })
                .eq('id', attribution.id);

            if (bot?.telegram) {
                await bot.telegram.sendMessage(
                    attribution.referrer_tg_user_id,
                    `💸 По твоей реф-ссылке закрылась оплата.\n\nКлиент: ${invoice.tg_user_id}\nТариф: ${this.getTariffDisplayTitle(tariff)}\nБонус: ${rewardTonAmount} TON\n\nБаланс уже обновлен.`
                ).catch(() => {});
            }

            const minPayoutTon = Number(economics.minPayoutTon || 5);
            if (previousBalanceTon < minPayoutTon && Number(updates.balance_ton || 0) >= minPayoutTon) {
                this.notifyReferralPayoutAvailable(ownerId, attribution.referrer_tg_user_id, updates.balance_ton).catch((notifyError) => {
                    console.error('Ошибка уведомления о доступной referral payout:', notifyError.message || notifyError);
                });
            }

            return {
                referrerTgUserId: String(attribution.referrer_tg_user_id),
                rewardAmount: rewardTonAmount,
                rewardCurrency: 'TON'
            };
        } catch (error) {
            if ((error.message || '').includes('referral_')) return null;
            console.error('Ошибка начисления рефералки:', error);
            return null;
        }
    }

    /**
     * Регистрация handlers для официального бота (общий код для polling и webhook)
     */
    registerHandlers(bot, botId, username, role = 'sales') {
        const normalizedRole = role === 'ops' ? 'ops' : 'sales';
        this._normalizedRole = normalizedRole;
        const { sendAdminMenu, sendUserMainMenu, sendMainMenu, createInvoiceForTariff } = createMenuBuilders({ service: this, botId });

        const regCtx = { service: this, botId, username, sendMainMenu, sendUserMainMenu, sendAdminMenu, createInvoiceForTariff };
        registerAllHandlers(bot, regCtx);
    }


    /**
     * Запуск официального бота (polling)
     */
    startBot(botId, token, username, role = 'sales') {
        if (activeBots.has(botId)) return;

        const bot = new Telegraf(token);
        this.registerHandlers(bot, botId, username, role);
        bot.launch().then(() => console.log(`🤖 Бот @${username} успешно запущен (polling)!`));
        activeBots.set(botId, bot);
    }

    /**
     * Запуск официального бота (webhook) — без polling, готов к handleUpdate()
     */
    startWebhookBot(botId, token, username, role = 'sales') {
        if (activeBots.has(botId)) return;

        const bot = new Telegraf(token);
        this.registerHandlers(bot, botId, username, role);
        activeBots.set(botId, bot);
        console.log(`🤖 Бот @${username} готов к webhook-обработке!`);
    }

    /**
     * Активация подписки
     */
    async activateSubscription(bot, invoice) {
        try {
            const { data: tariff } = await this.supabase.from('tariffs').select('*').eq('id', invoice.tariff_id).single();
            let primaryChannel = null;
            if (tariff.channel_id) {
                const { data } = await this.supabase.from('channels').select('*').eq('id', tariff.channel_id).single();
                primaryChannel = data || null;
            }
            const ownerId = primaryChannel?.owner_id || tariff.owner_id;
            const bundleItems = await this.getTariffBundleItems(tariff, ownerId);

            const channelTargets = bundleItems
                .filter(item => item.item_type === 'channel' && item.channels)
                .map(item => item.channels);

            const resourceTargets = bundleItems
                .filter(item => item.item_type === 'resource')
                .map(item => ({
                    title: item.resource_title,
                    url: item.resource_url
                }));

            const telegramTargets = this.buildTelegramTargets(primaryChannel, channelTargets);
            const inviteLinks = [];
            let finalExpiresAt = null;

            for (const channel of telegramTargets) {
                const { subscriptionId, expiresAt } = await this.upsertSubscriptionForChannel(
                    invoice.tg_user_id,
                    channel.id,
                    tariff.duration_days
                );

                if (!finalExpiresAt) {
                    finalExpiresAt = expiresAt;
                }

                const inviteName = `Sub_${invoice.tg_user_id}_${new Date().toISOString().split('T')[0]}_${channel.id.slice(0, 6)}`;
                const inviteLink = await bot.telegram.createChatInviteLink(channel.tg_chat_id, {
                    creates_join_request: true,
                    name: inviteName
                });

                const accessInvite = await this.createAccessInvite({
                    ownerId,
                    channelId: channel.id,
                    tariffId: tariff.id,
                    invoiceId: invoice.id,
                    subscriptionId,
                    tgUserId: invoice.tg_user_id,
                    inviteLink: inviteLink.invite_link,
                    inviteName
                });

                await this.logAccessEvent({
                    ownerId,
                    channelId: channel.id,
                    inviteId: accessInvite?.id || null,
                    subscriptionId,
                    invoiceId: invoice.id,
                    tgUserId: invoice.tg_user_id,
                    eventType: 'invite_issued',
                    eventSource: 'official_bot',
                    payload: {
                        tariff_title: tariff.title,
                        expires_at: expiresAt,
                        bundle_size: telegramTargets.length
                    }
                });

                await this.supabase
                    .from('subscriptions')
                    .update({
                        last_access_event: 'invite_issued',
                        access_note: telegramTargets.length > 1
                            ? 'Выдан пакет ссылок с join request'
                            : 'Выдана ссылка с join request'
                    })
                    .eq('id', subscriptionId);

                inviteLinks.push({
                    title: channel.title,
                    url: inviteLink.invite_link
                });
            }

            const expText = telegramTargets.length === 0
                ? `Материалы: <b>отправлены</b>`
                : finalExpiresAt
                    ? `Продлен до: <b>${new Date(finalExpiresAt).toLocaleDateString('ru-RU')}</b>`
                    : `Доступ: <b>Навсегда</b>`;

            const accessLines = inviteLinks
                .map((item, index) => `${index + 1}. <b>${item.title}</b>\n👉 ${item.url}`)
                .join('\n\n') || 'Telegram-доступ в этом тарифе не включен.';

            const resourceLines = resourceTargets.length > 0
                ? `\n\n<b>Доп. материалы:</b>\n${resourceTargets.map((item, index) => this.formatResourceLine(item, index)).join('\n\n')}`
                : '';
            const deliveryNote = telegramTargets.length > 0
                ? '\n\nВсе ссылки работают через запрос на вступление. Бот пропустит только аккаунт с активной подпиской.'
                : '';

            await bot.telegram.sendMessage(
                invoice.tg_user_id,
                `🎉 <b>Оплата успешно подтверждена!</b>\n\nТариф: «${this.getTariffDisplayTitle(tariff)}»\n⏳ ${expText}\n\n<b>Что ты получил:</b>\n${accessLines}${resourceLines}${deliveryNote}`,
                { parse_mode: 'HTML', disable_web_page_preview: true }
            );

            await this.processReferralReward(bot, invoice, tariff, ownerId);

            if (tariff.is_trial && tariff.upsell_tariff_id) {
                const { data: upsellTariff } = await this.supabase
                    .from('tariffs')
                    .select('id, title, price, currency, duration_days')
                    .eq('id', tariff.upsell_tariff_id)
                    .single();

                if (upsellTariff) {
                    const upsellDuration = Number(upsellTariff.duration_days) > 0
                        ? `${upsellTariff.duration_days} дней`
                        : 'без срока';

                    await bot.telegram.sendMessage(
                        invoice.tg_user_id,
                        `🔥 <b>Что дальше</b>\n\nТы сейчас зашел через пробник. Если захочешь остаться надолго, следующий шаг уже готов:\n\n<b>${this.escapeHtml(upsellTariff.title)}</b>\n💰 ${upsellTariff.price} ${upsellTariff.currency}\n⏳ ${upsellDuration}\n\nНапиши /start и выбери основной тариф, когда будешь готов зайти плотнее.`,
                        { parse_mode: 'HTML' }
                    );
                }
            }
        } catch (error) { console.error('Ошибка при активации подписки:', error); }
    }

    /**
     * Проверка TON платежа
     */
    async checkTonPayment(memo, expectedAmount, wallet) {
        try {
            const response = await fetch(`https://tonapi.io/v2/blockchain/accounts/${wallet}/transactions?limit=30`);
            const data = await response.json();
            if (!data.transactions) return false;

            for (const tx of data.transactions) {
                if (tx.in_msg && tx.in_msg.decoded_body && tx.in_msg.decoded_body.text === memo) {
                    const paidNanoTon = parseInt(tx.in_msg.value);
                    const expectedNanoTon = expectedAmount * 1000000000;
                    if (paidNanoTon >= expectedNanoTon) return true;
                }
            }
            return false;
        } catch (error) { return false; }
    }

    /**
     * Получить активного бота по ID
     */
    getBot(botId) {
        return activeBots.get(botId);
    }

    stopBot(botId) {
        const bot = activeBots.get(botId);
        if (!bot) return;
        try {
            bot.stop('SIGTERM');
        } catch (error) {
            console.error(`Не удалось остановить бота ${botId}:`, error.message);
        }
        activeBots.delete(botId);
    }

    /**
     * Остановить всех ботов
     */
    stopAll() {
        activeBots.forEach(bot => bot.stop('SIGTERM'));
    }
}
