import { useTonAddress, useTonWallet, TonConnectButton } from '@tonconnect/ui-react';

function shortAddress(addr) {
  if (!addr || addr.length < 12) return addr || '';
  return `${addr.slice(0, 4)}…${addr.slice(-6)}`;
}

export function TonWalletSidebarRow() {
  const address = useTonAddress();
  const wallet = useTonWallet();
  const connected = Boolean(wallet);

  if (!connected) {
    return (
      <div className="flex justify-end mb-4">
        <TonConnectButton />
      </div>
    );
  }

  return (
    <div className="flex justify-end mb-4">
      <span
        className="inline-flex items-center gap-1.5 px-2 py-1 text-[11px] font-mono rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200"
        title={address}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        {shortAddress(address)}
      </span>
    </div>
  );
}
