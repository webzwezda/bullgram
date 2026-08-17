import { useCallback, useEffect, useRef, useState } from 'react';
import { Link2, Loader2, Send } from 'lucide-react';
import { useAuth } from '../../app/providers/AuthProvider.jsx';
import { apiRequest } from '../../api/client.js';

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_DURATION_MS = 5 * 60 * 1000;

function normalizeTgId(value) {
  return String(value || '').replace(/[^\d]/g, '').trim();
}

export function ProfileTelegramCard() {
  const { accessToken } = useAuth();

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
    loadTgStatus().finally(() => setTgLoading(false));
  }, [loadTgStatus]);

  useEffect(() => () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
  }, []);

  const handleSave = useCallback(async () => {
    const normalizedTgId = normalizeTgId(tgIdValue);
    setSaving(true);
    setToast(null);
    setTgError('');
    try {
      await apiRequest('/api/payment-settings', {
        accessToken,
        method: 'POST',
        body: { admin_tg_id: normalizedTgId }
      });
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
  }, [accessToken, tgIdValue]);

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

  const tgIdDirty = normalizeTgId(tgIdValue) !== normalizeTgId(tgIdSaved);
  const verified = tgSource === 'verified' && tgUsername;

  return (
    <div className="bg-white border border-slate-200/60 rounded-3xl p-6 md:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] space-y-7">
      <div>
        <h3 className="text-lg font-black text-slate-900 tracking-tight">Telegram</h3>
        <p className="text-sm text-slate-500 mt-0.5">
          Твой Telegram ID — сюда приходят уведомления: оплаты, конец триала, проблемы с юзерботами.
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
          <Send className="w-4 h-4 text-slate-500" />
          Telegram ID
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
        {verified ? (
          <p className="text-xs text-emerald-600 font-bold">Привязан: @{tgUsername}</p>
        ) : null}
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
          disabled={!tgIdDirty || saving}
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
