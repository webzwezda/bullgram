import { ACCOUNT_LOT_NOT_READY_MESSAGE } from '../../services/shop-delivery.service.js';
import { buildAccountLotTitle } from '../../utils/phone-country.js';
import { accountSaleRuleState } from '../../utils/account-sale-rules.js';
import {
    isMissingDeliveryModeColumn,
    isMissingPaymentMethodsColumn,
    isMissingSalesChannelColumn,
    isMissingShopTables
} from './helpers.js';

// Массовое выставление аккаунтов (intake-сток) на витрину: один опубликованный
// лот item_type='account' на каждый актив. Падение одного аккаунта не мешает
// остальным — собираем per-asset результаты.
export async function createAccountLotsBatch(supabase, { ownerId, assetIds, priceTon, title, description = null, deliveryMode = 'hybrid' }) {
    const ids = Array.from(new Set(
        (Array.isArray(assetIds) ? assetIds : [])
            .map((value) => String(value || '').trim())
            .filter(Boolean)
    ));
    if (!ids.length) {
        const error = new Error('Выбери хотя бы один аккаунт');
        error.statusCode = 400;
        throw error;
    }
    // Название генерируется сервером на аккаунт (страна по телефону + срок
    // отлёжки); явный title остаётся как override для тестов/особых случаев.
    const explicitTitle = String(title || '').trim();
    const normalizedPriceTon = Number(priceTon || 0);
    if (!(normalizedPriceTon > 0)) {
        const error = new Error('Укажи цену лота в TON');
        error.statusCode = 400;
        throw error;
    }
    // Пачкой выставляем только выдачу в духе витрины: hybrid/files. Ручной
    // 'transfer' остаётся сценарием одиночных лотов через POST /admin/items.
    const normalizedDeliveryMode = ['hybrid', 'files'].includes(String(deliveryMode || '').trim().toLowerCase())
        ? String(deliveryMode).trim().toLowerCase()
        : 'hybrid';

    const { data: accountRows, error: accountsError } = await supabase
        .from('tg_accounts')
        .select('id, custom_label, runtime_status, last_checked_at, health_summary, tg_phone, created_at, proxy_id')
        .eq('owner_id', ownerId)
        .eq('account_type', 'userbot')
        .in('id', ids);
    if (accountsError) throw accountsError;
    const accountById = new Map((accountRows || []).map((row) => [String(row.id), row]));

    // Полное правило продажи (решение владельца 2026-11-03): tdata-блоб +
    // отлёжка + свежая проверка. Без restore source с tdata аккаунт не
    // выставляется вообще — покупатель обязан получить полный комплект.
    const { data: ruleSources, error: ruleSourcesError } = await supabase
        .from('userbot_restore_sources')
        .select('account_id, tdata_blob_encrypted')
        .eq('owner_id', ownerId)
        .in('account_id', ids);
    if (ruleSourcesError) throw ruleSourcesError;
    const hasTdataByAccountId = new Map(
        (ruleSources || []).map((row) => [String(row.account_id), Boolean(row.tdata_blob_encrypted)])
    );

    const { data: existingItems, error: existingItemsError } = await supabase
        .from('shop_items')
        .select('id')
        .eq('owner_id', ownerId)
        .in('status', ['draft', 'published']);
    if (existingItemsError) {
        if (isMissingShopTables(existingItemsError)) {
            const error = new Error('Сначала примени SQL под shop foundation');
            error.statusCode = 400;
            throw error;
        }
        throw existingItemsError;
    }

    const listedAssetKeys = new Set();
    if ((existingItems || []).length > 0) {
        const { data: existingAssets, error: existingAssetsError } = await supabase
            .from('shop_item_assets')
            .select('shop_item_id, asset_type, asset_id')
            .in('shop_item_id', (existingItems || []).map((item) => item.id));
        if (existingAssetsError) throw existingAssetsError;
        for (const asset of existingAssets || []) {
            listedAssetKeys.add(`${asset.asset_type}:${asset.asset_id}`);
        }
    }

    // files-выдача после продажи удаляет нашу копию аккаунта: разрешаем её
    // только для приёмочного стока (restore source с intake_batch_id) — иначе
    // проданный «в файлы» рабочий юзербот был бы уничтожен пуржем (ревью P2).
    let intakeAssetIds = new Set();
    if (normalizedDeliveryMode === 'files') {
        const { data: intakeSources, error: intakeSourcesError } = await supabase
            .from('userbot_restore_sources')
            .select('account_id')
            .in('account_id', ids)
            .not('intake_batch_id', 'is', null);
        if (intakeSourcesError) throw intakeSourcesError;
        intakeAssetIds = new Set((intakeSources || []).map((row) => String(row.account_id)));
    }

    const results = [];
    let created = 0;

    for (const assetId of ids) {
        const account = accountById.get(assetId);
        if (!account) {
            results.push({ asset_id: assetId, status: 'failed', error: 'Аккаунт не найден или чужой' });
            continue;
        }
        // Гейт правила продажи — поглощает прежний fresh-check: тот же текст
        // для плохих статусов, честные причины для tdata/отлёжки.
        const rule = accountSaleRuleState({
            runtime_status: account.runtime_status,
            last_checked_at: account.last_checked_at,
            health_summary: account.health_summary,
            created_at: account.created_at,
            has_tdata: hasTdataByAccountId.get(String(assetId)) === true
        });
        if (!rule.sellable) {
            results.push({ asset_id: assetId, status: 'failed', error: rule.reasons[0] || ACCOUNT_LOT_NOT_READY_MESSAGE });
            continue;
        }
        // 1 прокси = 1 юзербот: аккаунт уходит покупателю вместе со своим
        // прокси (трансфер переводит владение), без прокси лот не выставляем.
        if (!account.proxy_id) {
            results.push({ asset_id: assetId, status: 'failed', error: 'К аккаунту не привязан прокси — продажа без прокси запрещена (1 прокси = 1 юзербот).' });
            continue;
        }
        if (listedAssetKeys.has(`userbot:${assetId}`)) {
            results.push({ asset_id: assetId, status: 'failed', error: 'Аккаунт уже выставлен в другом лоте' });
            continue;
        }
        if (normalizedDeliveryMode === 'files' && !intakeAssetIds.has(String(assetId))) {
            results.push({
                asset_id: assetId,
                status: 'failed',
                error: 'Файловая выдача доступна только для стока приёмки. Для подключённого юзербота используйте режим «Кабинет + архив» (hybrid).'
            });
            continue;
        }

        const itemPayload = {
            owner_id: ownerId,
            title: explicitTitle || buildAccountLotTitle({
                phone: account.tg_phone,
                createdAt: account.created_at
            }),
            description: description || null,
            post_purchase_message: null,
            item_type: 'account',
            price_ton: normalizedPriceTon,
            status: 'published',
            visibility: 'public',
            sales_channel: 'both',
            preview_text: 'Телеграм-аккаунт с полным комплектом: сессия, tdata и пароль 2FA.',
            payment_methods: ['ton'],
            offer_code: null,
            transfer_mode: 'ownership_transfer',
            delivery_mode: normalizedDeliveryMode
        };

        const { data: savedItem, error: insertError } = await supabase
            .from('shop_items')
            .insert(itemPayload)
            .select('id')
            .single();
        let itemId = savedItem?.id || null;
        if (insertError) {
            if (isMissingPaymentMethodsColumn(insertError) || isMissingSalesChannelColumn(insertError) || isMissingDeliveryModeColumn(insertError)) {
                const legacyPayload = { ...itemPayload };
                delete legacyPayload.payment_methods;
                delete legacyPayload.sales_channel;
                delete legacyPayload.delivery_mode;
                const legacy = await supabase
                    .from('shop_items')
                    .insert(legacyPayload)
                    .select('id')
                    .single();
                if (legacy.error) {
                    results.push({ asset_id: assetId, status: 'failed', error: 'Не удалось создать лот' });
                    continue;
                }
                itemId = legacy.data?.id || null;
            } else {
                results.push({ asset_id: assetId, status: 'failed', error: 'Не удалось создать лот' });
                continue;
            }
        }

        const { error: assetInsertError } = await supabase
            .from('shop_item_assets')
            .insert([{
                shop_item_id: itemId,
                asset_type: 'userbot',
                asset_id: account.id,
                label: account.custom_label || null,
                sort_order: 0
            }]);
        if (assetInsertError) {
            await supabase.from('shop_items').delete().eq('id', itemId);
            results.push({ asset_id: assetId, status: 'failed', error: 'Не удалось привязать аккаунт к лоту' });
            continue;
        }

        created += 1;
        results.push({ asset_id: assetId, item_id: itemId, status: 'ok' });
    }

    return { created, results };
}
