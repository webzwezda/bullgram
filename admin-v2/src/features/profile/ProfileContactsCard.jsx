import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Link2, Loader2, LogOut, Send, Wallet } from 'lucide-react';
import { useAuth } from '../../app/providers/AuthProvider.jsx';
import { apiRequest } from '../../api/client.js';
import {
  normalizeTonWallet,
  isValidTonWallet
} from '../../pages/payment-settings/payment-settings.utils.js';

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_DURATION_MS = 5 * 60 * 1000;

function shortTg(id, username) {
  if (username) return `@${username}`;
  if (!id) return '';
  return `ID: ${id}`;
}

export function ProfileContactsCard() {
  const { accessToken } = useAuth();

  const [tonValue, setTonValue] = useState('');
  const [tonSaved, setTonSaved] = useState('');
  const [tonSaving, setTonSaving] = useState(false);
  const [tonToast, setTonToast] = useState(null);

  const [tgLinked, setTgLinked] = useState(null);
  const [tgLoading, setTgLoading] = useState(true);
  const [tgError, setTgError] = useState('');
  const [linking, setLinking] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const pollRef = useRef(null);
  const pollDeadlineRef = useRef(0);

  const loadSettings = useCallback(async () => {
    if (!accessToken) return;
    try {
      const data = await apiRequest('/api/payment-settings', { accessToken });
      const wallet = data?.settings?.ton_wallet || '';
      setTonValue(wallet);
      setTonSaved(wallet);
    } catch (err) {
      setTonToast({ kind: 'error', text: err?.message || 'Не удалось загрузить кошелёк' });
    }
  }, [accessToken]);

  const loadTgStatus = useCallback(async () => {
    if (!accessToken) return;
    try {
      const data = await apiRequest('/api/profile/tg-link/status', { accessToken });
      setTgLinked(data?.linked ? {
        telegram_user_id: data.telegram_user_id,
        telegram_username: data.telegram_username
      } : null);
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

  const handleTonSave = useCallback(async () => {
    const wallet = normalizeTonWallet(tonValue);
    if (!isValidTonWallet(wallet)) {
      setTonToast({ kind: 'error', text: 'Некорректный TON-кошелёк' });
      return;
    }
    setTonSaving(true);
    setTonToast(null);
    try {
      await apiRequest('/api/payment-settings', {
        accessToken,
        method: 'POST',
        body: { ton_wallet: wallet }
      });
      setTonSaved(wallet);
      setTonValue(wallet);
      setTonToast({ kind: 'success', text: 'Сохранено' });
    } catch (err) {
      setTonToast({ kind: 'error', text: err?.message || 'Ошибка сохранения' });
    } finally {
      setTonSaving(false);
    }
  }, [accessToken, tonValue]);

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
          setTgLinked({
            telegram_user_id: data.telegram_user_id,
            telegram_username: data.telegram_username
          });
          stopPolling();
          setLinking(false);
          setTgError('');
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

  const handleTgUnlink = useCallback(async () => {
    setTgError('');
    setUnlinking(true);
    try {
      await apiRequest('/api/profile/tg-link', { accessToken, method: 'DELETE' });
      setTgLinked(null);
    } catch (err) {
      setTgError(err?.message || 'Не удалось отвязать');
    } finally {
      setUnlinking(false);
    }
  }, [accessToken]);

  const tonDirty = normalizeTonWallet(tonValue) !== normalizeTonWallet(tonSaved);

  return (
    <div className="bg-white border border-slate-200/60 rounded-3xl p-6 md:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] space-y-7">
      <div>
        <h3 className="text-lg font-black text-slate-900 tracking-tight">Контакты</h3>
        <p className="text-sm text-slate-500 mt-0.5">
          TON-кошелёк для приёма платежей и Telegram для уведомлений.
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
          <Wallet className="w-4 h-4 text-slate-500" />
          TON-кошелёк
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={tonValue}
            onChange={(e) => {
              setTonValue(e.target.value);
              if (tonToast) setTonToast(null);
            }}
            placeholder="UQ... или 0Q... или EQ..."
            spellCheck={false}
            className="flex-1 px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50/50 text-sm font-mono text-slate-900 focus:outline-none focus:border-slate-400 focus:bg-white transition-all"
          />
          <button
            type="button"
            disabled={!tonDirty || tonSaving}
            onClick={handleTonSave}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {tonSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Сохранить
          </button>
        </div>
        {tonToast ? (
          <p className={`text-xs ${tonToast.kind === 'success' ? 'text-emerald-600' : 'text-rose-600'}`}>
            {tonToast.text}
          </p>
        ) : null}
      </div>

      <div className="border-t border-slate-100 pt-6 space-y-3">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
          <Send className="w-4 h-4 text-slate-500" />
          Telegram
        </div>

        {tgLoading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Проверяем статус…
          </div>
        ) : tgLinked ? (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-emerald-50 border border-emerald-200">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-bold text-emerald-800">
                  {shortTg(tgLinked.telegram_user_id, tgLinked.telegram_username)}
                </div>
                {tgLinked.telegram_user_id ? (
                  <div className="text-xs text-emerald-700/80 font-mono mt-0.5">
                    ID: {tgLinked.telegram_user_id}
                  </div>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              disabled={unlinking}
              onClick={handleTgUnlink}
              className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white border border-emerald-200 text-xs font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 transition-all"
            >
              {unlinking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />}
              Отвязать
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">
              Привяжите Telegram-аккаунт — откроется Telegram с готовой командой. После нажатия «Start» профиль обновится автоматически.
            </p>
            <button
              type="button"
              disabled={linking}
              onClick={handleTgLink}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-500 text-white text-sm font-bold hover:bg-sky-600 disabled:opacity-50 transition-all shadow-md shadow-sky-500/20"
            >
              {linking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
              {linking ? 'Ждём подтверждения в Telegram…' : 'Привязать Telegram'}
            </button>
          </div>
        )}

        {tgError ? <p className="text-xs text-rose-600">{tgError}</p> : null}
      </div>
    </div>
  );
}
