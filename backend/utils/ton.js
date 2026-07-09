const TON_SCALE = 9n;
const TON_NANO = 10n ** TON_SCALE;

export function tonToNano(value) {
    if (typeof value === 'bigint') return value;
    if (value === null || value === undefined || value === '') return 0n;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0n;
    // String split preserves precision for fractional TON amounts beyond Number.MAX_SAFE_INTEGER/1e9.
    const [whole, frac = ''] = String(value).split('.');
    const fracPadded = (frac + '0'.repeat(Number(TON_SCALE))).slice(0, Number(TON_SCALE));
    return BigInt(whole || '0') * TON_NANO + BigInt(fracPadded || '0');
}

export function tonToNanoString(value) {
    return tonToNano(value).toString();
}
