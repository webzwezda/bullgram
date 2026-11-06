// Сценарий из test/test-shop-delivery.js (разрезка под лимит pre-commit; хост — test/test-shop-delivery.js).
import AdmZip from 'adm-zip';
import { ARCHIVE_EXPIRED_MESSAGE, prepareShopArchiveDelivery } from '../../services/shop-delivery.service.js';
import { assert, makeMockSupabase, baseTables, pendingPurchase, filesDelivery } from './shared.js';

export async function runPublicArchiveDownload() {
console.log('— Публичное скачивание архива —');

{
    const nowIso = new Date().toISOString();
    const supabase = makeMockSupabase(baseTables({
        shop_purchases: [pendingPurchase({
            status: 'paid',
            delivered_at: nowIso,
            payload: { memo: 'shop_x', seller_wallet: 'UQtestwalletforrunittests000', delivery: filesDelivery(nowIso) }
        })]
    }));
    const result = await prepareShopArchiveDelivery(supabase, supabase._tables.shop_purchases[0], {
        ip: '9.9.9.9',
        rateCheck: () => true
    });
    assert(result.ok === true, 'download: выдача прошла');
    assert(result.archive.basename === 'account-13642', 'download: basename из маскированного номера');
    const zip = new AdmZip(result.archive.buffer);
    const names = zip.getEntries().map((entry) => entry.entryName);
    assert(names.includes('account-13642.session'), 'download: session в архиве');
    assert(names.includes('account-13642.json'), 'download: json в архиве');
    assert(names.includes('tdata.zip'), 'download: tdata в архиве');
    assert(names.includes('пароль-2fa.txt'), 'download: пароль 2FA в архиве');
    assert(names.includes('README.txt'), 'download: README в архиве');
    assert(zip.getEntry('account-13642.session').getData().toString() === 'SESSION-SQLITE-BYTES', 'download: session распакован корректно');
    assert(zip.getEntry('пароль-2fa.txt').getData().toString() === 'p@ssw0rd-2fa', 'download: пароль 2FA читается');
    const deliveryRow = supabase._tables.shop_purchases[0].payload.delivery;
    assert(deliveryRow.downloads.length === 1 && deliveryRow.downloads[0].ip === '9.9.9.9', 'download: счётчик +1 с ip');
    assert(deliveryRow.sha256 === result.archive.sha256 && deliveryRow.sha256.length === 64, 'download: sha256 закэширован');
    assert(deliveryRow.size_bytes === result.archive.sizeBytes && deliveryRow.size_bytes > 0, 'download: размер закэширован');
}
{
    const supabase = makeMockSupabase(baseTables({
        shop_purchases: [pendingPurchase({ status: 'pending' })]
    }));
    const result = await prepareShopArchiveDelivery(supabase, supabase._tables.shop_purchases[0], { rateCheck: () => true });
    assert(result.ok === false && result.statusCode === 409, 'download: неоплаченная покупка → 409');
}
{
    const oldIso = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const supabase = makeMockSupabase(baseTables({
        shop_purchases: [pendingPurchase({
            status: 'paid',
            delivered_at: oldIso,
            payload: { memo: 'shop_x', delivery: filesDelivery(oldIso) }
        })]
    }));
    const result = await prepareShopArchiveDelivery(supabase, supabase._tables.shop_purchases[0], { rateCheck: () => true });
    assert(result.ok === false && result.statusCode === 410 && result.error === ARCHIVE_EXPIRED_MESSAGE, 'download: окно истекло → 410');
}
{
    const nowIso = new Date().toISOString();
    const supabase = makeMockSupabase(baseTables({
        shop_purchases: [pendingPurchase({
            status: 'paid',
            delivered_at: nowIso,
            payload: { memo: 'shop_x', delivery: filesDelivery(nowIso, { purged_at: nowIso }) }
        })]
    }));
    const result = await prepareShopArchiveDelivery(supabase, supabase._tables.shop_purchases[0], { rateCheck: () => true });
    assert(result.ok === false && result.statusCode === 410, 'download: пуржнутое → 410');
}
{
    const nowIso = new Date().toISOString();
    const fullDownloads = Array.from({ length: 10 }, (_, index) => ({ at: nowIso, ip: `10.0.0.${index}` }));
    const supabase = makeMockSupabase(baseTables({
        shop_purchases: [pendingPurchase({
            status: 'paid',
            delivered_at: nowIso,
            payload: { memo: 'shop_x', delivery: filesDelivery(nowIso, { downloads: fullDownloads }) }
        })]
    }));
    const result = await prepareShopArchiveDelivery(supabase, supabase._tables.shop_purchases[0], { rateCheck: () => true });
    assert(result.ok === false && result.statusCode === 429, 'download: квота исчерпана → 429');
}
{
    const nowIso = new Date().toISOString();
    const supabase = makeMockSupabase(baseTables({
        shop_purchases: [pendingPurchase({
            status: 'paid',
            delivered_at: nowIso,
            payload: { memo: 'shop_x', delivery: filesDelivery(nowIso) }
        })]
    }));
    const result = await prepareShopArchiveDelivery(supabase, supabase._tables.shop_purchases[0], { rateCheck: () => false });
    assert(result.ok === false && result.statusCode === 429, 'download: rate-limit → 429');
}
}
