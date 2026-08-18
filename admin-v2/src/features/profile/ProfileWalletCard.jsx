import { useCallback, useEffect, useRef, useState } from 'react';
import { useTonAddress, useTonWallet, useTonConnectModal, useTonConnectUI } from '@tonconnect/ui-react';
import { toast } from 'sonner';
import { Copy, Loader2, Wallet, X } from 'lucide-react';
import { useAuth } from '../../app/providers/AuthProvider.jsx';
import { apiRequest } from '../../api/client.js';

function shortAddress(addr) {
  if (!addr || addr.length < 12) return addr || '';
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}

export function ProfileWalletCard() {
  const { accessToken } = useAuth();
  const address = useTonAddress();
  const wallet = useTonWallet();
  const { open } = useTonConnectModal();
  const [tonConnectUI] = useTonConnectUI();
  const [savedAddress, setSavedAddress] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const autoSaved = useRef(false);

  const connected = Boolean(wallet);

  const loadWallet = useCallback(async () => {
    if (!accessToken) return;
    try {
      const data = await apiRequest('/api/profile/wallet', { accessToken });
      setSavedAddress(data?.address || null);
    } catch {
      // карточка остаётся в режиме «только TonConnect»
    } finally {
      setLoaded(true);
    }
  }, [accessToken]);

  useEffect(() => {
    loadWallet();
  }, [loadWallet]);

  // Автосейв: подключённый адрес запоминаем в профиле (display, «последний подключённый»)
  useEffect(() => {
    if (!connected || !address || !loaded || !accessToken) return;
    if (address === savedAddress || autoSaved.current === address) return;
    autoSaved.current = address;
    apiRequest('/api/profile/wallet', { accessToken, method: 'PUT', body: { address } })
      .then(() => setSavedAddress(address))
      .catch(() => { autoSaved.current = false; });
  }, [connected, address, loaded, savedAddress, accessToken]);

  async function copyAddress(value) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`Адрес кошелька скопирован: ${shortAddress(value)}`);
    } catch {
      toast.error('Не удалось скопировать адрес');
    }
  }

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

  async function forget() {
    if (!accessToken) return;
    setForgetting(true);
    try {
      await apiRequest('/api/profile/wallet', { accessToken, method: 'PUT', body: { address: null } });
      setSavedAddress(null);
      autoSaved.current = false;
    } catch (err) {
      toast.error(err?.message || 'Не удалось забыть адрес');
    } finally {
      setForgetting(false);
    }
  }

  const shown = connected ? address : savedAddress;

  return (
    <div className="bg-white border border-slate-200/60 rounded-3xl p-6 md:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] space-y-7">
      <div>
        <h3 className="text-lg font-black text-slate-900 tracking-tight">Кошелёк TON</h3>
        <p className="text-sm text-slate-500 mt-0.5">
          Кошелёк, с которого ты платишь. Адрес запоминается при подключении — бери его отсюда для оплаты вручную.
          Это не касса: реквизиты для приёма денег — на странице «Оплата».
        </p>
      </div>

      <div className="space-y-3">
        {shown ? (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-bold">
                {connected ? 'Подключён сейчас' : 'Сохранённый адрес'}
              </span>
              <code className="text-xs font-mono text-slate-600 break-all select-all">{shortAddress(shown)}</code>
              <button
                type="button"
                onClick={() => copyAddress(shown)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 hover:text-slate-700 text-xs font-bold transition-all"
                title={shown}
              >
                <Copy className="w-3.5 h-3.5" />
                Копировать адрес
              </button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {!connected ? (
                <button
                  type="button"
                  onClick={open}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-sm font-bold transition-all"
                >
                  <Wallet className="w-4 h-4" />
                  Подключить кошелёк
                </button>
              ) : (
                <button
                  type="button"
                  onClick={disconnect}
                  disabled={disconnecting}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white hover:bg-rose-50 border border-slate-200 hover:border-rose-200 text-slate-500 hover:text-rose-600 text-sm font-bold transition-all disabled:opacity-50"
                >
                  {disconnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                  Отключить кошелёк
                </button>
              )}
              {savedAddress && !connected ? (
                <button
                  type="button"
                  onClick={forget}
                  disabled={forgetting}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white hover:bg-rose-50 border border-slate-200 hover:border-rose-200 text-slate-400 hover:text-rose-600 text-sm font-bold transition-all disabled:opacity-50"
                >
                  {forgetting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Забыть адрес
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={open}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-sm font-bold transition-all"
          >
            <Wallet className="w-4 h-4" />
            Подключить TON-кошелёк
          </button>
        )}
      </div>
    </div>
  );
}
