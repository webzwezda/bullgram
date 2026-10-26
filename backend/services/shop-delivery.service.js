// Выдача аккаунт-лотов (account shop delivery, Wave 2).
// Чистые правила гейтов и файловая выдача для item_type='account':
//   - гейт продажи/выдачи аккаунта: intake-сток в safe-mode
//     (pending_activation) продаётся, если проверка свежая (≤6ч) и health
//     говорит online; плохие статусы — всегда отстойник;
//   - гейт трансфера: 'online' или свежий проверенный pending_activation;
//   - сборка архива покупки из зашифрованных blob'ов
//     userbot_restore_sources (session/json/tdata/2FA + README);
//   - prepareShopArchiveDelivery — вся логика статусов скачивания
//     (409/410/429), квота/окно, кэш sha256 и счётчик скачиваний.
// Роут (shop.routes.js) остаётся тонким: UUID/404 на покупку + заголовки ответа.
import crypto from 'crypto';
import AdmZip from 'adm-zip';
import { decrypt } from '../utils/crypto.js';
import {
    buildAccountArchiveBasename,
    getShopFilesMaxDownloads,
    getShopFilesWindowHours,
    maskLabelForPublic
} from '../utils/shop-files.js';

const ACCOUNT_FRESH_CHECK_WINDOW_MS = 6 * 60 * 60 * 1000;

export const ACCOUNT_LOT_NOT_READY_MESSAGE = 'Аккаунт не готов к продаже: запусти проверку Telegram (Гигиена аккаунтов)';
export const ARCHIVE_EXPIRED_MESSAGE = 'Срок выдачи истёк, архив удалён с серверов';
export const NOT_PAID_MESSAGE = 'Оплата ещё не подтверждена';

function isFreshAccountCheck(row) {
    const checkedAt = row?.last_checked_at ? new Date(row.last_checked_at).getTime() : 0;
    return Boolean(checkedAt) && (Date.now() - checkedAt) <= ACCOUNT_FRESH_CHECK_WINDOW_MS;
}

function accountHealthStatus(row) {
    return String(row?.health_summary?.status || '').trim().toLowerCase();
}

// Продаваемый аккаунт-лот: intake-сток в safe-mode считается живым, если
// отлёжка недавно подтвердила online; 'online' тоже требует свежей проверки —
// без неё аккаунт мог испортиться, а отстойник об этом ещё не знает.
// Всё остальное (restricted/frozen/expired/dead_proxy/error и неизвестное) — карантин.
function isSellableAccountLot(row) {
    const status = String(row?.runtime_status || '').trim().toLowerCase();
    if (status === 'online') return isFreshAccountCheck(row);
    if (status === 'pending_activation') {
        return accountHealthStatus(row) === 'online' && isFreshAccountCheck(row);
    }
    return false;
}

export function findUnsellableAccountLot(rows) {
    return (rows || []).find((row) => !isSellableAccountLot(row)) || null;
}

// Гейт трансфера аккаунт-лота (shop-transfer.service): 'online' пропускается
// как и раньше; pending_activation — только со свежей чистой проверкой отлёжки.
export function isTransferableAccountLot(account) {
    const status = String(account?.runtime_status || '').trim().toLowerCase();
    if (status === 'online') return true;
    if (status !== 'pending_activation') return false;
    return accountHealthStatus(account) === 'online' && isFreshAccountCheck(account);
}

function buildArchiveReadme(basename) {
    return [
        'Архив Telegram-аккаунта',
        '',
        'Состав архива:',
        `- ${basename}.session — сессия Telegram (sqlite),`,
        `- ${basename}.json — fingerprint для TelegramExpert (app_id, device и т.п.),`,
        '- tdata.zip — tdata для Telegram Desktop (если был в комплекте),',
        '- пароль-2fa.txt — пароль двухфакторной защиты (если был задан).',
        '',
        'Как запустить:',
        '1. TelegramExpert: укажи папку архива, подставь .session + .json — аккаунт поднимется через встроенный прокси.',
        '2. Telegram Desktop: распакуй tdata.zip рядом с exe и запусти Telegram (портативный) из этой папки.',
        '',
        'Важно: пока не сменишь пароль 2FA, не логинь этот аккаунт параллельно в официальные клиенты —',
        'сессии могут перетереть друг друга и аккаунт улетит в проверку.'
    ].join('\n');
}

// Сборка zip в памяти из зашифрованных blob'ов восстановления.
// В архиве только содержимое блобов и README — никаких tg_phone/username.
// fixedDate фиксирует даты записей zip: иначе AdmZip кладёт «сейчас», архив
// выходит недетерминированным и закэшированный sha256 не сходится с повторной
// отдачей (ревью P2).
export function buildShopFileArchive({ label, source, fixedDate = null }) {
    if (!source?.session_blob_encrypted) {
        throw new Error('Архив аккаунта не найден');
    }

    const basename = buildAccountArchiveBasename(maskLabelForPublic(label));
    const zip = new AdmZip();
    zip.addFile(`${basename}.session`, Buffer.from(decrypt(source.session_blob_encrypted), 'base64'));

    if (source.json_blob_encrypted) {
        zip.addFile(`${basename}.json`, Buffer.from(decrypt(source.json_blob_encrypted), 'utf8'));
    }
    if (source.tdata_blob_encrypted) {
        zip.addFile('tdata.zip', Buffer.from(decrypt(source.tdata_blob_encrypted), 'base64'));
    }
    if (source.two_fa_secret_encrypted) {
        zip.addFile('пароль-2fa.txt', Buffer.from(decrypt(source.two_fa_secret_encrypted), 'utf8'));
    }
    zip.addFile('README.txt', Buffer.from(buildArchiveReadme(basename), 'utf8'));

    if (fixedDate instanceof Date && !Number.isNaN(fixedDate.getTime())) {
        for (const entry of zip.getEntries()) {
            entry.header.time = fixedDate;
        }
    }

    const buffer = zip.toBuffer();
    return {
        buffer,
        basename,
        sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
        sizeBytes: buffer.length
    };
}

// Маскированный номер и id аккаунта лотa для публичной страницы и архива.
async function loadAccountLotAsset(supabase, shopItemId) {
    const { data: assets, error } = await supabase
        .from('shop_item_assets')
        .select('asset_id')
        .eq('shop_item_id', shopItemId)
        .eq('asset_type', 'userbot');
    if (error) throw error;

    const accountId = assets?.[0]?.asset_id || null;
    if (!accountId) return { accountId: null, label: null };

    const { data: account, error: accountError } = await supabase
        .from('tg_accounts')
        .select('custom_label')
        .eq('id', accountId)
        .maybeSingle();
    if (accountError) throw accountError;

    return { accountId, label: account?.custom_label || null };
}

// Маскированный номер аккаунт-лота для публичной страницы (+13…642).
export async function loadAccountLotLabel(supabase, shopItemId) {
    const { label } = await loadAccountLotAsset(supabase, shopItemId);
    return maskLabelForPublic(label);
}

// Публичное представление выдачи для страницы покупки (public-view).
// files — окно с момента оплаты + квота; hybrid с трансфером — бессрочно;
// pending — недоступно до оплаты.
export function buildAccountDeliveryView({
    status,
    deliveredAt,
    itemDeliveryMode,
    payloadDelivery,
    label = null,
    now = new Date()
}) {
    const delivery = payloadDelivery || null;
    const mode = String(delivery?.mode || itemDeliveryMode || 'transfer');
    const downloads = Array.isArray(delivery?.downloads) ? delivery.downloads : [];

    const view = {
        mode,
        available: false,
        reason: null,
        window_ends_at: null,
        downloads_used: downloads.length,
        downloads_max: delivery?.downloads_max ?? null,
        sha256: delivery?.sha256 ?? null,
        size_bytes: delivery?.size_bytes ?? null,
        label
    };

    if (status !== 'paid') {
        return { ...view, reason: NOT_PAID_MESSAGE };
    }

    if (delivery?.mode === 'hybrid' && delivery.transferred) {
        // Аккаунт передан покупателю — архив это его данные, качается бессрочно.
        return { ...view, available: true };
    }

    if (delivery?.mode === 'files') {
        if (delivery.purged_at) {
            return { ...view, reason: ARCHIVE_EXPIRED_MESSAGE };
        }
        const windowHours = Number(delivery.window_hours || getShopFilesWindowHours());
        const endsAtMs = deliveredAt ? new Date(deliveredAt).getTime() + windowHours * 60 * 60 * 1000 : 0;
        view.window_ends_at = endsAtMs ? new Date(endsAtMs).toISOString() : null;
        if (!endsAtMs || endsAtMs <= now.getTime()) {
            return { ...view, reason: ARCHIVE_EXPIRED_MESSAGE };
        }
        const maxDownloads = Number(delivery.downloads_max ?? getShopFilesMaxDownloads());
        if (maxDownloads > 0 && downloads.length >= maxDownloads) {
            return { ...view, reason: 'Лимит скачиваний исчерпан' };
        }
        return { ...view, available: true };
    }

    if (delivery) {
        // hybrid ещё не передан (трансфер в процессе или упал) — архива пока нет.
        return { ...view, reason: 'Аккаунт передаётся в кабинет — архив появится после передачи' };
    }

    return { ...view, reason: 'Файловая выдача для этой покупки не предусмотрена' };
}

// Выдача архива покупки: все гейты скачивания в одном месте, чтобы роут был
// тонким, а тесты гоняли статусы 409/410/429 и счётчик на моке supabase.
// rateCheck — rate-limit роута по IP (свой map на 10 rpm); false → 429.
export async function prepareShopArchiveDelivery(supabase, purchase, { ip = 'unknown', now = new Date(), rateCheck = () => true } = {}) {
    if (!purchase) {
        return { ok: false, statusCode: 404, error: 'Счёт не найден' };
    }
    if (purchase.status !== 'paid') {
        return { ok: false, statusCode: 409, error: NOT_PAID_MESSAGE };
    }

    const delivery = purchase.payload?.delivery || null;
    if (!delivery) {
        return { ok: false, statusCode: 404, error: 'Файловая выдача для этой покупки не предусмотрена' };
    }
    if (delivery.purged_at) {
        return { ok: false, statusCode: 410, error: ARCHIVE_EXPIRED_MESSAGE };
    }
    if (delivery.mode === 'files') {
        const windowHours = Number(delivery.window_hours || getShopFilesWindowHours());
        const endsAtMs = purchase.delivered_at
            ? new Date(purchase.delivered_at).getTime() + windowHours * 60 * 60 * 1000
            : 0;
        if (!endsAtMs || endsAtMs <= now.getTime()) {
            return { ok: false, statusCode: 410, error: ARCHIVE_EXPIRED_MESSAGE };
        }
    }
    if (delivery.mode === 'hybrid' && !delivery.transferred) {
        return { ok: false, statusCode: 409, error: 'Аккаунт ещё не передан покупателю' };
    }

    if (!rateCheck()) {
        return { ok: false, statusCode: 429, error: 'Слишком много запросов. Попробуйте позже.' };
    }

    const downloads = Array.isArray(delivery.downloads) ? delivery.downloads : [];
    const downloadsMax = Number(delivery.downloads_max || getShopFilesMaxDownloads());
    // Квота — только для files-выдачи (аноним): у переданного в кабинет hybrid
    // архив — данные покупателя, качается бессрочно (лимитирует только rate).
    if (delivery.mode !== 'hybrid' && downloadsMax > 0 && downloads.length >= downloadsMax) {
        return { ok: false, statusCode: 429, error: 'Лимит скачиваний для этой покупки исчерпан' };
    }

    const { accountId, label } = await loadAccountLotAsset(supabase, purchase.shop_item_id);

    const { data: source, error: sourceError } = await supabase
        .from('userbot_restore_sources')
        .select('session_blob_encrypted, json_blob_encrypted, tdata_blob_encrypted, two_fa_secret_encrypted')
        .eq('account_id', accountId)
        .maybeSingle();
    if (sourceError) throw sourceError;
    if (!source?.session_blob_encrypted) {
        // Покупка оплачена, а блобов нет — это не «срок истёк» (тот случай даёт
        // честное сообщение выше), а аномалия: не пугаем покупателя ложным
        // дедлайном, ведём в поддержку (ревью волны 2).
        return { ok: false, statusCode: 410, error: 'Архив пока недоступен — обратитесь в поддержку, покупка зафиксирована.' };
    }

    const fixedDate = purchase.delivered_at ? new Date(purchase.delivered_at) : null;
    const archive = buildShopFileArchive({ label, source, fixedDate });

    const nextDelivery = {
        ...delivery,
        downloads: [...downloads.slice(0, downloadsMax), { at: now.toISOString(), ip }]
    };
    if (!nextDelivery.sha256) nextDelivery.sha256 = archive.sha256;
    if (nextDelivery.size_bytes == null) nextDelivery.size_bytes = archive.sizeBytes;

    const { error: updateError } = await supabase
        .from('shop_purchases')
        .update({
            payload: { ...(purchase.payload || {}), delivery: nextDelivery },
            updated_at: now.toISOString()
        })
        .eq('id', purchase.id);
    if (updateError) throw updateError;

    return { ok: true, archive };
}
