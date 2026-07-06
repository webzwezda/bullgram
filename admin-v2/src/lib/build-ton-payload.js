import { beginCell } from '@ton/core';

export function buildTonPayload(memo) {
  if (memo == null || String(memo).length === 0) {
    throw new Error('memo required');
  }
  const cell = beginCell()
    .storeUint(0, 32)
    .storeStringTail(String(memo))
    .endCell();
  return cell.toBoc().toString('base64');
}
