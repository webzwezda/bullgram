// Параметры файловой выдачи аккаунт-лотов (account shop delivery, Wave 2).
// Общие для роута магазина, джобы пуржа и публичного представления выдачи:
// квота скачиваний на покупку и окно (часы с момента оплаты), после которого
// наша копия проданного аккаунта удаляется с серверов.

const DEFAULT_MAX_DOWNLOADS = 10;
const DEFAULT_WINDOW_HOURS = 168;

export function getShopFilesMaxDownloads() {
    const raw = Number(process.env.SHOP_FILES_MAX_DOWNLOADS || DEFAULT_MAX_DOWNLOADS);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_DOWNLOADS;
}

export function getShopFilesWindowHours() {
    const raw = Number(process.env.SHOP_FILES_DOWNLOAD_WINDOW_HOURS || DEFAULT_WINDOW_HOURS);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_WINDOW_HOURS;
}

// Публичное имя архива строится из маскированного номера (+13…642 — безопасно
// для витрины и файловой системы); реальный телефон нигде не участвует.
export function buildAccountArchiveBasename(label) {
    const digits = String(label || '').replace(/\D+/g, '');
    return digits ? `account-${digits}` : 'account';
}

// Маска в custom_label — конвенция, а не гарантия: если в базу попал полный
// номер, витрина и имя архива не должны его протащить (ревью волны 2).
export function maskLabelForPublic(label) {
    const raw = String(label || '').trim();
    if (!raw) return null;
    const digits = raw.replace(/\D+/g, '');
    if (digits.length > 6) {
        return `+${digits.slice(0, 2)}…${digits.slice(-3)}`;
    }
    return raw;
}
