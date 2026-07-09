import { useCallback, useEffect, useRef, useState } from 'react';
import { Link2, Loader2, RefreshCw, Send, Wallet } from 'lucide-react';
import { useTonAddress, useTonWallet, useTonConnectModal } from '@tonconnect/ui-react';
import { useAuth } from '../../app/providers/AuthProvider.jsx';
import { apiRequest } from '../../api/client.js';
import {
  normalizeTonWallet,
  isValidTonWallet
} from '../../pages/payment-settings/payment-settings.utils.js';

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_DURATION_MS = 5 * 60 * 1000;

function normalizeTgId(value) {
  return String(value || '').replace(/[^\d]/g, '').trim();
}

export function ProfileContactsCard() {
  const { accessToken } = useAuth();
  const tonConnectAddress = useTonAddress();
  const tonConnectWallet = useTonWallet();
  const { open: openTonConnectModal } = useTonConnectModal();
  const tonConnected = Boolean(tonConnectWallet);

  const [tonValue, setTonValue] = useState('');
  const [tonSaved, setTonSaved] = useState('');
  const [tgIdValue, setTgIdValue] = useState('');
  const [tgIdSaved, setTgIdSaved] = useState('');
  const [tgUsername, setTgUsername] = useState(null);
  const [tgSource, setTgSource] = useState(null);
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);

  const [tgLoading, setTgLoading] = useState(true);
  const [tgError, setTgError] = useState('');
  const [linking, setLinking] = useState(false);
  const pollRef = useRef(null);
  const pollDeadlineRef = useRef(0);

  // Refs let polling/async callbacks read current state without
  // recreating the callback (which would retrigger effects → flicker).
  const tgIdSavedRef = useRef('');
  const tgSourceRef = useRef(null);
  tgIdSavedRef.current = tgIdSaved;
  tgSourceRef.current = tgSource;

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

  const loadTgStatus = useCallback(async () => {
    if (!accessToken) return;
    try {
      const data = await apiRequest('/api/profile/tg-link/status', { accessToken });
      if (data?.linked) {
        setTgUsername(data.telegram_username || null);
        setTgSource(data.source || null);
        const incoming = String(data.telegram_user_id || '');
        if (incoming && incoming !== tgIdSavedRef.current) {
          setTgIdValue(incoming);
          setTgIdSaved(incoming);
        }
      }
      setTgError('');
    } catch (err) {
      setTgError(err?.message || 'Не удалось проверить Telegram');
    }
  }, [accessToken]);

  useEffect(() => {
    loadSettings();
    loadTgStatus().finally(() => setTgLoading(false));
  }, [loadSettings, loadTgStatus]);

  useEffect(() => () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
  }, []);

  const handleContactsSave = useCallback(async () => {
    const wallet = normalizeTonWallet(tonValue);
    if (!isValidTonWallet(wallet)) {
      setToast({ kind: 'error', text: 'Некорректный TON-кошелёк' });
      return;
    }
    const normalizedTgId = normalizeTgId(tgIdValue);
    setSaving(true);
    setToast(null);
    setTgError('');
    try {
      await apiRequest('/api/payment-settings', {
        accessToken,
        method: 'POST',
        body: { ton_wallet: wallet, admin_tg_id: normalizedTgId }
      });
      setTonSaved(wallet);
      setTonValue(wallet);
      setTgIdSaved(normalizedTgId);
      setTgIdValue(normalizedTgId);
      // Manual save clears verification flag, source becomes 'manual'
      setTgUsername(null);
      setTgSource(normalizedTgId ? 'manual' : null);
      setToast({ kind: 'success', text: 'Сохранено' });
    } catch (err) {
      setToast({ kind: 'error', text: err?.message || 'Ошибка сохранения' });
    } finally {
      setSaving(false);
    }
  }, [accessToken, tonValue, tgIdValue]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollDeadlineRef.current = Date.now() + POLL_MAX_DURATION_MS;
    pollRef.current = window.setInterval(async () => {
      if (Date.now() > pollDeadlineRef.current) {
        stopPolling();
        setLinking(false);
        setTgError('Код истёк — попробуйте ещё раз');
        return;
      }
      try {
        const data = await apiRequest('/api/profile/tg-link/status', { accessToken });
        if (data?.linked) {
          const incoming = String(data.telegram_user_id || '');
          // Polling should fire when bot deep-link sets telegram_user_id (source flips to 'verified')
          // OR when value itself changes
          const becameVerified = data.source === 'verified' && tgSourceRef.current !== 'verified';
          if ((incoming && incoming !== tgIdSavedRef.current) || becameVerified) {
            setTgIdValue(incoming);
            setTgIdSaved(incoming);
            setTgUsername(data.telegram_username || null);
            setTgSource(data.source || null);
            stopPolling();
            setLinking(false);
            setTgError('');
          }
        }
      } catch {
        // silent — retry on next tick
      }
    }, POLL_INTERVAL_MS);
  }, [accessToken, stopPolling]);

  const handleTgLink = useCallback(async () => {
    setTgError('');
    setLinking(true);
    try {
      const data = await apiRequest('/api/profile/tg-link/init', {
        accessToken,
        method: 'POST',
        body: {}
      });
      if (!data?.deeplink_url) {
        throw new Error('Не удалось получить ссылку');
      }
      window.open(data.deeplink_url, '_blank', 'noopener,noreferrer');
      startPolling();
    } catch (err) {
      setLinking(false);
      setTgError(err?.message || 'Не удалось начать привязку');
    }
  }, [accessToken, startPolling]);

  const tonDirty = normalizeTonWallet(tonValue) !== normalizeTonWallet(tonSaved);
  const tgIdDirty = normalizeTgId(tgIdValue) !== normalizeTgId(tgIdSaved);
  const dirty = tonDirty || tgIdDirty;

  return (
    <div className="bg-white border border-slate-200/60 rounded-3xl p-6 md:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] space-y-7">
      <div>
        <h3 className="text-lg font-black text-slate-900 tracking-tight">Контакты</h3>
        <p className="text-sm text-slate-500 mt-0.5">
          TON-кошелёк для приёма платежей и Telegram ID для уведомлений.
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

      <div className="border-t border-slate-100 pt-6 space-y-3">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
          <Send className="w-4 h-4 text-slate-500" />
          Telegram
        </div>
        <input
          type="text"
          value={tgIdValue}
          onChange={(e) => setTgIdValue(e.target.value)}
          placeholder="123456789"
          spellCheck={false}
          inputMode="numeric"
          className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50/50 text-sm font-mono text-slate-900 focus:outline-none focus:border-slate-400 focus:bg-white transition-all"
        />
        <div>
          <button
            type="button"
            disabled={linking || tgLoading}
            onClick={handleTgLink}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-50 border border-sky-200 text-sky-700 text-xs font-bold hover:bg-sky-100 disabled:opacity-50 transition-all"
          >
            {linking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
            {linking ? 'Ждём подтверждения…' : 'Привязать через Telegram'}
          </button>
        </div>
        {tgError ? <p className="text-xs text-rose-600">{tgError}</p> : null}
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
          onClick={handleContactsSave}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Сохранить
        </button>
      </div>
    </div>
  );
}
