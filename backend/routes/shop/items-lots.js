// Массовые операции с лотами shop (стадия 2 разрезки shop.routes.js).
// Зона: POST items/batch-proxy, POST account-lots/batch,
// POST account-lots/scan (запуск), GET account-lots/scan (статус).
import { authenticateUser } from '../../middlewares/auth.middleware.js';
import { isAdminSeller } from './helpers.js';
import { loadOwnerUserbotProxyUsage, proxyHasUserbot } from './purchase-core.js';
import { createAccountLotsBatch } from './lots-batch.js';
import {
    SALE_SCAN_MISSING_MIGRATION_MESSAGE,
    attachListedItemIds,
    findActiveScan,
    isMissingScanTableError,
    loadScanCandidates,
    runSaleScan,
    scanItemLabel,
    sweepStaleScans
} from '../../services/sale-scan.service.js';

export function registerItemsLots(router, ctx) {
    const { supabase, userbotService } = ctx;

    // Массовое выставление серверных прокси: один лот на прокси, автотексты,
    // публикация сразу. Покупатель на витрине берёт сколько нужно штук одним платежом.
    router.post(['/admin/items/batch-proxy', '/seller/items/batch-proxy'], authenticateUser, async (req, res) => {
        const ownerId = req.user.id;
        const { proxy_ids = [], price_ton } = req.body;
        const normalizedPriceTon = Number(price_ton || 0);

        try {
            if (!isAdminSeller(req.profile)) {
                return res.status(403).json({ error: 'Продавать активы платформы может только пользователь с role admin.' });
            }

            const uniqueProxyIds = Array.from(new Set(
                (Array.isArray(proxy_ids) ? proxy_ids : [])
                    .filter((value) => value !== null && value !== undefined && String(value).trim() !== '')
            ));

            if (!uniqueProxyIds.length) {
                return res.status(400).json({ error: 'Выбери хотя бы один прокси' });
            }
            if (!(normalizedPriceTon > 0)) {
                return res.status(400).json({ error: 'Укажи цену лота в TON' });
            }

            const { data: proxyRows, error: proxiesError } = await supabase
                .from('proxies')
                .select('id, name, host, port, last_check_country, inventory_group')
                .eq('owner_id', ownerId)
                .in('id', uniqueProxyIds);
            if (proxiesError) throw proxiesError;

            const proxyById = new Map((proxyRows || []).map((row) => [String(row.id), row]));
            const errors = [];
            const candidates = [];

            for (const proxyId of uniqueProxyIds) {
                const proxy = proxyById.get(String(proxyId));
                if (!proxy) {
                    errors.push({ proxy_id: proxyId, error: 'Прокси не найден или чужой' });
                } else {
                    candidates.push(proxy);
                }
            }

            const { usage: proxyUsageMap } = await loadOwnerUserbotProxyUsage(supabase, ownerId);
            const shopSaleCandidates = [];
            for (const proxy of candidates) {
                if ((proxy.inventory_group || 'shop_sale') !== 'shop_sale') {
                    errors.push({ proxy_id: proxy.id, error: 'Прокси не в группе «На продажу»' });
                } else if (proxyHasUserbot(proxyUsageMap, proxy.id)) {
                    errors.push({ proxy_id: proxy.id, error: 'На прокси есть живой юзербот' });
                } else {
                    shopSaleCandidates.push(proxy);
                }
            }

            let listableProxies = shopSaleCandidates;
            if (shopSaleCandidates.length > 0) {
                const { data: existingItems, error: existingItemsError } = await supabase
                    .from('shop_items')
                    .select('id, title, status')
                    .eq('owner_id', ownerId)
                    .in('status', ['draft', 'published', 'sold']);
                // 'sold' тоже блокирует: files-продажа в течение окна выдачи
                // ещё держит нашу копию аккаунта — без этого её можно
                // выставить и продать второй раз (double-sell).
                if (existingItemsError) throw existingItemsError;

                let existingAssets = [];
                if ((existingItems || []).length > 0) {
                    const { data: rows, error: existingAssetsError } = await supabase
                        .from('shop_item_assets')
                        .select('shop_item_id, asset_type, asset_id')
                        .in('shop_item_id', (existingItems || []).map((item) => item.id));
                    if (existingAssetsError) throw existingAssetsError;
                    existingAssets = rows || [];
                }

                const itemById = new Map((existingItems || []).map((item) => [String(item.id), item]));
                const listedProxyIds = new Set(
                    existingAssets
                        .filter((asset) => asset.asset_type === 'proxy')
                        .map((asset) => String(asset.asset_id))
                );

                listableProxies = [];
                for (const proxy of shopSaleCandidates) {
                    if (listedProxyIds.has(String(proxy.id))) {
                        errors.push({ proxy_id: proxy.id, error: 'Прокси уже выставлен в другом лоте' });
                    } else {
                        listableProxies.push(proxy);
                    }
                }
            }

            const createdTitles = [];
            for (const proxy of listableProxies) {
                const title = String(proxy.name || '').trim() || `Прокси ${proxy.host}:${proxy.port}`;
                const previewText = 'Готовый серверный SOCKS5-прокси для одного Telegram-аккаунта.';
                const description = `Прокси ${proxy.host}:${proxy.port}${proxy.last_check_country ? ` • ${proxy.last_check_country}` : ''}.`;

                const itemPayload = {
                    owner_id: ownerId,
                    title,
                    description,
                    post_purchase_message: null,
                    item_type: 'proxy',
                    price_ton: normalizedPriceTon,
                    status: 'published',
                    visibility: 'public',
                    sales_channel: 'both',
                    preview_text: previewText,
                    payment_methods: ['ton'],
                    offer_code: null,
                    transfer_mode: 'ownership_transfer'
                };

                const { data: savedItem, error: insertError } = await supabase
                    .from('shop_items')
                    .insert(itemPayload)
                    .select('id')
                    .single();
                if (insertError) {
                    errors.push({ proxy_id: proxy.id, error: 'Не удалось создать лот' });
                    continue;
                }

                const { error: assetInsertError } = await supabase
                    .from('shop_item_assets')
                    .insert([{
                        shop_item_id: savedItem.id,
                        asset_type: 'proxy',
                        asset_id: proxy.id,
                        label: title,
                        sort_order: 0
                    }]);
                if (assetInsertError) {
                    await supabase.from('shop_items').delete().eq('id', savedItem.id);
                    errors.push({ proxy_id: proxy.id, error: 'Не удалось привязать прокси к лоту' });
                    continue;
                }

                createdTitles.push(title);
            }

            res.json({
                success: true,
                created: createdTitles.length,
                errors
            });
        } catch (error) {
            console.error('Ошибка массового выставления прокси:', error);
            res.status(500).json({ error: 'Ошибка массового выставления прокси' });
        }
    });

    // Массовое выставление аккаунтов из приёмки: один опубликованный лот на
    // аккаунт, гейты те же, что у одиночного создания. Упавший аккаунт не
    // мешает остальным — результаты по каждому в ответе.
    router.post('/admin/account-lots/batch', authenticateUser, async (req, res) => {
        const ownerId = req.user.id;

        try {
            if (!isAdminSeller(req.profile)) {
                return res.status(403).json({ error: 'Выставлять аккаунты платформы может только пользователь с role admin.' });
            }

            const { created, results } = await createAccountLotsBatch(supabase, {
                ownerId,
                assetIds: req.body?.asset_ids,
                priceTon: req.body?.price_ton,
                title: req.body?.title,
                description: req.body?.description || null,
                deliveryMode: req.body?.delivery_mode
            });

            res.json({ success: true, created, results });
        } catch (error) {
            if (error.statusCode) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            console.error('Ошибка массового выставления аккаунтов:', error);
            res.status(500).json({ error: 'Ошибка массового выставления аккаунтов' });
        }
    });

    // Скан «Найти аккаунты для продажи»: обходит ВЕСЬ юзербот-сток админа
    // (любой runtime_status, включая карантин; рабочие QR-импорты без restore
    // source тоже), по каждому делает живую проверку сессии (тот же код, что
    // у джобы отлёжки) и применяет вердикт с карантинными эффектами + правило
    // продажи (tdata/отлёжка). Один активный скан на владельца; прогресс
    // пишется после каждого айтема, UI поллит GET /admin/account-lots/scan.
    router.post('/admin/account-lots/scan', authenticateUser, async (req, res) => {
        const ownerId = req.user.id;

        try {
            if (!isAdminSeller(req.profile)) {
                return res.status(403).json({ error: 'Скан аккаунтов для продажи доступен только пользователю с role admin.' });
            }
            if (!userbotService) {
                return res.status(500).json({ error: 'Скан недоступен: userbotService не сконфигурирован.' });
            }

            const { data: existingScans, error: listError } = await supabase
                .from('account_sale_scans')
                .select('id, status, updated_at')
                .eq('owner_id', ownerId)
                .order('created_at', { ascending: false });
            if (listError) {
                if (isMissingScanTableError(listError)) {
                    return res.status(400).json({ error: SALE_SCAN_MISSING_MIGRATION_MESSAGE });
                }
                throw listError;
            }
            await sweepStaleScans(supabase, ownerId, existingScans || []);
            if (findActiveScan(existingScans || [])) {
                return res.status(409).json({ error: 'Скан уже идёт — дождись завершения' });
            }

            const rawScope = String(req.body?.scope || '').trim().toLowerCase();
            const scope = ['unlisted', 'listed'].includes(rawScope) ? rawScope : 'unlisted';

            const { accounts, orphanCount } = await loadScanCandidates(supabase, ownerId, scope);
            if (!accounts.length) {
                return res.status(400).json({ error: scope === 'listed'
                    ? 'Выставленных юзерботов не найдено'
                    : 'Юзерботов для скана не найдено — подключи или импортируй аккаунты' });
            }

            const { data: scanRow, error: insertError } = await supabase
                .from('account_sale_scans')
                .insert({
                    owner_id: ownerId,
                    scope,
                    status: 'processing',
                    total: accounts.length,
                    processed: 0,
                    failed: 0,
                    orphans: orphanCount,
                    items: accounts.map((account) => ({
                        account_id: account.id,
                        label: scanItemLabel(account),
                        status: 'queued'
                    }))
                })
                .select('id')
                .single();
            if (insertError) {
                // 23505 = partial unique index «один processing-скан на владельца»:
                // гонка двух одновременных POST прошла findActiveScan до инсерта.
                if (String(insertError.code || '') === '23505') {
                    return res.status(409).json({ error: 'Скан уже идёт — дождись завершения' });
                }
                throw insertError;
            }

            // Fire-and-forget: прогресс пишется в строку скана после каждого
            // айтема, ответ не ждёт обхода (~30-60 сек на аккаунт). Кандидаты
            // передаём из POST — без перечитывания между двумя запросами.
            runSaleScan(supabase, userbotService, {
                ownerId,
                scanId: scanRow.id,
                candidates: accounts,
                orphanCount
            }).catch((scanError) => {
                console.error('Продажа аккаунтов: фоновый скан упал:', scanError);
            });

            res.json({ success: true, scan_id: scanRow.id, total: accounts.length });
        } catch (error) {
            console.error('Ошибка запуска скана аккаунтов для продажи:', error);
            res.status(500).json({ error: 'Ошибка запуска скана аккаунтов для продажи' });
        }
    });

    // Последний скан владельца (полная строка с items и orphans). Зависшие
    // processing-строки старше часа свипом помечаются failed — скан умер
    // вместе с перезапуском сервера (fire-and-forget не переживает pm2 reload).
    router.get('/admin/account-lots/scan', authenticateUser, async (req, res) => {
        const ownerId = req.user.id;

        try {
            if (!isAdminSeller(req.profile)) {
                return res.status(403).json({ error: 'Скан аккаунтов для продажи доступен только пользователю с role admin.' });
            }

            const rawScope = String(req.query.scope || '').trim().toLowerCase();
            const scope = ['unlisted', 'listed'].includes(rawScope) ? rawScope : 'unlisted';

            const { data: rows, error } = await supabase
                .from('account_sale_scans')
                .select('*')
                .eq('owner_id', ownerId)
                .eq('scope', scope)
                .order('created_at', { ascending: false });
            if (error) {
                if (isMissingScanTableError(error)) {
                    return res.status(400).json({ error: SALE_SCAN_MISSING_MIGRATION_MESSAGE });
                }
                throw error;
            }

            const allRows = rows || [];
            await sweepStaleScans(supabase, ownerId, allRows);

            // listed_item_id по текущим публичным лотам: карточка умеет «Снять»
            // и прячет строки, чей лот уже снят/продан (см. attachListedItemIds).
            const scan = await attachListedItemIds(supabase, ownerId, allRows[0] || null);

            res.json({ scan });
        } catch (error) {
            console.error('Ошибка чтения скана аккаунтов для продажи:', error);
            res.status(500).json({ error: 'Ошибка чтения скана аккаунтов для продажи' });
        }
    });
}
