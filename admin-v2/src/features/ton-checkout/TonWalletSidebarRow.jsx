import { useTonAddress, useTonWallet, useTonConnectModal } from '@tonconnect/ui-react';
import { Wallet } from 'lucide-react';

function shortAddress(addr) {
  if (!addr || addr.length < 12) return addr || '';
  return `${addr.slice(0, 4)}…${addr.slice(-6)}`;
}

export function TonWalletSidebarRow() {
  const address = useTonAddress();
  const wallet = useTonWallet();
  const { open } = useTonConnectModal();
  const connected = Boolean(wallet);

  if (connected) {
    return (
      <button
        type="button"
        onClick={open}
        className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-white hover:bg-slate-50 text-slate-600 text-xs font-bold rounded-lg border border-slate-200 transition-colors shadow-sm mb-4"
        title={address}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        <span className="font-mono">{shortAddress(address)}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={open}
      className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold rounded-lg border border-sky-600 transition-colors shadow-sm mb-4"
    >
      <Wallet className="w-3.5 h-3.5" />
      Подключить TON-кошелёк
    </button>
  );
}
