// Чистые форматтеры тарифов/меню/оплат — вынесены дословно из official-bot.service.js
// (behavior-preserving разрезка под pre-commit лимит; тела не менялись, кроме this.x() -> x()).

export function formatTariffBundleSummary(tariff, bundleItems = []) {
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

export function getTariffDisplayTitle(tariff) {
    if (tariff?.is_trial) {
        return tariff.trial_label || `${tariff.title} (пробник)`;
    }
    return tariff?.title || 'Тариф';
}

export function buildTelegramTargets(primaryChannel, channelTargets = []) {
    const targetsById = new Map();
    [primaryChannel, ...channelTargets].filter(Boolean).forEach((channel) => {
        const key = String(channel.id || channel.tg_chat_id || '').trim();
        if (!key || targetsById.has(key)) return;
        targetsById.set(key, channel);
    });
    return Array.from(targetsById.values());
}

export function escapeMarkdownText(value) {
    return String(value || '').replace(/([_*[\]()`])/g, '\\$1');
}

export function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export function formatResourceLine(item, index) {
    const title = escapeHtml(item.title || 'Материал');
    const value = escapeHtml(item.url || '');
    return `${index + 1}. <b>${title}</b>\n${value}`;
}

export function getTariffPaymentGroupKey(tariff) {
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

export function sortTariffPaymentVariants(variants = []) {
    // RUB убран из валют продукта: в меню попадают только активные тарифы (TON/USDT), порядок TON → USDT сохранён
    const currencyOrder = { TON: 1, USDT: 2 };
    return [...variants].sort((left, right) => {
        const leftCurrency = String(left.currency || '').toUpperCase();
        const rightCurrency = String(right.currency || '').toUpperCase();
        const byCurrency = (currencyOrder[leftCurrency] || 99) - (currencyOrder[rightCurrency] || 99);
        if (byCurrency !== 0) return byCurrency;
        return Number(left.price || 0) - Number(right.price || 0);
    });
}

export function buildTariffPaymentGroups(tariffs = []) {
    const groupsByKey = new Map();
    tariffs.forEach((tariff) => {
        const key = getTariffPaymentGroupKey(tariff);
        if (!groupsByKey.has(key)) {
            groupsByKey.set(key, { key, variants: [] });
        }
        groupsByKey.get(key).variants.push(tariff);
    });

    return Array.from(groupsByKey.values())
        .map((group) => {
            const variants = sortTariffPaymentVariants(group.variants);
            return {
                ...group,
                lead: variants[0],
                variants
            };
        })
        .sort((left, right) => Number(left.lead?.price || 0) - Number(right.lead?.price || 0));
}

export function findTariffPaymentGroup(tariffs = [], sourceTariff) {
    const sourceKey = getTariffPaymentGroupKey(sourceTariff);
    return buildTariffPaymentGroups(tariffs).find((group) => group.key === sourceKey)
        || { key: sourceKey, lead: sourceTariff, variants: [sourceTariff] };
}

export function formatDiscountedAmount(amount, currency, discountPercent) {
    const numericAmount = Number(amount || 0);
    const percent = Number(discountPercent || 0);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0 || !Number.isFinite(percent) || percent <= 0) {
        return numericAmount;
    }
    return Number((numericAmount * (100 - percent) / 100).toFixed(4));
}

export function formatTariffPaymentOptions(variants = [], discountPercent = 0) {
    return sortTariffPaymentVariants(variants)
        .map((variant) => {
            const currency = variant.currency || 'TON';
            const price = Number(variant.price || 0);
            if (price === 0) return 'Бесплатно';
            const discountedPrice = formatDiscountedAmount(price, currency, discountPercent);
            if (Number(discountPercent || 0) > 0 && discountedPrice < price) {
                return `${discountedPrice} ${currency} вместо ${price}`;
            }
            return `${price} ${currency}`;
        })
        .join(' / ');
}

export function getTariffGroupIcon() {
    return '💎';
}

export function getTariffCategory(tariff) {
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

export function buildTariffCategories(tariffs = []) {
    const categories = {
        trial: [],
        regular: [],
        bundle: [],
        premium: [],
        lifetime: []
    };

    tariffs.forEach((tariff) => {
        const category = getTariffCategory(tariff);
        if (categories[category]) {
            categories[category].push(tariff);
        }
    });

    return Object.entries(categories)
        .filter(([_, items]) => items.length > 0)
        .map(([category, items]) => ({ category, items }));
}

export function buildPaginatedTariffMenu(tariffs = [], page = 0, perPage = 5) {
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
