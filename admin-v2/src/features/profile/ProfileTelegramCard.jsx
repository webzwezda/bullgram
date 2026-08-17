import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { useAuth } from '../../app/providers/AuthProvider.jsx';
import { apiRequest } from '../../api/client.js';
import { TelegramLoginWidget } from '../telegram/TelegramLoginWidget.jsx';

function normalizeTgId(value) {
  return String(value || '').replace(/[^\d]/g, '').trim();
}

export function ProfileTelegramCard() {
  const { accessToken } = useAuth();

  const [tgIdValue, setTgIdValue] = useState('');
  const [tgIdSaved, setTgIdSaved] = useState('');
  const [tgUsername, setTgUsername] = useState(null);
  const [tgSource, setTgSource] = useState(null);
  const [botUsername, setBotUsername] = useState(null);
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const accessTokenRef = useRef('');
  accessTokenRef.current = accessToken;

  const applyBinding = useCallback((data) => {
    setTgUsername(data.telegram_username || null);
    setTgSource(data.source || null);
    const incoming = String(data.telegram_user_id || '');
    if (incoming) {
      setTgIdValue(incoming);
      setTgIdSaved(incoming);
    }
  }, []);

  const loadStatus = useCallback(async () => {
    if (!accessToken) return;
    try {
      const data = await apiRequest('/api/profile/telegram/status', { accessToken });
      if (data?.linked) {
        applyBinding(data);
      } else if (data?.manual_tg_id) {
        // ручной ID — предзаполняем поле, но это не «залогиненный» TG
        setTgIdValue(String(data.manual_tg_id));
        setTgIdSaved(String(data.manual_tg_id));
      }
      setBotUsername(data?.bot_username || null);
    } catch {
      // card stays in manual mode if status check fails
    }
  }, [accessToken, applyBinding]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleWidgetAuth = useCallback(async (user) => {
    if (!accessTokenRef.current) return;
    setVerifying(true);
    setToast(null);
    try {
      const data = await apiRequest('/api/profile/telegram/widget', {
        accessToken: accessTokenRef.current,
        method: 'POST',
        body: user
      });
      applyBinding(data);
      setToast({ kind: 'success', text: 'Telegram привязан' });
    } catch (err) {
      setToast({ kind: 'error', text: err?.message || 'Не удалось привязать Telegram' });
    } finally {
      setVerifying(false);
    }
  }, [applyBinding]);

  // Telegram Login Widget: подключается общим компонентом (уникальный глобальный колбэк на инстанс)


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

  const tgIdDirty = normalizeTgId(tgIdValue) !== normalizeTgId(tgIdSaved);
  const verified = tgSource === 'verified' && tgUsername;

  return (
    <div className="bg-white border border-slate-200/60 rounded-3xl p-6 md:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] space-y-7">
      <div>
        <h3 className="text-lg font-black text-slate-900 tracking-tight">Telegram</h3>
        <p className="text-sm text-slate-500 mt-0.5">
          Твой Telegram ID — сюда приходят уведомления: оплаты, конец триала, проблемы с юзерботами.
          Нажми «Log in to Telegram» — ID подтянется сам.
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
          <Send className="w-4 h-4 text-slate-500" />
          Telegram ID
        </div>

        {botUsername ? (
          <div className="flex items-center gap-3 flex-wrap">
            <TelegramLoginWidget botUsername={botUsername} onAuth={handleWidgetAuth} />
            {verifying ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Проверяем подпись…
              </span>
            ) : null}
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
          <p className="text-xs text-emerald-600 font-bold">Привязан: @{tgUsername}</p>
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
