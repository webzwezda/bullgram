import { useCallback, useEffect, useState } from 'react';
import { Link2, Loader2, RefreshCw, Wallet } from 'lucide-react';
import { useTonAddress, useTonWallet, useTonConnectModal } from '@tonconnect/ui-react';
import { useAuth } from '../../app/providers/AuthProvider.jsx';
import { apiRequest } from '../../api/client.js';
import {
  normalizeTonWallet,
  isValidTonWallet
} from '../../pages/payment-settings/payment-settings.utils.js';

export function BillingContactsCard() {
  const { accessToken } = useAuth();
  const tonConnectAddress = useTonAddress();
  const tonConnectWallet = useTonWallet();
  const { open: openTonConnectModal } = useTonConnectModal();
  const tonConnected = Boolean(tonConnectWallet);

  const [tonValue, setTonValue] = useState('');
  const [tonSaved, setTonSaved] = useState('');
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);

  const loadSettings = useCallback(async () => {
    if (!accessToken) return;
    try {
      const data = await apiRequest('/api/payment-settings', { accessToken });
      const wallet = data?.settings?.ton_wallet || '';
      setTonSaved(wallet);
      // Only overwrite tonValue when DB actually has a wallet.
      // Otherwise leave the input empty — user decides what to put there
      // (manual paste or click «Взять из TON Connect»).
      if (wallet) {
        setTonValue(wallet);
      }
    } catch (err) {
      setToast({ kind: 'error', text: err?.message || 'Не удалось загрузить реквизиты' });
    }
  }, [accessToken]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleSave = useCallback(async () => {
    const wallet = normalizeTonWallet(tonValue);
    if (!isValidTonWallet(wallet)) {
      setToast({ kind: 'error', text: 'Некорректный TON-кошелёк' });
      return;
    }
    setSaving(true);
    setToast(null);
    try {
      await apiRequest('/api/payment-settings', {
        accessToken,
        method: 'POST',
        body: { ton_wallet: wallet }
      });
      setTonSaved(wallet);
      setTonValue(wallet);
      setToast({ kind: 'success', text: 'Сохранено' });
    } catch (err) {
      setToast({ kind: 'error', text: err?.message || 'Ошибка сохранения' });
    } finally {
      setSaving(false);
    }
  }, [accessToken, tonValue]);

  const dirty = normalizeTonWallet(tonValue) !== normalizeTonWallet(tonSaved);

  return (
    <div className="space-y-7">
      <div>
        <h3 className="text-lg font-black text-slate-900 tracking-tight">Реквизиты кассы</h3>
        <p className="text-sm text-slate-500 mt-0.5">
          TON-кошелёк, на который приходят оплаты по счетам sales-бота.
          Лоты витрины shop принимаются на кошелёк сайта — здесь его менять не нужно.
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
          <Wallet className="w-4 h-4 text-slate-500" />
          TON-кошелёк
        </div>
        <input
          type="text"
          value={tonValue}
          onChange={(e) => {
            setTonValue(e.target.value);
            if (toast) setToast(null);
          }}
          placeholder="UQ... или 0Q... или EQ..."
          spellCheck={false}
          className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50/50 text-sm font-mono text-slate-900 focus:outline-none focus:border-slate-400 focus:bg-white transition-all"
        />
        <div>
          <button
            type="button"
            onClick={() => {
              if (tonConnected && tonConnectAddress) {
                setTonValue(tonConnectAddress);
                if (toast) setToast(null);
              } else {
                openTonConnectModal();
              }
            }}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-50 border border-sky-200 text-sky-700 text-xs font-bold hover:bg-sky-100 transition-all"
          >
            {tonConnected ? <RefreshCw className="w-3 h-3" /> : <Link2 className="w-3 h-3" />}
            {tonConnected ? 'Взять из TON Connect' : 'Подключить TON Connect'}
          </button>
        </div>
      </div>

      {toast ? (
        <p className={`text-xs ${toast.kind === 'success' ? 'text-emerald-600' : 'text-rose-600'}`}>
          {toast.text}
        </p>
      ) : null}

      <div className="flex justify-end pt-2">
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={handleSave}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Сохранить
        </button>
      </div>
    </div>
  );
}
