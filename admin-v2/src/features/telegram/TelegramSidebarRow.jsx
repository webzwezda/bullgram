import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy, Loader2, X } from 'lucide-react';
import { useAuth } from '../../app/providers/AuthProvider.jsx';
import { apiRequest } from '../../api/client.js';
import { TelegramLoginWidget } from './TelegramLoginWidget.jsx';

export function TelegramSidebarRow() {
  const { accessToken } = useAuth();
  const [state, setState] = useState({
    loading: true,
    linked: false,
    telegramUsername: null,
    telegramUserId: null,
    botUsername: null
  });
  const [verifying, setVerifying] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    apiRequest('/api/profile/telegram/status', { accessToken })
      .then((data) => {
        if (cancelled) return;
        setState({
          loading: false,
          linked: Boolean(data?.linked),
          telegramUsername: data?.telegram_username || null,
          telegramUserId: data?.telegram_user_id ? String(data.telegram_user_id) : null,
          botUsername: data?.bot_username || null
        });
      })
      .catch(() => {
        if (!cancelled) setState((prev) => ({ ...prev, loading: false }));
      });
    return () => { cancelled = true; };
  }, [accessToken]);

  const handleAuth = useCallback(async (user) => {
    if (!accessToken) return;
    setVerifying(true);
    try {
      const data = await apiRequest('/api/profile/telegram/widget', {
        accessToken,
        method: 'POST',
        body: user
      });
      setState((prev) => ({
        ...prev,
        linked: true,
        telegramUsername: data?.telegram_username || null,
        telegramUserId: data?.telegram_user_id ? String(data.telegram_user_id) : null
      }));
    } catch {
      // детали ошибки покажет карточка на /app/profile
    } finally {
      setVerifying(false);
    }
  }, [accessToken]);

  const handleUnlink = useCallback(async () => {
    if (!accessToken) return;
    setUnlinking(true);
    try {
      await apiRequest('/api/profile/telegram', { accessToken, method: 'DELETE' });
      setState((prev) => ({ ...prev, linked: false, telegramUsername: null, telegramUserId: null }));
    } catch {
      // молча — повторная попытка через крестик
    } finally {
      setUnlinking(false);
    }
  }, [accessToken]);

  async function copyTgId() {
    if (!state.telegramUserId) return;
    try {
      await navigator.clipboard.writeText(state.telegramUserId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard недоступен — просто ничего не делаем
    }
  }

  if (state.linked) {
    const label = state.telegramUsername
      ? `@${state.telegramUsername}`
      : (state.telegramUserId || 'Telegram');
    return (
      <div className="flex items-center gap-1.5 mb-4">
        <Link
          to="/profile"
          className="flex-1 min-w-0 flex items-center justify-center gap-2 py-2 px-3 bg-white hover:bg-slate-50 text-slate-600 text-xs font-bold rounded-lg border border-slate-200 transition-colors shadow-sm truncate"
          title={state.telegramUserId ? `TG ID: ${state.telegramUserId} — открыть профиль` : 'Telegram привязан — открыть профиль'}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
          <span className="truncate">{label}</span>
        </Link>
        <button
          type="button"
          onClick={copyTgId}
          className={`w-8 h-8 shrink-0 flex items-center justify-center bg-white rounded-lg border border-slate-200 transition-colors shadow-sm ${
            copied ? 'text-emerald-600' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-50'
          }`}
          title="Скопировать Telegram ID"
          aria-label="Скопировать Telegram ID"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
        <button
          type="button"
          onClick={handleUnlink}
          disabled={unlinking}
          className="w-8 h-8 shrink-0 flex items-center justify-center bg-white hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg border border-slate-200 transition-colors shadow-sm disabled:opacity-50"
          title="Отвязать Telegram"
          aria-label="Отвязать Telegram"
        >
          {unlinking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
        </button>
      </div>
    );
  }

  return (
    <div className="mb-4 flex flex-col items-center gap-1">
      {state.botUsername ? (
        <TelegramLoginWidget botUsername={state.botUsername} onAuth={handleAuth} size="medium" radius={8} />
      ) : null}
      {verifying ? (
        <span className="text-[10px] font-bold text-slate-400">Проверяем подпись…</span>
      ) : null}
    </div>
  );
}
