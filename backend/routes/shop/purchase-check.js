import { claimPaid, markExpired } from '../../services/payment-claim.service.js';
import { findUnsellableAccountLot } from '../../services/shop-delivery.service.js';
import { transferShopAssets } from '../../services/shop-transfer.service.js';
import { getShopFilesMaxDownloads, getShopFilesWindowHours } from '../../utils/shop-files.js';
import { applyShopOfferUnlock } from './purchase-core.js';
import {
    checkShopTonPayment,
    isPendingPurchaseExpired,
    isTextServiceItem,
    normalizePaymentMethod,
    siteWallet
} from './helpers.js';

export async function runShopPurchaseCheck(supabase, purchase, { enforceBuyerOwnerId = null, enforceSellerOwnerId = null, senderWallet = null, paymentCheckFn = null } = {}) {
    if (!purchase) {
        return {
            ok: false,
            statusCode: 404,
            body: { error: 'Покупка не найдена' }
        };
    }

    if (enforceBuyerOwnerId && String(purchase.buyer_owner_id) !== String(enforceBuyerOwnerId)) {
        return {
            ok: false,
            statusCode: 404,
            body: { error: 'Покупка не найдена' }
        };
    }

    if (enforceSellerOwnerId && String(purchase.seller_owner_id) !== String(enforceSellerOwnerId)) {
        return {
            ok: false,
            statusCode: 404,
            body: { error: 'Покупка не найдена' }
        };
    }

    if (purchase.status === 'paid' && purchase.ownership_transfer_status === 'completed') {
        return {
            ok: true,
            statusCode: 200,
            body: {
                success: true,
                status: 'paid',
                ownership_transfer_status: 'completed'
            }
        };
    }

    // Файловая выдача уже оформлена: повторная проверка оплаты не должна
    // перезапускать выдачу и не должна попадать в sold-race (лот уже помечен
    // sold, а ownership_transfer_status у files-выдачи остаётся pending —
    // передача прав для неё не существует).
    if (purchase.status === 'paid' && purchase.payload?.delivery?.mode === 'files') {
        return {
            ok: true,
            statusCode: 200,
            body: {
                success: true,
                status: 'paid',
                ownership_transfer_status: purchase.ownership_transfer_status || 'pending'
            }
        };
    }

    const paymentMethod = normalizePaymentMethod(purchase.payload?.payment_method);

    const memo = purchase.payload?.memo;
    const wallet = purchase.payload?.seller_wallet || siteWallet();
    const isPaid = paymentCheckFn
        ? await paymentCheckFn({ purchase })
        : await checkShopTonPayment({ memo, expectedAmountTon: purchase.amount_ton, wallet, senderWallet });

    // Платёж мог прийти после истечения брони. Деньги уже на кошельке сайта —
    // сначала ищем платёж и только потом решаем, истекла ли покупка.
    if (!isPaid) {
        if (purchase.status === 'expired' || isPendingPurchaseExpired(purchase)) {
            await markExpired({ supabase, table: 'shop_purchases', id: purchase.id });

            return {
                ok: false,
                statusCode: 400,
                body: {
                    error: 'Время на оплату истекло. Создай покупку заново.',
                    status: 'expired',
                    ownership_transfer_status: 'pending'
                }
            };
        }

        return {
            ok: true,
            statusCode: 200,
            body: {
                success: true,
                status: 'pending',
                ownership_transfer_status: purchase.ownership_transfer_status || 'pending'
            }
        };
    }

    const { data: item, error: itemError } = await supabase
        .from('shop_items')
        .select('*')
        .eq('id', purchase.shop_item_id)
        .single();
    if (itemError) throw itemError;
    const textServiceItem = isTextServiceItem(item);

    if (!textServiceItem && item.status === 'sold' && purchase.ownership_transfer_status !== 'completed') {
        // Платёж найден, но лот уже продан другому — фиксируем как paid+failed,
        // чтобы у покупки осталась долговечная запись для ручного возврата.
        if (purchase.status === 'pending') {
            await supabase
                .from('shop_purchases')
                .update({
                    status: 'paid',
                    ownership_transfer_status: 'failed',
                    ownership_transfer_error: 'Платёж получен, но лот уже продан другому покупателю — нужен возврат',
                    updated_at: new Date().toISOString()
                })
                .eq('id', purchase.id)
                .eq('status', 'pending');
        }
        return {
            ok: false,
            statusCode: 400,
            body: {
                error: 'Лот уже ушел другому покупателю. Платёж получен — свяжитесь с поддержкой для возврата.',
                status: 'failed',
                ownership_transfer_status: 'failed'
            }
        };
    }

    const { data: assets, error: assetsError } = await supabase
        .from('shop_item_assets')
        .select('*')
        .eq('shop_item_id', purchase.shop_item_id)
        .order('sort_order', { ascending: true });
    if (assetsError) throw assetsError;

    const nowIso = new Date().toISOString();

    // Опоздавший платёж: строка уже истекла, а claimPaid делает CAS только по
    // status='pending'. Возвращаем в pending, чтобы стандартный зачёт сработал.
    if (purchase.status === 'expired') {
        await supabase
            .from('shop_purchases')
            .update({ status: 'pending', updated_at: nowIso })
            .eq('id', purchase.id)
            .eq('status', 'expired');
    }

    const claimed = await claimPaid({
        supabase,
        table: 'shop_purchases',
        id: purchase.id,
        patch: {
            status: 'paid',
            ownership_transfer_status: textServiceItem ? 'completed' : (purchase.ownership_transfer_status || 'pending'),
            ownership_transfer_error: null,
            updated_at: nowIso
        }
    });

    if (!claimed) {
        // Race: другой worker уже обработал платёж. Не запускать asset transfer повторно.
        const { data: fresh } = await supabase
            .from('shop_purchases')
            .select('status, ownership_transfer_status')
            .eq('id', purchase.id)
            .maybeSingle();

        if (fresh?.status !== 'paid') {
            return {
                ok: false,
                statusCode: 409,
                body: {
                    error: 'Платёж найден, но зачесть его не удалось. Нажмите «Проверить оплату» ещё раз.',
                    status: 'pending',
                    ownership_transfer_status: fresh?.ownership_transfer_status || 'pending'
                }
            };
        }

        return {
            ok: true,
            statusCode: 200,
            body: {
                success: true,
                status: 'paid',
                ownership_transfer_status: fresh?.ownership_transfer_status || 'completed',
                already: true
            }
        };
    }

    if (textServiceItem) {
        await applyShopOfferUnlock(supabase, purchase, item);
        return {
            ok: true,
            statusCode: 200,
            body: {
                success: true,
                status: 'paid',
                ownership_transfer_status: 'completed'
            }
        };
    }

    // Отстойник: аккаунт испортился между бронью и оплатой. Платёж уже зачтён —
    // фиксируем paid+failed (по образцу sold-race выше), чтобы у покупки осталась
    // запись для ручного возврата, и не передаём проблемный аккаунт покупателю.
    const isAccountLotItem = item.item_type === 'account';
    const accountDeliveryMode = isAccountLotItem
        ? String(item.delivery_mode || 'transfer').trim().toLowerCase()
        : null;
    const userbotAssetIds = (assets || [])
        .filter(asset => asset.asset_type === 'userbot')
        .map(asset => String(asset.asset_id));
    if (userbotAssetIds.length > 0) {
        const { data: transferUserbots, error: transferUserbotsError } = await supabase
            .from('tg_accounts')
            .select('id, tg_username, runtime_status, last_checked_at, health_summary, custom_label')
            .in('id', userbotAssetIds);
        if (transferUserbotsError) throw transferUserbotsError;
        // Аккаунт-лоты (intake): pending_activation со свежей чистой проверкой —
        // продаваемый сток, а не карантин (см. shop-delivery.service).
        const quarantineStatuses = ['restricted', 'expired', 'dead_proxy', 'error', 'pending_activation', 'frozen'];
        const quarantined = isAccountLotItem
            ? findUnsellableAccountLot(transferUserbots)
            : (transferUserbots || []).find(row =>
                quarantineStatuses.includes(String(row.runtime_status || '').trim().toLowerCase())
            );
        if (quarantined) {
            const reason = isAccountLotItem
                ? `Аккаунт ${quarantined.custom_label || quarantined.id} не готов к выдаче (${quarantined.runtime_status}) — передача не проведена, нужен возврат`
                : `Аккаунт @${quarantined.tg_username || quarantined.id} проблемный (${quarantined.runtime_status}) — передача не проведена, нужен возврат`;
            await supabase
                .from('shop_purchases')
                .update({
                    ownership_transfer_status: 'failed',
                    ownership_transfer_error: reason,
                    updated_at: new Date().toISOString()
                })
                .eq('id', purchase.id);
            return {
                ok: false,
                statusCode: 400,
                body: {
                    error: 'Оплата получена, но аккаунт в лоте оказался проблемным. Передача прав не проведена — свяжитесь с поддержкой для возврата.',
                    status: 'paid',
                    ownership_transfer_status: 'failed'
                }
            };
        }
    }

    // Аккаунт-лоты: файловая выдача (files, либо hybrid у анонимного покупателя —
    // покупка без JWT всегда остаётся files-delivery). Трансфера нет: архив
    // качается по квоте с публичной страницы покупки, нашу копию аккаунта
    // после окна удалит джоба sold-files-purge.
    if (isAccountLotItem && (accountDeliveryMode === 'files' || (accountDeliveryMode === 'hybrid' && !purchase.buyer_owner_id))) {
        const delivery = {
            mode: 'files',
            downloads: [],
            downloads_max: getShopFilesMaxDownloads(),
            window_hours: getShopFilesWindowHours(),
            purged_at: null,
            sha256: null,
            size_bytes: null
        };

        await supabase
            .from('shop_items')
            .update({ status: 'sold', visibility: 'private', updated_at: nowIso })
            .eq('id', item.id);

        await supabase
            .from('shop_purchases')
            .update({
                delivered_at: nowIso,
                payload: { ...(purchase.payload || {}), delivery },
                updated_at: nowIso
            })
            .eq('id', purchase.id);

        return {
            ok: true,
            statusCode: 200,
            body: {
                success: true,
                status: 'paid',
                ownership_transfer_status: purchase.ownership_transfer_status || 'pending'
            }
        };
    }

    // Страховочный предохранитель (ревью P0): трансфер на buyer_owner_id=NULL
    // создаёт осиротевшие строки. Не-аккаунтный лот анонимно купить нельзя
    // (гейт в purchase-anon), аккаунтный без покупателя ушёл в files-ветку
    // выше — сюда без покупателя дойти не должно, но если дошло: paid+failed.
    if (!purchase.buyer_owner_id) {
        const reason = 'Анонимная оплата лота без покупателя — передача прав невозможна, нужен возврат';
        await supabase
            .from('shop_purchases')
            .update({
                ownership_transfer_status: 'failed',
                ownership_transfer_error: reason,
                updated_at: nowIso
            })
            .eq('id', purchase.id);
        return {
            ok: false,
            statusCode: 400,
            body: {
                error: 'Оплата получена, но у покупки нет покупателя для передачи прав. Свяжитесь с поддержкой для возврата.',
                status: 'paid',
                ownership_transfer_status: 'failed'
            }
        };
    }

    try {
        await transferShopAssets(supabase, purchase, item, assets || []);

        const completionPatch = {
            ownership_transfer_status: 'completed',
            ownership_transfer_error: null,
            updated_at: new Date().toISOString()
        };
        if (isAccountLotItem && accountDeliveryMode === 'hybrid') {
            // Гибрид: аккаунт передан покупателю, архив остаётся downloadable
            // бессрочно — это данные покупателя, пуржа для них нет.
            completionPatch.delivered_at = completionPatch.updated_at;
            completionPatch.payload = {
                ...(purchase.payload || {}),
                delivery: { mode: 'hybrid', transferred: true }
            };
        }

        await supabase
            .from('shop_purchases')
            .update(completionPatch)
            .eq('id', purchase.id);

        return {
            ok: true,
            statusCode: 200,
            body: {
                success: true,
                status: 'paid',
                ownership_transfer_status: 'completed'
            }
        };
    } catch (transferError) {
        console.error('Ошибка перевода прав shop purchase:', transferError);
        await supabase
            .from('shop_purchases')
            .update({
                ownership_transfer_status: 'failed',
                ownership_transfer_error: transferError.message || 'Неизвестная ошибка',
                updated_at: new Date().toISOString()
            })
            .eq('id', purchase.id);

        return {
            ok: false,
            statusCode: 500,
            body: {
                error: 'Оплата найдена, но перевод прав сломался',
                status: 'paid',
                ownership_transfer_status: 'failed'
            }
        };
    }
}
