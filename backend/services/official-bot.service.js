import { Telegraf } from 'telegraf';
import QRCode from 'qrcode';
import { decrypt } from '../utils/crypto.js';
import { getReferralEconomics, loadReferralReserveState, reconcileReferralReserveAccount } from './referral-reserve.service.js';
import { convertAmountToTon } from './crypto-rates.service.js';

// Импорты для Юзербота
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const activeBots = new Map();
const pendingReferralWalletInputs = new Map();

function normalizeTonWallet(value) {
    return String(value || '').trim();
}

function looksLikeTonWallet(value) {
    const wallet = normalizeTonWallet(value);
    if (/^[UEk]Q[A-Za-z0-9_-]{46}$/.test(wallet)) return true;
    if (/^[0-9-]+:[a-fA-F0-9]{64}$/.test(wallet)) return true;
    return false;
}

function pendingReferralWalletKey(botId, tgUserId) {
    return `${botId}:${tgUserId}`;
}

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

    formatResourceLine(item, index) {
        const title = this.escapeMarkdownText(item.title || 'Материал');
        const value = this.escapeMarkdownText(item.url || '');
        return `${index + 1}. **${title}**\n${value}`;
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

    formatTariffPaymentOptions(variants = []) {
        return this.sortTariffPaymentVariants(variants)
            .map((variant) => `${variant.price} ${variant.currency || 'TON'}`)
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
                .select('owner_id, admin_tg_id')
                .eq('id', botId)
                .maybeSingle();

            if (botError) throw botError;

            const ownerId = botAccount?.owner_id || ownerIdFallback || null;

            if (!ownerId) {
                const botAdminTgId = botAccount?.admin_tg_id ? String(botAccount.admin_tg_id) : '';
                return {
                    ownerId: null,
                    botAdminTgId,
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

            if (tgUserId === botAdminId || tgUserId === fallbackAdminId) {
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

            const updates = {
                balance_ton: Number((Number(referrerProfile.balance_ton || 0) + rewardTonAmount).toFixed(6)),
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
     * Запуск официального бота
     */
    startBot(botId, token, username, role = 'sales') {
        if (activeBots.has(botId)) return;

        const bot = new Telegraf(token);
        const self = this;
        const normalizedRole = role === 'ops' ? 'ops' : 'sales';

        // --- Админ-меню ---
        const sendAdminMenu = async (ctx) => {
            const adminContext = await this.getBotAdminContext(botId);
            const inlineKeyboard = [
                [{ text: '⚙️ Управление тарифами', callback_data: 'admin_tariffs' }],
                [{ text: '💸 Партнерка', callback_data: 'admin_referral' }],
                [{ text: '👤 Профиль администратора', callback_data: 'admin_profile' }],
                [{ text: '📊 Статистика', callback_data: 'admin_stats' }],
                [{ text: '🔙 Режим пользователя', callback_data: 'user_menu' }]
            ];

            const text = `🔧 <b>Панель администратора</b>\n\n${this.buildAdminOwnershipHint(adminContext, 'sales')}\n\nВыберите действие:`;
            if (ctx.callbackQuery) {
                await ctx.editMessageText(text, { reply_markup: { inline_keyboard: inlineKeyboard }, parse_mode: 'HTML' });
            } else {
                await ctx.reply(text, { reply_markup: { inline_keyboard: inlineKeyboard }, parse_mode: 'HTML' });
            }
        };

        // --- Пользовательское меню ---
        const sendUserMainMenu = async (ctx) => {
            try {
                const adminContext = await this.getBotAdminContext(botId);
                const ownerId = adminContext?.ownerId;
                if (!ownerId) return;

                const userRole = await this.getUserRole(ctx, botId);
                const isAdmin = userRole === 'admin';

                const inlineKeyboard = [];

                if (isAdmin) {
                    inlineKeyboard.push([{ text: '🔧 Админка', callback_data: 'admin_panel' }]);
                }

                inlineKeyboard.push([{ text: '💳 Покупка тарифа', callback_data: 'buy_tariff' }]);

                const existingReferralProfile = adminContext.referralEnabled
                    ? null
                    : await this.getReferralProfile(ownerId, ctx.from.id).catch(() => null);

                if (adminContext.referralEnabled || existingReferralProfile) {
                    inlineKeyboard.push([{ text: '🤝 Стать партнером', callback_data: 'referral_info' }]);
                }

                inlineKeyboard.push([{ text: '👤 Мой статус', callback_data: 'my_status' }]);

                const firstName = ctx.from?.first_name || '';
                const welcomeText = firstName ? `Добро пожаловать, ${firstName}!` : 'Добро пожаловать!';

                if (ctx.callbackQuery) {
                    await ctx.editMessageText(welcomeText, { reply_markup: { inline_keyboard: inlineKeyboard } });
                } else {
                    await ctx.reply(welcomeText, { reply_markup: { inline_keyboard: inlineKeyboard } });
                }
            } catch (error) {
                console.error('Ошибка меню:', error);
                console.error('Error details:', error.message);
                console.error('Stack:', error.stack);
            }
        };

        // --- Главное меню ---
        const sendMainMenu = async (ctx) => {
            if (normalizedRole === 'ops') {
                const adminContext = await this.getBotAdminContext(botId);
                const text = `🧭 <b>Бот-админ юзерботов</b>\n\nСюда прилетают сигналы о новых личках и мутных входящих от юзерботов.\n\nЕсли тут тишина, значит никто ничего не написал или сигналов пока нет.\n\n${this.buildAdminOwnershipHint(adminContext, 'ops')}\n\nОткрывай веб-панель и смотри <b>Центр юзербота</b>, когда надо быстро ответить человеку.`;
                return ctx.reply(text, { parse_mode: 'HTML' });
            }

            return sendUserMainMenu(ctx);
        };

        bot.start(async (ctx) => {
            try {
                const ownerId = await this.getBotOwner(botId);
                if (ownerId) {
                    const startText = ctx.message?.text || '';
                    const startPayload = startText.startsWith('/start ') ? startText.slice(7).trim() : '';
                    const displayName = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ').trim() || null;

                    if (startPayload.startsWith('ref_')) {
                        const settings = await this.getReferralSettings(ownerId);
                        const reserve = await loadReferralReserveState(this.supabase, ownerId, { ensure: true });

                        if (settings.referral_enabled && reserve.canAcceptNewPartners) {
                            await this.registerReferralLead({
                                ownerId,
                                referralCode: startPayload.replace(/^ref_/, ''),
                                referredTgUserId: ctx.from.id,
                                referredUsername: ctx.from?.username || null,
                                referredDisplayName: displayName,
                                rewardPercent: settings.referral_reward_percent,
                                clientDiscountPercent: settings.referral_client_discount_percent,
                                discountEligible: true,
                                reserveStatus: reserve.status
                            });

                            const welcomeText = settings.referral_welcome_text
                                || 'Тебя привели по партнерской ссылке. Скидка уже закреплена, выбирай тариф.';

                            await ctx.reply(`🤝 ${welcomeText}`);
                        } else {
                            await ctx.reply('🤝 Партнерская скидка по новой ссылке сейчас на паузе. Если ты уже был закреплен раньше, старые условия сохранятся.');
                        }
                    }
                }
            } catch (error) {
                console.error('Ошибка referral start payload:', error);
            }

            await sendMainMenu(ctx);
        });
        bot.action('back_to_main', async (ctx) => { await ctx.answerCbQuery(); sendMainMenu(ctx); });

        bot.action('open_referral', async (ctx) => {
            await ctx.answerCbQuery();

            try {
                const ownerId = await this.getBotOwner(botId);
                if (!ownerId) return;
                const settings = await this.getReferralSettings(ownerId);
                if (!settings.referral_enabled) {
                    return ctx.reply('Партнерка сейчас выключена. Если админ ее включит, кнопка появится сама.');
                }

                const displayName = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ').trim() || null;
                const existingProfile = await this.getReferralProfile(ownerId, ctx.from.id);
                const reserve = await loadReferralReserveState(this.supabase, ownerId, { ensure: true });

                if (!existingProfile && !reserve.canAcceptNewPartners) {
                    return ctx.reply('Партнерка сейчас не выдает новые ссылки: админ еще не пополнил резерв или резерв на паузе. Старые партнеры продолжают видеть свою статистику.');
                }

                const profile = existingProfile || await this.ensureReferralProfile(
                    ownerId,
                    ctx.from.id,
                    ctx.from?.username || null,
                    displayName
                );

                if (!profile) {
                    return ctx.reply('Рефералка пока не включена или SQL под нее еще не применен.');
                }

                const snapshot = await this.getReferralSnapshot(ownerId, ctx.from.id);
                const paidCount = (snapshot?.events || []).filter(event => event.event_type === 'reward_granted' && event.status === 'completed').length;
                const leadsCount = snapshot?.leads?.length || 0;
                const link = `https://t.me/${username}?start=ref_${profile.referral_code}`;

                await ctx.reply(
                    `💸 <b>Партнерка / рефералка</b>\n\nТвоя ссылка:\n<code>${link}</code>\n\nЛидов привел: <b>${leadsCount}</b>\nОплат закрыто: <b>${paidCount}</b>\nБаланс RUB: <b>${Number(profile.balance_rub || 0)}</b>\nБаланс TON: <b>${Number(profile.balance_ton || 0)}</b>\nБаланс USDT: <b>${Number(profile.balance_usdt || 0)}</b>\n\nШли эту ссылку тем, кому реально нужен продукт. Как только по ней придет первая оплата, бонус прилетит автоматически.`,
                    { parse_mode: 'HTML', disable_web_page_preview: true }
                );
            } catch (error) {
                console.error('Ошибка открытия рефералки:', error);
                await ctx.reply('Не получилось открыть партнерку.');
            }
        });

        bot.action(/^show_tariff_(.+)$/, async (ctx) => {
            const tariffId = ctx.match[1];
            await ctx.answerCbQuery();

            try {
                const { data: tariff } = await this.supabase.from('tariffs').select('*').eq('id', tariffId).single();
                if (!tariff) return ctx.reply('❌ Тариф не найден.');
                const { data: siblingTariffs } = await this.supabase.from('tariffs')
                    .select('*')
                    .eq('owner_id', tariff.owner_id)
                    .eq('is_active', true);
                const paymentGroup = this.findTariffPaymentGroup(siblingTariffs || [tariff], tariff);
                const paymentLines = this.sortTariffPaymentVariants(paymentGroup.variants)
                    .map((variant) => `• **${variant.price} ${variant.currency || 'TON'}**`)
                    .join('\n');

                const bundleItems = await this.getTariffBundleItems(tariff, tariff.owner_id);
                const channelItems = bundleItems.filter(item => item.item_type === 'channel' && item.channels);
                const resourceItems = bundleItems.filter(item => item.item_type === 'resource');
                const durationText = Number(tariff.duration_days) > 0 ? `${tariff.duration_days} дней` : 'Навсегда';
                let primaryChannel = null;
                if (tariff.channel_id) {
                    const { data } = await this.supabase.from('channels').select('id, title, tg_chat_id').eq('id', tariff.channel_id).single();
                    primaryChannel = data || null;
                }
                const telegramTargets = this.buildTelegramTargets(primaryChannel, channelItems.map(item => item.channels));

                const lines = [];
                if (telegramTargets.length > 0) {
                    lines.push('**Что входит в Telegram:**');
                    telegramTargets.forEach((channel, index) => lines.push(`${index + 1}. ${channel.title}`));
                } else {
                    lines.push('**Что входит:**');
                    lines.push('1. Материалы после оплаты');
                }

                if (resourceItems.length > 0) {
                    lines.push('');
                    lines.push('**Бонусы / материалы:**');
                    resourceItems.forEach((item, index) => lines.push(`${index + 1}. ${item.resource_title}`));
                }

                await ctx.reply(
                    `📦 **${this.getTariffDisplayTitle(tariff)}**\n\nЦена:\n${paymentLines}\nСрок: **${durationText}**\n\n${lines.join('\n')}`,
                    { parse_mode: 'Markdown' }
                );
            } catch (error) {
                console.error('Ошибка показа тарифа:', error);
                await ctx.reply('❌ Не получилось показать состав тарифа');
            }
        });

        // --- Генерация счета ---
        const createInvoiceForTariff = async (ctx, tariff) => {
            try {
                const bundleItems = await this.getTariffBundleItems(tariff, tariff.owner_id);
                const bundleSummary = this.formatTariffBundleSummary(tariff, bundleItems);

                const { data: settings } = await this.supabase.from('payment_settings').select('*').eq('owner_id', tariff.owner_id).single();
                if (!settings) return ctx.reply('❌ Администратор не настроил реквизиты.');

                const userId = ctx.from.id;
                const memo = 'sub_' + Math.random().toString(36).substr(2, 6);
                const referralAttribution = await this.getActiveReferralAttribution(tariff.owner_id, userId);
                const referralDiscountPercent = Number(referralAttribution?.client_discount_percent_snapshot || 0);
                const originalAmount = Number(tariff.price || 0);
                const invoiceAmount = referralDiscountPercent > 0
                    ? Number((originalAmount * (100 - referralDiscountPercent) / 100).toFixed(tariff.currency === 'RUB' ? 2 : 4))
                    : originalAmount;
                const referralDiscountAmount = Number((originalAmount - invoiceAmount).toFixed(tariff.currency === 'RUB' ? 2 : 4));

                const { error: insertErr } = await this.supabase.from('invoices').insert({
                    tg_user_id: userId, tariff_id: tariff.id, amount: invoiceAmount, currency: tariff.currency, memo: memo, status: 'pending'
                });

                if (insertErr) return ctx.reply(`❌ Ошибка БД при создании счета:\n${insertErr.message}`);

                const { data: createdInvoice } = await this.supabase
                    .from('invoices')
                    .select('id')
                    .eq('memo', memo)
                    .single();

                await this.logPaymentEvent({
                    ownerId: tariff.owner_id,
                    invoiceId: createdInvoice?.id,
                    provider: tariff.currency === 'RUB' ? 'manual_rub' : 'manual_ton',
                    eventType: 'invoice_created',
                    status: 'pending',
                    payload: {
                        tariff_id: tariff.id,
                        amount: invoiceAmount,
                        currency: tariff.currency,
                        memo,
                        referral_discount_percent: referralDiscountPercent,
                        referral_discount_amount: referralDiscountAmount,
                        original_amount: originalAmount,
                        referral_code: referralAttribution?.referral_code || null
                    }
                });

                if (tariff.currency === 'RUB') {
                    if (!settings.sbp_phone) return ctx.reply('❌ Реквизиты СБП не указаны.');
                    const sbpLines = [
                        `🏦 Банк: **${settings.sbp_bank || 'Не указан'}**`,
                        settings.sbp_fio ? `👤 Получатель: **${settings.sbp_fio}**` : null,
                        `📞 Реквизиты: \`${settings.sbp_phone}\``
                    ].filter(Boolean).join('\n');
                    const discountLine = referralDiscountPercent > 0
                        ? `\nСкидка по рефке: **-${referralDiscountPercent}%** (${referralDiscountAmount} RUB)\nЦена до скидки: **${originalAmount} RUB**`
                        : '';
                    const caption = `💳 **Оплата картой (СБП)**\n\nТариф: **${this.getTariffDisplayTitle(tariff)}**\nЧто входит: **${bundleSummary}**${discountLine}\nСумма: **${invoiceAmount} RUB**\n\n${sbpLines}\n\n⚠️ *Переведите точную сумму и нажмите «Я оплатил».*`;

                    await ctx.deleteMessage().catch(() => {});
                    await ctx.reply(caption, {
                        parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: [[{ text: '✅ Я оплатил!', callback_data: `fiat_paid_${memo}` }], [{ text: '🔙 Назад', callback_data: 'back_to_main' }]]}
                    });
                } else {
                    if (!settings.ton_wallet) return ctx.reply('❌ TON-кошелек не указан.');
                    const nanoTon = Math.round(invoiceAmount * 1000000000);
                    const tonUri = `ton://transfer/${settings.ton_wallet}?amount=${nanoTon}&text=${encodeURIComponent(memo)}`;
                    const qrBuffer = await QRCode.toBuffer(tonUri, { errorCorrectionLevel: 'H', margin: 2, width: 400 });

                    const discountLine = referralDiscountPercent > 0
                        ? `\nСкидка по рефке: **-${referralDiscountPercent}%** (${referralDiscountAmount} ${tariff.currency})\nЦена до скидки: **${originalAmount} ${tariff.currency}**`
                        : '';
                    const caption = `💎 **Счет сформирован!**\n\nТариф: **${this.getTariffDisplayTitle(tariff)}**\nЧто входит: **${bundleSummary}**${discountLine}\nСумма: **${invoiceAmount} ${tariff.currency}**\nКошелек: \`${settings.ton_wallet}\`\nКомментарий: \`${memo}\``;

                    await ctx.deleteMessage().catch(() => {});
                    await ctx.replyWithPhoto({ source: qrBuffer }, {
                        caption: caption, parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: [[{ text: '💸 Оплатить в 1 клик', url: tonUri }], [{ text: '🔄 Проверить оплату', callback_data: `check_payment_${memo}` }], [{ text: '🔙 Назад', callback_data: 'back_to_main' }]]}
                    });
                }
            } catch (err) { console.error('Ошибка счета:', err); }
        };

        bot.action(/^buy_(.+)$/, async (ctx) => {
            const tariffId = ctx.match[1];
            await ctx.answerCbQuery();

            try {
                const { data: tariff } = await this.supabase.from('tariffs').select('*').eq('id', tariffId).single();
                if (!tariff) return ctx.reply('❌ Тариф не найден.');
                const { data: siblingTariffs } = await this.supabase.from('tariffs')
                    .select('*')
                    .eq('owner_id', tariff.owner_id)
                    .eq('is_active', true);
                const paymentGroup = this.findTariffPaymentGroup(siblingTariffs || [tariff], tariff);

                if (paymentGroup.variants.length > 1) {
                    const keyboard = this.sortTariffPaymentVariants(paymentGroup.variants)
                        .map((variant) => ([{
                            text: `${this.getTariffCurrencyIcon(variant.currency)} ${variant.price} ${variant.currency || 'TON'}`,
                            callback_data: `pay_tariff_${variant.id}`
                        }]));
                    keyboard.push([{ text: '🔙 Назад', callback_data: 'back_to_main' }]);

                    await ctx.deleteMessage().catch(() => {});
                    await ctx.reply(
                        `Выберите способ оплаты для «${this.getTariffDisplayTitle(paymentGroup.lead)}»:`,
                        { reply_markup: { inline_keyboard: keyboard } }
                    );
                    return;
                }

                await createInvoiceForTariff(ctx, tariff);
            } catch (err) { console.error('Ошибка выбора способа оплаты:', err); }
        });

        bot.action(/^pay_tariff_(.+)$/, async (ctx) => {
            const tariffId = ctx.match[1];
            await ctx.answerCbQuery();

            try {
                const { data: tariff } = await this.supabase.from('tariffs').select('*').eq('id', tariffId).single();
                if (!tariff) return ctx.reply('❌ Тариф не найден.');
                await createInvoiceForTariff(ctx, tariff);
            } catch (err) { console.error('Ошибка выбранного способа оплаты:', err); }
        });

        // --- Кнопка "Я оплатил" ---
        bot.action(/fiat_paid_(.+)/, async (ctx) => {
            const memo = ctx.match[1];
            await ctx.answerCbQuery();

            const { data: invoice } = await this.supabase
                .from('invoices')
                .select('id, tariff_id, tg_user_id, status')
                .eq('memo', memo)
                .eq('tg_user_id', ctx.from.id)
                .maybeSingle();

            if (!invoice) {
                await ctx.editMessageText('Не нашел этот счет у тебя в истории. Открой оплату заново и повтори шаг.', { parse_mode: 'Markdown' });
                return;
            }

            await this.supabase
                .from('invoices')
                .update({ status: 'awaiting_receipt' })
                .eq('id', invoice.id)
                .eq('tg_user_id', ctx.from.id);

            if (invoice) {
                const { data: tariff } = await this.supabase.from('tariffs').select('owner_id').eq('id', invoice.tariff_id).single();
                await this.logPaymentEvent({
                    ownerId: tariff?.owner_id,
                    invoiceId: invoice.id,
                    provider: 'manual_rub',
                    eventType: 'receipt_requested',
                    status: 'awaiting_receipt',
                    payload: { memo }
                });
            }

            await ctx.editMessageText(`Отлично! Пожалуйста, **отправьте прямо в этот чат фотографию чека или PDF-файл** об успешном переводе.\nID платежа: \`${memo}\``, { parse_mode: 'Markdown' });
        });

        // --- Ловец чеков ---
        bot.on('message', async (ctx) => {
            if (ctx.chat.type === 'private' && ctx.message?.text) {
                const pendingWallet = pendingReferralWalletInputs.get(pendingReferralWalletKey(botId, ctx.from.id));
                if (pendingWallet) {
                    pendingReferralWalletInputs.delete(pendingReferralWalletKey(botId, ctx.from.id));

                    if (Date.now() - Number(pendingWallet.requestedAt || 0) > 15 * 60 * 1000) {
                        await ctx.reply('Ввод кошелька устарел. Нажми кнопку в партнерке еще раз.');
                        return;
                    }

                    try {
                        const result = await this.saveReferralPayoutWallet(pendingWallet.ownerId, ctx.from.id, ctx.message.text);
                        if (result.error) {
                            await ctx.reply(result.error);
                            return;
                        }

                        await ctx.reply(`Готово. TON-кошелек для выплат сохранен:\n<code>${result.wallet.ton_wallet}</code>`, {
                            parse_mode: 'HTML',
                            reply_markup: { inline_keyboard: [[{ text: '💸 Открыть партнерку', callback_data: 'referral_info' }]] }
                        });
                    } catch (error) {
                        console.error('Ошибка сохранения referral payout wallet:', error);
                        await ctx.reply('Не получилось сохранить TON-кошелек.');
                    }
                    return;
                }
            }

            if (!ctx.message || (!ctx.message.photo && !ctx.message.document)) return;
            if (ctx.chat.type !== 'private') return;

            const userId = ctx.from.id;

            try {
                const { data: invoices, error } = await this.supabase.from('invoices')
                    .select('*').eq('tg_user_id', userId).eq('status', 'awaiting_receipt').order('created_at', { ascending: false }).limit(1);
                const invoice = invoices && invoices.length > 0 ? invoices[0] : null;

                if (error || !invoice) return ctx.reply('⚠️ Я не жду от вас чек в данный момент.\nЕсли вы ошиблись скриншотом — напишите /start и пройдите процесс заново.', { parse_mode: 'Markdown' });

                let tariffName = 'Неизвестный тариф';
                if (invoice.tariff_id) {
                    const { data: tariff } = await this.supabase.from('tariffs').select('title').eq('id', invoice.tariff_id).single();
                    if (tariff) tariffName = tariff.title;
                }

                const ownerId = await this.getBotOwner(botId);
                const adminContext = await this.getBotAdminContext(botId, ownerId);

                if (!adminContext?.adminTgId) return ctx.reply('❌ Ошибка системы: у этого бота не указан Telegram ID админа.');

                await this.supabase.from('invoices').update({ status: 'wait_admin' }).eq('id', invoice.id);
                await this.logPaymentEvent({
                    ownerId,
                    invoiceId: invoice.id,
                    provider: 'manual_rub',
                    eventType: 'receipt_uploaded',
                    status: 'wait_admin',
                    payload: {
                        memo: invoice.memo,
                        tg_user_id: userId
                    }
                });

                const captionForAdmin = `🔔 **Новый чек на проверку!**\n\nПокупатель: @${ctx.from.username || 'Без юзернейма'} (ID: \`${userId}\`)\nТариф: **${tariffName}**\nСумма: **${invoice.amount} RUB**\n\nНажмите кнопку ниже после проверки.`;

                await ctx.telegram.copyMessage(adminContext.adminTgId, ctx.chat.id, ctx.message.message_id, {
                    caption: captionForAdmin, parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: '✅ Одобрить и выдать доступ', callback_data: `admin_approve_${invoice.memo}` }], [{ text: '❌ Отклонить (Фейк)', callback_data: `admin_reject_${invoice.memo}` }]]}
                });

                await ctx.reply(`✅ Чек успешно отправлен администратору!\nКак только он подтвердит перевод, бот пришлет вам ссылку.`);
            } catch (err) { await ctx.reply('❌ Произошла ошибка при отправке чека администратору.'); }
        });

        // --- Кнопки Админа ---
        bot.action(/admin_approve_(.+)/, async (ctx) => {
            const memo = ctx.match[1];
            try {
                const { data: invoice } = await this.supabase.from('invoices').select('*').eq('memo', memo).single();
                if (!invoice || invoice.status === 'paid') return ctx.answerCbQuery('Уже обработано!', { show_alert: true });

                await this.supabase.from('invoices').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('memo', memo);
                const { data: tariff } = await this.supabase.from('tariffs').select('owner_id').eq('id', invoice.tariff_id).single();
                await this.logPaymentEvent({
                    ownerId: tariff?.owner_id,
                    invoiceId: invoice.id,
                    provider: 'manual_rub',
                    eventType: 'admin_approved',
                    status: 'paid',
                    payload: { memo }
                });
                await this.activateSubscription(bot, invoice);
                await ctx.editMessageCaption(`✅ **Чек одобрен!**\nКлиенту (ID: ${invoice.tg_user_id}) выдана ссылка.`, { parse_mode: 'Markdown' });
            } catch (err) { console.error('Ошибка одобрения:', err); }
        });

        bot.action(/admin_reject_(.+)/, async (ctx) => {
            const memo = ctx.match[1];
            try {
                const { data: invoice } = await this.supabase.from('invoices').select('*').eq('memo', memo).single();
                if (!invoice) return ctx.answerCbQuery('Счет не найден', { show_alert: true });

                await this.supabase.from('invoices').update({ status: 'rejected' }).eq('memo', memo);
                const { data: tariff } = await this.supabase.from('tariffs').select('owner_id').eq('id', invoice.tariff_id).single();
                await this.logPaymentEvent({
                    ownerId: tariff?.owner_id,
                    invoiceId: invoice.id,
                    provider: 'manual_rub',
                    eventType: 'admin_rejected',
                    status: 'rejected',
                    payload: { memo }
                });
                await bot.telegram.sendMessage(invoice.tg_user_id, `❌ **Оплата отклонена администратором.**\nСвяжитесь с поддержкой.`, { parse_mode: 'Markdown' });
                await ctx.editMessageCaption(`❌ **Отклонено!**\nКлиент уведомлен.`, { parse_mode: 'Markdown' });
            } catch (err) { console.error('Ошибка отклонения:', err); }
        });

        // --- Проверка крипты ---
        bot.action(/check_payment_(.+)/, async (ctx) => {
            const memo = ctx.match[1];
            await ctx.answerCbQuery('Проверяем блокчейн...', { show_alert: true });
            try {
                const { data: invoice } = await this.supabase.from('invoices').select('*').eq('memo', memo).single();
                if (!invoice) return;
                if (invoice.status === 'paid') return ctx.reply('✅ Этот счет уже оплачен!');

                const ownerId = await this.getBotOwner(botId);
                const { data: settings } = await this.supabase.from('payment_settings').select('ton_wallet').eq('owner_id', ownerId).single();

                const isPaid = await this.checkTonPayment(memo, invoice.amount, settings.ton_wallet);
                await this.logPaymentEvent({
                    ownerId,
                    invoiceId: invoice.id,
                    provider: 'manual_ton',
                    eventType: 'ton_manual_check',
                    status: isPaid ? 'paid' : 'pending',
                    payload: { memo }
                });

                if (isPaid) {
                    await this.supabase.from('invoices').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('memo', memo);
                    await this.logPaymentEvent({
                        ownerId,
                        invoiceId: invoice.id,
                        provider: 'manual_ton',
                        eventType: 'ton_manual_confirmed',
                        status: 'paid',
                        payload: { memo }
                    });
                    await this.activateSubscription(bot, invoice);
                } else {
                    await ctx.reply(`⏳ **Оплата пока не найдена.**\nID заказа: \`${memo}\`\nПодождите пару минут и проверьте еще раз.`, { parse_mode: 'Markdown' });
                }
            } catch (err) { console.error('Ошибка в чекере крипты:', err); }
        });

        // --- Мой статус ---
        bot.action('check_status', async (ctx) => {
            await ctx.answerCbQuery();
            try {
                const { data: subs, error } = await this.supabase.from('subscriptions').select('*').eq('tg_user_id', ctx.from.id).eq('status', 'active');
                if (error || !subs || subs.length === 0) return ctx.reply(' У вас пока нет активных подписок или их срок истек. Выберите тариф в меню!');

                let message = '✅ **Ваши активные подписки:**\n\n';
                for (const sub of subs) {
                    let channelName = 'Закрытый канал';
                    if (sub.channel_id) {
                        const { data: ch } = await this.supabase.from('channels').select('title').eq('id', sub.channel_id).single();
                        if (ch) channelName = ch.title;
                    }
                    let expDate = '♾ Навсегда';
                    if (sub.expires_at) expDate = new Date(sub.expires_at).toLocaleDateString('ru-RU');
                    message += `🔹 **${channelName}**\n⏳ Доступ до: ${expDate}\n\n`;
                }
                await ctx.reply(message, { parse_mode: 'Markdown' });
            } catch (err) { console.error('Ошибка статуса:', err); }
        });

        // --- Обновленный мой статус ---
        bot.action('my_status', async (ctx) => {
            await ctx.answerCbQuery();
            try {
                const adminContext = await this.getBotAdminContext(botId);
                const ownerId = adminContext?.ownerId;
                if (!ownerId) return;

                const { data: subs, error } = await this.supabase
                    .from('subscriptions')
                    .select('*, channels(title)')
                    .eq('tg_user_id', ctx.from.id)
                    .eq('status', 'active');

                if (error || !subs || subs.length === 0) {
                    const msg = '📭 <b>Мой статус</b>\n\nУ вас пока нет активных подписок.\n\nВыберите тариф в главном меню, чтобы получить доступ к закрытым каналам и материалам.';
                    return ctx.reply(msg, { parse_mode: 'HTML' });
                }

                let message = '📭 <b>Мой статус</b>\n\n✅ <b>Ваши активные подписки:</b>\n\n';
                for (const sub of subs) {
                    const channelName = sub.channels?.title || 'Закрытый канал';
                    let expDate = '♾️ Навсегда';
                    if (sub.expires_at) {
                        const exp = new Date(sub.expires_at);
                        const now = new Date();
                        const daysLeft = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
                        if (daysLeft <= 0) {
                            expDate = '⚠️ Истек';
                        } else if (daysLeft === 1) {
                            expDate = 'Завтра истекает';
                        } else if (daysLeft <= 7) {
                            expDate = `${daysLeft} дн.`;
                        } else {
                            expDate = exp.toLocaleDateString('ru-RU');
                        }
                    }
                    message += `🔹 ${channelName}\n   ⏳ До: ${expDate}\n\n`;
                }

                message += `${this.buildAdminOwnershipHint(adminContext, 'sales')}`;
                await ctx.reply(message, { parse_mode: 'HTML' });
            } catch (err) {
                console.error('Ошибка my_status:', err);
                await ctx.reply('Не удалось загрузить статус.');
            }
        });

        // --- Информация о партнерке (из open_referral) ---
        bot.action('referral_info', async (ctx) => {
            await ctx.answerCbQuery();

            try {
                const ownerId = await this.getBotOwner(botId);
                if (!ownerId) return;
                const settings = await this.getReferralSettings(ownerId);
                const existingProfile = await this.getReferralProfile(ownerId, ctx.from.id);
                if (!settings.referral_enabled && !existingProfile) {
                    return ctx.reply('💸 Партнерская программа сейчас выключена. Если админ ее включит, кнопка появится сама.');
                }

                const displayName = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ').trim() || null;
                const reserve = await loadReferralReserveState(this.supabase, ownerId, { ensure: true });

                if (!existingProfile && !reserve.canAcceptNewPartners) {
                    return ctx.reply('💸 Новые партнерские ссылки сейчас на паузе: админ еще не пополнил резерв или резерв закончился. Старые партнеры продолжают работать по своим условиям.');
                }

                const profile = existingProfile || await this.ensureReferralProfile(
                    ownerId,
                    ctx.from.id,
                    ctx.from?.username || null,
                    displayName
                );

                if (!profile) {
                    return ctx.reply('💸 Партнерка пока не включена или SQL под нее еще не применен.');
                }

                const snapshot = await this.getReferralSnapshot(ownerId, ctx.from.id);
                const paidCount = (snapshot?.events || []).filter(event => event.event_type === 'reward_granted' && event.status === 'completed').length;
                const leadsCount = snapshot?.leads?.length || 0;
                const payoutMethod = await this.getReferralPayoutMethod(ownerId, ctx.from.id);
                const pendingPayout = await this.getPendingReferralPayout(ownerId, ctx.from.id);
                const minPayoutTon = getReferralEconomics().minPayoutTon;
                const balanceTon = Number(profile.balance_ton || 0);
                const walletText = payoutMethod?.ton_wallet
                    ? `<code>${payoutMethod.ton_wallet}</code>`
                    : 'не указан';
                const payoutText = pendingPayout
                    ? `\n⏳ Заявка на выплату: <b>${Number(pendingPayout.amount_ton || 0)} TON</b> (${pendingPayout.status})`
                    : '';
                const payoutKeyboard = [
                    [{ text: payoutMethod?.ton_wallet ? '✏️ Поменять TON-кошелек' : '➕ Указать TON-кошелек', callback_data: 'referral_wallet_setup' }]
                ];

                if (balanceTon >= minPayoutTon && payoutMethod?.ton_wallet && !pendingPayout) {
                    payoutKeyboard.push([{ text: `💸 Запросить выплату ${balanceTon} TON`, callback_data: 'referral_payout_request' }]);
                }

                payoutKeyboard.push([{ text: '🔄 Обновить', callback_data: 'referral_info' }]);

                await ctx.reply(
                    `💸 <b>Партнерская программа</b>\n\nТвоя партнерская ссылка:\n<code>t.me/${username}?start=ref_${profile.referral_code}</code>\n\n📊 Статистика:\n   Привлечено лидов: <b>${leadsCount}</b>\n   Закрыто оплат: <b>${paidCount}</b>\n\n💰 Баланс к выплате:\n   TON: <b>${balanceTon}</b>\n\n👛 Кошелек: ${walletText}${payoutText}\n\nМинимальная выплата: <b>${minPayoutTon} TON</b>. Шли ссылку тем, кому нужен продукт.`,
                    { parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: { inline_keyboard: payoutKeyboard } }
                );
            } catch (error) {
                console.error('Ошибка открытия рефералки:', error);
                await ctx.reply('Не получилось открыть партнерку.');
            }
        });

        bot.action('referral_wallet_setup', async (ctx) => {
            await ctx.answerCbQuery();

            try {
                const ownerId = await this.getBotOwner(botId);
                if (!ownerId) return;

                const existingProfile = await this.getReferralProfile(ownerId, ctx.from.id);
                if (!existingProfile) {
                    return ctx.reply('Сначала открой партнерку и получи свою ссылку.');
                }

                const pendingPayout = await this.getPendingReferralPayout(ownerId, ctx.from.id);
                if (pendingPayout) {
                    return ctx.reply('У тебя уже есть заявка на выплату. Кошелек можно поменять после обработки заявки.');
                }

                pendingReferralWalletInputs.set(pendingReferralWalletKey(botId, ctx.from.id), {
                    ownerId,
                    requestedAt: Date.now()
                });

                await ctx.reply('Пришли TON-кошелек одним сообщением. Обычно он начинается на UQ или EQ. Выплаты ниже 5 TON пока не отправляем.');
            } catch (error) {
                console.error('Ошибка запуска ввода payout wallet:', error);
                await ctx.reply('Не получилось открыть ввод кошелька.');
            }
        });

        bot.action('referral_payout_request', async (ctx) => {
            await ctx.answerCbQuery();

            try {
                const ownerId = await this.getBotOwner(botId);
                if (!ownerId) return;

                const result = await this.requestReferralPartnerPayout(ownerId, ctx.from.id);
                if (result.error) {
                    return ctx.reply(`💸 ${result.error}`);
                }

                await ctx.reply(`💸 Заявка создана: ${Number(result.payout.amount_ton || 0)} TON.\n\nАдмин увидит ее в партнерке и отправит выплату после проверки.`);
            } catch (error) {
                console.error('Ошибка создания payout request:', error);
                await ctx.reply('Не получилось создать заявку на выплату.');
            }
        });

        // --- Админ-меню обработчики ---
        bot.action('user_menu', async (ctx) => {
            await ctx.answerCbQuery();
            await sendUserMainMenu(ctx);
        });

        bot.action('admin_panel', async (ctx) => {
            await ctx.answerCbQuery();
            await sendAdminMenu(ctx);
        });

        bot.action('buy_tariff', async (ctx) => {
            await ctx.answerCbQuery();
            try {
                const adminContext = await this.getBotAdminContext(botId);
                const ownerId = adminContext?.ownerId;
                if (!ownerId) return;

                const { data: tariffs, error } = await this.supabase.from('tariffs')
                    .select('*').eq('owner_id', ownerId).eq('is_active', true).order('price', { ascending: true });

                if (error || !tariffs || tariffs.length === 0) {
                    const msg = '😔 К сожалению, сейчас нет доступных тарифов.';
                    return ctx.reply(msg);
                }

                const tariffGroups = this.buildTariffPaymentGroups(tariffs);
                const tariffsWithBundles = await Promise.all(tariffGroups.map(async group => ({
                    group,
                    tariff: group.lead,
                    bundleItems: await this.getTariffBundleItems(group.lead, ownerId)
                })));

                const inlineKeyboard = tariffsWithBundles.flatMap(({ group, tariff, bundleItems }) => {
                    const icon = this.getTariffGroupIcon(group);
                    const paymentOptions = this.formatTariffPaymentOptions(group.variants);
                    return [
                        [{ text: `${icon} ${this.getTariffDisplayTitle(tariff)} — ${paymentOptions}`, callback_data: `buy_${tariff.id}` }],
                        [{ text: `📦 ${this.formatTariffBundleSummary(tariff, bundleItems)}`, callback_data: `show_tariff_${tariff.id}` }]
                    ];
                });
                inlineKeyboard.push([{ text: '🔙 Назад', callback_data: 'back_to_main' }]);

                const text = `💳 <b>Выберите тариф</b>\n\n${this.buildAdminOwnershipHint(adminContext, 'sales')}`;
                await ctx.reply(text, { reply_markup: { inline_keyboard: inlineKeyboard }, parse_mode: 'HTML' });
            } catch (error) {
                console.error('Ошибка покупки тарифа:', error);
            }
        });

        bot.action('admin_tariffs', async (ctx) => {
            await ctx.answerCbQuery();
            await ctx.reply('⚙️ <b>Управление тарифами</b>\n\nДля управления тарифами используйте веб-панель:\n\n📱 Откройте <b>/app/plans</b> в админке\n\nТам можно:\n• Создавать и удалять тарифы\n• Менять цены и сроки\n• Настраивать комплекты\n\nИзменения сразу применяются в боте.', { parse_mode: 'HTML' });
        });

        bot.action('admin_referral', async (ctx) => {
            await ctx.answerCbQuery();
            try {
                const ownerId = await this.getBotOwner(botId);
                if (!ownerId) return;

                const snapshot = await this.getReferralSnapshot(ownerId, null);
                const totalEvents = snapshot?.events?.length || 0;
                const completedRewards = (snapshot?.events || []).filter(e => e.event_type === 'reward_granted' && e.status === 'completed').length;
                const totalLeads = snapshot?.leads?.length || 0;

                await ctx.reply(
                    `💸 <b>Статистика партнерки</b>\n\n📊 Общая статистика:\n   Всего лидов: <b>${totalLeads}</b>\n   Начислено бонусов: <b>${completedRewards}</b>\n   Всего событий: <b>${totalEvents}</b>\n\nДля управления партнеркой:\n📱 Откройте <b>/app/referrals</b> в админке`,
                    { parse_mode: 'HTML' }
                );
            } catch (error) {
                console.error('Ошибка admin_referral:', error);
                await ctx.reply('Не удалось загрузить статистику партнерки.');
            }
        });

        bot.action('admin_profile', async (ctx) => {
            await ctx.answerCbQuery();
            const adminContext = await this.getBotAdminContext(botId);
            await ctx.reply(
                `👤 <b>Профиль администратора</b>\n\n${this.buildAdminOwnershipHint(adminContext, 'sales')}\n\nДля управления профилем:\n📱 Откройте <b>/app/botfather</b> в админке`,
                { parse_mode: 'HTML' }
            );
        });

        bot.action('admin_stats', async (ctx) => {
            await ctx.answerCbQuery();
            try {
                const ownerId = await this.getBotOwner(botId);
                if (!ownerId) return;

                const { count: totalSubs } = await this.supabase
                    .from('subscriptions')
                    .select('*', { count: 'exact', head: true })
                    .eq('status', 'active');

                const { count: totalTariffs } = await this.supabase
                    .from('tariffs')
                    .select('*', { count: 'exact', head: true })
                    .eq('is_active', true);

                await ctx.reply(
                    `📊 <b>Статистика</b>\n\n📦 Активных подписок: <b>${totalSubs || 0}</b>\n💳 Активных тарифов: <b>${totalTariffs || 0}</b>\n\nДля подробной статистики:\n📱 Откройте <b>/app/analytics</b> в админке`,
                    { parse_mode: 'HTML' }
                );
            } catch (error) {
                console.error('Ошибка admin_stats:', error);
                await ctx.reply('Не удалось загрузить статистику.');
            }
        });

        // --- Пагинация тарифов ---
        bot.action(/^tariffs_page_(\d+)$/, async (ctx) => {
            await ctx.answerCbQuery();
            const page = parseInt(ctx.match[1], 10);
            try {
                const adminContext = await this.getBotAdminContext(botId);
                const ownerId = adminContext?.ownerId;
                if (!ownerId) return;

                const { data: tariffs, error } = await this.supabase.from('tariffs')
                    .select('*').eq('owner_id', ownerId).eq('is_active', true).order('price', { ascending: true });

                if (error || !tariffs) return;

                const tariffGroups = this.buildTariffPaymentGroups(tariffs);
                await sendPaginatedTariffsMenu(ctx, tariffGroups, ownerId, adminContext, page);
            } catch (error) {
                console.error('Ошибка пагинации:', error);
            }
        });

        // --- Категории тарифов ---
        bot.action(/^category_(.+)$/, async (ctx) => {
            await ctx.answerCbQuery();
            const category = ctx.match[1];
            try {
                const adminContext = await this.getBotAdminContext(botId);
                const ownerId = adminContext?.ownerId;
                if (!ownerId) return;

                const { data: tariffs, error } = await this.supabase.from('tariffs')
                    .select('*').eq('owner_id', ownerId).eq('is_active', true).order('price', { ascending: true });

                if (error || !tariffs) return;

                const tariffGroups = this.buildTariffPaymentGroups(tariffs);
                const categoryTariffs = tariffGroups.filter(group => this.getTariffCategory(group.lead) === category);

                if (categoryTariffs.length === 0) {
                    return ctx.reply('В этой категории пока нет тарифов.');
                }

                const tariffsWithBundles = await Promise.all(categoryTariffs.map(async group => ({
                    group,
                    tariff: group.lead,
                    bundleItems: await this.getTariffBundleItems(group.lead, ownerId)
                })));

                const inlineKeyboard = tariffsWithBundles.flatMap(({ group, tariff, bundleItems }) => {
                    const icon = this.getTariffGroupIcon(group);
                    const paymentOptions = this.formatTariffPaymentOptions(group.variants);
                    return [
                        [{ text: `${icon} ${this.getTariffDisplayTitle(tariff)} — ${paymentOptions}`, callback_data: `buy_${tariff.id}` }],
                        [{ text: `📦 ${this.formatTariffBundleSummary(tariff, bundleItems)}`, callback_data: `show_tariff_${tariff.id}` }]
                    ];
                });
                inlineKeyboard.push([{ text: '🔙 Назад', callback_data: 'back_to_main' }]);

                const categoryLabels = {
                    trial: '🧪 Пробные',
                    regular: '📦 Обычные',
                    bundle: '🎁 Комплекты',
                    premium: '💎 Премиум',
                    lifetime: '♾️ Навсегда'
                };
                const label = categoryLabels[category] || '📦 Тарифы';

                const text = `${label}\n\n${this.buildAdminOwnershipHint(adminContext, 'sales')}`;
                if (ctx.callbackQuery) {
                    await ctx.editMessageText(text, { reply_markup: { inline_keyboard: inlineKeyboard } });
                } else {
                    await ctx.reply(text, { reply_markup: { inline_keyboard: inlineKeyboard } });
                }
            } catch (error) {
                console.error('Ошибка категории:', error);
            }
        });

        // --- Слухач назначения bot-админом в канал/группу/чат ---
        bot.on('my_chat_member', async (ctx) => {
            const chat = ctx.myChatMember.chat;
            const newStatus = ctx.myChatMember.new_chat_member.status;
            if (newStatus === 'administrator') {
                try {
                    const ownerId = await this.getBotOwner(botId);
                    if (ownerId) {
                        await this.supabase.from('channels').upsert(
                            {
                                owner_id: ownerId,
                                bot_id: botId,
                                tg_chat_id: chat.id,
                                title: chat.title || String(chat.id),
                                chat_type: chat.type || 'channel'
                            },
                            { onConflict: 'tg_chat_id' }
                        );
                    }
                } catch (err) {}
            } else if (newStatus === 'left' || newStatus === 'kicked') {
                await this.supabase.from('channels').delete().eq('tg_chat_id', chat.id);
            }
        });

        // --- Контролируемый вход по пригласительным ссылкам ---
        bot.on('chat_join_request', async (ctx) => {
            try {
                const chatId = ctx.chatJoinRequest.chat.id;
                const tgUserId = ctx.chatJoinRequest.from.id;
                const channel = await this.getChannelByChatId(chatId);

                if (!channel) {
                    await ctx.telegram.declineChatJoinRequest(chatId, tgUserId).catch(() => {});
                    return;
                }

                const invite = await this.findLatestAccessInvite(channel.id, tgUserId);
                await this.logAccessEvent({
                    ownerId: channel.owner_id,
                    channelId: channel.id,
                    inviteId: invite?.id || null,
                    subscriptionId: invite?.subscription_id || null,
                    invoiceId: invite?.invoice_id || null,
                    tgUserId,
                    eventType: 'join_requested',
                    eventSource: 'official_bot',
                    payload: {
                        chat_id: String(chatId)
                    }
                });

                await this.supabase
                    .from('subscriptions')
                    .update({
                        last_join_request_at: new Date().toISOString(),
                        last_access_event: 'join_requested'
                    })
                    .eq('channel_id', channel.id)
                    .eq('tg_user_id', String(tgUserId));

                const hasAccess = await this.hasActiveSubscription(tgUserId, channel.id);
                if (hasAccess) {
                    await ctx.telegram.approveChatJoinRequest(chatId, tgUserId);
                    if (invite) {
                        await this.supabase
                            .from('access_invites')
                            .update({
                                status: 'approved',
                                used_at: new Date().toISOString()
                            })
                            .eq('id', invite.id);
                    }

                    await this.supabase
                        .from('subscriptions')
                        .update({
                            last_join_approved_at: new Date().toISOString(),
                            last_access_event: 'join_approved'
                        })
                        .eq('channel_id', channel.id)
                        .eq('tg_user_id', String(tgUserId));

                    await this.logAccessEvent({
                        ownerId: channel.owner_id,
                        channelId: channel.id,
                        inviteId: invite?.id || null,
                        subscriptionId: invite?.subscription_id || null,
                        invoiceId: invite?.invoice_id || null,
                        tgUserId,
                        eventType: 'join_approved',
                        eventSource: 'official_bot',
                        payload: {
                            chat_id: String(chatId)
                        }
                    });

                    await ctx.telegram.sendMessage(
                        tgUserId,
                        `✅ Доступ в «${channel.title || 'закрытый канал'}» подтвержден. Добро пожаловать!`
                    ).catch(() => {});
                    return;
                }

                await ctx.telegram.declineChatJoinRequest(chatId, tgUserId);
                if (invite) {
                    await this.supabase
                        .from('access_invites')
                        .update({
                            status: 'declined',
                            used_at: new Date().toISOString()
                        })
                        .eq('id', invite.id);
                }

                await this.supabase
                    .from('subscriptions')
                    .update({
                        last_access_event: 'join_declined',
                        access_note: 'Отклонен join request: нет активной подписки'
                    })
                    .eq('channel_id', channel.id)
                    .eq('tg_user_id', String(tgUserId));

                await this.logAccessEvent({
                    ownerId: channel.owner_id,
                    channelId: channel.id,
                    inviteId: invite?.id || null,
                    subscriptionId: invite?.subscription_id || null,
                    invoiceId: invite?.invoice_id || null,
                    tgUserId,
                    eventType: 'join_declined',
                    eventSource: 'official_bot',
                    payload: {
                        chat_id: String(chatId),
                        reason: 'no_active_subscription'
                    }
                });

                await ctx.telegram.sendMessage(
                    tgUserId,
                    `⛔ Доступ в «${channel.title || 'закрытый канал'}» не подтвержден. Сначала оформи или продли подписку через этого бота.`
                ).catch(() => {});
            } catch (error) {
                console.error('Ошибка обработки chat_join_request:', error);
            }
        });

        bot.launch().then(() => console.log(`🤖 Бот @${username} успешно запущен!`));
        activeBots.set(botId, bot);
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
                ? `Материалы: **отправлены**`
                : finalExpiresAt
                    ? `Продлен до: **${new Date(finalExpiresAt).toLocaleDateString('ru-RU')}**`
                    : `Доступ: **Навсегда**`;

            const accessLines = inviteLinks
                .map((item, index) => `${index + 1}. **${item.title}**\n👉 ${item.url}`)
                .join('\n\n') || 'Telegram-доступ в этом тарифе не включен.';

            const resourceLines = resourceTargets.length > 0
                ? `\n\n**Доп. материалы:**\n${resourceTargets.map((item, index) => this.formatResourceLine(item, index)).join('\n\n')}`
                : '';
            const deliveryNote = telegramTargets.length > 0
                ? '\n\nВсе ссылки работают через запрос на вступление. Бот пропустит только аккаунт с активной подпиской.'
                : '';

            await bot.telegram.sendMessage(
                invoice.tg_user_id,
                `🎉 **Оплата успешно подтверждена!**\n\nТариф: «${this.getTariffDisplayTitle(tariff)}»\n⏳ ${expText}\n\n**Что ты получил:**\n${accessLines}${resourceLines}${deliveryNote}`,
                { parse_mode: 'Markdown', disable_web_page_preview: true }
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
                        `🔥 **Что дальше**\n\nТы сейчас зашел через пробник. Если захочешь остаться надолго, следующий шаг уже готов:\n\n**${upsellTariff.title}**\n💰 ${upsellTariff.price} ${upsellTariff.currency}\n⏳ ${upsellDuration}\n\nНапиши /start и выбери основной тариф, когда будешь готов зайти плотнее.`,
                        { parse_mode: 'Markdown' }
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
