export function getTonConnectManifestUrl() {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/app/tonconnect-manifest.json`;
  }
  return 'https://bullrun.ru/app/tonconnect-manifest.json';
}

async function buildTonCommentPayload(comment) {
  const value = String(comment || '').trim();
  if (!value) return null;
  const { beginCell } = await import('@ton/ton');
  return beginCell()
    .storeUint(0, 32)
    .storeStringTail(value)
    .endCell()
    .toBoc()
    .toString('base64');
}

export async function buildTonConnectTransaction({ address, amountTon, memo }) {
  const { toNano } = await import('@ton/ton');
  const payload = await buildTonCommentPayload(memo);
  return {
    validUntil: Math.floor(Date.now() / 1000) + 360,
    messages: [
      {
        address: String(address || '').trim(),
        amount: toNano(String(amountTon || 0)).toString(),
        ...(payload ? { payload } : {})
      }
    ]
  };
}

export function normalizeTonConnectError(error) {
  const message = String(error?.message || '').trim();
  if (!message) return 'Не удалось открыть оплату в кошельке.';
  if (message.includes('declined') || message.includes('rejected')) {
    return 'Кошелек отклонил оплату.';
  }
  if (message.includes('wallet is not connected')) {
    return 'Сначала подключи кошелек в браузере.';
  }
  return message;
}
