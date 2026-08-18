import { useCallback, useEffect, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { useAuth } from '../../app/providers/AuthProvider.jsx';
import { apiRequest } from '../../api/client.js';
import { supabase } from '../../lib/supabase.js';

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
  const [linking, setLinking] = useState(false);

  const applyBinding = useCallback((data) => {
    setTgUsername(data.telegram_username || null);
    setTgSource(data?.linked ? (data.source || 'verified') : null);
    // поле уведомлений — только ручное значение; oauth-ID после логина сюда не пишем
    const manual = String(data.manual_tg_id || '').trim();
    setTgIdValue(manual);
    setTgIdSaved(manual);
  }, []);

  const loadStatus = useCallback(async () => {
    if (!accessToken) return;
    try {
      const data = await apiRequest('/api/profile/telegram/status', { accessToken });
      applyBinding(data);
    } catch {
      // card stays in manual mode if status check fails
    }
  }, [accessToken, applyBinding]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleLink = useCallback(async () => {
    setLinking(true);
    setToast(null);
    try {
      const { data, error } = await supabase.auth.linkIdentity({
        provider: 'custom:telegram',
        options: { redirectTo: `${window.location.origin}/app/profile` }
      });
      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
    } catch (err) {
      setToast({ kind: 'error', text: err?.message || 'Не удалось привязать Telegram' });
    } finally {
      setLinking(false);
    }
  }, []);

  const handleSave = useCallback(async () => {
    const normalizedTgId = normalizeTgId(tgIdValue);
    setSaving(true);
    setToast(null);
    try {
      await apiRequest('/api/payment-settings', {
        accessToken,
        method: 'POST',
        body: { admin_tg_id: normalizedTgId }
      });
      setTgIdSaved(normalizedTgId);
      setTgIdValue(normalizedTgId);
      setToast({ kind: 'success', text: 'Сохранено' });
    } catch (err) {
      setToast({ kind: 'error', text: err?.message || 'Ошибка сохранения' });
    } finally {
      setSaving(false);
    }
  }, [accessToken, tgIdValue]);

  const tgIdDirty = normalizeTgId(tgIdValue) !== normalizeTgId(tgIdSaved);
  const verified = tgSource === 'verified';

  return (
    <div className="bg-white border border-slate-200/60 rounded-3xl p-6 md:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] space-y-7">
      <div>
        <h3 className="text-lg font-black text-slate-900 tracking-tight">Telegram</h3>
        <p className="text-sm text-slate-500 mt-0.5">
          Твой Telegram ID — сюда приходят уведомления: оплаты, конец триала, проблемы с юзерботами.
          Это номер, который видят боты — узнай его у <span className="font-bold">@bullgram_getid_bot</span> и впиши сюда.
          Вход через Telegram подтверждает аккаунт, но даёт другой (OAuth) номер — для уведомлений он не подходит.
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
          <Send className="w-4 h-4 text-slate-500" />
          Telegram ID
        </div>

        {!verified ? (
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={handleLink}
              disabled={linking}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-sm font-bold transition-all disabled:opacity-50"
            >
              {linking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Привязать Telegram
            </button>
          </div>
        ) : null}

        <input
          type="text"
          value={tgIdValue}
          onChange={(e) => setTgIdValue(e.target.value)}
          placeholder="123456789"
          spellCheck={false}
          inputMode="numeric"
          className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50/50 text-sm font-mono text-slate-900 focus:outline-none focus:border-slate-400 focus:bg-white transition-all"
        />

        {verified ? (
          <p className="text-xs text-emerald-600 font-bold">
            {tgUsername ? `Привязан: @${tgUsername}` : 'Привязан через Telegram-логин'}
          </p>
        ) : null}
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
