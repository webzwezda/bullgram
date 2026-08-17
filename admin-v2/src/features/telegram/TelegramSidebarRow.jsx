import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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

  if (state.linked) {
    const label = state.telegramUsername
      ? `@${state.telegramUsername}`
      : (state.telegramUserId || 'Telegram привязан');
    return (
      <Link
        to="/profile"
        className="flex items-center justify-center gap-2 py-2 px-3 mb-4 bg-white hover:bg-slate-50 text-slate-600 text-xs font-bold rounded-lg border border-slate-200 transition-colors shadow-sm truncate"
        title="Telegram привязан — открыть профиль"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
        <span className="truncate">{label}</span>
      </Link>
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
