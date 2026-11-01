// Автоназвание лота аккаунта (Wave 2, правка владельца): страна определяется
// по телефону аккаунта (заполняется отлёжкой при первом getMe), отлёжка —
// сколько дней прошло с импорта. Никаких ручных названий.

// Телефонные префиксы → страна (RU). Матчим по самому длинному префиксу;
// список — ходовые коды фермы/стоков, незнакомый код даёт «не определена».
const PHONE_COUNTRY_PREFIXES = [
    ['234', 'Нигерия'],
    ['998', 'Узбекистан'],
    ['996', 'Кыргызстан'],
    ['994', 'Азербайджан'],
    ['977', 'Непал'],
    ['971', 'ОАЭ'],
    ['92', 'Пакистан'],
    ['91', 'Индия'],
    ['90', 'Турция'],
    ['84', 'Вьетнам'],
    ['81', 'Япония'],
    ['80', 'Филиппины'],
    ['7', 'Россия'],
    ['66', 'Таиланд'],
    ['63', 'Филиппины'],
    ['62', 'Индонезия'],
    ['55', 'Бразилия'],
    ['52', 'Мексика'],
    ['49', 'Германия'],
    ['48', 'Польша'],
    ['44', 'Великобритания'],
    ['380', 'Украина'],
    ['374', 'Армения'],
    ['372', 'Эстония'],
    ['371', 'Латвия'],
    ['370', 'Литва'],
    ['375', 'Беларусь'],
    ['20', 'Египет'],
    ['1', 'США'],
    ['62', 'Индонезия']
].sort((left, right) => right[0].length - left[0].length);

export function phoneCountryName(phone) {
    const digits = String(phone || '').replace(/\D+/g, '');
    if (!digits) return null;
    const hit = PHONE_COUNTRY_PREFIXES.find(([prefix]) => digits.startsWith(prefix));
    return hit ? hit[1] : null;
}

function pluralizeRu(count, one, few, many) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
}

// «Телеграм аккаунт — страна: США, отлёжка: 30 дней». Отлёжка считается от
// импорта (created_at): неполные сутки — «меньше суток».
export function buildAccountLotTitle({ phone, createdAt, now = new Date() } = {}) {
    const country = phoneCountryName(phone) || 'не определена';
    const createdMs = createdAt ? new Date(createdAt).getTime() : NaN;
    let restPhrase = 'меньше суток';
    if (Number.isFinite(createdMs)) {
        const days = Math.floor(Math.max(0, now.getTime() - createdMs) / (24 * 60 * 60 * 1000));
        if (days >= 1) {
            restPhrase = `${days} ${pluralizeRu(days, 'день', 'дня', 'дней')}`;
        }
    }
    return `Телеграм аккаунт — страна: ${country}, отлёжка: ${restPhrase}`;
}
