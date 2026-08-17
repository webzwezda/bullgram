import { useState } from 'react';
import { useTonAddress, useTonWallet, useTonConnectModal, useTonConnectUI } from '@tonconnect/ui-react';
import { toast } from 'sonner';
import { Copy, Loader2, Wallet, X } from 'lucide-react';

function shortAddress(addr) {
  if (!addr || addr.length < 12) return addr || '';
  return `${addr.slice(0, 4)}…${addr.slice(-6)}`;
}

export function TonWalletSidebarRow() {
  const address = useTonAddress();
  const wallet = useTonWallet();
  const { open } = useTonConnectModal();
  const [tonConnectUI] = useTonConnectUI();
  const [disconnecting, setDisconnecting] = useState(false);
  const connected = Boolean(wallet);

  async function disconnect() {
    setDisconnecting(true);
    try {
      await tonConnectUI.disconnect();
    } catch {
      // стейт кошелька обновится подписками TonConnect даже при ошибке
    } finally {
      setDisconnecting(false);
    }
  }

  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      toast.success('Адрес кошелька скопирован');
    } catch {
      toast.error('Не удалось скопировать адрес');
    }
  }

  if (connected) {
    return (
      <div className="flex items-center gap-1.5 mb-4">
        <button
          type="button"
          onClick={open}
          className="flex-1 min-w-0 flex items-center justify-center gap-2 py-2 px-3 bg-white hover:bg-slate-50 text-slate-600 text-xs font-bold rounded-lg border border-slate-200 transition-colors shadow-sm truncate"
          title={address}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
          <span className="font-mono truncate">{shortAddress(address)}</span>
        </button>
        <button
          type="button"
          onClick={copyAddress}
          className="w-8 h-8 shrink-0 flex items-center justify-center bg-white text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded-lg border border-slate-200 transition-colors shadow-sm"
          title="Скопировать адрес кошелька"
          aria-label="Скопировать адрес кошелька"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={disconnect}
          disabled={disconnecting}
          className="w-8 h-8 shrink-0 flex items-center justify-center bg-white hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg border border-slate-200 transition-colors shadow-sm disabled:opacity-50"
          title="Отключить кошелёк"
          aria-label="Отключить кошелёк"
        >
          {disconnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
        </button>
      </div>
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
