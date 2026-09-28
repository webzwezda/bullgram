import { beginCell } from '@ton/core';

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function buildTonPayload(memo) {
  if (memo == null || String(memo).length === 0) {
    throw new Error('memo required');
  }
  const cell = beginCell()
    .storeUint(0, 32)
    .storeStringTail(String(memo))
    .endCell();
  const bocBytes = cell.toBoc();
  const bytes = bocBytes instanceof Uint8Array ? bocBytes : new Uint8Array(bocBytes);
  return bytesToBase64(bytes);
}
