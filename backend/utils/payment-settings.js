const CANONICAL_SBP_BANKS = [
    'Сбербанк',
    'Т-Банк'
];

function canonicalSbpBankName(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return null;
    if (raw.includes('сбер')) return 'Сбербанк';
    if (raw.includes('тинь') || raw.includes('т-банк') || raw.includes('т банк') || raw === 'тбанк') return 'Т-Банк';
    return null;
}

export function normalizeSbpBankSelection(value, { fallbackToDefault = true } = {}) {
    const rawItems = Array.isArray(value)
        ? value
        : String(value || '')
            .split(/[,;\n]/)
            .map((item) => item.trim())
            .filter(Boolean);

    const normalizedSet = new Set();
    rawItems.forEach((item) => {
        const canonical = canonicalSbpBankName(item);
        if (canonical) {
            normalizedSet.add(canonical);
        }
    });

    if (!normalizedSet.size && fallbackToDefault) {
        normalizedSet.add('Т-Банк');
    }

    return CANONICAL_SBP_BANKS.filter((item) => normalizedSet.has(item)).join(', ');
}
