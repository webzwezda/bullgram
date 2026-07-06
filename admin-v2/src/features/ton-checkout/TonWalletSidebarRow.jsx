import { useTonAddress, useTonWallet, TonConnectButton } from '@tonconnect/ui-react';
import { Wallet } from 'lucide-react';

function shortAddress(addr) {
  if (!addr || addr.length < 12) return addr || '';
  return `${addr.slice(0, 4)}…${addr.slice(-6)}`;
}

export function TonWalletSidebarRow() {
  const address = useTonAddress();
  const wallet = useTonWallet();
  const connected = Boolean(wallet);

  return (
    <div className="flex items-center justify-between gap-2 p-3 bg-slate-50 rounded-xl border border-slate-100 mb-4">
      <div className="flex items-center gap-2 min-w-0">
        <Wallet className="w-4 h-4 text-slate-400 shrink-0" />
        <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">TON</span>
      </div>
      <div className="flex items-center shrink-0">
        {connected ? (
          <span
            className="inline-flex items-center gap-1.5 px-2 py-1 text-[11px] font-mono rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200"
            title={address}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            {shortAddress(address)}
          </span>
        ) : (
          <TonConnectButton />
        )}
      </div>
    </div>
  );
}
