// Хелперы хендлера POST /admin/items (стадия 2 разрезки shop.routes.js).
// Куски тела единственного хендлера вынесены из items-create.js по решению
// владельца (§7 плана): дословные обёртки function + передача аргументов,
// логика не менялась (отступы кусков сохранены из исходного хендлера).
// Контракт: saveTextServiceItem/saveAssetItem сами отправляют ответ на всех
// не-throw путях; validateLotAssets возвращает res, если отправил ответ 400
// (вызов в items-create.js прерывает хендлер), иначе undefined.
import {
    isMissingDeliveryModeColumn,
    isMissingPaymentMethodsColumn,
    isMissingSalesChannelColumn,
    isMissingShopTables,
    normalizeItem
} from './helpers.js';
import {
    loadOwnerUserbotProxyUsage,
    proxyHasMultipleUserbots,
    proxyHasUserbot
} from './purchase-core.js';
import {
    ACCOUNT_LOT_NOT_READY_MESSAGE,
    findUnsellableAccountLot
} from '../../services/shop-delivery.service.js';

export async function saveTextServiceItem({
    supabase, res, ownerId, id,
    title, description, post_purchase_message, price_ton, status, visibility, preview_text,
    normalizedPaymentMethods, normalizedSalesChannel, normalizedOfferCode
}) {
                const itemPayload = {
                    owner_id: ownerId,
                    title: String(title).trim(),
                    description: description || null,
                    post_purchase_message: post_purchase_message || null,
                    item_type: 'text_offer',
                    price_ton: Number(price_ton || 0),
                    status: status || 'draft',
                    visibility: visibility || 'public',
                    sales_channel: normalizedSalesChannel,
                    preview_text: preview_text || null,
                    payment_methods: normalizedPaymentMethods,
                    offer_code: normalizedOfferCode,
                    transfer_mode: 'post_purchase_message'
                };

                let savedItem = null;
                if (id) {
                    const { data, error } = await supabase
                        .from('shop_items')
                        .update(itemPayload)
                        .eq('id', id)
                        .eq('owner_id', ownerId)
                        .select('*')
                        .single();
                    if (error) {
                        if (isMissingPaymentMethodsColumn(error) || isMissingSalesChannelColumn(error)) {
                            const legacyPayload = { ...itemPayload };
                            delete legacyPayload.payment_methods;                            delete legacyPayload.sales_channel;
                            const legacy = await supabase
                                .from('shop_items')
                                .update(legacyPayload)
                                .eq('id', id)
                                .eq('owner_id', ownerId)
                                .select('*')
                                .single();
                            if (legacy.error) throw legacy.error;
                            savedItem = { ...legacy.data, payment_methods: normalizedPaymentMethods };
                        } else if (isMissingShopTables(error)) {
                            return res.status(400).json({ error: 'Сначала примени SQL под shop foundation' });
                        } else {
                            throw error;
                        }
                    } else {
                        savedItem = data;
                    }

                    await supabase
                        .from('shop_item_assets')
                        .delete()
                        .eq('shop_item_id', id);
                } else {
                    const { data, error } = await supabase
                        .from('shop_items')
                        .insert(itemPayload)
                        .select('*')
                        .single();
                    if (error) {
                        if (isMissingPaymentMethodsColumn(error) || isMissingSalesChannelColumn(error)) {
                            const legacyPayload = { ...itemPayload };
                            delete legacyPayload.payment_methods;                            delete legacyPayload.sales_channel;
                            const legacy = await supabase
                                .from('shop_items')
                                .insert(legacyPayload)
                                .select('*')
                                .single();
                            if (legacy.error) throw legacy.error;
                            savedItem = { ...legacy.data, payment_methods: normalizedPaymentMethods };
                        } else if (isMissingShopTables(error)) {
                            return res.status(400).json({ error: 'Сначала примени SQL под shop foundation' });
                        } else {
                            throw error;
                        }
                    } else {
                        savedItem = data;
                    }
                }

                return res.json({
                    success: true,
                    item: normalizeItem(savedItem)
                });
}

export async function validateLotAssets({
    supabase, res, ownerId, id, assets, status, isAccountItem
}) {
            const { usage: proxyUsageMap } = await loadOwnerUserbotProxyUsage(supabase, ownerId);
            const proxyIds = assets.filter(asset => asset.asset_type === 'proxy').map(asset => asset.asset_id);
            const userbotIds = assets.filter(asset => asset.asset_type === 'userbot').map(asset => asset.asset_id);
            const baseIds = assets.filter(asset => asset.asset_type === 'channel_audience_asset').map(asset => asset.asset_id);
            const assetKeys = assets.map(asset => `${asset.asset_type}:${asset.asset_id}`);

            if (proxyIds.length > 0) {
                const { data: rows, error } = await supabase
                    .from('proxies')
                    .select('id')
                    .eq('owner_id', ownerId)
                    .in('id', proxyIds);
                if (error) throw error;
                if ((rows || []).length !== proxyIds.length) {
                    return res.status(400).json({ error: 'В лоте есть чужие или несуществующие прокси' });
                }

                const listedProxy = proxyIds.find(proxyId => proxyHasUserbot(proxyUsageMap, proxyId));
                if (listedProxy) {
                    return res.status(400).json({ error: 'На прокси есть живой юзербот — нельзя выставлять на продажу.' });
                }
            }

            if (userbotIds.length > 0) {
                const { data: rows, error } = await supabase
                    .from('tg_accounts')
                    .select('id, proxy_id, runtime_status, last_checked_at, tg_username, custom_label, health_summary')
                    .eq('owner_id', ownerId)
                    .eq('account_type', 'userbot')
                    .in('id', userbotIds);
                if (error) throw error;
                if ((rows || []).length !== userbotIds.length) {
                    return res.status(400).json({ error: 'В лоте есть чужие или несуществующие юзерботы' });
                }

                if (isAccountItem) {
                    // Аккаунт-лоты (intake): pending_activation со свежей чистой
                    // проверкой — продаваемый сток, а не карантин. Остальные
                    // плохие статусы и устаревшая проверка — в отстойник.
                    const blockedAccount = findUnsellableAccountLot(rows);
                    if (blockedAccount) {
                        return res.status(400).json({ error: ACCOUNT_LOT_NOT_READY_MESSAGE });
                    }
                } else {
                    // Мёртвые сессии тоже нельзя продавать: покупатель получит
                    // неактивный аккаунт (расширение правила AGENTS.md про blocked/restricted).
                    // error — проверка не прошла (например, заморозка Telegram, когда
                    // getMe не укладывается в таймаут): такие тоже в отстойник.
                    const quarantineStatuses = ['restricted', 'pending_activation', 'expired', 'dead_proxy', 'error', 'frozen'];
                    const blockedUserbot = (rows || []).find(row =>
                        quarantineStatuses.includes(String(row.runtime_status || '').trim().toLowerCase())
                    );
                    if (blockedUserbot) {
                        return res.status(400).json({ error: `Юзербот @${blockedUserbot.tg_username || blockedUserbot.id} проблемный (${blockedUserbot.runtime_status}) — публикация невозможна` });
                    }

                    // Публикуем только с живой проверкой: без этого аккаунт мог испортиться
                    // после последней проверки и отстойник об этом еще не знает.
                    if (String(status || '') === 'published') {
                        const freshCutoffMs = 6 * 60 * 60 * 1000;
                        const staleUserbot = (rows || []).find(row => {
                            const checkedAt = row.last_checked_at ? new Date(row.last_checked_at).getTime() : 0;
                            return !checkedAt || (Date.now() - checkedAt) > freshCutoffMs;
                        });
                        if (staleUserbot) {
                            return res.status(400).json({ error: `У юзербота @${staleUserbot.tg_username || staleUserbot.id} устаревшая проверка — запусти «Проверить Telegram» и публикуй после неё` });
                        }
                    }
                }

                const sharedUserbot = (rows || []).find(row => row.proxy_id && proxyHasMultipleUserbots(proxyUsageMap, row.proxy_id));
                if (sharedUserbot) {
                    return res.status(400).json({ error: 'Нельзя продавать юзербота, если его прокси одновременно висит еще на другом юзерботе.' });
                }
            }

            if (baseIds.length > 0) {
                const { data: rows, error } = await supabase
                    .from('channel_audiences')
                    .select('id')
                    .eq('owner_id', ownerId)
                    .in('id', baseIds);
                if (error && !(error.message || '').includes('channel_audiences')) throw error;
                if (error && (error.message || '').includes('channel_audiences')) {
                    return res.status(400).json({ error: 'Таблица channel_audiences недоступна. Базы пока нельзя продавать.' });
                }
                if ((rows || []).length !== baseIds.length) {
                    return res.status(400).json({ error: 'В лоте есть чужие или несуществующие базы' });
                }
            }

            const { data: existingItems, error: existingItemsError } = await supabase
                .from('shop_items')
                .select('id, title, status')
                .eq('owner_id', ownerId)
                .in('status', ['draft', 'published']);

            if (existingItemsError) {
                if (isMissingShopTables(existingItemsError)) {
                    return res.status(400).json({ error: 'Сначала примени SQL под shop foundation' });
                }
                throw existingItemsError;
            }

            const candidateItems = (existingItems || []).filter(item => String(item.id) !== String(id || ''));
            if (candidateItems.length > 0) {
                const { data: existingAssets, error: existingAssetsError } = await supabase
                    .from('shop_item_assets')
                    .select('shop_item_id, asset_type, asset_id')
                    .in('shop_item_id', candidateItems.map(item => item.id));

                if (existingAssetsError) {
                    if (isMissingShopTables(existingAssetsError)) {
                        return res.status(400).json({ error: 'Сначала примени SQL под shop foundation' });
                    }
                    throw existingAssetsError;
                }

                const duplicateAsset = (existingAssets || []).find(asset =>
                    assetKeys.includes(`${asset.asset_type}:${asset.asset_id}`)
                );

                if (duplicateAsset) {
                    const ownerItem = candidateItems.find(item => String(item.id) === String(duplicateAsset.shop_item_id));
                    return res.status(400).json({
                        error: `Этот актив уже выставлен в другом лоте${ownerItem?.title ? `: ${ownerItem.title}` : ''}`
                    });
                }
            }
}

export async function saveAssetItem({
    supabase, res, ownerId, id,
    title, description, post_purchase_message, normalizedItemType, price_ton, status, visibility,
    normalizedSalesChannel, preview_text, normalizedPaymentMethods, normalizedOfferCode,
    transfer_mode, isAccountItem, normalizedDeliveryMode, assets
}) {
            const itemPayload = {
                owner_id: ownerId,
                title: String(title).trim(),
                description: description || null,
                post_purchase_message: post_purchase_message || null,
                item_type: normalizedItemType,
                price_ton: Number(price_ton || 0),                status: status || 'draft',
                visibility: visibility || 'public',
                sales_channel: normalizedSalesChannel,
                preview_text: preview_text || null,
                payment_methods: normalizedPaymentMethods,
                offer_code: normalizedOfferCode,
                transfer_mode: transfer_mode || 'ownership_transfer',
                delivery_mode: isAccountItem ? normalizedDeliveryMode : null
            };

            let savedItem = null;
            if (id) {
                const { data, error } = await supabase
                    .from('shop_items')
                    .update(itemPayload)
                    .eq('id', id)
                    .eq('owner_id', ownerId)
                    .select('*')
                    .single();
                if (error) {
                    if (isMissingPaymentMethodsColumn(error) || isMissingSalesChannelColumn(error) || isMissingDeliveryModeColumn(error)) {
                        const legacyPayload = { ...itemPayload };
                        delete legacyPayload.payment_methods;                        delete legacyPayload.sales_channel;
                        delete legacyPayload.delivery_mode;
                        const legacy = await supabase
                            .from('shop_items')
                            .update(legacyPayload)
                            .eq('id', id)
                            .eq('owner_id', ownerId)
                            .select('*')
                            .single();
                        if (legacy.error) throw legacy.error;
                        savedItem = { ...legacy.data, payment_methods: normalizedPaymentMethods };
                    } else if (isMissingShopTables(error)) {
                        return res.status(400).json({ error: 'Сначала примени SQL под shop foundation' });
                    } else {
                        throw error;
                    }
                } else {
                    savedItem = data;
                }

                const { error: deleteAssetsError } = await supabase
                    .from('shop_item_assets')
                    .delete()
                    .eq('shop_item_id', id);
                if (deleteAssetsError) throw deleteAssetsError;
            } else {
                const { data, error } = await supabase
                    .from('shop_items')
                    .insert(itemPayload)
                    .select('*')
                    .single();
                if (error) {
                    if (isMissingPaymentMethodsColumn(error) || isMissingSalesChannelColumn(error) || isMissingDeliveryModeColumn(error)) {
                        const legacyPayload = { ...itemPayload };
                        delete legacyPayload.payment_methods;                        delete legacyPayload.sales_channel;
                        delete legacyPayload.delivery_mode;
                        const legacy = await supabase
                            .from('shop_items')
                            .insert(legacyPayload)
                            .select('*')
                            .single();
                        if (legacy.error) throw legacy.error;
                        savedItem = { ...legacy.data, payment_methods: normalizedPaymentMethods };
                    } else if (isMissingShopTables(error)) {
                        return res.status(400).json({ error: 'Сначала примени SQL под shop foundation' });
                    } else {
                        throw error;
                    }
                } else {
                    savedItem = data;
                }
            }

            const assetRows = assets.map((asset, index) => ({
                shop_item_id: savedItem.id,
                asset_type: asset.asset_type,
                asset_id: asset.asset_id,
                label: asset.label || null,
                sort_order: index
            }));

            const { error: assetInsertError } = await supabase
                .from('shop_item_assets')
                .insert(assetRows);
            if (assetInsertError) throw assetInsertError;

            res.json({
                success: true,
                item: normalizeItem(savedItem)
            });
}
