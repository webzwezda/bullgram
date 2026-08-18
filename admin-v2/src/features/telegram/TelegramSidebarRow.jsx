import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Copy, Loader2, Send, X } from 'lucide-react';
import { useAuth } from '../../app/providers/AuthProvider.jsx';
import { apiRequest } from '../../api/client.js';
import { supabase } from '../../lib/supabase.js';

export function TelegramSidebarRow() {
  const { accessToken } = useAuth();
  const [state, setState] = useState({
    loading: true,
    linked: false,
    telegramUsername: null,
    manualTgId: null,
    canUnlink: true
  });
  const [linking, setLinking] = useState(false);
  const [unlinking, setUnlinking] = useState(false);

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
          // классический TG ID (цель уведомлений), не oauth-субъект
          manualTgId: data?.manual_tg_id ? String(data.manual_tg_id).trim() || null : null,
          canUnlink: data?.can_unlink !== false
        });
      })
      .catch(() => {
        if (!cancelled) setState((prev) => ({ ...prev, loading: false }));
      });
    return () => { cancelled = true; };
  }, [accessToken]);

  const handleLink = useCallback(async () => {
    setLinking(true);
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
      toast.error(err?.message || 'Не удалось привязать Telegram');
    } finally {
      setLinking(false);
    }
  }, []);

  const handleUnlink = useCallback(async () => {
    if (!accessToken) return;
    if (!state.canUnlink) {
      toast.error('Telegram — единственный способ входа в этот аккаунт. Сначала войдите через Google и привяжите его.');
      return;
    }
    setUnlinking(true);
    try {
      const { data: identitiesData, error: identitiesError } = await supabase.auth.getUserIdentities();
      if (identitiesError) throw identitiesError;
      const oidcIdentity = (identitiesData?.identities || []).find((identity) => identity.provider === 'custom:telegram');
      if (oidcIdentity) {
        const { error: unlinkError } = await supabase.auth.unlinkIdentity({ identity_id: oidcIdentity.identity_id || oidcIdentity.id });
        if (unlinkError) throw unlinkError;
      }
      await apiRequest('/api/profile/telegram', { accessToken, method: 'DELETE' });
      setState((prev) => ({ ...prev, linked: false, telegramUsername: null, telegramUserId: null }));
    } catch (err) {
      toast.error(err?.message || 'Не удалось отвязать Telegram');
    } finally {
      setUnlinking(false);
    }
  }, [accessToken, state.canUnlink]);

  async function copyTgId() {
    if (!state.manualTgId) return;
    try {
      await navigator.clipboard.writeText(state.manualTgId);
      toast.success(`TG ID скопирован: ${state.manualTgId}`);
    } catch {
      toast.error('Не удалось скопировать TG ID');
    }
  }

  if (state.linked) {
    const label = state.telegramUsername ? `@${state.telegramUsername}` : 'Telegram';
    return (
      <div className="flex items-center gap-1.5 mb-4">
        <Link
          to="/profile"
          className="flex-1 min-w-0 flex items-center justify-center gap-2 py-2 px-3 bg-white hover:bg-slate-50 text-slate-600 text-xs font-bold rounded-lg border border-slate-200 transition-colors shadow-sm truncate"
          title={state.manualTgId ? `TG ID: ${state.manualTgId} — открыть профиль` : 'Telegram привязан — открыть профиль'}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
          <span className="truncate">{label}</span>
        </Link>
        {state.manualTgId ? (
          <button
            type="button"
            onClick={copyTgId}
            className="w-8 h-8 shrink-0 flex items-center justify-center bg-white text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded-lg border border-slate-200 transition-colors shadow-sm"
            title="Скопировать Telegram ID"
            aria-label="Скопировать Telegram ID"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={handleUnlink}
          disabled={unlinking}
          className="w-8 h-8 shrink-0 flex items-center justify-center bg-white hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg border border-slate-200 transition-colors shadow-sm disabled:opacity-50"
          title={state.canUnlink ? 'Отвязать Telegram' : 'Единственный способ входа — отвязка недоступна'}
          aria-label="Отвязать Telegram"
        >
          {unlinking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handleLink}
      disabled={linking}
      className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold rounded-lg border border-sky-600 transition-colors shadow-sm mb-4 disabled:opacity-50"
    >
      {linking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
      Привязать Telegram
    </button>
  );
}
