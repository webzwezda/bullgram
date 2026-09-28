import { useTonAddress, useTonWallet, TonConnectButton } from '@tonconnect/ui-react';

function shortAddress(addr) {
  if (!addr || addr.length < 12) return addr || '';
  return `${addr.slice(0, 4)}…${addr.slice(-6)}`;
}

export function TonWalletChip() {
  const address = useTonAddress();
  const wallet = useTonWallet();
  const connected = Boolean(wallet);

  if (!connected) {
    return (
      <div className="flex items-center gap-2">
        <TonConnectButton />
        <span className="text-xs text-slate-500">Подключите TON-кошелёк</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        {shortAddress(address)}
      </span>
    </div>
  );
}
